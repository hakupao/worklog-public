package cli

// Argument parsing (click semantics, spec §4.1 / D8), the order of checks, D6 / D13, the
// top-level recover and the merged stdout+stderr order.

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
)

func TestOptionsMayComeBeforeOrAfterPositionals(t *testing.T) {
	for _, argv := range [][]string{
		{"new", "田中", "帳票修正", "--project", "order"},
		{"new", "--project", "order", "田中", "帳票修正"},
		{"new", "田中", "--project=order", "帳票修正"},
		{"new", "--project", "x", "田中", "--project", "order", "帳票修正"}, // the last one wins
	} {
		s := newFnStub(t, okServer())
		w := cliWorld(t, s.srv.URL)
		if code, out, errOut := w.run(argv...); code != 0 || out != "T20260922-07\n" {
			t.Fatalf("%v: exit %d, stdout %q, stderr %q", argv, code, out, errOut)
		}
		b := s.bodies(t, "POST")[0]
		if str(t, b, "requester") != "田中さん（営業部）" || str(t, b, "title") != "帳票修正" || str(t, b, "project") != "order" {
			t.Fatalf("%v: body %s", argv, pyjson.Compact(b))
		}
	}
}

func TestDoubleDashEndsOptionParsing(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	if code, _, errOut := w.run("note", "-", "--", "--minutes"); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	b := s.bodies(t, "PUT")[0]
	if str(t, b, "text") != "--minutes" || get(t, b, "minutes") != nil {
		t.Fatalf("body %s", pyjson.Compact(b))
	}
}

func TestRepeatedDeliverablesAppendInOrder(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("done", "--deliverable=a.md", "T20260918-01", "--deliverable", "b.md", "--deliverable", "a.md"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	want, _ := pyjson.Decode([]byte(`["a.md", "b.md", "a.md"]`))
	if got := get(t, s.bodies(t, "PUT")[0], "deliverables"); !pyjson.Equal(got, want) {
		t.Fatalf("deliverables %s", pyjson.Compact(got))
	}
}

func TestOptionValuesAreConvertedAsClickDoes(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	// int(' 3 ') and float(' 1e1 ') strip whitespace; underscores between digits are allowed.
	if code, _, errOut := w.run("note", "-", "x", "--minutes", " 1_5 "); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	if got := get(t, s.bodies(t, "PUT")[0], "minutes"); got != pyjson.Int(15) {
		t.Fatalf("minutes %v", got)
	}
	if code, _, errOut := w.run("done", "T20260918-01", "--hours", " 1e1 "); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	if got := get(t, s.bodies(t, "PUT")[1], "hours_manual"); !pyjson.Equal(got, pyjson.Float(10)) {
		t.Fatalf("hours %v", got)
	}
}

// Usage errors exit 2 before the config is read (click checks them while parsing).
func TestUsageErrorsExit2BeforeTheConfigIsRead(t *testing.T) {
	cases := []struct {
		argv []string
		msg  string
	}{
		{nil, "Missing command."},
		{[]string{"plan"}, "Missing command."},
		{[]string{"frobnicate"}, "No such command 'frobnicate'."},
		{[]string{"plan", "frobnicate"}, "No such command 'frobnicate'."},
		{[]string{"-h"}, "No such option: -h"},
		{[]string{"--version"}, "No such option: --version"},
		{[]string{"ls", "x"}, "Got unexpected extra argument (x)"},
		{[]string{"ls", "x", "y"}, "Got unexpected extra arguments (x y)"},
		{[]string{"ls", "--all=1"}, "Option '--all' does not take a value."},
		{[]string{"ls", "--bogus"}, "No such option: --bogus"},
		{[]string{"ls", "--no-all"}, "No such option: --no-all"},
		{[]string{"done"}, "Missing argument 'TASK_ID'."},
		{[]string{"new", "a"}, "Missing argument 'TITLE'."},
		{[]string{"done", "T", "--hours"}, "Option '--hours' requires an argument."},
		{[]string{"done", "T", "--hours", "abc"}, "Invalid value for '--hours': 'abc' is not a valid float."},
		{[]string{"done", "T", "--hours", "-1"}, "Invalid value for '--hours': -1.0 is not in the range x>=0."},
		{[]string{"done", "T", "--hours", "0x10"}, "Invalid value for '--hours': '0x10' is not a valid float."},
		{[]string{"note", "-", "-x"}, "No such option: -x"},
		{[]string{"note", "T", "x", "--minutes", "1.5"}, "Invalid value for '--minutes': '1.5' is not a valid integer."},
		{[]string{"harvest", "--since", "x"}, "Invalid value for '--since': 'x' is not a valid integer."},
		{[]string{"review", "--force=yes"}, "Option '--force' does not take a value."},
		{[]string{"plan", "judge", "--date"}, "Option '--date' requires an argument."},
		{[]string{"plan", "judge", "x"}, "Got unexpected extra argument (x)"},
	}
	for _, c := range cases {
		w := cliWorld(t, deadURL(t))
		if err := os.Remove(filepath.Join(w.root, "config.toml")); err != nil {
			t.Fatal(err)
		}
		code, out, errOut := w.run(c.argv...)
		if code != 2 || out != "" || !strings.HasSuffix(errOut, "Error: "+c.msg+"\n") {
			t.Errorf("%q: exit %d, stdout %q, stderr %q", c.argv, code, out, errOut)
		}
	}
}

func TestHelpIsPrintedAndExits0WithoutTheConfig(t *testing.T) {
	for _, argv := range [][]string{
		{"--help"}, {"ls", "--help"}, {"done", "--help"}, {"plan", "--help"}, {"plan", "judge", "--help"},
		{"done", "--hours", "abc", "--help"}, // help is eager: it wins over a bad value and a missing argument
	} {
		w := cliWorld(t, deadURL(t))
		os.Remove(filepath.Join(w.root, "config.toml"))
		code, out, errOut := w.run(argv...)
		if code != 0 || !strings.HasPrefix(out, "Usage: wl") || errOut != "" {
			t.Errorf("%q: exit %d, stdout %q, stderr %q", argv, code, out, errOut)
		}
	}
	w := cliWorld(t, deadURL(t))
	_, out, _ := w.run("plan", "--help")
	if !contains(out, "judge") {
		t.Errorf("plan --help does not list judge: %q", out)
	}
}

func TestConfigErrorsComeBeforeTheCredentialsCheck(t *testing.T) {
	w := newWorld(t, "", "machine = [\n", "")
	code, _, errOut := w.run("ls")
	if code != 1 || !strings.HasPrefix(errOut, "worklog: cannot read ") || strings.Count(errOut, "\n") != 1 {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
}

// D13: an invalid --received is only parsed after config and client setup (and after the
// requester warnings); exit 1 with one line instead of a traceback.
func TestD13ReceivedIsCheckedAfterConfigAndClient(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	code, out, errOut := w.run("new", "佐藤", "x", "--received", "2026-13-01")
	if code != 1 || out != "" || errOut != "warning: unknown requester alias '佐藤', saving as-is\nerror: --received must look like 2026-10-02\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
	if len(s.requests()) != 0 {
		t.Fatalf("calls %v", s.calls())
	}
	// Config and credentials errors still win.
	w = newWorld(t, "", "machine=\"m\"\n", "")
	if code, _, errOut := w.run("new", "a", "b", "--received", "nope"); code != 1 || !contains(errOut, "api_url (config.toml)") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
	// An empty --received is today, as Python's `if received` takes it.
	w = cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("new", "a", "b", "--received="); code != 0 || str(t, s.bodies(t, "POST")[0], "received_at") != "2026-10-13" {
		t.Fatalf("exit %d", code)
	}
}

// D6: --date / --week / --received take YYYY-MM-DD (and YYYYMMDD) only; the rarer ISO forms
// Python's fromisoformat accepts are refused.
func TestD6OnlyTheCommonISOFormsAreAccepted(t *testing.T) {
	s := newFnStub(t, func(q seen) reply { return jsonReply(404, `{"error": "no plan"}`) })
	w := cliWorld(t, s.srv.URL)
	for _, d := range []string{"2026-W40-1", "2026-283", "2026-10-2", "10/02", "２０２６-10-02"} {
		code, _, errOut := w.run("plan", "judge", "--date", d)
		if code != 2 || errOut != "worklog: --date must look like 2026-10-02\n" {
			t.Errorf("--date %s: exit %d, stderr %q", d, code, errOut)
		}
	}
	for _, wk := range []string{"2026-W40-1", "2026W40", "２０２６-W40", "2026-W4", ""} {
		code, _, errOut := w.run("review", "--week", wk)
		if code != 2 || errOut != "worklog: --week must look like 2026-W39\n" {
			t.Errorf("--week %q: exit %d, stderr %q", wk, code, errOut)
		}
	}
	if len(s.requests()) != 0 {
		t.Fatalf("calls %v", s.calls())
	}
	if code, out, _ := w.run("plan", "judge", "--date", "20261002"); code != 0 || out != "plan: 2026-10-02 no-plan\n" {
		t.Fatalf("compact date: exit %d, stdout %q", code, out)
	}
	for _, r := range []string{"2026-W40-1", "2026-283"} {
		if code, _, errOut := w.run("new", "田中", "b", "--received", r); code != 1 || errOut != "error: --received must look like 2026-10-02\n" {
			t.Errorf("--received %s: exit %d, stderr %q", r, code, errOut)
		}
	}
}

func TestWeekIsCheckedByShapeBeforeTheConfigAndAsAWeekAfter(t *testing.T) {
	w := newWorld(t, "", "machine=\"m\"\n", "")
	// Shape first: no config error, exit 2.
	if code, _, errOut := w.run("review", "--week", "2026-40"); code != 2 || errOut != "worklog: --week must look like 2026-W39\n" {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
	// A well-shaped impossible week meets the credentials check first.
	if code, _, errOut := w.run("review", "--week", "2026-W54"); code != 1 || !contains(errOut, "api_token") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
}

// --hours is checked before the config: --hours -1 never needs config.toml (spec §4.1).
func TestHoursIsCheckedBeforeTheConfig(t *testing.T) {
	w := newWorld(t, "", "machine = [\n", "")
	if code, _, errOut := w.run("done", "T", "--hours", "-1"); code != 2 || contains(errOut, "cannot read") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
}

// A panic anywhere (a standalone side job here) is one stderr line and exit 1, as Python's
// traceback exits 1: never Go's goroutine dump and exit 2.
func TestAPanicIsOneLineAndExit1(t *testing.T) {
	s := newStub(t,
		on("GET", `^/api/reviews/2026-W40$`, jsonReply(404, `{"error": "no review"}`)),
		on("GET", `^/api/dashboard\?`, jsonReply(200, `{"overview": {"minutes": 60, "sessions": 1}}`)),
		on("GET", `^/api/reviews/`, jsonReply(404, `{"error": "no review"}`)),
	)
	w := cliWorld(t, s.srv.URL)
	w.runner.answer = panicOn("<week>", errors.New("boom"))
	code, out, errOut := w.run("review", "--week", "2026-W40")
	if code != 1 || out != "" || errOut != "worklog: unexpected error: boom\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
}

func TestASummarizerPanicInHarvestIsExit1(t *testing.T) {
	w, _ := apiWorld(t)
	w.runner.answer = panicOn("<transcript>", errors.New("summarizer bug"))
	root, _ := writeLog(t, w)
	code, out, errOut := w.run("harvest", "--claude-root", root, "--codex-root", t.TempDir())
	if code != 1 || out != "" || errOut != "worklog: unexpected error: summarizer bug\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
}

// With stdout and stderr on one file (`>> harvest.log 2>&1`), the lines arrive in the order they
// were produced: the flush line, the count line, then the three side jobs.
func TestHarvestMergedStreamOrder(t *testing.T) {
	all := loadTranscripts(t)
	s := all["harvest_flushes_outbox"]
	r := stage(t, s, newPool(s.list("served")))
	merged := &lockedBuffer{}
	r.w.env.Stdout, r.w.env.Stderr = merged, merged
	if code := Main(r.argv(t, s.list("argv")), r.w.env); code != 0 {
		t.Fatalf("exit %d: %s", code, merged.String())
	}
	want := "outbox: sent=1 remaining=0\n" +
		"new=1 updated=0 parked=0 skipped=0 fallback=0, unassigned=3\n" +
		"review: 2026-W41 generated\nplan: 2026-10-13 judged\ndeliverables: judged\n"
	if got := r.mask(merged.String()); got != want {
		t.Fatalf("merged\n got %q\nwant %q", got, want)
	}
}

// Every line is one Write, on both streams, so nothing is held back for a flush at exit.
func TestEveryLineIsOneWrite(t *testing.T) {
	all := loadTranscripts(t)
	s := all["harvest_rejected"]
	r := stage(t, s, newPool(s.list("served")))
	rec := &writes{}
	r.w.env.Stdout, r.w.env.Stderr = rec, rec
	if code := Main(r.argv(t, s.list("argv")), r.w.env); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if len(rec.calls) < 6 {
		t.Fatalf("writes %q", rec.calls)
	}
	for _, c := range rec.calls {
		if strings.Count(c, "\n") != 1 || !strings.HasSuffix(c, "\n") {
			t.Fatalf("write %q is not one line", c)
		}
	}
}

type writes struct {
	mu    sync.Mutex
	calls []string
}

func (w *writes) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.calls = append(w.calls, string(p))
	return len(p), nil
}

func TestCommandTableMatchesSpec(t *testing.T) {
	var names []string
	for _, c := range table {
		names = append(names, c.name)
		if c.name == "plan" && (len(c.sub) != 1 || c.sub[0].name != "judge") {
			t.Fatalf("plan subcommands %v", c.sub)
		}
	}
	if !slices.IsSorted(commands) || len(names) != len(commands) {
		t.Fatalf("names %v", names)
	}
}

// --hours inf / nan pass FloatRange(min=0) in click, and pydantic writes them as null
// (ser_json_inf_nan='null', checked against the venv): the write goes out, exit 0, no panic.
func TestHoursInfAndNaNAreSentAsNull(t *testing.T) {
	for _, h := range []string{"inf", "Infinity", "nan", " NaN "} {
		s := newFnStub(t, okServer())
		w := cliWorld(t, s.srv.URL)
		if code, out, errOut := w.run("done", "T20260918-01", "--hours", h); code != 0 || out != "" || errOut != "" {
			t.Fatalf("%q: exit %d, stdout %q, stderr %q", h, code, out, errOut)
		}
		body := s.bodies(t, "PUT")[0]
		if v, ok := body.Get("hours_manual"); !ok || v != nil {
			t.Fatalf("%q: hours_manual %v", h, v)
		}
	}
	w := cliWorld(t, deadURL(t))
	if code, _, errOut := w.run("done", "T", "--hours", "-inf"); code != 2 || !strings.HasSuffix(errOut, "Error: Invalid value for '--hours': -inf is not in the range x>=0.\n") {
		t.Fatalf("-inf: exit %d, stderr %q", code, errOut)
	}
}
