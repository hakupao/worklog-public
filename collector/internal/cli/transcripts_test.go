package cli

// Replays golden/cli_transcripts.json: Python's wl run as a subprocess against a stub server with a
// fake claude. Each scenario is re-run in process against an httptest stub that serves the replies
// Python got, and compared per stream, by exit code, by every request made (ordered-value bodies,
// byte-exact strings), every claude call (argv and stdin byte-exact), the outbox and the state file.

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

type transcript struct {
	o *pyjson.Object
}

func (s transcript) get(k string) pyjson.Value { v, _ := s.o.Get(k); return v }
func (s transcript) str(k string) string       { v, _ := s.get(k).(string); return v }
func (s transcript) list(k string) []pyjson.Value {
	v, _ := s.get(k).([]pyjson.Value)
	return v
}
func (s transcript) opt(k string) pyjson.Value {
	o, _ := s.get("options").(*pyjson.Object)
	if o == nil {
		return nil
	}
	v, _ := o.Get(k)
	return v
}

func loadTranscripts(t *testing.T) map[string]transcript {
	t.Helper()
	var raw []byte
	testkit.Golden(t, "cli_transcripts", &raw)
	v, err := pyjson.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	scen, _ := v.(*pyjson.Object).Get("scenarios")
	out := map[string]transcript{}
	for _, s := range scen.([]pyjson.Value) {
		tr := transcript{s.(*pyjson.Object)}
		out[tr.str("name")] = tr
	}
	return out
}

func field(v pyjson.Value, k string) pyjson.Value {
	o, _ := v.(*pyjson.Object)
	if o == nil {
		return nil
	}
	x, _ := o.Get(k)
	return x
}

func fstr(v pyjson.Value, k string) string { s, _ := field(v, k).(string); return s }

// servedPool hands out Python's replies: the first unused one for the same method and URI, else
// the last one used for it (the stub's sticky last reply).
type servedPool struct {
	mu     sync.Mutex
	served []pyjson.Value
	used   []bool
	last   map[string]pyjson.Value
}

func newPool(served ...[]pyjson.Value) *servedPool {
	p := &servedPool{last: map[string]pyjson.Value{}}
	for _, s := range served {
		p.served = append(p.served, s...)
	}
	p.used = make([]bool, len(p.served))
	return p
}

func (p *servedPool) answer(q seen) reply {
	p.mu.Lock()
	defer p.mu.Unlock()
	key := q.Method + " " + q.URI
	var hit pyjson.Value
	for i, s := range p.served {
		if !p.used[i] && fstr(s, "method")+" "+fstr(s, "path") == key {
			p.used[i] = true
			hit = s
			break
		}
	}
	if hit == nil {
		hit = p.last[key]
	}
	if hit == nil {
		return reply{status: 404, ctype: "text/plain", body: "no stub route"}
	}
	p.last[key] = hit
	r := reply{status: int(field(hit, "status").(pyjson.Int)), ctype: fstr(hit, "content_type"), body: fstr(hit, "body")}
	if h, ok := field(hit, "headers").(*pyjson.Object); ok {
		r.headers = map[string]string{}
		for _, k := range h.Keys() {
			v, _ := h.Get(k)
			r.headers[k] = v.(string)
		}
	}
	return r
}

// fakeClaude is gen_golden's FAKE_CLAUDE.
func fakeClaude(fail bool) func(string) (string, int) {
	return func(text string) (string, int) {
		if fail {
			return "", 1
		}
		switch {
		case strings.HasPrefix(text, "<transcript>"):
			sum := sha256.Sum256([]byte(text))
			return "要約 " + hex.EncodeToString(sum[:])[:8] + "\n", 0
		case strings.HasPrefix(text, "<week>"):
			return "## 本周概况\n复盘内容\n", 0
		case strings.HasPrefix(text, "<date>"):
			return verdicts(text, "<items>\n", "\n</items>", func(id pyjson.Value) *pyjson.Object {
				o := pyjson.NewObject()
				o.Set("id", id)
				o.Set("status", "done")
				o.Set("progress", "")
				o.Set("evidence", []pyjson.Value{})
				o.Set("note", "ok")
				return o
			}), 0
		case strings.HasPrefix(text, "<files>"):
			return verdicts(text, "<files>\n", "\n</files>", func(id pyjson.Value) *pyjson.Object {
				o := pyjson.NewObject()
				o.Set("id", id)
				o.Set("verdict", "in")
				o.Set("reason", "r")
				return o
			}), 0
		}
		return "", 0
	}
}

func verdicts(text, open, close string, one func(id pyjson.Value) *pyjson.Object) string {
	body := strings.SplitN(strings.SplitN(text, open, 2)[1], close, 2)[0]
	v, err := pyjson.Decode([]byte(body))
	if err != nil {
		panic(err)
	}
	var out []pyjson.Value
	for _, it := range v.([]pyjson.Value) {
		out = append(out, one(field(it, "id")))
	}
	return string(pyjson.Dumps(out, pyjson.Default())) + "\n"
}

// replay is one scenario's run: its world, stub and the masks to apply to the output.
type replay struct {
	w      *world
	stub   *stub
	pool   *servedPool
	masks  [][2]string
	corpus string
}

const transcriptConfig = "machine = \"mac mini 開発\"\nsummarize_model = \"haiku\"\n%s" +
	"[requesters]\n\"田中\" = \"田中さん（営業部）\"\n\"Team\" = \"Team\"\n[projects]\n\"/work/proj-a\" = \"ProjA\"\n"

// stage builds the scenario's directories, config, corpus copies and outbox as gen_cli_transcripts.
func stage(t *testing.T, s transcript, pool *servedPool) *replay {
	t.Helper()
	r := &replay{pool: pool}
	r.stub = newFnStub(t, pool.answer)
	url := r.stub.srv.URL + "/"
	if s.opt("dead_server") == true {
		url = deadURL(t)
	}
	creds := "api_token = \"tok\"\n"
	if s.opt("credentials") == false {
		creds = ""
	}
	r.w = newWorld(t, "", strings.Replace(transcriptConfig, "%s", "api_url = \""+url+"\"\n", 1), creds)
	w := r.w
	if unit, ok := s.opt("home_unit").(string); ok {
		rel := strings.TrimPrefix(unit, "logs/")
		moveInto(t, testkit.CopyCorpus(t, rel), filepath.Join(w.userHome, ".claude", "projects"))
		codex := rel
		if fi, err := os.Stat(filepath.Join(testkit.TestdataDir(t), "logs", filepath.FromSlash(rel), "sessions")); err == nil && fi.IsDir() {
			codex = rel + "/sessions"
		}
		moveInto(t, testkit.CopyCorpus(t, codex), filepath.Join(w.userHome, ".codex", "sessions"))
	}
	if ob := s.opt("outbox"); ob != nil {
		for i, n := range []struct{ id, text string }{{"N1", "一件目"}, {"N2", "二件目"}} {
			name := []string{"1791000000000000000-000000.json", "1791000000000000001-000001.json"}[i]
			writeFile(t, filepath.Join(w.home, "outbox", name),
				`{"method": "PUT", "path": "/api/notes/`+n.id+`", "body": {"id": "`+n.id+`", "text": "`+n.text+`"}}`)
		}
		if ob == "d14" {
			writeFile(t, filepath.Join(w.home, "outbox", "1791000000000000005-zzzzzz.json"), "[1, 2]")
		}
	}
	r.corpus = filepath.Join(w.work, "corpus")
	r.masks = [][2]string{{w.work, "<WORK>"}, {r.corpus, "<CORPUS>"}}
	if !strings.Contains(url, r.stub.srv.URL) {
		r.masks = append(r.masks, [2]string{":" + url[strings.LastIndex(url, ":")+1:len(url)-1], ":<PORT>"})
	} else {
		r.masks = append(r.masks, [2]string{r.stub.srv.URL[strings.LastIndex(r.stub.srv.URL, ":"):], ":<PORT>"})
	}
	old := noteTail
	noteTail = func() string { return "0000" } // uuid4 pinned to n*0x1111: hex[:4] is "0000"
	t.Cleanup(func() { noteTail = old })
	if s.opt("claude_mode") == "fail" {
		w.runner.answer = fakeClaude(true)
	} else {
		w.runner.answer = fakeClaude(false)
	}
	return r
}

// moveInto moves a CopyCorpus copy (mtimes applied) to dst.
func moveInto(t *testing.T, src, dst string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(src, dst); err != nil {
		t.Fatal(err)
	}
}

// argv substitutes <CORPUS>/logs/<rel> with a copy of that corpus directory.
func (r *replay) argv(t *testing.T, golden []pyjson.Value) []string {
	var out []string
	for _, a := range golden {
		s := a.(string)
		if strings.HasPrefix(s, "<CORPUS>/logs/") {
			rel := strings.TrimPrefix(s, "<CORPUS>/logs/")
			dst := filepath.Join(r.corpus, "logs", filepath.FromSlash(rel))
			if _, err := os.Stat(dst); err != nil {
				moveInto(t, testkit.CopyCorpus(t, rel), dst)
			}
			s = dst
		}
		out = append(out, s)
	}
	return out
}

func (r *replay) mask(s string) string {
	for _, m := range r.masks {
		s = strings.ReplaceAll(s, m[0], m[1])
	}
	return s
}

var workPath = regexp.MustCompile(`<WORK>[^\s;]*`)

// native turns the golden's POSIX spelling of a <WORK> path into what Python prints on this host:
// str(Path) is native, but the refused-session line appends a literal "/rejected/" to it
// (harvest/run.py:232), so on Windows that suffix keeps its forward slashes.
func native(s string) string {
	return nativeOn(runtime.GOOS, s)
}

func nativeOn(goos, s string) string {
	if goos != "windows" {
		return s
	}
	return workPath.ReplaceAllStringFunc(s, func(p string) string {
		p, lit := strings.CutSuffix(p, "/rejected/")
		p = strings.ReplaceAll(p, "/", `\`)
		if lit {
			p += "/rejected/"
		}
		return p
	})
}

// expected is what a scenario must produce in Go.
type expected struct {
	exit             int
	stdout, stderr   string
	compareStderr    bool
	requests, claude []pyjson.Value
	outbox           *pyjson.Object
	state            pyjson.Value
}

func expectedOf(s transcript) expected {
	e := expected{
		exit:     int(s.get("exit_code").(pyjson.Int)),
		stdout:   s.str("stdout"),
		requests: s.list("requests"),
		claude:   s.list("claude_calls"),
		state:    s.get("state_after"),
	}
	e.outbox, _ = s.get("outbox_after").(*pyjson.Object)
	if v, ok := s.get("stderr").(string); ok {
		e.stderr, e.compareStderr = native(v), true
	}
	return e
}

func TestCLITranscripts(t *testing.T) {
	all := loadTranscripts(t)
	for _, name := range slices.Sorted(func(yield func(string) bool) {
		for k := range all {
			if !yield(k) {
				return
			}
		}
	}) {
		s := all[name]
		t.Run(name, func(t *testing.T) {
			pool := newPool(s.list("served"))
			e := expectedOf(s)
			switch name {
			case "new_bad_received":
				// D13: the same order (after config and client), one line instead of a traceback.
				e.stderr, e.compareStderr = "error: --received must look like 2026-10-02\n", true
			case "harvest_outbox_non_object":
				// D14: Go sets the non-object file aside and the harvest runs, where Python's flush
				// raised. Everything after the flush is harvest_flushes_outbox's run.
				base := all["harvest_flushes_outbox"]
				pool = newPool(s.list("served"), base.list("served")[2:])
				be := expectedOf(base)
				e.exit, e.stdout, e.compareStderr = 0, be.stdout, true
				e.stderr = strings.Replace(be.stderr, "outbox: sent=1 remaining=0", "outbox: sent=2 remaining=0", 1)
				e.requests = append(slices.Clone(s.list("requests")), be.requests[2:]...)
				e.claude, e.state, e.outbox = be.claude, be.state, nil
			}
			r := stage(t, s, pool)
			code, out, errOut := r.w.run(r.argv(t, s.list("argv"))...)
			out, errOut = r.mask(out), r.mask(errOut)
			if code != e.exit {
				t.Errorf("exit %d, want %d (stderr %q)", code, e.exit, errOut)
			}
			if out != e.stdout {
				t.Errorf("stdout\n got %q\nwant %q", out, e.stdout)
			}
			if e.compareStderr && errOut != e.stderr {
				t.Errorf("stderr\n got %q\nwant %q", errOut, e.stderr)
			}
			if !e.compareStderr && errOut == "" {
				t.Errorf("stderr is empty; a usage error must say something")
			}
			compareRequests(t, r.stub.requests(), e.requests)
			compareClaude(t, r.w.runner.recorded(), e.claude)
			if name == "harvest_outbox_non_object" {
				b, err := os.ReadFile(filepath.Join(r.w.outbox(), "rejected", "1791000000000000005-zzzzzz.json"))
				if err != nil || string(b) != "[1, 2]" {
					t.Errorf("D14 file not set aside: %q %v", b, err)
				}
				if f := jsonFiles(t, r.w.outbox()); len(f) != 0 {
					t.Errorf("outbox left %v", f)
				}
				// N2 was accepted here: the D14 file is the only one set aside.
				if f := jsonFiles(t, filepath.Join(r.w.outbox(), "rejected")); len(f) != 1 {
					t.Errorf("rejected/ holds %v", f)
				}
			} else {
				compareOutbox(t, r.w.outbox(), e.outbox)
			}
			compareState(t, filepath.Join(r.w.home, "harvest_state.json"), e.state)
		})
	}
}

// requestHeaders are the headers gen_golden's stub recorded.
var requestHeaders = []string{"Authorization", "Content-Type", "CF-Access-Client-Id", "CF-Access-Client-Secret"}

func compareRequests(t *testing.T, got []seen, want []pyjson.Value) {
	t.Helper()
	n := max(len(got), len(want))
	for i := range n {
		if i >= len(got) {
			t.Errorf("request %d missing: want %s %s", i, fstr(want[i], "method"), fstr(want[i], "path"))
			continue
		}
		q := got[i]
		if i >= len(want) {
			t.Errorf("request %d extra: %s %s", i, q.Method, q.URI)
			continue
		}
		wq := want[i]
		if q.Method != fstr(wq, "method") || q.URI != fstr(wq, "path") {
			t.Errorf("request %d: %s %s, want %s %s", i, q.Method, q.URI, fstr(wq, "method"), fstr(wq, "path"))
			continue
		}
		for _, h := range requestHeaders {
			if g, w := q.Header.Get(h), fstr(field(wq, "headers"), h); g != w {
				t.Errorf("request %d %s: header %s = %q, want %q", i, q.URI, h, g, w)
			}
		}
		if ua := q.Header.Get("User-Agent"); ua != "worklog-cli/"+Version+" (go)" {
			t.Errorf("request %d: User-Agent %q", i, ua)
		}
		wb := field(wq, "body")
		if wb == nil {
			if len(q.Body) != 0 {
				t.Errorf("request %d %s: body %q, want none", i, q.URI, q.Body)
			}
			continue
		}
		gb, err := pyjson.Decode(q.Body)
		if err != nil || !pyjson.Equal(gb, wb) {
			t.Errorf("request %d %s: body\n got %s\nwant %s", i, q.URI, q.Body, pyjson.Compact(wb))
		}
	}
}

func compareClaude(t *testing.T, got []fakeCall, want []pyjson.Value) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%d claude calls, want %d", len(got), len(want))
	}
	for i := range min(len(got), len(want)) {
		var wa []string
		for _, a := range field(want[i], "argv").([]pyjson.Value) {
			wa = append(wa, a.(string))
		}
		if !slices.Equal(got[i].Argv[1:], wa) || got[i].Argv[0] != "claude" {
			t.Errorf("claude call %d argv %q, want claude %q", i, got[i].Argv, wa)
		}
		if ws := fstr(want[i], "stdin"); got[i].Stdin != ws {
			t.Errorf("claude call %d stdin\n got %q\nwant %q", i, got[i].Stdin, ws)
		}
	}
}

// parkedStamp is a name this run's outbox stamped from the frozen clock: Go's stamps and random
// tails differ from Python's counters, so such names are compared by directory and order only.
var parkedStamp = regexp.MustCompile(`^17918604\d{11}-[0-9a-f]{6}\.json$`)

func compareOutbox(t *testing.T, dir string, want *pyjson.Object) {
	t.Helper()
	var got []string
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".json") {
			rel, _ := filepath.Rel(dir, p)
			got = append(got, filepath.ToSlash(rel))
		}
		return nil
	})
	slices.Sort(got)
	var wantKeys []string
	if want != nil {
		wantKeys = want.Keys()
	}
	if len(got) != len(wantKeys) {
		t.Errorf("outbox %v, want %v", got, wantKeys)
		return
	}
	for i, g := range got {
		wk := wantKeys[i]
		gd, gn := filepath.ToSlash(filepath.Dir(g)), filepath.Base(g)
		wd, wn := filepath.ToSlash(filepath.Dir(wk)), filepath.Base(wk)
		if gd != wd || (gn != wn && !(parkedStamp.MatchString(gn) && strings.HasPrefix(wn, "17918604"))) {
			t.Errorf("outbox file %d %s, want %s", i, g, wk)
		}
		wv, _ := want.Get(wk)
		if gv := readJSON(t, filepath.Join(dir, filepath.FromSlash(g))); !pyjson.Equal(gv, wv) {
			t.Errorf("outbox %s\n got %s\nwant %s", g, pyjson.Compact(gv), pyjson.Compact(wv))
		}
	}
}

// compareState is spec §5.2's state level: the same key set, and per entry the same fields in the
// same order with mtime equal as float64 and fp equal.
func compareState(t *testing.T, path string, want pyjson.Value) {
	t.Helper()
	b, err := os.ReadFile(path)
	if want == nil {
		if err == nil {
			t.Errorf("state file written: %s", b)
		}
		return
	}
	if err != nil {
		t.Errorf("no state file: %v", err)
		return
	}
	gv, err := pyjson.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	g, w := gv.(*pyjson.Object), want.(*pyjson.Object)
	gk, wk := slices.Sorted(slices.Values(g.Keys())), slices.Sorted(slices.Values(w.Keys()))
	if !slices.Equal(gk, wk) {
		t.Errorf("state keys %v, want %v", gk, wk)
		return
	}
	for _, k := range wk {
		ge, _ := g.Get(k)
		we, _ := w.Get(k)
		if !slices.Equal(ge.(*pyjson.Object).Keys(), we.(*pyjson.Object).Keys()) || !pyjson.Equal(ge, we) {
			t.Errorf("state %s = %s, want %s", k, pyjson.Compact(ge), pyjson.Compact(we))
		}
	}
}

func TestNativeKeepsTheLiteralRejectedSuffix(t *testing.T) {
	in := "it is in <WORK>/home/outbox/rejected/ and; moved to <WORK>/home/outbox/rejected and"
	if got := nativeOn("darwin", in); got != in {
		t.Errorf("posix %q", got)
	}
	want := `it is in <WORK>\home\outbox/rejected/ and; moved to <WORK>\home\outbox\rejected and`
	if got := nativeOn("windows", in); got != want {
		t.Errorf("windows %q", got)
	}
}
