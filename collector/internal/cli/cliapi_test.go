package cli

// Ports of tests/test_cli_api.py: how the CLI wires up its api.Client, and what `wl harvest` does
// around the collector run. Python's FakeClient becomes a stub server with the same answers; its
// monkeypatched run_review / run_judge raising becomes a claude that panics on that job's prompt,
// which reaches the same recover in harvest.SideJobs.

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/harvest"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// fakeClientRoutes answer as test_cli_api.FakeClient does: no tasks, the week's timeline, an
// existing review, no day plan, no pending deliverables, and every write accepted.
func fakeClientRoutes(timeline string) []*route {
	return []*route{
		on("GET", `^/api/tasks$`, jsonReply(200, `[]`)),
		on("POST", `^/api/ingest/sessions$`, jsonReply(200, `{"inserted": 1, "updated": 0}`)),
		on("POST", `^/api/ingest/heartbeat$`, jsonReply(200, `{"ok": true}`)),
		on("GET", `^/api/weeks/[^/]+/timeline$`, jsonReply(200, timeline)),
		on("GET", `^/api/reviews/`, jsonReply(200, `{"text": "x"}`)),
		on("GET", `^/api/dashboard\?`, jsonReply(200, `{"overview": {"minutes": 60, "sessions": 1}, "hints": []}`)),
		on("POST", `^/api/reviews$`, jsonReply(200, `{"stored": true}`)),
		on("GET", `/judge-input$`, jsonReply(404, `{"error": "no plan"}`)),
		on("POST", `/judgement$`, jsonReply(200, `{"ok": true}`)),
		on("GET", `^/api/ingest/deliverables/pending\?`, jsonReply(200, `{"items": [], "total": 0}`)),
		on("POST", `^/api/ingest/deliverables/verdicts$`, jsonReply(200, `{"inserted": 0}`)),
		on("POST", `^/api/ingest/session-meta$`, jsonReply(200, `{"updated": 0}`)),
		on("PUT", `^/api/`, jsonReply(200, `{"ok": true}`)),
	}
}

// apiWorld is test_cli_api.setup: machine "mac", token "tok", a stub with FakeClient's answers.
func apiWorld(t *testing.T, routes ...*route) (*world, *stub) {
	s := newStub(t, append(routes, fakeClientRoutes(`{"unassigned": 0}`)...)...)
	w := newWorld(t, s.srv.URL, "machine=\"mac\"\n[requesters]\n\"田中\"=\"田中さん\"\n", "api_token=\"tok\"\n")
	return w, s
}

// emptyRoots is two empty directories as --claude-root / --codex-root.
func emptyRoots(t *testing.T) []string {
	empty := t.TempDir()
	return []string{"--claude-root", empty, "--codex-root", empty}
}

func TestTheClientGetsTheURLTokenAndOutboxFromConfig(t *testing.T) {
	// Python asserted the factory's arguments; here the same three values are observed: the
	// request reaches config.toml's api_url with credentials.toml's token, and a parked write lands
	// in {WORKLOG_HOME}/outbox.
	w, s := apiWorld(t, on("PUT", `^/api/notes/`, jsonReply(503, `{}`)))
	if code, _, _ := w.run("ls"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	q := s.requests()[0]
	if q.URI != "/api/tasks" || q.Header.Get("Authorization") != "Bearer tok" {
		t.Fatalf("request %s %v", q.URI, q.Header)
	}
	if q.Header.Get("User-Agent") != "worklog-cli/"+Version+" (go)" {
		t.Fatalf("User-Agent %q", q.Header.Get("User-Agent"))
	}
	if code, _, _ := w.run("note", "-", "x"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if f := jsonFiles(t, filepath.Join(w.home, "outbox")); len(f) != 1 {
		t.Fatalf("outbox %v", f)
	}
}

func TestAccessServiceTokenCredentialsReachTheClient(t *testing.T) {
	w, s := apiWorld(t)
	writeFile(t, filepath.Join(w.home, "credentials.toml"), "api_token=\"tok\"\naccess_client_id=\"abc.access\"\naccess_client_secret=\"shh\"\n")
	if code, _, _ := w.run("ls"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	h := s.requests()[0].Header
	if h.Get("CF-Access-Client-Id") != "abc.access" || h.Get("CF-Access-Client-Secret") != "shh" {
		t.Fatalf("headers %v", h)
	}
}

func TestHarvestFlushesTheOutboxBeforeCollecting(t *testing.T) {
	w, s := apiWorld(t)
	writeFile(t, filepath.Join(w.home, "outbox", "1791000000000000000-000000.json"),
		`{"method": "PUT", "path": "/api/notes/N1", "body": {"id": "N1"}}`)
	code, _, errOut := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	if calls := s.calls(); len(calls) < 2 || calls[0] != "PUT /api/notes/N1" || calls[1] != "GET /api/tasks" {
		t.Fatalf("calls %v", calls)
	}
}

func TestHarvestReportsWhatTheOutboxFlushDid(t *testing.T) {
	w, _ := apiWorld(t, on("PUT", `^/api/notes/N4$`, jsonReply(503, `{}`)))
	for i, id := range []string{"N1", "N2", "N3", "N4"} {
		writeFile(t, filepath.Join(w.home, "outbox", "179100000000000000"+string(rune('0'+i))+"-000000.json"),
			`{"method": "PUT", "path": "/api/notes/`+id+`", "body": {"id": "`+id+`"}}`)
	}
	code, _, errOut := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || !strings.HasPrefix(errOut, "outbox: sent=3 remaining=1\n") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
}

func TestHarvestStaysQuietAboutAnEmptyOutbox(t *testing.T) {
	w, _ := apiWorld(t)
	code, out, errOut := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || contains(out+errOut, "outbox:") {
		t.Fatalf("exit %d, output %q", code, out+errOut)
	}
}

func TestHarvestPrintsCountsAndTheWeekUnassignedTail(t *testing.T) {
	s := newStub(t, append([]*route{on("GET", `^/api/weeks/2026-W42/timeline$`, jsonReply(200, `{"unassigned": 4}`))},
		fakeClientRoutes(`{}`)...)...)
	w := newWorld(t, s.srv.URL, "machine=\"mac\"\n", "api_token=\"tok\"\n")
	code, out, _ := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || out != "new=0 updated=0 parked=0 skipped=0 fallback=0, unassigned=4\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
	if !slices.Contains(s.calls(), "GET /api/weeks/2026-W42/timeline") {
		t.Fatalf("calls %v", s.calls())
	}
}

func TestHarvestOmitsTheUnassignedTailWhenTheWeekCannotBeRead(t *testing.T) {
	w, _ := apiWorld(t, on("GET", `^/api/weeks/`, jsonReply(500, `{}`)))
	code, out, _ := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || out != "new=0 updated=0 parked=0 skipped=0 fallback=0\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
}

func TestHarvestExits2WhenTheServerTasksCannotBeRead(t *testing.T) {
	w, _ := apiWorld(t, on("GET", `^/api/tasks$`, jsonReply(503, `{}`)))
	code, out, errOut := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 2 || out != "" || errOut != "worklog: api unreachable, harvest skipped (outbox will be flushed next run)\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
}

func TestHarvestReportsRefusedSessionsAndLeavesThemUnbookmarked(t *testing.T) {
	// End to end through the real client: a 400 on ingest must not silently swallow a session.
	s := newStub(t,
		on("POST", `^/api/ingest/sessions$`, jsonReply(400, `{"error": "invalid"}`)),
		on("GET", `^/api/tasks$`, jsonReply(200, `[]`)),
		on("GET", `.`, jsonReply(200, `{}`)),
		on("POST", `.`, jsonReply(200, `{}`)),
	)
	w := newWorld(t, s.srv.URL, "machine=\"mac\"\n[harvest]\nmin_active_minutes = 0\n", "api_token=\"tok\"\n")
	w.runner.answer = func(string) (string, int) { return "s", 0 }
	claude, _ := writeLog(t, w)
	code, out, errOut := w.run("harvest", "--claude-root", claude, "--codex-root", t.TempDir())
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	if !contains(out, "rejected=1") || !contains(out, "parked=0") || !contains(errOut, w.outbox()+"/rejected/") || !contains(errOut, "Sabcd1234") {
		t.Fatalf("stdout %q, stderr %q", out, errOut)
	}
	if n := len(jsonFiles(t, filepath.Join(w.outbox(), "rejected"))); n != 1 {
		t.Fatalf("rejected %d", n)
	}
	if f := jsonFiles(t, w.outbox()); len(f) != 0 {
		t.Fatalf("queued %v", f)
	}
	if st := harvest.LoadState(filepath.Join(w.home, "harvest_state.json")); len(st) != 0 {
		t.Fatalf("state %v", st)
	}
}

func TestHarvestLineKeepsItsEverydayShapeWhenNothingWentWrong(t *testing.T) {
	w, _ := apiWorld(t)
	code, out, _ := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || out != "new=0 updated=0 parked=0 skipped=0 fallback=0, unassigned=0\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
}

// writeLog puts tests/fixtures/claude_code_session.jsonl under a Claude root in w.work, modified an
// hour before the clock, and returns the root and the log.
func writeLog(t *testing.T, w *world) (root, log string) {
	t.Helper()
	fixture, err := os.ReadFile(filepath.Join(testkit.TestdataDir(t), "fixtures", "claude_code_session.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	root = filepath.Join(w.work, "claude")
	log = filepath.Join(root, "-work-proj-a", "abcd1234-ef56-7890-ab12-cd34ef567890.jsonl")
	writeFile(t, log, string(fixture))
	mt := fixedNow.Add(-time.Hour)
	if err := os.Chtimes(log, mt, mt); err != nil {
		t.Fatal(err)
	}
	return root, log
}

// metaWorld is a world with one session log in reach of --refresh-meta, so `sent` is observable.
func metaWorld(t *testing.T, meta reply) (*world, *stub, []string) {
	s := newStub(t, on("POST", `^/api/ingest/session-meta$`, meta))
	w := newWorld(t, s.srv.URL, "machine=\"mac\"\n", "api_token=\"tok\"\n")
	claude, _ := writeLog(t, w)
	return w, s, []string{"--claude-root", claude, "--codex-root", t.TempDir()}
}

func TestHarvestFilesOnlyRefreshesPathsWithoutCollecting(t *testing.T) {
	w, s, roots := metaWorld(t, jsonReply(200, `{"updated": 2}`))
	writeFile(t, filepath.Join(w.home, "outbox", "1791000000000000000-000000.json"),
		`{"method": "PUT", "path": "/api/notes/N1", "body": {"id": "N1"}}`)
	s.routes = append(s.routes, on("PUT", `^/api/notes/`, jsonReply(200, `{}`)))
	// The log is 30 days old: --since 20 leaves it out and --since 90 reaches it, so the window
	// given is the one used.
	log := filepath.Join(roots[1], "-work-proj-a", "abcd1234-ef56-7890-ab12-cd34ef567890.jsonl")
	mt := fixedNow.AddDate(0, 0, -30)
	if err := os.Chtimes(log, mt, mt); err != nil {
		t.Fatal(err)
	}
	if code, out, _ := w.run(append([]string{"harvest", "--files-only", "--since", "20"}, roots...)...); code != 0 || out != "meta: sent=0 updated=0\n" {
		t.Fatalf("--since 20: exit %d, stdout %q", code, out)
	}
	s.mu.Lock()
	s.reqs = nil
	s.mu.Unlock()
	writeFile(t, filepath.Join(w.home, "outbox", "1791000000000000000-000000.json"),
		`{"method": "PUT", "path": "/api/notes/N1", "body": {"id": "N1"}}`)
	code, out, _ := w.run(append([]string{"harvest", "--files-only", "--since", "90"}, roots...)...)
	if code != 0 || out != "meta: sent=1 updated=2\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
	// The outbox is still flushed first; no tasks are read and nothing is summarized.
	if got := s.calls(); !slices.Equal(got, []string{"PUT /api/notes/N1", "POST /api/ingest/session-meta"}) {
		t.Fatalf("calls %v", got)
	}
	if len(w.runner.recorded()) != 0 {
		t.Fatalf("claude calls %v", w.runner.recorded())
	}
}

func TestHarvestRefreshMetaIsTheSameCommandUnderItsNewName(t *testing.T) {
	w, s, roots := metaWorld(t, jsonReply(200, `{"updated": 1}`))
	code, out, _ := w.run(append([]string{"harvest", "--refresh-meta"}, roots...)...)
	if code != 0 || out != "meta: sent=1 updated=1\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
	if got := s.calls(); !slices.Equal(got, []string{"POST /api/ingest/session-meta"}) {
		t.Fatalf("calls %v", got)
	}
}

func TestHarvestFilesOnlyDefaultsToEveryLog(t *testing.T) {
	// The fixture's log is weeks older than the clock: a 14-day window would leave it out.
	w, _, roots := metaWorld(t, jsonReply(200, `{"updated": 1}`))
	old := fixedNow.AddDate(1, 0, 0)
	w.env.Now = func() time.Time { return old }
	code, out, _ := w.run(append([]string{"harvest", "--files-only"}, roots...)...)
	if code != 0 || out != "meta: sent=1 updated=1\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
}

func TestPlainHarvestStillDefaultsTo14Days(t *testing.T) {
	w, s := apiWorld(t)
	claude, log := writeLog(t, w)
	roots := []string{"harvest", "--claude-root", claude, "--codex-root", t.TempDir()}
	for _, c := range []struct {
		age  time.Duration
		want string
	}{
		{15 * 24 * time.Hour, "new=0 updated=0 parked=0 skipped=0 fallback=0, unassigned=0\n"},
		{13 * 24 * time.Hour, "new=1 updated=0 parked=0 skipped=0 fallback=0, unassigned=0\n"},
	} {
		mt := fixedNow.Add(-c.age)
		if err := os.Chtimes(log, mt, mt); err != nil {
			t.Fatal(err)
		}
		code, out, errOut := w.run(roots...)
		if code != 0 || out != c.want {
			t.Fatalf("age %v: exit %d, stdout %q, stderr %q", c.age, code, out, errOut)
		}
	}
	_ = s
}

func TestHarvestFilesOnlySaysTheServerWasUnreachable(t *testing.T) {
	w, _, roots := metaWorld(t, jsonReply(503, `{}`))
	code, out, errOut := w.run(append([]string{"harvest", "--files-only"}, roots...)...)
	if code != 2 || out != "" || errOut != "worklog: the server was unreachable; nothing was queued, re-running it is safe\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
}

func TestHarvestFilesOnlySaysTheServerRefused(t *testing.T) {
	w, _, roots := metaWorld(t, jsonReply(404, `{"error": "no route"}`))
	code, _, errOut := w.run(append([]string{"harvest", "--files-only"}, roots...)...)
	if code != 2 || errOut != "worklog: the server refused the update (is it deployed with migration 0004?); nothing was queued, re-running it is safe\n" {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
}

// sideJobWorld is a harvest whose three side jobs all reach claude: a missing review, a day plan
// with one item, one pending file.
func sideJobWorld(t *testing.T) (*world, *stub) {
	return apiWorld(t,
		on("GET", `^/api/reviews/`, jsonReply(404, `{"error": "no review"}`)),
		on("GET", `/2026-10-13/judge-input$`, jsonReply(200,
			`{"date": "2026-10-13", "fingerprint": "fp", "judged_fingerprint": null, "items": [{"id": "I1", "text": "x", "detail": ""}], "sessions": [], "notes": []}`)),
		on("GET", `^/api/ingest/deliverables/pending\?`,
			jsonReply(200, `{"items": [{"key": "/nonexistent/a.md", "task_title": "t", "project": "P"}], "total": 1}`),
			jsonReply(200, `{"items": [], "total": 0}`)),
	)
}

// panicOn makes claude panic on the prompt that starts with prefix, as Python's monkeypatched job
// raised.
func panicOn(prefix string, err error) func(string) (string, int) {
	return func(stdin string) (string, int) {
		if strings.HasPrefix(stdin, prefix) {
			panic(err)
		}
		return "[]", 0
	}
}

func TestHarvestOutputIsUnchangedWhenTheReviewStepFails(t *testing.T) {
	w, _ := sideJobWorld(t)
	w.runner.answer = panicOn("<week>", errors.New("boom"))
	code, out, errOut := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || out != "new=0 updated=0 parked=0 skipped=0 fallback=0, unassigned=0\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
	if !strings.HasPrefix(errOut, "worklog: weekly review 2026-W41 skipped: boom\n") {
		t.Fatalf("stderr %q", errOut)
	}
}

func TestHarvestAsksThePlanJudgeAboutTodayAndYesterday(t *testing.T) {
	w, s := apiWorld(t)
	if code, _, _ := w.run(append([]string{"harvest"}, emptyRoots(t)...)...); code != 0 {
		t.Fatalf("exit %d", code)
	}
	var days []string
	for _, c := range s.calls() {
		if strings.HasSuffix(c, "/judge-input") {
			days = append(days, c)
		}
	}
	if !slices.Equal(days, []string{"GET /api/day-plans/2026-10-13/judge-input", "GET /api/day-plans/2026-10-12/judge-input"}) {
		t.Fatalf("judge calls %v", days)
	}
}

func TestAPlanJudgeCrashDoesNotFailHarvest(t *testing.T) {
	w, _ := sideJobWorld(t)
	w.runner.answer = panicOn("<date>", errors.New("bug"))
	code, _, errOut := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || !contains(errOut, "worklog: plan judge 2026-10-13 skipped: bug\n") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
}

func TestHarvestAsksForThisMachinesPendingDeliverables(t *testing.T) {
	w, s := apiWorld(t)
	if code, _, _ := w.run(append([]string{"harvest"}, emptyRoots(t)...)...); code != 0 {
		t.Fatalf("exit %d", code)
	}
	var pending []string
	for _, c := range s.calls() {
		if strings.Contains(c, "/deliverables/pending") {
			pending = append(pending, c)
		}
	}
	if !slices.Equal(pending, []string{"GET /api/ingest/deliverables/pending?machine=mac&limit=40"}) {
		t.Fatalf("pending calls %v", pending)
	}
}

func TestADeliverableJudgeCrashDoesNotFailHarvest(t *testing.T) {
	w, _ := sideJobWorld(t)
	w.runner.answer = panicOn("<files>", errors.New("bug"))
	code, out, errOut := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || !strings.HasPrefix(out, "new=") || !strings.HasSuffix(errOut, "worklog: deliverable judge skipped: bug\n") {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
}

func TestWlPlanJudgeForcesTheGivenDay(t *testing.T) {
	w, s := apiWorld(t)
	code, out, _ := w.run("plan", "judge", "--date", "2026-10-02")
	if code != 0 || out != "plan: 2026-10-02 no-plan\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
	if got := s.calls(); !slices.Equal(got, []string{"GET /api/day-plans/2026-10-02/judge-input"}) {
		t.Fatalf("calls %v", got)
	}
}

func TestWlPlanJudgeRejectsABadDate(t *testing.T) {
	w, s := apiWorld(t)
	code, _, errOut := w.run("plan", "judge", "--date", "nope")
	if code != 2 || errOut != "worklog: --date must look like 2026-10-02\n" || len(s.requests()) != 0 {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
}

func TestWlReviewForcesAWeek(t *testing.T) {
	w, s := apiWorld(t)
	code, out, errOut := w.run("review", "--week", "2026-W39", "--force")
	if code != 0 || out != "review: 2026-W39 stored\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
	var weeks []string
	for _, b := range s.bodies(t, "POST") {
		weeks = append(weeks, str(t, b, "week"))
	}
	if !slices.Equal(weeks, []string{"2026-W39"}) {
		t.Fatalf("stored %v (calls %v)", weeks, s.calls())
	}
}

func TestWlReviewRejectsAnImpossibleWeek(t *testing.T) {
	for _, bad := range []string{"2026-W00", "2026-W99", "2027-W53"} {
		w, s := apiWorld(t)
		code, _, errOut := w.run("review", "--week", bad)
		if code != 2 || errOut != "worklog: --week must look like 2026-W39\n" || len(s.requests()) != 0 {
			t.Fatalf("%s: exit %d, stderr %q", bad, code, errOut)
		}
	}
}

// test_harvest_fallback.test_cli_prints_fallback_count: the count line carries fallback=.
func TestCLIPrintsFallbackCount(t *testing.T) {
	w, _ := apiWorld(t)
	code, out, _ := w.run(append([]string{"harvest"}, emptyRoots(t)...)...)
	if code != 0 || !contains(out, "fallback=0") {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
}
