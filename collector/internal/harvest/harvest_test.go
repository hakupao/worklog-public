package harvest

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/blake2b"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/claudecode"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// Ports of tests/test_harvest_run.py. The fixtures are copied as in _make_roots: written now, so
// inside the default 14-day window, with the real clock.

const (
	claudeSessionID = "abcd1234-ef56-7890-ab12-cd34ef567890"
	claudeLog       = claudeSessionID + ".jsonl"
	codexSessionID  = "11112222-3333-4444-5555-666677778888"
)

var oneInsert = answer{res: &api.IngestResult{Inserted: 1}, out: api.OK}

type answer struct {
	res *api.IngestResult
	out api.Outcome
}

// fakeStore is FakeStore: Append answers with whatever the server would have reported.
type fakeStore struct {
	results  map[string]answer
	def      answer
	appended []string
	records  map[string]model.Session
	tasks    []model.Task
	tasksErr error
}

func newStore() *fakeStore { return &fakeStore{def: oneInsert, records: map[string]model.Session{}} }

func (s *fakeStore) Tasks() ([]model.Task, error) { return s.tasks, s.tasksErr }

func (s *fakeStore) Append(sess model.Session) (*api.IngestResult, api.Outcome) {
	s.appended = append(s.appended, sess.ID)
	s.records[sess.ID] = sess
	a, ok := s.results[sess.ID]
	if !ok {
		a = s.def
	}
	return a.res, a.out
}

func (s *fakeStore) OutboxDir() string { return "/home/me/.worklog/outbox" }

func stubSummarizer(*session.RawSession, string) (string, string) { return "stub summary", "llm" }

// countingSummarizer is _counting_summarizer; the workers call it concurrently.
type countingSummarizer struct {
	mu    sync.Mutex
	calls []string
}

func (c *countingSummarizer) fn(raw *session.RawSession, _ string) (string, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls = append(c.calls, raw.SessionID)
	return "stub summary", "llm"
}

func (c *countingSummarizer) count(id string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, s := range c.calls {
		if s == id {
			n++
		}
	}
	return n
}

type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

func testEnv(t *testing.T, now func() time.Time) (*rt.Env, *lockedBuffer) {
	t.Helper()
	errBuf := &lockedBuffer{}
	return &rt.Env{
		Stdout: &lockedBuffer{}, Stderr: errBuf, Now: now,
		Getenv: func(string) string { return "" },
		Home:   t.TempDir(), GOOS: runtime.GOOS, Cwd: t.TempDir(),
	}, errBuf
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(testkit.TestdataDir(t), "fixtures", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func write(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func appendText(t *testing.T, path, text string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(text); err != nil {
		t.Fatal(err)
	}
}

type fx struct {
	t         *testing.T
	tmp       string
	cfg       *config.Config
	env       *rt.Env
	stderr    *lockedBuffer
	roots     []Root
	claudeLog string
	codexLog  string
}

// setup is _make_cfg + _make_roots.
func setup(t *testing.T) *fx {
	t.Helper()
	tmp := t.TempDir()
	root := filepath.Join(tmp, "wl_root")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	f := &fx{t: t, tmp: tmp}
	f.cfg = &config.Config{
		Machine: "mac", Root: root, Home: filepath.Join(tmp, "home"), SummarizeModel: "haiku",
		Requesters: map[string]string{}, ExcludeCwdPatterns: []string{}, ExcludePromptPatterns: []string{},
		MinActiveMinutes: 3,
	}
	f.env, f.stderr = testEnv(t, time.Now)
	claudeRoot := filepath.Join(tmp, "claude_projects")
	f.claudeLog = filepath.Join(claudeRoot, "-work-proj-a", claudeLog)
	write(t, f.claudeLog, fixture(t, "claude_code_session.jsonl"))
	codexRoot := filepath.Join(tmp, "codex_sessions")
	f.codexLog = filepath.Join(codexRoot, "2026", "09", "18", "rollout-2026-09-18T09-00-00-11112222.jsonl")
	write(t, f.codexLog, fixture(t, "codex_rollout.jsonl"))
	f.roots = []Root{{"claude-code", claudeRoot}, {"codex", codexRoot}}
	return f
}

var fourteen = 14

func (f *fx) harvest(st Store, sum Summarizer) Result {
	f.t.Helper()
	r, err := Run(f.cfg, st, f.roots, sum, &fourteen, 4, nil, f.env)
	if err != nil {
		f.t.Fatal(err)
	}
	return r
}

func (f *fx) state() *pyjson.Object {
	f.t.Helper()
	b, err := os.ReadFile(f.cfg.StatePath())
	if err != nil {
		f.t.Fatal(err)
	}
	v, err := pyjson.Decode(b)
	if err != nil {
		f.t.Fatal(err)
	}
	return v.(*pyjson.Object)
}

func touchLater(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	later := info.ModTime().Add(time.Hour)
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatal(err)
	}
}

func mtimeOf(t *testing.T, path string) float64 {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return pytime.MtimeFloat(info)
}

// What Claude Code appends to an open session's log while nobody is typing in it.
const idleNoise = `{"type":"attachment","timestamp":"2026-09-18T11:00:00.000Z","attachment":{}}
{"type":"last-prompt","lastPrompt":"x"}
{"type":"mode","mode":"default"}
{"type":"bridge-session","sessionId":"abcd1234-ef56-7890-ab12-cd34ef567890"}
{"type":"system","subtype":"turn_duration","timestamp":"2026-09-18T11:00:01.000Z"}
`

func TestHarvestEndToEndCreatesSessions(t *testing.T) {
	f := setup(t)
	st := newStore()
	r := f.harvest(st, stubSummarizer)
	if r.New != 2 || r.Updated != 0 || r.Skipped != 0 || r.Parked != 0 {
		t.Fatalf("result %+v", r)
	}
	if len(st.records) != 2 {
		t.Fatalf("records %v", st.appended)
	}
	for _, id := range []string{"Sabcd1234", "S11112222"} {
		s, ok := st.records[id]
		if !ok {
			t.Fatalf("%s not sent: %v", id, st.appended)
		}
		if s.Summary != "stub summary" || s.SummarySource != "llm" || s.TaskID != nil || s.LinkMethod != "none" {
			t.Errorf("%s: %+v", id, s)
		}
	}
}

func TestHarvestIsIdempotentOnSecondRun(t *testing.T) {
	f := setup(t)
	st := newStore()
	f.harvest(st, stubSummarizer)
	r := f.harvest(st, stubSummarizer)
	if r.New != 0 || r.Updated != 0 || r.Skipped != 2 || len(st.records) != 2 {
		t.Fatalf("result %+v, records %v", r, st.appended)
	}
}

func TestAnIdleSessionWhoseLogOnlyGrewMetadataIsNotSummarizedAgain(t *testing.T) {
	f := setup(t)
	st := newStore()
	sum := &countingSummarizer{}
	f.harvest(st, sum.fn)
	if sum.count(claudeSessionID) != 1 {
		t.Fatal(sum.calls)
	}
	appendText(t, f.claudeLog, idleNoise)
	touchLater(t, f.claudeLog)
	r := f.harvest(st, sum.fn)
	if sum.count(claudeSessionID) != 1 {
		t.Fatalf("summarized again: %v", sum.calls)
	}
	if r.New != 0 || r.Updated != 0 || r.Skipped != 2 {
		t.Fatalf("result %+v", r)
	}
	if n := strings.Count(strings.Join(st.appended, " "), "Sabcd1234"); n != 1 {
		t.Fatalf("appended %v", st.appended)
	}
	// The bookmark moved on to the new mtime, so the noise is not even re-parsed next time.
	e, _ := f.state().Get("claude-code:" + claudeSessionID)
	m, _ := e.(*pyjson.Object).Get("mtime")
	if m != pyjson.Float(mtimeOf(t, f.claudeLog)) {
		t.Fatalf("bookmark mtime %v", m)
	}
}

func TestASessionThatGainedARealTurnIsSummarizedAgain(t *testing.T) {
	f := setup(t)
	st := newStore()
	sum := &countingSummarizer{}
	f.harvest(st, sum.fn)
	appendText(t, f.claudeLog,
		`{"type": "user", "sessionId": "abcd1234-ef56-7890-ab12-cd34ef567890", "isSidechain": false, "cwd": "/work/proj-a", "timestamp": "2026-09-18T12:00:00.000Z", "message": {"role": "user", "content": "次の修正もお願いします"}}`+"\n"+
			`{"type": "assistant", "sessionId": "abcd1234-ef56-7890-ab12-cd34ef567890", "isSidechain": false, "cwd": "/work/proj-a", "timestamp": "2026-09-18T12:05:00.000Z", "message": {"role": "assistant", "content": [{"type": "text", "text": "承知しました"}]}}`+"\n")
	touchLater(t, f.claudeLog)
	r := f.harvest(st, sum.fn)
	if sum.count(claudeSessionID) != 2 || r.Skipped != 1 {
		t.Fatalf("calls %v result %+v", sum.calls, r)
	}
	if n := strings.Count(strings.Join(st.appended, " "), "Sabcd1234"); n != 2 {
		t.Fatalf("appended %v", st.appended)
	}
}

func TestASubagentThatFinishedLaterIsEnoughToSummarizeAgain(t *testing.T) {
	f := setup(t)
	st := newStore()
	sum := &countingSummarizer{}
	f.harvest(st, sum.fn)
	sub := filepath.Join(strings.TrimSuffix(f.claudeLog, ".jsonl"), "subagents", "agent-a1.jsonl")
	write(t, sub, []byte(`{"type": "assistant", "isSidechain": true, "message": {"id": "msg_s", "model": "claude-opus-5-5", "role": "assistant", "content": [], "usage": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}}`+"\n"))
	touchLater(t, sub)
	f.harvest(st, sum.fn)
	if sum.count(claudeSessionID) != 2 {
		t.Fatal(sum.calls)
	}
}

func TestACaseCreatedAfterTheFirstHarvestGetsTheIdleSessionReSent(t *testing.T) {
	f := setup(t)
	f.cfg.Projects = []config.Project{{Dir: "/work/proj-a", Name: "ProjA"}}
	sum := &countingSummarizer{}
	st := newStore()
	f.harvest(st, sum.fn)
	if st.records["Sabcd1234"].TaskID != nil {
		t.Fatal("linked before the case exists")
	}
	task := model.NewTask("T20260918-01", pytime.Naive(time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)), "mac", "x", "t",
		pytime.Date{Y: 2026, M: 9, D: 1})
	task.Project = "ProjA"
	st = newStore()
	st.tasks = []model.Task{task}
	appendText(t, f.claudeLog, idleNoise)
	touchLater(t, f.claudeLog)
	f.harvest(st, sum.fn)
	if id := st.records["Sabcd1234"].TaskID; id == nil || *id != "T20260918-01" {
		t.Fatalf("task_id %v", id)
	}
	if sum.count(claudeSessionID) != 2 {
		t.Fatal(sum.calls)
	}
}

func TestAFallbackSummaryIsRetriedWhenTheLogNextMoves(t *testing.T) {
	f := setup(t)
	st := newStore()
	degraded := func(*session.RawSession, string) (string, string) { return "first line only", "fallback" }
	if r := f.harvest(st, degraded); r.Fallback != 2 {
		t.Fatalf("result %+v", r)
	}
	appendText(t, f.claudeLog, idleNoise)
	touchLater(t, f.claudeLog)
	sum := &countingSummarizer{}
	f.harvest(st, sum.fn)
	if !slices.Equal(sum.calls, []string{claudeSessionID}) {
		t.Fatal(sum.calls)
	}
	if st.records["Sabcd1234"].SummarySource != "llm" {
		t.Fatal(st.records["Sabcd1234"].SummarySource)
	}
}

// State written before fingerprints existed holds a bare mtime per session.
func TestAPreFingerprintBookmarkIsHonoredAndUpgraded(t *testing.T) {
	f := setup(t)
	st := newStore()
	o := pyjson.NewObject()
	o.Set("claude-code:"+claudeSessionID, pyjson.Float(mtimeOf(t, f.claudeLog)))
	write(t, f.cfg.StatePath(), pyjson.Dumps(o, pyjson.Default()))
	sum := &countingSummarizer{}
	if r := f.harvest(st, sum.fn); r.Skipped != 1 || sum.count(claudeSessionID) != 0 {
		t.Fatalf("result %+v calls %v", r, sum.calls)
	}
	// Once the log moves, the old bookmark cannot tell noise from work: summarized once more, and
	// from then on the bookmark carries a fingerprint.
	appendText(t, f.claudeLog, idleNoise)
	touchLater(t, f.claudeLog)
	f.harvest(st, sum.fn)
	if sum.count(claudeSessionID) != 1 {
		t.Fatal(sum.calls)
	}
	appendText(t, f.claudeLog, idleNoise)
	touchLater(t, f.claudeLog)
	f.harvest(st, sum.fn)
	if sum.count(claudeSessionID) != 1 {
		t.Fatal(sum.calls)
	}
}

func TestHarvestSkipsExcludedCwd(t *testing.T) {
	f := setup(t)
	f.cfg.ExcludeCwdPatterns = []string{"proj-a"}
	st := newStore()
	r := f.harvest(st, stubSummarizer)
	if r.New != 1 || r.Skipped != 1 {
		t.Fatalf("result %+v", r)
	}
	if _, ok := st.records["Sabcd1234"]; ok {
		t.Fatal("excluded session sent")
	}
	if _, ok := st.records["S11112222"]; !ok {
		t.Fatal("codex session not sent")
	}
	// An excluded session is never bookmarked.
	if _, ok := f.state().Get("claude-code:" + claudeSessionID); ok {
		t.Fatal("excluded session bookmarked")
	}
}

func TestHarvestCountsNewAndUpdatedFromTheStoreResult(t *testing.T) {
	f := setup(t)
	st := newStore()
	st.results = map[string]answer{
		"Sabcd1234": {&api.IngestResult{Inserted: 1}, api.OK},
		"S11112222": {&api.IngestResult{Updated: 1}, api.OK},
	}
	r := f.harvest(st, stubSummarizer)
	if r.New != 1 || r.Updated != 1 || r.Parked != 0 {
		t.Fatalf("result %+v", r)
	}
	got := slices.Sorted(slices.Values(st.appended))
	if !slices.Equal(got, []string{"S11112222", "Sabcd1234"}) {
		t.Fatal(got)
	}
}

func TestHarvestCountsParkedAppends(t *testing.T) {
	f := setup(t)
	st := newStore()
	st.def = answer{nil, api.Retry}
	r := f.harvest(st, stubSummarizer)
	if r.New != 0 || r.Updated != 0 || r.Parked != 2 {
		t.Fatalf("result %+v", r)
	}
	// a parked session is on its way to the server, so it is remembered and not re-parsed
	if f.state().Len() == 0 {
		t.Fatal("nothing bookmarked")
	}
}

// outbox/rejected/ is a record of a refusal, not a queue: nothing replays it. Bookmarking a refused
// session would mean it is never sent and never parsed again.
func TestARefusedSessionIsCountedAndNeverBookmarked(t *testing.T) {
	f := setup(t)
	st := newStore()
	st.def = answer{nil, api.Rejected}
	r := f.harvest(st, stubSummarizer)
	if r.New != 0 || r.Updated != 0 || r.Parked != 0 || r.Rejected != 2 {
		t.Fatalf("result %+v", r)
	}
	// Phase 1 writes the bookmark file for skipped logs, so what matters is that it holds nothing.
	if f.state().Len() != 0 {
		t.Fatal(string(pyjson.Compact(f.state())))
	}
	err := f.stderr.String()
	for _, id := range []string{"Sabcd1234", "S11112222"} {
		want := "worklog: the server refused session " + id + "; it is in /home/me/.worklog/outbox/rejected/ and will not be sent. The next harvest will try it again.\n"
		if !strings.Contains(err, want) {
			t.Errorf("stderr %q lacks %q", err, want)
		}
	}
	// Because nothing was bookmarked, the very next run sees both sessions again.
	if again := f.harvest(st, stubSummarizer); again.Rejected != 2 || again.Skipped != 0 {
		t.Fatalf("again %+v", again)
	}
}

func TestASessionThatCouldNotBeParkedIsCountedAndNeverBookmarked(t *testing.T) {
	f := setup(t)
	st := newStore()
	st.def = answer{nil, api.Lost}
	r := f.harvest(st, stubSummarizer)
	if r.Lost != 2 || r.Parked != 0 || r.Rejected != 0 {
		t.Fatalf("result %+v", r)
	}
	if f.state().Len() != 0 {
		t.Fatal(string(pyjson.Compact(f.state())))
	}
	want := "worklog: session Sabcd1234 could not be saved anywhere; the next harvest will try it again.\n"
	if !strings.Contains(f.stderr.String(), want) {
		t.Fatalf("stderr %q", f.stderr.String())
	}
}

// The contrast that makes the two tests above mean something: Retry IS durable.
func TestAParkedSessionIsStillBookmarked(t *testing.T) {
	f := setup(t)
	st := newStore()
	st.def = answer{nil, api.Retry}
	if r := f.harvest(st, stubSummarizer); r.Parked != 2 {
		t.Fatalf("result %+v", r)
	}
	if f.state().Len() == 0 {
		t.Fatal("nothing bookmarked")
	}
	if r := f.harvest(st, stubSummarizer); r.Skipped != 2 {
		t.Fatalf("result %+v", r)
	}
}

// Python's FakeStore.sessions() raises; the Go Store interface has no way to read sessions at all.
func TestHarvestDoesNotReadSessionsFromTheStore(t *testing.T) {
	f := setup(t)
	if r := f.harvest(newStore(), stubSummarizer); r.New != 2 {
		t.Fatalf("result %+v", r)
	}
}

func TestHarvestRaisesWithoutParsingLogsWhenTheAPIIsUnreachable(t *testing.T) {
	f := setup(t)
	st := newStore()
	st.tasksErr = api.ErrUnavailable
	sum := &countingSummarizer{}
	// The claude log is made unreadable: a parse would warn D1. Nothing may be read at all.
	write(t, f.claudeLog, []byte{0xff, '\n'})
	_, err := Run(f.cfg, st, f.roots, sum.fn, &fourteen, 4, nil, f.env)
	if !errors.Is(err, api.ErrUnavailable) {
		t.Fatalf("err %v", err)
	}
	if len(sum.calls) != 0 || len(st.appended) != 0 || f.stderr.String() != "" {
		t.Fatalf("calls %v appended %v stderr %q", sum.calls, st.appended, f.stderr.String())
	}
	if _, err := os.Stat(f.cfg.StatePath()); !os.IsNotExist(err) {
		t.Fatalf("state file: %v", err)
	}
}

// D10 (replaces test_harvest_moves_the_state_file_out_of_the_repo_once and
// test_harvest_keeps_the_new_state_file_when_an_old_one_still_exists): a legacy
// <root>/data/.harvest_state.json is neither read nor moved.
func TestD10LegacyStateFileIsIgnored(t *testing.T) {
	f := setup(t)
	old := filepath.Join(f.cfg.Root, "data", ".harvest_state.json")
	o := pyjson.NewObject()
	o.Set("claude-code:"+claudeSessionID, pyjson.Float(mtimeOf(t, f.claudeLog)))
	legacy := pyjson.Dumps(o, pyjson.Default())
	write(t, old, legacy)
	st := newStore()
	if r := f.harvest(st, stubSummarizer); r.New != 2 || r.Skipped != 0 {
		t.Fatalf("result %+v", r)
	}
	if b, err := os.ReadFile(old); err != nil || !bytes.Equal(b, legacy) {
		t.Fatalf("legacy file changed: %v", err)
	}
	if strings.Contains(f.stderr.String(), "harvest state") {
		t.Fatalf("stderr %q", f.stderr.String())
	}
}

func TestSinceFiltersOldFiles(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "projects")
	old := filepath.Join(root, "-work-proj-a", "old.jsonl")
	write(t, old, fixture(t, "claude_code_session.jsonl"))
	month := time.Now().Add(-30 * 24 * time.Hour)
	if err := os.Chtimes(old, month, month); err != nil {
		t.Fatal(err)
	}
	env, _ := testEnv(t, time.Now)
	collect := func(since *float64) int {
		n := 0
		claudecode.IterSessions(root, since, env, func(*session.RawSession) { n++ })
		return n
	}
	day := sinceEpoch(time.Now(), 1)
	if got := collect(&day); got != 0 {
		t.Fatalf("since a day: %d", got)
	}
	if got := collect(nil); got != 1 {
		t.Fatalf("all: %d", got)
	}
	// And through Run: --since 1 leaves the month-old log out.
	cfg := &config.Config{Machine: "m", Root: tmp, Home: filepath.Join(tmp, "home"), MinActiveMinutes: 3}
	one := 1
	r, err := Run(cfg, newStore(), []Root{{"claude-code", root}}, stubSummarizer, &one, 1, nil, env)
	if err != nil || r != (Result{}) {
		t.Fatalf("result %+v %v", r, err)
	}
}

func TestTrivialSessionSkippedWithoutSummarizing(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "projects")
	write(t, filepath.Join(root, "-work-x", "s.jsonl"),
		[]byte(`{"type": "user", "sessionId": "abcdef1234567890", "cwd": "/work/x", "timestamp": "2026-09-18T00:00:00.000Z", "isSidechain": false, "message": {"role": "user", "content": "hi"}}`+"\n"))
	cfg := &config.Config{Root: tmp, Machine: "m", Home: filepath.Join(tmp, "home"), MinActiveMinutes: 3,
		ExcludePromptPatterns: []string{}, ExcludeCwdPatterns: []string{}}
	env, _ := testEnv(t, time.Now)
	sum := &countingSummarizer{}
	r, err := Run(cfg, newStore(), []Root{{"claude-code", root}}, sum.fn, &fourteen, 4, nil, env)
	if err != nil || r.New != 0 || r.Skipped != 1 || len(sum.calls) != 0 {
		t.Fatalf("result %+v %v calls %v", r, err, sum.calls)
	}
	// A trivial session is bookmarked by mtime only.
	st := LoadState(cfg.StatePath())
	if b, ok := st["claude-code:abcdef1234567890"]; !ok || b.FP != nil {
		t.Fatalf("state %+v", st)
	}
}

// _add_codex_patch: a tool call writing a deliverable, appended to the codex rollout (cwd /work/proj-b).
func (f *fx) addCodexPatch() {
	appendText(f.t, f.codexLog, `{"timestamp": "2026-09-18T09:05:00.000Z", "type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec", "input": "tools.apply_patch(\"*** Begin Patch\\n*** Add File: out/spec.md\\n+x\\n*** End Patch\")"}}`+"\n")
}

func TestHarvestSendsFilesWritten(t *testing.T) {
	f := setup(t)
	f.addCodexPatch()
	st := newStore()
	f.harvest(st, stubSummarizer)
	if got := st.records["S11112222"].FilesWritten; !slices.Equal(got, []string{"/work/proj-b/out/spec.md"}) {
		t.Fatal(got)
	}
	if got := st.records["Sabcd1234"].FilesWritten; got == nil || len(got) != 0 {
		t.Fatalf("%#v", got)
	}
}

func TestHarvestSendsActiveIntervals(t *testing.T) {
	f := setup(t)
	st := newStore()
	f.harvest(st, stubSummarizer)
	s := st.records["Sabcd1234"]
	iv := s.ActiveIntervals
	if len(iv) == 0 || iv[0][0] != s.StartedAt || iv[len(iv)-1][1] != s.EndedAt {
		t.Fatalf("intervals %v", iv)
	}
	for _, p := range iv {
		if p[1].Before(p[0]) {
			t.Fatalf("interval %v", p)
		}
	}
	// Every Session carries [] rather than null for lists Python defaults to [].
	o := st.records["S11112222"].Object()
	for _, k := range []string{"files_written", "active_intervals", "artifacts"} {
		if v, _ := o.Get(k); v == nil {
			t.Errorf("%s is null", k)
		}
	}
}

type fakeMeta struct {
	answers []answer
	batches [][]*pyjson.Object
}

func (m *fakeMeta) PutSessionMeta(items []*pyjson.Object) (int, api.Outcome) {
	m.batches = append(m.batches, items)
	a := m.answers[0]
	m.answers = m.answers[1:]
	if a.out != api.OK {
		return 0, a.out
	}
	return a.res.Updated, api.OK
}

func updated(n int) answer { return answer{&api.IngestResult{Updated: n}, api.OK} }

var isoZ = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`)

func TestRefreshMetaIgnoresBookmarksAndSendsOnlyDerivedFields(t *testing.T) {
	f := setup(t)
	f.harvest(newStore(), stubSummarizer)
	// Harvested before the patch was there, and the bookmark now covers that mtime.
	f.addCodexPatch()
	before, _ := os.ReadFile(f.cfg.StatePath())
	m := &fakeMeta{answers: []answer{updated(1)}}
	sent, upd, out := RefreshMeta(f.cfg, m, f.roots, nil, f.env)
	if sent != 2 || upd != 1 || out != api.OK {
		t.Fatalf("%d %d %s", sent, upd, out)
	}
	if len(m.batches) != 1 || len(m.batches[0]) != 2 {
		t.Fatalf("batches %d", len(m.batches))
	}
	// Every session goes, an empty list included; the Claude log has no usage (zero, priced at $0),
	// the Codex one has no token_count at all (null).
	want := []string{
		`{"agent":"claude-code","session_id":"abcd1234-ef56-7890-ab12-cd34ef567890","files_written":[],"tokens":{"by_model":{},"subagent":{},"cost_usd":0.0,"cost_partial":false},"artifacts":[]}`,
		`{"agent":"codex","session_id":"11112222-3333-4444-5555-666677778888","files_written":["/work/proj-b/out/spec.md"],"tokens":null,"artifacts":[]}`,
	}
	for i, item := range m.batches[0] {
		keys := item.Keys()
		if !slices.Equal(keys, []string{"agent", "session_id", "files_written", "tokens", "active_intervals", "artifacts"}) {
			t.Errorf("keys %v", keys)
		}
		iv, _ := item.Get("active_intervals")
		rest := pyjson.NewObject()
		for _, k := range keys {
			if k != "active_intervals" {
				v, _ := item.Get(k)
				rest.Set(k, v)
			}
		}
		wv, _ := pyjson.Decode([]byte(want[i]))
		if !pyjson.Equal(rest, wv) {
			t.Errorf("item %d = %s", i, pyjson.Compact(rest))
		}
		pairs, _ := iv.([]pyjson.Value)
		if len(pairs) == 0 {
			t.Errorf("item %d: no intervals", i)
		}
		for _, p := range pairs {
			pair := p.([]pyjson.Value)
			a, b := pair[0].(string), pair[1].(string)
			if len(pair) != 2 || !isoZ.MatchString(a) || !isoZ.MatchString(b) || a > b {
				t.Errorf("pair %v", pair)
			}
		}
	}
	if after, _ := os.ReadFile(f.cfg.StatePath()); !bytes.Equal(before, after) {
		t.Fatal("state changed")
	}
}

func TestRefreshMetaReportsARequestThatDidNotLand(t *testing.T) {
	f := setup(t)
	f.addCodexPatch()
	if _, _, out := RefreshMeta(f.cfg, &fakeMeta{answers: []answer{{nil, api.Retry}}}, f.roots, nil, f.env); out != api.Retry {
		t.Fatal(out)
	}
}

func TestRefreshMetaHonoursExcludedCwds(t *testing.T) {
	f := setup(t)
	f.cfg.ExcludeCwdPatterns = []string{"proj-a", "proj-b"}
	f.addCodexPatch()
	m := &fakeMeta{}
	sent, upd, out := RefreshMeta(f.cfg, m, f.roots, nil, f.env)
	if sent != 0 || upd != 0 || out != api.OK || len(m.batches) != 0 {
		t.Fatalf("%d %d %s %d", sent, upd, out, len(m.batches))
	}
}

func TestRefreshMetaLooksAtEveryLogByDefault(t *testing.T) {
	f := setup(t)
	// Both logs last touched long before any 14-day window.
	long := time.Unix(1_000_000_000, 0)
	for _, p := range []string{f.claudeLog, f.codexLog} {
		if err := os.Chtimes(p, long, long); err != nil {
			t.Fatal(err)
		}
	}
	if sent, upd, out := RefreshMeta(f.cfg, &fakeMeta{answers: []answer{updated(0)}}, f.roots, nil, f.env); sent != 2 || upd != 0 || out != api.OK {
		t.Fatalf("%d %d %s", sent, upd, out)
	}
	if sent, upd, out := RefreshMeta(f.cfg, &fakeMeta{}, f.roots, &fourteen, f.env); sent != 0 || upd != 0 || out != api.OK {
		t.Fatalf("%d %d %s", sent, upd, out)
	}
}

// META_BATCH: 500 per request; the first batch that does not land returns its Outcome and the
// batches before it stay applied.
func TestRefreshMetaSendsBatchesOf500(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "projects")
	src := fixture(t, "claude_code_session.jsonl")
	for i := range 1001 {
		id := fmt.Sprintf("s%07d-0000", i)
		write(t, filepath.Join(root, "-work-proj-a", id+".jsonl"), []byte(strings.ReplaceAll(string(src), claudeSessionID, id)))
	}
	cfg := &config.Config{Machine: "m", Root: tmp, Home: filepath.Join(tmp, "home")}
	env, _ := testEnv(t, time.Now)
	m := &fakeMeta{answers: []answer{updated(500), updated(3), updated(1)}}
	sent, upd, out := RefreshMeta(cfg, m, []Root{{"claude-code", root}}, nil, env)
	if sent != 1001 || upd != 504 || out != api.OK {
		t.Fatalf("%d %d %s", sent, upd, out)
	}
	if len(m.batches) != 3 || len(m.batches[0]) != 500 || len(m.batches[1]) != 500 || len(m.batches[2]) != 1 {
		t.Fatalf("batches %d", len(m.batches))
	}
	m = &fakeMeta{answers: []answer{updated(500), {nil, api.Rejected}}}
	if _, _, out := RefreshMeta(cfg, m, []Root{{"claude-code", root}}, nil, env); out != api.Rejected || len(m.batches) != 2 {
		t.Fatalf("%s %d", out, len(m.batches))
	}
}

func TestHarvestSendsTokensPricedFromConfig(t *testing.T) {
	f := setup(t)
	f.cfg.Pricing = map[string]map[string]float64{"claude-opus-5-5": {"input": 4.0, "output": 20.0, "cache_read": 0.2,
		"cache_write_5m": 5.0, "cache_write_1h": 8.0}}
	appendText(t, f.claudeLog, `{"type": "assistant", "sessionId": "abcd1234-ef56-7890-ab12-cd34ef567890", "isSidechain": false, "message": {"id": "msg_x", "model": "claude-opus-5-5", "role": "assistant", "content": [], "usage": {"input_tokens": 1000000, "output_tokens": 1000000, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}}`+"\n")
	st := newStore()
	f.harvest(st, stubSummarizer)
	tok := st.records["Sabcd1234"].Tokens
	if c, _ := tok.Get("cost_usd"); c != pyjson.Float(24.0) {
		t.Fatalf("cost %v", c)
	}
	if p, _ := tok.Get("cost_partial"); p != false {
		t.Fatalf("partial %v", p)
	}
	bm, _ := tok.Get("by_model")
	row, _ := bm.(*pyjson.Object).Get("claude-opus-5-5")
	if out, _ := row.(*pyjson.Object).Get("output"); out != pyjson.Int(1_000_000) {
		t.Fatalf("output %v", out)
	}
	// The Codex fixture has no token_count events: unknown, sent as null.
	if st.records["S11112222"].Tokens != nil {
		t.Fatal("codex tokens not null")
	}
}

const artifactPublish = `{"type": "assistant", "sessionId": "abcd1234-ef56-7890-ab12-cd34ef567890", "cwd": "/work/proj-a", "timestamp": "2026-09-18T11:00:00.000Z", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_art", "name": "Artifact", "input": {"file_path": "/work/proj-a/r.html"}}]}}
{"type": "user", "sessionId": "abcd1234-ef56-7890-ab12-cd34ef567890", "cwd": "/work/proj-a", "timestamp": "2026-09-18T11:00:05.000Z", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_art", "content": "ok"}]}, "toolUseResult": {"url": "https://claude.ai/artifact/AAA111", "title": "集計結果", "artifact_id": "a1"}}
`

// A publish is tool-only turns, so the message count does not move; the fingerprint must.
func TestAPublishAloneReSendsTheSessionWithItsArtifacts(t *testing.T) {
	f := setup(t)
	st := newStore()
	f.harvest(st, stubSummarizer)
	if a := st.records["Sabcd1234"].Artifacts; a == nil || len(a) != 0 {
		t.Fatalf("%#v", a)
	}
	appendText(t, f.claudeLog, artifactPublish)
	touchLater(t, f.claudeLog)
	sum := &countingSummarizer{}
	f.harvest(st, sum.fn)
	if !slices.Equal(sum.calls, []string{claudeSessionID}) {
		t.Fatal(sum.calls)
	}
	got := pyjson.Compact(st.records["Sabcd1234"].Object())
	want := `"artifacts":[{"url":"https://claude.ai/artifact/AAA111","title":"集計結果","artifact_id":"a1","ts":"2026-09-18T11:00:05.000Z"}]`
	if !strings.Contains(string(got), want) {
		t.Fatal(string(got))
	}
}

// Bookmarks written before the field must still match, or every open window is summarized again.
func TestASessionWithoutArtifactsKeepsItsPreArtifactsFingerprint(t *testing.T) {
	env, _ := testEnv(t, time.Now)
	raw, err := claudecode.ParseFile(filepath.Join(testkit.TestdataDir(t), "fixtures", "claude_code_session.jsonl"), env)
	if err != nil || raw == nil {
		t.Fatal(err)
	}
	first, _ := session.StartedAt(raw.Messages)
	last, _ := session.EndedAt(raw.Messages)
	files := []pyjson.Value{}
	for _, p := range slices.Sorted(slices.Values(raw.FilesWritten)) {
		files = append(files, p)
	}
	var tok pyjson.Value
	if raw.Tokens != nil {
		tok = raw.Tokens.Value()
	}
	before := pyjson.Dumps([]pyjson.Value{pyjson.Int(len(raw.Messages)), first.ISOFormat(), last.ISOFormat(), files, tok,
		"T1", "auto-dir"}, pyjson.Default().Sorted())
	h, _ := blake2b.New(16, nil)
	h.Write(before)
	tid := "T1"
	if got := Fingerprint(raw, &tid, "auto-dir"); got != hex.EncodeToString(h.Sum(nil)) {
		t.Fatalf("fp %s", got)
	}
}

// Python's `with ThreadPoolExecutor` waits for every submitted session before the panic leaves
// harvest (shutdown(wait=True) cancels nothing), so every candidate reaches claude; nothing after
// the panic is sent. The second call is slowed so that a Run that re-panics at once returns first.
func TestASummarizerPanicWaitsForTheOtherWorkers(t *testing.T) {
	f := setup(t)
	st := newStore()
	boom := errors.New("boom")
	var calls, finished atomic.Int32
	sum := func(raw *session.RawSession, _ string) (string, string) {
		if calls.Add(1) == 1 {
			panic(boom)
		}
		time.Sleep(200 * time.Millisecond)
		finished.Add(1)
		return "stub summary", "llm"
	}
	var p any
	func() {
		defer func() { p = recover() }()
		Run(f.cfg, st, f.roots, sum, &fourteen, 1, nil, f.env)
	}()
	if p != boom {
		t.Fatalf("recovered %v", p)
	}
	if n, done := calls.Load(), finished.Load(); n != 2 || done != 1 {
		t.Fatalf("when the panic left Run: %d summarizer calls, %d finished; want 2 and 1 (Python waits for every worker)", n, done)
	}
	if len(st.appended) != 0 {
		t.Fatalf("appended %v", st.appended)
	}
}

// A summarizer panic is re-raised on the goroutine that called Run (Python: fut.result() raises),
// where a recover can turn it into exit 1; the sessions handled before it stay bookmarked.
func TestASummarizerPanicReachesTheCaller(t *testing.T) {
	f := setup(t)
	st := newStore()
	boom := errors.New("boom")
	sum := func(raw *session.RawSession, _ string) (string, string) {
		if raw.Agent == "codex" {
			panic(boom)
		}
		return "stub summary", "llm"
	}
	var p any
	func() {
		defer func() { p = recover() }()
		Run(f.cfg, st, f.roots, sum, &fourteen, 1, nil, f.env)
	}()
	if p != boom {
		t.Fatalf("recovered %v", p)
	}
	if !slices.Equal(st.appended, []string{"Sabcd1234"}) {
		t.Fatalf("appended %v", st.appended)
	}
	state := LoadState(f.cfg.StatePath())
	if b, ok := state["claude-code:"+claudeSessionID]; len(state) != 1 || !ok || b.FP == nil {
		t.Fatalf("state %+v", state)
	}
}
