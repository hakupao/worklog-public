package cli

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/harvest"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// countLine is the stdout shape the A4 runbook checks.
var countLine = regexp.MustCompile(`^new=\d+ updated=\d+ parked=\d+ skipped=\d+ fallback=\d+( rejected=\d+)?( lost=\d+)?(, unassigned=\d+)?\n$`)

// tiersLines are the stderr lines that start with "tiers: ".
func tiersLines(stderr string) []string {
	var out []string
	for _, l := range strings.Split(stderr, "\n") {
		if strings.HasPrefix(l, "tiers: ") {
			out = append(out, l)
		}
	}
	return out
}

func tieredArgs(t *testing.T) []string {
	return append([]string{"harvest", "--tiered"}, emptyRoots(t)...)
}

func TestHarvestTieredRefreshMetaIsAUsageError(t *testing.T) {
	w, s := apiWorld(t)
	code, out, errOut := w.run("harvest", "--tiered", "--refresh-meta")
	if code != 2 || out != "" || !contains(errOut, "Usage: wl harvest [OPTIONS]") ||
		!contains(errOut, "Error: --tiered cannot be combined with --refresh-meta") {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
	if len(s.requests()) != 0 {
		t.Fatalf("calls %v", s.calls())
	}
}

func TestHarvestTieredPrintsTheTiersLine(t *testing.T) {
	w, _ := apiWorld(t)
	code, out, errOut := w.run(tieredArgs(t)...)
	if code != 0 || !countLine.MatchString(out) {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
	lines := tiersLines(errOut)
	want := "tiers: due=15m,1h,day,week parsed=0 new=0 bootstrap=0 reused=0 refreshed=0 failed=0 adopted=0 " +
		"jobs=review:exists,plan_today:no-plan,plan_yesterday:no-plan,deliverables:nothing"
	if len(lines) != 1 || lines[0] != want {
		t.Fatalf("tiers lines %q, want %q", lines, want)
	}
	if !strings.HasSuffix(errOut, want+"\n") {
		t.Fatalf("the tiers line is not last: %q", errOut)
	}
	// Each side job is a tiers.jsonl line with a ts, so the rotation keeps it.
	b, err := os.ReadFile(filepath.Join(w.home, "tiers.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var jobs []string
	for _, l := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		v, err := pyjson.Decode([]byte(l))
		if err != nil {
			t.Fatalf("line %q: %v", l, err)
		}
		o := v.(*pyjson.Object)
		if ts, _ := o.Get("ts"); ts == nil {
			t.Fatalf("line without ts: %q", l)
		}
		jobs = append(jobs, str(t, o, "job")+":"+str(t, o, "result"))
	}
	if got := strings.Join(jobs, ","); got != "review:exists,plan_today:no-plan,plan_yesterday:no-plan,deliverables:nothing" {
		t.Fatalf("tiers.jsonl jobs %s", got)
	}
	cs := harvest.LoadCollectorState(filepath.Join(w.home, "collector_state.json"))
	if cs.Jobs["hour"] != "2026-10-13T12" || cs.Jobs["rescan"] != "2026-10-13" || cs.Jobs["review"] != "2026-W42" {
		t.Fatalf("jobs %v", cs.Jobs)
	}
	if _, err := os.Stat(filepath.Join(w.home, "harvest.lock")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("lock left behind: %v", err)
	}
}

func TestHarvestTieredSkipsTheTimelineGetWhenNoHourChanged(t *testing.T) {
	w, s := apiWorld(t)
	if code, out, _ := w.run(tieredArgs(t)...); code != 0 || !strings.HasSuffix(out, ", unassigned=0\n") {
		t.Fatalf("first run: exit %d, stdout %q", code, out)
	}
	s.mu.Lock()
	s.reqs = nil
	s.mu.Unlock()
	code, out, errOut := w.run(tieredArgs(t)...)
	if code != 0 || out != "new=0 updated=0 parked=0 skipped=0 fallback=0\n" {
		t.Fatalf("second run: exit %d, stdout %q", code, out)
	}
	for _, c := range s.calls() {
		if strings.Contains(c, "/timeline") {
			t.Fatalf("second run read the timeline: %v", s.calls())
		}
	}
	if w := "tiers: due=15m parsed=0 new=0 bootstrap=0 reused=0 refreshed=0 failed=0 adopted=0 jobs="; !slices.Equal(tiersLines(errOut), []string{w}) {
		t.Fatalf("tiers %q", tiersLines(errOut))
	}
	// Full mode still reads it every run.
	s.mu.Lock()
	s.reqs = nil
	s.mu.Unlock()
	if code, out, _ := w.run(append([]string{"harvest"}, emptyRoots(t)...)...); code != 0 || !strings.HasSuffix(out, ", unassigned=0\n") {
		t.Fatalf("full run: exit %d, stdout %q", code, out)
	}
}

// holdLock takes the lock in w's home as another live harvest, started a minute before the clock.
func holdLock(t *testing.T, w *world) (path, holder string) {
	t.Helper()
	path = filepath.Join(w.home, "harvest.lock")
	release, _, err := harvest.Acquire(path, fixedNow.Add(-time.Minute), time.Hour, harvest.PidAlive)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(release)
	return path, "pid " + strconv.Itoa(os.Getpid()) + " since 2026-10-13T11:59:00+09:00"
}

func TestHarvestWhileLockedExits0TieredAnd2ManualWithoutHeartbeat(t *testing.T) {
	w, s := apiWorld(t)
	path, holder := holdLock(t, w)
	want := "worklog: another harvest is running (" + holder + ", lock " + path + "); skipped\n"
	for _, c := range []struct {
		args []string
		code int
	}{{tieredArgs(t), 0}, {append([]string{"harvest"}, emptyRoots(t)...), 2}} {
		code, out, errOut := w.run(c.args...)
		if code != c.code || out != "" || errOut != want {
			t.Fatalf("%v: exit %d, stdout %q, stderr %q\nwant %q", c.args, code, out, errOut, want)
		}
	}
	if len(s.requests()) != 0 {
		t.Fatalf("calls %v", s.calls())
	}
}

func TestLockIsTakenBeforeTheOutboxFlush(t *testing.T) {
	w, s := apiWorld(t)
	holdLock(t, w)
	queued := filepath.Join(w.home, "outbox", "1791000000000000000-000000.json")
	writeFile(t, queued, `{"method": "PUT", "path": "/api/notes/N1", "body": {"id": "N1"}}`)
	if code, _, _ := w.run(append([]string{"harvest"}, emptyRoots(t)...)...); code != 2 {
		t.Fatalf("exit %d", code)
	}
	if b, err := os.ReadFile(queued); err != nil || !contains(string(b), "N1") {
		t.Fatalf("outbox file touched: %v %q", err, b)
	}
	if m, _ := filepath.Glob(filepath.Join(w.home, "outbox", "*")); len(m) != 1 {
		t.Fatalf("outbox %v", m)
	}
	if len(s.requests()) != 0 {
		t.Fatalf("calls %v", s.calls())
	}
}

func TestLockIsReleasedWhenHarvestPanics(t *testing.T) {
	s := newStub(t, fakeClientRoutes(`{"unassigned": 0}`)...)
	w := newWorld(t, s.srv.URL, "machine=\"mac\"\n[harvest]\nmin_active_minutes = 0\n", "api_token=\"tok\"\n")
	lock := filepath.Join(w.home, "harvest.lock")
	heldAtPanic := false
	w.runner.answer = func(string) (string, int) {
		_, err := os.Stat(lock)
		heldAtPanic = err == nil
		panic("boom")
	}
	claude, _ := writeLog(t, w)
	for _, tiered := range []bool{false, true} {
		heldAtPanic = false
		args := []string{"harvest", "--claude-root", claude, "--codex-root", t.TempDir()}
		if tiered {
			args = append(args, "--tiered")
		}
		code, _, errOut := w.run(args...)
		if code != 1 || !contains(errOut, "worklog: unexpected error: boom") {
			t.Fatalf("tiered=%v: exit %d, stderr %q", tiered, code, errOut)
		}
		if !heldAtPanic {
			t.Fatalf("tiered=%v: the lock was not held when the summarizer panicked", tiered)
		}
		if _, err := os.Stat(lock); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("tiered=%v: the panic leaked the lock: %v", tiered, err)
		}
	}
}

func TestAcquireOtherErrorWarnsAndContinues(t *testing.T) {
	old := acquireLock
	acquireLock = func(string, time.Time, time.Duration, func(int) bool) (func(), string, error) {
		return func() {}, "", errors.New("permission denied")
	}
	t.Cleanup(func() { acquireLock = old })
	w, _ := apiWorld(t)
	code, out, errOut := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || out != "new=0 updated=0 parked=0 skipped=0 fallback=0, unassigned=0\n" ||
		errOut != "worklog: could not take the harvest lock "+filepath.Join(w.home, "harvest.lock")+" (permission denied); running without it\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
}

// freshEnv is another process against w's home: the same files and clock, new buffers.
func freshEnv(w *world) (*rt.Env, *lockedBuffer, *lockedBuffer) {
	out, errb := &lockedBuffer{}, &lockedBuffer{}
	e := *w.env
	e.Stdout, e.Stderr = out, errb
	return &e, out, errb
}

func TestTwoSeparateTieredProcessesInOneHourJudgeThePlanOnce(t *testing.T) {
	w, s := apiWorld(t)
	var lines []string
	for i := range 2 {
		env, _, errb := freshEnv(w)
		if code := Main(tieredArgs(t), env); code != 0 {
			t.Fatalf("run %d: exit %d: %s", i, code, errb.String())
		}
		lines = append(lines, tiersLines(errb.String())...)
	}
	n := 0
	for _, c := range s.calls() {
		if strings.Contains(c, "2026-10-13/judge-input") {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("today's plan judged %d times: %v", n, s.calls())
	}
	if len(lines) != 2 || !strings.Contains(lines[0], "plan_today:") || strings.Contains(lines[1], "plan_today") ||
		!strings.HasSuffix(lines[1], " jobs=") {
		t.Fatalf("tiers lines %q", lines)
	}
}

func TestCollectorStateSaveFailureKeepsTheExitCode(t *testing.T) {
	for _, tiered := range []bool{false, true} {
		w, _ := apiWorld(t)
		// A directory where the file goes: it reads as empty and cannot be replaced.
		if err := os.MkdirAll(filepath.Join(w.home, "collector_state.json"), 0o755); err != nil {
			t.Fatal(err)
		}
		args := append([]string{"harvest"}, emptyRoots(t)...)
		if tiered {
			args = append(args, "--tiered")
		}
		code, out, errOut := w.run(args...)
		if code != 0 || !countLine.MatchString(out) || !contains(errOut, "could not save") {
			t.Fatalf("tiered=%v: exit %d, stdout %q, stderr %q", tiered, code, out, errOut)
		}
	}
}

// Full mode keeps the cache up and records the jobs, and prints nothing new.
func TestFullModeMaintainsTheCollectorState(t *testing.T) {
	s := newStub(t, fakeClientRoutes(`{"unassigned": 0}`)...)
	w := newWorld(t, s.srv.URL, "machine=\"mac\"\n[harvest]\nmin_active_minutes = 0\n", "api_token=\"tok\"\n")
	w.runner.answer = func(string) (string, int) { return "a summary", 0 }
	claude, _ := writeLog(t, w)
	code, out, errOut := w.run("harvest", "--claude-root", claude, "--codex-root", t.TempDir())
	if code != 0 || out != "new=1 updated=0 parked=0 skipped=0 fallback=0, unassigned=0\n" || tiersLines(errOut) != nil {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
	cs := harvest.LoadCollectorState(filepath.Join(w.home, "collector_state.json"))
	e, ok := cs.Valid("claude-code:abcd1234-ef56-7890-ab12-cd34ef567890", harvest.LoadState(filepath.Join(w.home, "harvest_state.json")))
	if !ok || e.Summary != "a summary" {
		t.Fatalf("entry %+v valid %v", e, ok)
	}
	if cs.Jobs["hour"] != "2026-10-13T12" || cs.Jobs["plan_today"] != "2026-10-13T12" || cs.Jobs["review"] != "2026-W42" {
		t.Fatalf("jobs %v", cs.Jobs)
	}
	if _, err := os.Stat(filepath.Join(w.home, "tiers.jsonl")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("full mode wrote tiers.jsonl: %v", err)
	}
}
