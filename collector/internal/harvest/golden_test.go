package harvest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/claudecode"
	"github.com/hakupao/worklog/collector/internal/codex"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/summarize"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// Goldens from gen_golden.gen_harvest: two harvests per corpus unit with since_days=None,
// workers=1, a store answering inserted=1, and summarize.summarize on a fake claude.

var goldenNow = time.Date(2026, 10, 13, 12, 0, 0, 123456000, time.FixedZone("JST", 9*3600))

// goldenEnv is gen_golden's process: HOME /home/wl (base._HOME, clean_paths' noise filter) and the
// fixed clock.
func goldenEnv(t *testing.T) (*rt.Env, *lockedBuffer) {
	env, stderr := testEnv(t, func() time.Time { return goldenNow })
	env.Home = "/home/wl"
	return env, stderr
}

func loadGolden(t *testing.T, name string) *pyjson.Object {
	t.Helper()
	var raw []byte
	testkit.Golden(t, name, &raw)
	v, err := pyjson.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	return v.(*pyjson.Object)
}

func at(o pyjson.Value, k string) pyjson.Value {
	v, ok := o.(*pyjson.Object).Get(k)
	if !ok {
		panic("missing " + k)
	}
	return v
}

func isError(v pyjson.Value) bool {
	o, ok := v.(*pyjson.Object)
	if !ok {
		return false
	}
	_, has := o.Get("error")
	return has
}

func date(v pyjson.Value) pytime.Date {
	d, err := pytime.ParseDate(v.(string))
	if err != nil {
		panic(err)
	}
	return d
}

// goldenTasks is HARVEST_TASKS through _task().
func goldenTasks(g *pyjson.Object) []model.Task {
	var out []model.Task
	for _, row := range at(g, "tasks").([]pyjson.Value) {
		r := row.([]pyjson.Value)
		t := model.NewTask(r[0].(string), pytime.Naive(time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)), "m", "r", "t", date(r[3]))
		t.Project, t.Status = r[1].(string), r[2].(string)
		if r[4] != nil {
			d := date(r[4])
			t.DoneAt = &d
		}
		out = append(out, t)
	}
	return out
}

func examplePricing(t *testing.T) map[string]map[string]float64 {
	var g struct {
		Pricing map[string]map[string]float64 `json:"pricing_example"`
	}
	testkit.Golden(t, "tokens", &g)
	if len(g.Pricing) == 0 {
		t.Fatal("no pricing_example")
	}
	return g.Pricing
}

// goldenCfg is _harvest_cfg.
func goldenCfg(t *testing.T, g *pyjson.Object) *config.Config {
	tmp := t.TempDir()
	cfg := &config.Config{
		Machine: "mac-golden", Root: filepath.Join(tmp, "root"), Home: filepath.Join(tmp, "home"),
		ExcludeCwdPatterns:    []string{"scratch-workspaces"},
		ExcludePromptPatterns: []string{"Review this change for security vulnerabilities"},
		Pricing:               examplePricing(t), SummarizeModel: "haiku", MinActiveMinutes: 3,
	}
	for _, p := range at(g, "projects").([]pyjson.Value) {
		pp := p.([]pyjson.Value)
		cfg.Projects = append(cfg.Projects, config.Project{Dir: pp[0].(string), Name: pp[1].(string)})
	}
	return cfg
}

// fakeClaude is _fake_claude_stdout: a hash-derived line, or exit 1 for every third prompt (by hash).
type fakeClaude struct {
	mu    sync.Mutex
	calls int
}

func (f *fakeClaude) Run(_ context.Context, _ []string, stdin []byte, _ time.Duration) (llm.Result, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	h := sha256.Sum256(stdin)
	hx := hex.EncodeToString(h[:])
	if h[0]%3 == 0 {
		return llm.Result{ExitCode: 1}, nil
	}
	return llm.Result{Stdout: []byte("  要約 " + hx[:8] + " — 作業をまとめた　\n")}, nil
}

func (f *fakeClaude) summarizer() Summarizer {
	return func(raw *session.RawSession, m string) (string, string) { return summarize.Summarize(f, raw, m) }
}

type goldenStore struct {
	tasks  []model.Task
	bodies []pyjson.Value
}

func (s *goldenStore) Tasks() ([]model.Task, error) { return s.tasks, nil }
func (s *goldenStore) Append(sess model.Session) (*api.IngestResult, api.Outcome) {
	s.bodies = append(s.bodies, sess.Object())
	return &api.IngestResult{Inserted: 1}, api.OK
}
func (s *goldenStore) OutboxDir() string { return "<outbox>" }

// unitRoots is gen_golden.unit_roots.
func unitRoots(unit string) []Root {
	cx := unit
	if fi, err := os.Stat(filepath.Join(unit, "sessions")); err == nil && fi.IsDir() {
		cx = filepath.Join(unit, "sessions")
	}
	return []Root{{"claude-code", unit}, {"codex", cx}}
}

func unitDir(logs, key string) string {
	return filepath.Join(logs, filepath.FromSlash(strings.TrimPrefix(key, "logs/")))
}

func resultObject(r Result) *pyjson.Object {
	o := pyjson.NewObject()
	for _, kv := range []struct {
		k string
		v int
	}{{"new", r.New}, {"updated", r.Updated}, {"skipped", r.Skipped}, {"fallback", r.Fallback},
		{"parked", r.Parked}, {"rejected", r.Rejected}, {"lost", r.Lost}} {
		o.Set(kv.k, pyjson.Int(kv.v))
	}
	return o
}

func lines(s string) []pyjson.Value {
	out := []pyjson.Value{}
	for _, l := range strings.Split(strings.TrimSuffix(s, "\n"), "\n") {
		if l != "" {
			out = append(out, l)
		}
	}
	return out
}

// sameState is the spec §5.2 state comparison: the same key set; per entry the same fields in the
// same order, mtime equal as float64, fp equal or absent on both sides.
func sameState(t *testing.T, name string, path string, want *pyjson.Object) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Errorf("%s: %v", name, err)
		return
	}
	gv, err := pyjson.Decode(b)
	if err != nil {
		t.Errorf("%s: state %v", name, err)
		return
	}
	got := gv.(*pyjson.Object)
	gk, wk := slices.Sorted(slices.Values(got.Keys())), slices.Sorted(slices.Values(want.Keys()))
	if !slices.Equal(gk, wk) {
		t.Errorf("%s: state keys\n%v\nwant\n%v", name, gk, wk)
		return
	}
	for _, k := range wk {
		g, w := at(got, k).(*pyjson.Object), at(want, k).(*pyjson.Object)
		if !slices.Equal(g.Keys(), w.Keys()) {
			t.Errorf("%s: %s fields %v, want %v", name, k, g.Keys(), w.Keys())
			continue
		}
		if num(at(g, "mtime")) != num(at(w, "mtime")) {
			t.Errorf("%s: %s mtime %v, want %v", name, k, at(g, "mtime"), at(w, "mtime"))
		}
		if fp, ok := w.Get("fp"); ok && at(g, "fp") != fp {
			t.Errorf("%s: %s fp %v, want %v", name, k, at(g, "fp"), fp)
		}
	}
}

func num(v pyjson.Value) float64 {
	switch x := v.(type) {
	case pyjson.Float:
		return float64(x)
	case pyjson.Int:
		return float64(x)
	}
	panic(fmt.Sprintf("not a number: %v", v))
}

func withFingerprintHook(t *testing.T, fn func([]byte)) {
	onFingerprint = fn
	t.Cleanup(func() { onFingerprint = nil })
}

// sessions.json + state_after_python.json + fingerprint.json "harvest": per unit, both runs' results
// and stderr, every body in send order (ordered-value), the state after them (§5.2 state level), and
// every fingerprint input byte-for-byte in the order Python took them.
func TestHarvestGolden(t *testing.T) {
	sessions := loadGolden(t, "sessions")
	states := at(loadGolden(t, "state_after_python"), "units").(*pyjson.Object)
	fpHarvest := at(loadGolden(t, "fingerprint"), "harvest").(*pyjson.Object)
	if ts := at(sessions, "ts"); ts != "2026-10-13T12:00:00.123456" {
		t.Fatalf("golden ts %v", ts)
	}
	logs := testkit.CopyCorpus(t, ".")
	units := at(sessions, "units").(*pyjson.Object)
	compared := 0
	for _, key := range units.Keys() {
		want := at(units, key)
		var inputs []pyjson.Value
		withFingerprintHook(t, func(b []byte) { inputs = append(inputs, string(b)) })
		cfg := goldenCfg(t, sessions)
		store := &goldenStore{tasks: goldenTasks(sessions)}
		claude := &fakeClaude{}
		roots := unitRoots(unitDir(logs, key))
		var runs []pyjson.Value
		for range 2 {
			env, stderr := goldenEnv(t)
			r, err := Run(cfg, store, roots, claude.summarizer(), nil, 1, nil, env)
			if err != nil {
				t.Fatalf("%s: %v", key, err)
			}
			run := pyjson.NewObject()
			run.Set("result", resultObject(r))
			run.Set("stderr", lines(stderr.String()))
			runs = append(runs, run)
		}
		if isError(want) {
			// Python raised (spec §6 D1–D4, D11, D12); Go harvests what the parsers kept, and only
			// warns.
			for _, rv := range runs {
				for _, l := range at(rv, "stderr").([]pyjson.Value) {
					if !strings.HasPrefix(l.(string), "worklog: ") {
						t.Errorf("%s: stderr %q", key, l)
					}
				}
			}
			continue
		}
		compared++
		if !pyjson.Equal(runs, at(want, "runs")) {
			t.Errorf("%s: runs\n%s\nwant\n%s", key, pyjson.Compact(runs), pyjson.Compact(at(want, "runs")))
		}
		wantBodies := at(want, "bodies").([]pyjson.Value)
		if !pyjson.Equal(store.bodies, wantBodies) {
			t.Errorf("%s: bodies\n%s\nwant\n%s", key, pyjson.Compact(store.bodies), pyjson.Compact(wantBodies))
		}
		sameState(t, key, cfg.StatePath(), at(states, key).(*pyjson.Object))
		wantFP, _ := fpHarvest.Get(key)
		if wantFP == nil {
			if len(inputs) != 0 {
				t.Errorf("%s: %d fingerprints taken, Python took none", key, len(inputs))
			}
			continue
		}
		var wantInputs []pyjson.Value
		for _, e := range wantFP.([]pyjson.Value) {
			wantInputs = append(wantInputs, at(e, "input"))
		}
		if !pyjson.Equal(inputs, wantInputs) {
			t.Errorf("%s: fingerprint inputs\n%v\nwant\n%v", key, inputs, wantInputs)
		}
	}
	if compared < 80 {
		t.Fatalf("only %d units compared", compared)
	}
}

// fingerprint.json "files": every parsed corpus file, with (None, "none") and ("T20260918-01",
// "auto-dir"): the json.dumps input byte-for-byte, and the blake2b digest.
func TestFingerprintGolden(t *testing.T) {
	files := at(loadGolden(t, "fingerprint"), "files").(*pyjson.Object)
	logs := testkit.CopyCorpus(t, ".")
	fixtures := testkit.CopyCorpus(t, "../fixtures")
	env, _ := goldenEnv(t)
	n := 0
	for _, key := range files.Keys() {
		path := unitDir(logs, key)
		if rest, ok := strings.CutPrefix(key, "fixtures/"); ok {
			path = filepath.Join(fixtures, filepath.FromSlash(rest))
		}
		byAgent := at(files, key).(*pyjson.Object)
		for _, agent := range byAgent.Keys() {
			parse := claudecode.ParseFile
			if agent == "codex" {
				parse = codex.ParseFile
			}
			raw, _ := parse(path, env)
			for _, cv := range at(byAgent, agent).([]pyjson.Value) {
				if isError(cv) {
					continue // D3: Python's min() raises on mixed offsets; Go's D3 instants are tested in the parsers
				}
				if raw == nil {
					t.Errorf("%s %s: no session", key, agent)
					break
				}
				var tid *string
				if s, ok := at(cv, "task_id").(string); ok {
					tid = &s
				}
				method := at(cv, "link_method").(string)
				if got := string(fingerprintInput(raw, tid, method)); got != at(cv, "input") {
					t.Errorf("%s %s: input\n%s\nwant\n%s", key, agent, got, at(cv, "input"))
				}
				if got := Fingerprint(raw, tid, method); got != at(cv, "fp") {
					t.Errorf("%s %s: fp %s, want %s", key, agent, got, at(cv, "fp"))
				}
				n++
			}
		}
	}
	if n < 100 {
		t.Fatalf("only %d fingerprints compared", n)
	}
}

// fingerprint.json "harvest" digests: every captured input hashes to Python's digest.
func TestFingerprintGoldenHarvestDigests(t *testing.T) {
	h := at(loadGolden(t, "fingerprint"), "harvest").(*pyjson.Object)
	n := 0
	for _, key := range h.Keys() {
		for _, e := range at(h, key).([]pyjson.Value) {
			if got := digest([]byte(at(e, "input").(string))); got != at(e, "fp") {
				t.Errorf("%s: %s, want %s", key, got, at(e, "fp"))
			}
			n++
		}
	}
	if n == 0 {
		t.Fatal("no digests")
	}
}

func writeState(t *testing.T, path string, s *pyjson.Object) {
	t.Helper()
	write(t, path, pyjson.Dumps(s, pyjson.Default()))
}

func touchTree(t *testing.T, dir string) {
	t.Helper()
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		touchLater(t, p)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// The in-process hand-off (plan Task 9, the A1 hand-off criteria in miniature): Python's state after
// its two harvests, on a fresh copy of the corpus, read by Go.
//   - Same mtimes: Go does what Python's second run did (sessions.json runs[1]): for every unit but
//     one that is new=0 updated=0 parked=0, claude never called, the state unchanged. The exception
//     is a unit with one session id in two project dirs: each run re-sends whichever log was not
//     bookmarked last, in Python as in Go (a candidate for followups.md, not a port difference).
//   - Every mtime moved: a bookmark that carries Python's fp is skipped by Go's fingerprint, so its
//     session is not summarized again and its fp stays. A fallback bookmark has no fp (run.py
//     bookmarks a fallback summary without one so it is retried), and Python re-summarizes those
//     too: the sessions of Python's first run whose bookmark has no fp are the only claude calls.
func TestHandOffFromPythonState(t *testing.T) {
	g := loadGolden(t, "state_after_python")
	sessions := at(loadGolden(t, "sessions"), "units").(*pyjson.Object)
	units := at(g, "units").(*pyjson.Object)
	logs := testkit.CopyCorpus(t, ".")
	withFP, oscillating := 0, 0
	for _, key := range units.Keys() {
		want := at(units, key)
		if isError(want) {
			continue
		}
		state := want.(*pyjson.Object)
		runs := at(at(sessions, key), "runs").([]pyjson.Value)
		first, second := at(runs[0], "result"), at(runs[1], "result")
		hasFP := func(k string) bool {
			e, ok := state.Get(k)
			if !ok {
				return false
			}
			_, ok = e.(*pyjson.Object).Get("fp")
			return ok
		}
		retried := 0
		for _, b := range at(at(sessions, key), "bodies").([]pyjson.Value)[:int(at(first, "new").(pyjson.Int))] {
			if !hasFP(at(b, "agent").(string) + ":" + at(b, "session_id").(string)) {
				retried++
			}
		}
		for _, k := range state.Keys() {
			if hasFP(k) {
				withFP++
			}
		}
		cfg := goldenCfg(t, g)
		writeState(t, cfg.StatePath(), state)
		store := &goldenStore{tasks: goldenTasks(g)}
		claude := &fakeClaude{}
		roots := unitRoots(unitDir(logs, key))
		env, stderr := goldenEnv(t)

		r, err := Run(cfg, store, roots, claude.summarizer(), nil, 4, nil, env)
		if err != nil || !pyjson.Equal(resultObject(r), second) || claude.calls != r.New || stderr.String() != "" {
			t.Errorf("%s same mtimes: %+v %v calls=%d stderr=%q, want %s", key, r, err, claude.calls, stderr.String(), pyjson.Compact(second))
		}
		if r.New == 0 {
			sameState(t, key+" same mtimes", cfg.StatePath(), state)
		} else {
			oscillating++
			writeState(t, cfg.StatePath(), state)
		}

		touchTree(t, unitDir(logs, key))
		claude.calls = 0
		r, err = Run(cfg, store, roots, claude.summarizer(), nil, 4, nil, env)
		if err != nil || r.New != retried || r.Updated != 0 || r.Parked != 0 || claude.calls != retried {
			t.Errorf("%s touched: %+v %v calls=%d, want %d re-summarized", key, r, err, claude.calls, retried)
		}
		after := LoadState(cfg.StatePath())
		if len(after) != state.Len() {
			t.Errorf("%s touched: %d entries, want %d", key, len(after), state.Len())
		}
		for _, k := range state.Keys() {
			fp, ok := at(state, k).(*pyjson.Object).Get("fp")
			b, there := after[k]
			switch {
			case !there:
				t.Errorf("%s touched: %s gone", key, k)
			case ok && (b.FP == nil || *b.FP != fp):
				t.Errorf("%s touched: %s fp %v, want %v", key, k, b.FP, fp)
			case !ok && b.FP != nil:
				t.Errorf("%s touched: %s gained fp %s", key, k, *b.FP)
			}
		}
	}
	if withFP < 50 || oscillating != 1 {
		t.Fatalf("%d fingerprinted bookmarks handed off, %d oscillating units", withFP, oscillating)
	}
}
