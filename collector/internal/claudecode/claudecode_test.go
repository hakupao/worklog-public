package claudecode

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/testkit"
	"github.com/hakupao/worklog/collector/internal/tokens"
)

// home is the HOME the corpus and its goldens assume (testdata/logs/INDEX.md).
const home = "/home/wl"

const sid = "abcd1234-ef56-7890-ab12-cd34ef567890"

func newEnv(goos string) (*rt.Env, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	return &rt.Env{
		Stdout: io.Discard,
		Stderr: buf,
		Now:    func() time.Time { return time.Date(2026, 10, 13, 3, 0, 0, 0, time.UTC) },
		Getenv: func(string) string { return "" },
		Home:   home,
		GOOS:   goos,
	}, buf
}

func warnLines(buf *bytes.Buffer) []string {
	s := buf.String()
	if s == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(s, "\n"), "\n")
}

func parse(t *testing.T, path string) *session.RawSession {
	t.Helper()
	env, buf := newEnv("darwin")
	s, err := ParseFile(path, env)
	if err != nil {
		t.Fatalf("ParseFile(%s): %v", path, err)
	}
	if w := warnLines(buf); w != nil {
		t.Errorf("unexpected warnings: %q", w)
	}
	if s == nil {
		t.Fatalf("ParseFile(%s) = nil", path)
	}
	return s
}

func iterAll(t *testing.T, root string, since *float64, env *rt.Env) []*session.RawSession {
	t.Helper()
	var out []*session.RawSession
	IterSessions(root, since, env, func(s *session.RawSession) { out = append(out, s) })
	return out
}

func ids(ss []*session.RawSession) []string {
	out := []string{}
	for _, s := range ss {
		out = append(out, s.SessionID)
	}
	return out
}

func f64(v float64) *float64 { return &v }

func str(s string) *string { return &s }

func mustJSON(t *testing.T, s string) pyjson.Value {
	t.Helper()
	v, err := pyjson.Decode([]byte(s))
	if err != nil {
		t.Fatalf("bad JSON literal %s: %v", s, err)
	}
	return v
}

// row is test_tokens.row(): one model's counts in tokens.FIELDS order, as JSON.
func row(n ...int64) string {
	var u [6]int64
	copy(u[:], n)
	return fmt.Sprintf(`{"input": %d, "output": %d, "cache_read": %d, "cache_write_5m": %d, "cache_write_1h": %d, "reasoning": %d}`,
		u[0], u[1], u[2], u[3], u[4], u[5])
}

func assertJSON(t *testing.T, what string, got pyjson.Value, want string) {
	t.Helper()
	w := mustJSON(t, want)
	if !pyjson.Equal(got, w) {
		t.Errorf("%s:\n got %s\nwant %s", what, pyjson.Dumps(got, pyjson.Unicode()), pyjson.Dumps(w, pyjson.Unicode()))
	}
}

func messageTexts(s *session.RawSession, role string) []string {
	out := []string{}
	for _, m := range s.Messages {
		if role == "" || m.Role == role {
			out = append(out, m.Text)
		}
	}
	return out
}

func roles(s *session.RawSession) []string {
	out := []string{}
	for _, m := range s.Messages {
		out = append(out, m.Role)
	}
	return out
}

func writeFile(t *testing.T, path string, lines ...string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func setMtime(t *testing.T, path string, sec int64) {
	t.Helper()
	ts := time.Unix(sec, 0)
	if err := os.Chtimes(path, ts, ts); err != nil {
		t.Fatal(err)
	}
}

// ---- test_parsers.py (Claude) -------------------------------------------------------------------

func fixture(t *testing.T) string {
	return testkit.CopyCorpus(t, "../fixtures/claude_code_session.jsonl")
}

func TestClaudeParse(t *testing.T) {
	s := parse(t, fixture(t))
	if s.Agent != "claude-code" || s.SessionID != sid || s.Cwd != "/work/proj-a" {
		t.Errorf("got agent=%q id=%q cwd=%q", s.Agent, s.SessionID, s.Cwd)
	}
	if n := session.Turns(s.Messages); n != 3 {
		t.Errorf("turns = %d, want 3", n)
	}
	if n := session.ActiveMinutes(s.Messages, 30); n != 15 {
		t.Errorf("active minutes = %d, want 15", n)
	}
}

func TestClaudeSkipsSidechainAndToolResultAndEmpty(t *testing.T) {
	s := parse(t, fixture(t))
	for _, text := range messageTexts(s, "user") {
		if text == "サブエージェントへの指示テキスト" || strings.HasPrefix(text, "<") {
			t.Errorf("user text %q should have been skipped", text)
		}
	}
}

func TestClaudeMissingFileReturnsNone(t *testing.T) {
	env, buf := newEnv("darwin")
	s, err := ParseFile(filepath.Join(t.TempDir(), "nope.jsonl"), env)
	if s != nil || err != nil || buf.Len() != 0 {
		t.Errorf("got %v, %v, warnings %q", s, err, buf.String())
	}
}

func TestClaudeIterSessions(t *testing.T) {
	env, _ := newEnv("darwin")
	if got := iterAll(t, filepath.Join(t.TempDir(), "fixtures_claude_root_nonexistent"), nil, env); len(got) != 0 {
		t.Errorf("got %d sessions from a missing root", len(got))
	}
}

func TestClaudeIterSessionsFindsFixture(t *testing.T) {
	root := testkit.CopyCorpus(t, "test_parsers/test_claude_iter_sessions_finds_fixture")
	env, _ := newEnv("darwin")
	got := iterAll(t, filepath.Join(root, "projects"), nil, env)
	if len(got) != 1 || got[0].Agent != "claude-code" {
		t.Fatalf("got %v", ids(got))
	}
}

func TestClaudeFilesWrittenFromFileTools(t *testing.T) {
	s := parse(t, testkit.CopyCorpus(t, "test_parsers/test_claude_files_written_from_file_tools/s.jsonl"))
	want := []string{"/work/proj/成果物/a.md", "/work/proj/b.py", "/work/proj/c.ipynb", "/work/proj/docs/rel.md",
		// An inline subagent (sidechain) write is the session's work too.
		"/work/proj/sub-agent.md"}
	if !reflect.DeepEqual(s.FilesWritten, want) {
		t.Errorf("files_written = %q, want %q", s.FilesWritten, want)
	}
	// Extraction does not change what counts as a message.
	if r := roles(s); !reflect.DeepEqual(r, []string{"user"}) {
		t.Errorf("roles = %q", r)
	}
}

func TestClaudeFixtureWithoutFileToolsHasNoFiles(t *testing.T) {
	if s := parse(t, fixture(t)); len(s.FilesWritten) != 0 || s.FilesWritten == nil {
		t.Errorf("files_written = %#v, want []", s.FilesWritten)
	}
}

func TestClaudeSubagentTranscriptsFeedTheParentSession(t *testing.T) {
	root := testkit.CopyCorpus(t, "test_parsers/test_claude_subagent_transcripts_feed_the_parent_session")
	s := parse(t, filepath.Join(root, "-work-proj", "cc-files.jsonl"))
	if want := []string{"/work/proj/main.md", "/work/proj/成果物/report.xlsx"}; !reflect.DeepEqual(s.FilesWritten, want) {
		t.Errorf("files_written = %q, want %q", s.FilesWritten, want)
	}
	// The subagent's conversation still counts for nothing: one user turn, the parent's.
	if n := session.Turns(s.Messages); n != 1 {
		t.Errorf("turns = %d, want 1", n)
	}
	// A subagent transcript is never a session of its own.
	env, buf := newEnv("darwin")
	if sub, _ := ParseFile(filepath.Join(root, "-work-proj", "cc-files", "subagents", "agent-a1.jsonl"), env); sub != nil {
		t.Errorf("a subagent transcript parsed as session %q", sub.SessionID)
	}
	if got := ids(iterAll(t, root, nil, env)); !reflect.DeepEqual(got, []string{"cc-files"}) {
		t.Errorf("iter = %q", got)
	}
	if buf.Len() != 0 {
		t.Errorf("warnings: %q", buf.String())
	}
}

func TestClaudeANewerSubagentLogMovesTheSessionMtime(t *testing.T) {
	root := testkit.CopyCorpus(t, "test_parsers/test_claude_a_newer_subagent_log_moves_the_session_mtime")
	s := parse(t, filepath.Join(root, "-work-proj", "cc-files.jsonl"))
	if s.Mtime != 1_000_300_000 {
		t.Errorf("mtime = %v, want 1000300000", s.Mtime)
	}
	if want := []string{"/work/proj/late.md"}; !reflect.DeepEqual(s.FilesWritten, want) {
		t.Errorf("files_written = %q", s.FilesWritten)
	}
	env, _ := newEnv("darwin")
	if got := ids(iterAll(t, root, f64(1_000_200_000), env)); !reflect.DeepEqual(got, []string{"cc-files"}) {
		t.Errorf("since 1_000_200_000: %q", got)
	}
	if got := iterAll(t, root, f64(1_000_400_000), env); len(got) != 0 {
		t.Errorf("since 1_000_400_000: %q", ids(got))
	}
}

func TestClaudeArtifactsKeepPublishesOnly(t *testing.T) {
	s := parse(t, testkit.CopyCorpus(t, "test_parsers/test_claude_artifacts_keep_publishes_only/s.jsonl"))
	want := []model.Artifact{
		{URL: "https://claude.ai/code/artifact/00000000-0000-4000-8000-0000000000a1", Title: str("旧形式"),
			ArtifactID: str("00000000-0000-4000-8000-0000000000a1"), TS: "2026-10-09T09:03:00.000Z"},
		{URL: "https://claude.ai/artifact/AAA111", Title: str("改訂版"), ArtifactID: str("id-1"), TS: "2026-10-09T09:05:00.000Z"},
	}
	if !reflect.DeepEqual(s.Artifacts, want) {
		t.Errorf("artifacts = %s", dumpArtifacts(s.Artifacts))
	}
	// Tool-only turns still add no messages.
	if r := roles(s); !reflect.DeepEqual(r, []string{"user"}) {
		t.Errorf("roles = %q", r)
	}
}

func TestClaudeArtifactsFromSubagentsAndAnOlderPublishReadLater(t *testing.T) {
	root := testkit.CopyCorpus(t, "test_parsers/test_claude_artifacts_from_subagents_and_an_older_publish_read_later")
	s := parse(t, filepath.Join(root, "-work-proj", "cc-art.jsonl"))
	want := []model.Artifact{
		{URL: "https://claude.ai/artifact/BBB222", Title: str("子だけ"), ArtifactID: str("id-2"), TS: "2026-10-09T09:40:00.000Z"},
		{URL: "https://claude.ai/artifact/AAA111", Title: str("子の題"), ArtifactID: str("id-1"), TS: "2026-10-09T10:00:00.000Z"},
	}
	if !reflect.DeepEqual(s.Artifacts, want) {
		t.Errorf("artifacts = %s", dumpArtifacts(s.Artifacts))
	}
}

// The Claude half of test_claude_and_codex_sessions_without_publishes_have_no_artifacts (Task 7 ports
// the Codex half).
func TestClaudeSessionsWithoutPublishesHaveNoArtifacts(t *testing.T) {
	if s := parse(t, fixture(t)); s.Artifacts == nil || len(s.Artifacts) != 0 {
		t.Errorf("artifacts = %#v, want []", s.Artifacts)
	}
}

func dumpArtifacts(as []model.Artifact) string {
	var b strings.Builder
	for _, a := range as {
		deref := func(p *string) string {
			if p == nil {
				return "<nil>"
			}
			return *p
		}
		fmt.Fprintf(&b, "{%s %s %s %s} ", a.URL, deref(a.Title), deref(a.ArtifactID), a.TS)
	}
	return b.String()
}

// ---- test_tokens.py (Claude) --------------------------------------------------------------------

func tokenLog(t *testing.T, test string) string {
	return filepath.Join(testkit.CopyCorpus(t, "test_tokens/"+test), "proj", sid+".jsonl")
}

func TestClaudeCountsAResponseOnceHoweverManyRecordsRepeatItsID(t *testing.T) {
	s := parse(t, tokenLog(t, "test_claude_counts_a_response_once_however_many_records_repeat_its_id"))
	assertJSON(t, "tokens", s.Tokens.Value(), `{"by_model": {"claude-opus-5-5": `+row(4, 55, 1000, 200, 0)+`}, "subagent": {}}`)
}

func TestClaudeTakesTheLastRecordOfAResponseStreamedIntoASubagentLog(t *testing.T) {
	s := parse(t, tokenLog(t, "test_claude_takes_the_last_record_of_a_response_streamed_into_a_subagent_log"))
	sub, _ := s.Tokens.Value().Get("subagent")
	assertJSON(t, "subagent", sub, `{"claude-sonnet-5": `+row(2, 392, 0, 46311)+`}`)
}

func TestClaudeAResumedSubagentReplayingAnEarlierSnapshotDoesNotUndoTheFinalCount(t *testing.T) {
	s := parse(t, tokenLog(t, "test_claude_a_resumed_subagent_replaying_an_earlier_snapshot_does_not_undo_the_final_count"))
	sub, _ := s.Tokens.Value().Get("subagent")
	assertJSON(t, "subagent", sub, `{"claude-sonnet-5": `+row(3, 213, 10)+`}`)
}

func TestClaudeSplitsCacheWritesInto5mAnd1h(t *testing.T) {
	s := parse(t, tokenLog(t, "test_claude_splits_cache_writes_into_5m_and_1h"))
	byModel, _ := s.Tokens.Value().Get("by_model")
	r, _ := byModel.(*pyjson.Object).Get("claude-sonnet-5")
	w5, _ := r.(*pyjson.Object).Get("cache_write_5m")
	w1, _ := r.(*pyjson.Object).Get("cache_write_1h")
	if w5 != pyjson.Int(40+7+30) || w1 != pyjson.Int(60+20) {
		t.Errorf("(5m, 1h) = (%v, %v), want (77, 80)", w5, w1)
	}
}

func TestClaudeInlineSidechainAndSubagentLogsAreSubagentUsage(t *testing.T) {
	s := parse(t, tokenLog(t, "test_claude_inline_sidechain_and_subagent_logs_are_subagent_usage"))
	assertJSON(t, "tokens", s.Tokens.Value(), `{"by_model": {"claude-opus-5-5": `+row(1, 10)+
		`, "claude-haiku-4-5-20251001": `+row(2, 20)+`, "claude-sonnet-5": `+row(7, 70)+`}, "subagent": {`+
		`"claude-haiku-4-5-20251001": `+row(2, 20)+`, "claude-sonnet-5": `+row(7, 70)+`}}`)
}

func TestClaudeWorkflowSubagentsCountForMtimeAndFilesWritten(t *testing.T) {
	s := parse(t, tokenLog(t, "test_claude_workflow_subagents_count_for_mtime_and_files_written"))
	if s.Mtime != 2_000_000_000 {
		t.Errorf("mtime = %v", s.Mtime)
	}
	if want := []string{"/w/out/report.md"}; !reflect.DeepEqual(s.FilesWritten, want) {
		t.Errorf("files_written = %q", s.FilesWritten)
	}
}

func TestClaudeAdvisorIterationsAreCountedOnTheirOwnModel(t *testing.T) {
	s := parse(t, tokenLog(t, "test_claude_advisor_iterations_are_counted_on_their_own_model"))
	byModel, _ := s.Tokens.Value().Get("by_model")
	assertJSON(t, "by_model", byModel, `{"claude-opus-5-5": `+row(4, 357, 105877, 1223, 1517, 9)+
		`, "claude-fable-5-1": `+row(54477, 4010)+`}`)
}

// pricingExample is config.example.toml's [pricing], as golden/tokens.json records it.
func pricingExample(t *testing.T) map[string]map[string]float64 {
	var g struct {
		PricingExample map[string]map[string]float64 `json:"pricing_example"`
	}
	testkit.Golden(t, "tokens", &g)
	if len(g.PricingExample) == 0 {
		t.Fatal("golden tokens.json has no pricing_example")
	}
	return g.PricingExample
}

func costOf(t *testing.T, o *pyjson.Object) (float64, bool) {
	t.Helper()
	c, _ := o.Get("cost_usd")
	p, _ := o.Get("cost_partial")
	f, ok := c.(pyjson.Float)
	if !ok {
		t.Fatalf("cost_usd = %#v", c)
	}
	return float64(f), p == true
}

func TestFastModeCacheUsageHasNoPriceSoTheCostIsPartial(t *testing.T) {
	tl := tokens.NewTally()
	tl.Add("claude-opus-5-5:fast", tokens.Usage{1_000_000, 1_000_000, 500}, false)
	cost, partial := costOf(t, tokens.WithCost(tl, pricingExample(t)))
	if math.Abs(cost-48.0) > 48.0*1e-6 || !partial {
		t.Errorf("cost = %v partial = %v, want ≈48.0 true", cost, partial)
	}
}

func TestClaudeFastModeIsItsOwnModelAndSyntheticTurnsAreSkipped(t *testing.T) {
	s := parse(t, tokenLog(t, "test_claude_fast_mode_is_its_own_model_and_synthetic_turns_are_skipped"))
	byModel, _ := s.Tokens.Value().Get("by_model")
	assertJSON(t, "by_model", byModel, `{"claude-opus-5-5:fast": `+row(10, 100)+`, "claude-opus-5-5": `+row(1, 1)+`}`)
	cost, partial := costOf(t, tokens.WithCost(s.Tokens, pricingExample(t)))
	want := float64(10*8+100*40+1*4+1*20) / 1e6
	if math.Abs(cost-want) > want*1e-6 || partial {
		t.Errorf("cost = %v partial = %v, want ≈%v false", cost, partial, want)
	}
}

func TestClaudeTokensDoNotChangeTextOrTurns(t *testing.T) {
	root := testkit.CopyCorpus(t, "test_tokens/test_claude_tokens_do_not_change_text_or_turns")
	with := parse(t, filepath.Join(root, "proj", sid+".jsonl"))
	without := parse(t, filepath.Join(root, "b", sid+".jsonl"))
	pairs := func(s *session.RawSession) []string {
		out := []string{}
		for _, m := range s.Messages {
			out = append(out, m.Role+"|"+m.Text)
		}
		return out
	}
	if !reflect.DeepEqual(pairs(with), pairs(without)) {
		t.Errorf("messages differ: %q vs %q", pairs(with), pairs(without))
	}
	assertJSON(t, "tokens without usage", without.Tokens.Value(), `{"by_model": {}, "subagent": {}}`)
}

func TestClaudeIterSessionsNeverParsesAWorkflowTranscriptAsASession(t *testing.T) {
	root := filepath.Join(testkit.CopyCorpus(t, "test_tokens/test_claude_iter_sessions_never_parses_a_workflow_transcript_as_a_session"), "projects")
	var parsed []string
	real := parseFile
	parseFile = func(p string, env *rt.Env) (*session.RawSession, error) {
		parsed = append(parsed, p)
		return real(p, env)
	}
	defer func() { parseFile = real }()
	env, _ := newEnv("darwin")
	got := iterAll(t, root, nil, env)
	if want := []string{filepath.Join(root, "proj", sid+".jsonl")}; !reflect.DeepEqual(parsed, want) {
		t.Errorf("parsed %q, want %q", parsed, want)
	}
	if len(got) != 1 {
		t.Fatalf("got %d sessions", len(got))
	}
	sub, _ := got[0].Tokens.Value().Get("subagent")
	assertJSON(t, "subagent", sub, `{"claude-sonnet-5": `+row(1, 1)+`}`)
}

// ---- walk order, subagent order --------------------------------------------------------------------

func minimalLog(id string) string {
	return fmt.Sprintf(`{"type": "user", "sessionId": %q, "cwd": "/w", "timestamp": "2026-09-18T09:00:00Z", "message": {"role": "user", "content": "hi"}}`, id)
}

// sorted(root.rglob("*.jsonl")) compares paths component by component, lower-cased on Windows: a plain
// string sort would put "p-q/" before "p/" ('-' < '/') and, on Windows, "Zeta" before "alpha".
func TestIterOrderFollowsTheHostPathFlavour(t *testing.T) {
	root := t.TempDir()
	for _, rel := range []string{"p-q/s.jsonl", "p/s.jsonl", "-work-alpha/a.jsonl", "-work-Zeta/z.jsonl"} {
		writeFile(t, filepath.Join(root, filepath.FromSlash(rel)), minimalLog(rel))
	}
	for goos, want := range map[string][]string{
		"darwin":  {"-work-Zeta/z.jsonl", "-work-alpha/a.jsonl", "p/s.jsonl", "p-q/s.jsonl"},
		"linux":   {"-work-Zeta/z.jsonl", "-work-alpha/a.jsonl", "p/s.jsonl", "p-q/s.jsonl"},
		"windows": {"-work-alpha/a.jsonl", "-work-Zeta/z.jsonl", "p/s.jsonl", "p-q/s.jsonl"},
	} {
		if filepath.Separator == '\\' && goos != "windows" {
			continue // a POSIX flavour does not split this host's "\\" paths
		}
		env, _ := newEnv(goos)
		if got := ids(iterAll(t, root, nil, env)); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: order %q, want %q", goos, got, want)
		}
	}
}

// Subagent logs are read in (mtime, name) order: with equal mtimes the name decides, and the later
// of two equal-output records of one response wins.
func TestSubagentLogsAreReadInMtimeThenNameOrder(t *testing.T) {
	root := t.TempDir()
	parent := writeFile(t, filepath.Join(root, "proj", sid+".jsonl"), minimalLog(sid))
	rec := func(model string) string {
		return fmt.Sprintf(`{"type": "assistant", "isSidechain": true, "message": {"id": "same", "model": %q, "usage": {"input_tokens": 1, "output_tokens": 5}}}`, model)
	}
	dir := filepath.Join(root, "proj", sid, "subagents")
	b := writeFile(t, filepath.Join(dir, "agent-b.jsonl"), rec("model-b"))
	a := writeFile(t, filepath.Join(dir, "agent-a.jsonl"), rec("model-a"))
	setMtime(t, parent, 1_000_000_000)
	setMtime(t, a, 1_500_000_000)
	setMtime(t, b, 1_500_000_000)
	s := parse(t, parent)
	assertJSON(t, "subagent", mustGet(s.Tokens.Value(), "subagent"), `{"model-b": `+row(1, 5)+`}`)

	// An older mtime is read first even with the later name.
	setMtime(t, b, 1_400_000_000)
	s = parse(t, parent)
	assertJSON(t, "subagent", mustGet(s.Tokens.Value(), "subagent"), `{"model-a": `+row(1, 5)+`}`)
	if s.Mtime != 1_500_000_000 {
		t.Errorf("mtime = %v", s.Mtime)
	}
}

func mustGet(o *pyjson.Object, k string) pyjson.Value {
	v, _ := o.Get(k)
	return v
}

// A symlinked directory is not descended into (Path.rglob's recurse_symlinks=False).
func TestIterDoesNotFollowDirectorySymlinks(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	writeFile(t, filepath.Join(other, "x.jsonl"), minimalLog("elsewhere"))
	writeFile(t, filepath.Join(root, "p", "s.jsonl"), minimalLog("here"))
	if err := os.Symlink(other, filepath.Join(root, "link")); err != nil {
		t.Skip("no symlinks:", err)
	}
	env, _ := newEnv("darwin")
	if got := ids(iterAll(t, root, nil, env)); !reflect.DeepEqual(got, []string{"here"}) {
		t.Errorf("got %q", got)
	}
}

// ---- records ------------------------------------------------------------------------------------

func TestRecordsFilterLikeThePythonParser(t *testing.T) {
	p := writeFile(t, filepath.Join(t.TempDir(), "s.jsonl"),
		`{"type": "summary", "sessionId": "not-me", "cwd": "/no"}`,
		`{"type": "user", "isSidechain": true, "sessionId": "side", "cwd": "/side", "timestamp": "2026-09-18T09:00:00Z", "message": {"content": "sidechain"}}`,
		`{"type": "user", "sessionId": "", "cwd": "", "timestamp": "2026-09-18T09:00:00Z", "message": {"content": "<command>x</command>"}}`,
		`{"type": "user", "sessionId": "first", "cwd": "/first", "timestamp": "2026-09-18T09:01:00Z", "message": {"content": [{"type": "text", "text": "a"}, {"type": "image"}, {"type": "text", "text": "b"}]}}`,
		`{"type": "user", "sessionId": "second", "cwd": "/second", "timestamp": "2026-09-18T09:02:00Z", "message": {"content": ""}}`,
		`{"type": "assistant", "timestamp": "2026-09-18T09:03:00Z", "message": {"content": [{"type": "tool_use", "name": "Bash"}]}}`,
		`{"type": "assistant", "timestamp": "2026-09-18T09:04:00Z", "message": {"content": "<ok> from the model"}}`,
		`{"type": "assistant", "message": {"content": "no timestamp"}}`,
		`  {"type": "user", "timestamp": "2026-09-18T09:05:00Z", "message": {"content": "padded"}}`+"\u3000",
		`[1, 2]`,
		`not json`,
		`{"type": "user", "timestamp": "2026-09-18T09:06:00Z", "message": null}`,
	)
	s := parse(t, p)
	if s.SessionID != "first" || s.Cwd != "/first" {
		t.Errorf("id=%q cwd=%q", s.SessionID, s.Cwd)
	}
	if got, want := messageTexts(s, ""), []string{"ab", "<ok> from the model", "padded"}; !reflect.DeepEqual(got, want) {
		t.Errorf("texts = %q, want %q", got, want)
	}
}

func TestNoSessionIDIsNoSession(t *testing.T) {
	p := writeFile(t, filepath.Join(t.TempDir(), "s.jsonl"),
		`{"type": "user", "cwd": "/w", "timestamp": "2026-09-18T09:00:00Z", "message": {"content": "hi"}}`)
	env, buf := newEnv("darwin")
	if s, err := ParseFile(p, env); s != nil || err != nil || buf.Len() != 0 {
		t.Errorf("got %v %v %q", s, err, buf.String())
	}
}

// A publish without an id registers None, which a tool_result without tool_use_id then matches
// (Python's set membership on None).
func TestArtifactPublishWithoutIDMatchesAResultWithoutToolUseID(t *testing.T) {
	p := writeFile(t, filepath.Join(t.TempDir(), "s.jsonl"),
		`{"type": "user", "sessionId": "x", "timestamp": "2026-10-09T09:00:00Z", "message": {"content": "go"}}`,
		`{"type": "assistant", "timestamp": "2026-10-09T09:01:00Z", "message": {"content": [{"type": "tool_use", "name": "Artifact", "input": {"file_path": "/p.html"}}]}}`,
		`{"type": "user", "timestamp": "2026-10-09T09:01:00Z", "message": {"content": [{"type": "tool_result"}]}, "toolUseResult": {"url": "https://claude.ai/artifact/N", "title": ""}}`,
	)
	s := parse(t, p)
	want := []model.Artifact{{URL: "https://claude.ai/artifact/N", TS: "2026-10-09T09:01:00Z"}}
	if !reflect.DeepEqual(s.Artifacts, want) {
		t.Errorf("artifacts = %s", dumpArtifacts(s.Artifacts))
	}
}

// ---- spec §6 rows ---------------------------------------------------------------------------------

func divergentFile(t *testing.T, row string) string {
	root := testkit.CopyCorpus(t, "divergent/"+row)
	var found string
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".jsonl") {
			found = p
		}
		return nil
	})
	return found
}

func pythonError(t *testing.T, key string) string {
	var raw []byte
	testkit.Golden(t, "parsers", &raw)
	v, err := pyjson.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	files := mustGet(v.(*pyjson.Object), "files").(*pyjson.Object)
	e := mustGet(mustGet(files, key).(*pyjson.Object), "claude-code").(*pyjson.Object)
	return mustGet(e, "message").(string)
}

func TestD1InvalidUTF8IsSkippedWithOneWarning(t *testing.T) {
	for row, key := range map[string]string{
		"D1": "logs/divergent/D1/-work-div/div00001-0000-0000-0000-000000000001.jsonl",
		"D2": "logs/divergent/D2/sessions/2026/09/18/rollout-d2.jsonl",
	} {
		p := divergentFile(t, row)
		env, buf := newEnv("darwin")
		s, err := ParseFile(p, env)
		if s != nil || err != nil {
			t.Errorf("%s: got %v, %v", row, s, err)
		}
		want := fmt.Sprintf("worklog: skipped unreadable log %s (%s)", p, pythonError(t, key))
		if got := warnLines(buf); !reflect.DeepEqual(got, []string{want}) {
			t.Errorf("%s: warnings %q, want %q", row, got, want)
		}
	}
}

func TestD3MixedOffsetsWarnOnceAndParseUnchanged(t *testing.T) {
	p := divergentFile(t, "D3")
	env, buf := newEnv("darwin")
	s, _ := ParseFile(p, env)
	if s == nil {
		t.Fatal("no session")
	}
	var ts []string
	for _, m := range s.Messages {
		ts = append(ts, m.TS.ISOFormat())
	}
	if want := []string{"2026-09-18T09:00:00+00:00", "2026-09-18T09:10:00", "2026-09-18T09:20:00+09:00"}; !reflect.DeepEqual(ts, want) {
		t.Errorf("ts = %q", ts)
	}
	if w := warnLines(buf); len(w) != 1 || !strings.Contains(w[0], p) {
		t.Errorf("warnings %q", w)
	}
}

func TestD4BadTokenCountIsZeroWithOneWarning(t *testing.T) {
	p := divergentFile(t, "D4")
	env, buf := newEnv("darwin")
	s, _ := ParseFile(p, env)
	if s == nil {
		t.Fatal("no session")
	}
	assertJSON(t, "tokens", s.Tokens.Value(), `{"by_model": {"claude-opus-5-5": `+row(0, 3)+`}, "subagent": {}}`)
	if got := messageTexts(s, ""); !reflect.DeepEqual(got, []string{"D4", "x"}) {
		t.Errorf("texts = %q", got)
	}
	if w := warnLines(buf); len(w) != 1 || !strings.Contains(w[0], p) {
		t.Errorf("warnings %q", w)
	}
}

func TestD11AndD12DropTheRecordWithOneWarning(t *testing.T) {
	for _, row := range []string{"D11", "D12"} {
		p := divergentFile(t, row)
		env, buf := newEnv("darwin")
		s, _ := ParseFile(p, env)
		if s == nil {
			t.Fatalf("%s: no session", row)
		}
		if got := messageTexts(s, ""); !reflect.DeepEqual(got, []string{row, "next"}) {
			t.Errorf("%s: texts = %q", row, got)
		}
		if w := warnLines(buf); len(w) != 1 || !strings.Contains(w[0], p) {
			t.Errorf("%s: warnings %q", row, w)
		}
	}
}

// D15 (an offset with a fraction of a second) is dropped like D11; several bad records in one file
// still give one warning per row; falsy timestamps are dropped silently, as Python's `if not timestamp`.
func TestBadTimestampsWarnOncePerFileAndFalsyOnesAreSilent(t *testing.T) {
	msg := func(text, ts string) string {
		return fmt.Sprintf(`{"type": "user", "sessionId": "x", "cwd": "/w", "timestamp": %s, "message": {"content": %q}}`, ts, text)
	}
	p := writeFile(t, filepath.Join(t.TempDir(), "s.jsonl"),
		msg("ok", `"2026-09-18T09:00:00Z"`),
		msg("d15", `"2026-09-18T09:00:00+09:00:30.5"`),
		msg("d11", `"2026-13-01T00:00:00Z"`),
		msg("d12", `true`),
		msg("d12b", `{"a": 1}`),
		msg("null", `null`), msg("zero", `0`), msg("false", `false`), msg("empty", `""`), msg("list", `[]`),
	)
	env, buf := newEnv("darwin")
	s, _ := ParseFile(p, env)
	if got := messageTexts(s, ""); !reflect.DeepEqual(got, []string{"ok"}) {
		t.Errorf("texts = %q", got)
	}
	if w := warnLines(buf); len(w) != 2 {
		t.Errorf("want one D11 and one D12 warning, got %q", w)
	}
}

// An Artifact result whose ts fromisoformat rejects is dropped with a D11 warning; a non-string one is
// ignored silently, as _published does.
func TestArtifactWithAnUnreadableTimestampIsDropped(t *testing.T) {
	call := func(id, url, ts string) []string {
		return []string{
			fmt.Sprintf(`{"type": "assistant", "timestamp": "2026-10-09T09:01:00Z", "message": {"content": [{"type": "tool_use", "id": %q, "name": "Artifact", "input": {"file_path": "/p.html"}}]}}`, id),
			fmt.Sprintf(`{"type": "user", "timestamp": %s, "message": {"content": [{"type": "tool_result", "tool_use_id": %q}]}, "toolUseResult": {"url": %q}}`, ts, id, url),
		}
	}
	lines := []string{`{"type": "user", "sessionId": "x", "timestamp": "2026-10-09T09:00:00Z", "message": {"content": "go"}}`}
	lines = append(lines, call("a", "https://claude.ai/artifact/A", `"later"`)...)
	lines = append(lines, call("b", "https://claude.ai/artifact/B", `5`)...)
	lines = append(lines, call("c", "https://claude.ai/artifact/C", `"2026-10-09T09:02:00Z"`)...)
	p := writeFile(t, filepath.Join(t.TempDir(), "s.jsonl"), lines...)
	env, buf := newEnv("darwin")
	s, _ := ParseFile(p, env)
	if len(s.Artifacts) != 1 || s.Artifacts[0].URL != "https://claude.ai/artifact/C" {
		t.Errorf("artifacts = %s", dumpArtifacts(s.Artifacts))
	}
	// D11 for the artifact; the result record with ts 5 has no text, so it is dropped before its
	// timestamp is looked at, and _published ignores a non-string ts.
	if w := warnLines(buf); len(w) != 1 || !strings.Contains(w[0], "'later'") {
		t.Errorf("warnings %q", w)
	}
}

// Review Focus 3: a response replaced by a later record of the same id keeps its first position, and
// responses without an id are counted after all the others, so by_model's order is C, B, Z.
func TestResponsesKeepTheirFirstPositionAndNoIDCountsLast(t *testing.T) {
	rec := func(id, model string, out int) string {
		return fmt.Sprintf(`{"type": "assistant", "message": {"id": %s, "model": %q, "usage": {"input_tokens": 1, "output_tokens": %d}}}`, id, model, out)
	}
	p := writeFile(t, filepath.Join(t.TempDir(), "s.jsonl"),
		minimalLog("x"),
		rec(`null`, "Z", 1),
		rec(`"m1"`, "A", 1),
		rec(`"m2"`, "B", 1),
		rec(`"m1"`, "C", 2),
		rec(`"m2"`, "D", 0), // smaller output: the stored B stays
	)
	s := parse(t, p)
	assertJSON(t, "by_model", mustGet(s.Tokens.Value(), "by_model"),
		`{"C": `+row(1, 2)+`, "B": `+row(1, 1)+`, "Z": `+row(1, 1)+`}`)
}

// d17Cases are record shapes Python's parser cannot handle (spec §6 D17). Each bad line comes with
// the line Go's result must equal: the same record with the offending part ignored.
var d17Cases = []struct{ name, bad, same string }{
	{"message not an object",
		`{"type": "user", "timestamp": "2026-09-18T09:01:00Z", "message": "hi"}`,
		``},
	{"text block text not a string",
		`{"type": "user", "timestamp": "2026-09-18T09:01:00Z", "message": {"content": [{"type": "text", "text": null}, {"type": "text", "text": "a"}]}}`,
		`{"type": "user", "timestamp": "2026-09-18T09:01:00Z", "message": {"content": [{"type": "text", "text": "a"}]}}`},
	{"tool_use name unhashable",
		`{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": ["Write"], "input": {"file_path": "/w/a.md"}}]}}`,
		`{"type": "assistant", "message": {"content": []}}`},
	{"file tool input not an object",
		`{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Write", "input": "/w/a.md"}, {"type": "tool_use", "name": "Edit", "input": {"file_path": "/w/b.md"}}]}}`,
		`{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Edit", "input": {"file_path": "/w/b.md"}}]}}`},
	{"Artifact tool_use id unhashable",
		`{"type": "assistant", "message": {"content": [{"type": "tool_use", "id": ["u"], "name": "Artifact", "input": {"file_path": "/p.html"}}]}}`,
		`{"type": "assistant", "message": {"content": []}}`},
	{"tool_result tool_use_id unhashable",
		`{"type": "user", "timestamp": "2026-09-18T09:01:00Z", "message": {"content": [{"type": "tool_result", "tool_use_id": {"a": 1}}]}, "toolUseResult": {"url": "https://claude.ai/artifact/X"}}`,
		``},
	{"iterations a number",
		`{"type": "assistant", "message": {"id": "m", "model": "M", "usage": {"input_tokens": 1, "output_tokens": 2, "iterations": 5}}}`,
		`{"type": "assistant", "message": {"id": "m", "model": "M", "usage": {"input_tokens": 1, "output_tokens": 2}}}`},
	{"iteration model not a string",
		`{"type": "assistant", "message": {"id": "m", "model": "M", "usage": {"iterations": [{"type": "advisor_message", "model": 5, "input_tokens": 3}]}}}`,
		`{"type": "assistant", "message": {"id": "m", "model": "M", "usage": {"iterations": [{"type": "advisor_message", "input_tokens": 3}]}}}`},
	{"message id unhashable",
		`{"type": "assistant", "message": {"id": ["m"], "model": "M", "usage": {"input_tokens": 1}}}`,
		`{"type": "assistant", "message": {"id": null, "model": "M", "usage": {"input_tokens": 1}}}`},
	{"sessionId not a string",
		`{"type": "user", "sessionId": 5, "timestamp": "2026-09-18T09:01:00Z", "message": {"content": "first"}}`,
		`{"type": "user", "timestamp": "2026-09-18T09:01:00Z", "message": {"content": "first"}}`},
	{"cwd not a string",
		`{"type": "user", "cwd": ["/x"], "timestamp": "2026-09-18T09:01:00Z", "message": {"content": "first"}}`,
		`{"type": "user", "timestamp": "2026-09-18T09:01:00Z", "message": {"content": "first"}}`},
}

// D17: each shape gives exactly one warning per file (two bad records too) and otherwise the result
// of the same log with the offending part left out.
func TestD17ShapesWarnOncePerFileAndAreOtherwiseIgnored(t *testing.T) {
	base := []string{
		`{"type": "user", "sessionId": "x", "cwd": "/w", "timestamp": "2026-09-18T09:00:00Z", "message": {"content": "go"}}`,
		`{"type": "assistant", "timestamp": "2026-09-18T09:00:30Z", "message": {"content": "ok"}}`,
	}
	for _, c := range d17Cases {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			bad := writeFile(t, filepath.Join(dir, "bad.jsonl"), c.bad, base[0], base[1], c.bad)
			same := []string{base[0], base[1]}
			if c.same != "" {
				same = []string{c.same, base[0], base[1], c.same}
			}
			want := parse(t, writeFile(t, filepath.Join(dir, "same.jsonl"), same...))
			env, buf := newEnv("darwin")
			got, _ := ParseFile(bad, env)
			w := warnLines(buf)
			if len(w) != 1 || !strings.Contains(w[0], "ignored a part of a record the parser cannot read") {
				t.Errorf("warnings %q", w)
			}
			gd, wd := rawDict(got).(*pyjson.Object), rawDict(want).(*pyjson.Object)
			gd.Set("mtime", nil)
			wd.Set("mtime", nil)
			if !pyjson.Equal(gd, wd) {
				t.Errorf("\n got %s\nwant %s", pyjson.Dumps(gd, pyjson.Unicode()), pyjson.Dumps(wd, pyjson.Unicode()))
			}
		})
	}
}

// A subagent transcript's bad shape is reported under the subagent's own path.
func TestD17InASubagentLogNamesThatLog(t *testing.T) {
	root := t.TempDir()
	parent := writeFile(t, filepath.Join(root, "proj", sid+".jsonl"), minimalLog(sid))
	sub := writeFile(t, filepath.Join(root, "proj", sid, "subagents", "agent-a.jsonl"),
		`{"type": "assistant", "isSidechain": true, "message": "x"}`)
	env, buf := newEnv("darwin")
	if s, _ := ParseFile(parent, env); s == nil {
		t.Fatal("no session")
	}
	if w := warnLines(buf); len(w) != 1 || !strings.Contains(w[0], sub) {
		t.Errorf("warnings %q", w)
	}
}

// A dangling symlink: as a subagent log it is skipped with the os.Stat error; as a session log it is
// skipped quietly without since (parse_file's exists() check) and with a warning under since
// (_mtime raises there).
func TestDanglingSymlinksAreSkippedWithTheStatError(t *testing.T) {
	root := t.TempDir()
	parent := writeFile(t, filepath.Join(root, "proj", sid+".jsonl"), minimalLog(sid))
	if err := os.MkdirAll(filepath.Join(root, "proj", sid, "subagents"), 0o755); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(root, "proj", sid, "subagents", "agent-x.jsonl")
	if err := os.Symlink(filepath.Join(root, "missing"), sub); err != nil {
		t.Skip("no symlinks:", err)
	}
	env, buf := newEnv("darwin")
	if s, _ := ParseFile(parent, env); s == nil {
		t.Fatal("no session")
	}
	_, statErr := os.Stat(sub)
	if w := warnLines(buf); len(w) != 1 || w[0] != fmt.Sprintf("worklog: skipped unreadable log %s (%s)", sub, statErr) {
		t.Errorf("warnings %q", w)
	}

	lone := filepath.Join(root, "other", "dangling.jsonl")
	if err := os.MkdirAll(filepath.Dir(lone), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "missing"), lone); err != nil {
		t.Fatal(err)
	}
	env, buf = newEnv("darwin")
	iterAll(t, filepath.Dir(lone), nil, env)
	if buf.Len() != 0 {
		t.Errorf("without since: %q", buf.String())
	}
	iterAll(t, filepath.Dir(lone), f64(0), env)
	if w := warnLines(buf); len(w) != 1 || !strings.Contains(w[0], lone) {
		t.Errorf("with since: %q", w)
	}
}

// An integer beyond int64 is an ordinary Python int: the record is kept (CPython 3.14.4 keeps all
// three messages). As a message id it dedups like any id; as a token count it is D4 in Go (Python
// counts it), with the D4 warning.
func TestBigIntegersKeepTheRecord(t *testing.T) {
	dir := t.TempDir()
	p := writeFile(t, filepath.Join(dir, "s.jsonl"),
		`{"type":"user","sessionId":"s1","cwd":"/w","timestamp":"2026-10-01T00:00:00Z","message":{"role":"user","content":"hello"}}`,
		`{"type":"assistant","sessionId":"s1","timestamp":"2026-10-01T00:40:00Z","message":{"role":"assistant","content":[{"type":"text","text":"answer"}]},"toolUseResult":{"id":12345678901234567890}}`,
		`{"type":"user","sessionId":"s1","timestamp":"2026-10-01T00:41:00Z","message":{"role":"user","content":"again"}}`)
	s := parse(t, p)
	if got := messageTexts(s, ""); !reflect.DeepEqual(got, []string{"hello", "answer", "again"}) {
		t.Errorf("texts = %q", got)
	}

	usage := `{"type":"assistant","sessionId":"s2","cwd":"/w","timestamp":"2026-10-01T00:%02d:00Z","message":{"role":"assistant","content":[{"type":"text","text":"t%d"}],"id":18446744073709551616,"model":"m","usage":{"input_tokens":%s,"output_tokens":3}}}`
	p = writeFile(t, filepath.Join(dir, "u.jsonl"),
		`{"type":"user","sessionId":"s2","cwd":"/w","timestamp":"2026-10-01T00:00:00Z","message":{"role":"user","content":"hi"}}`,
		fmt.Sprintf(usage, 1, 1, "12345678901234567890"), fmt.Sprintf(usage, 2, 2, "12345678901234567890"))
	env, buf := newEnv("darwin")
	s, _ = ParseFile(p, env)
	if s == nil {
		t.Fatal("no session")
	}
	// Both records carry the same message id, so the usage is counted once.
	assertJSON(t, "tokens", s.Tokens.Value(), `{"by_model": {"m": `+row(0, 3)+`}, "subagent": {}}`)
	want := fmt.Sprintf("worklog: %s: token count 12345678901234567890 is not an integer; counted as 0", p)
	if w := warnLines(buf); !reflect.DeepEqual(w, []string{want}) {
		t.Errorf("warnings %q, want %q", w, want)
	}
}

// ---- the stat-first seam (IterSessionsFiltered) ----------------------------------------------------

func iterFiltered(root string, since *float64, f Filter, env *rt.Env) []*session.RawSession {
	var out []*session.RawSession
	IterSessionsFiltered(root, since, f, env, func(s *session.RawSession) { out = append(out, s) })
	return out
}

// countParses counts the calls through the parseFile seam until the test ends.
func countParses(t *testing.T) *[]string {
	t.Helper()
	var parsed []string
	real := parseFile
	parseFile = func(p string, env *rt.Env) (*session.RawSession, error) {
		parsed = append(parsed, p)
		return real(p, env)
	}
	t.Cleanup(func() { parseFile = real })
	return &parsed
}

// A zero Filter is today's IterSessions, session for session and warning for warning, over the whole
// corpus.
func TestIterSessionsFilteredZeroFilterYieldsExactlyIterSessions(t *testing.T) {
	root := testkit.CopyCorpus(t, ".")
	for _, since := range []*float64{nil, f64(0), f64(1_500_000_000)} {
		env, buf := newEnv("darwin")
		want := iterAll(t, root, since, env)
		env2, buf2 := newEnv("darwin")
		got := iterFiltered(root, since, Filter{}, env2)
		if len(want) == 0 {
			t.Fatalf("since %v: the corpus yielded nothing", since)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("since %v: sessions differ: %q vs %q", since, ids(got), ids(want))
		}
		if buf2.String() != buf.String() {
			t.Errorf("since %v: warnings differ:\n got %q\nwant %q", since, buf2.String(), buf.String())
		}
	}
}

func TestKeepFalseNeverParses(t *testing.T) {
	root := testkit.CopyCorpus(t, ".")
	parsed := countParses(t)
	var kept, skipped []string
	env, _ := newEnv("darwin")
	got := iterFiltered(root, nil, Filter{
		Keep: func(p string, _ float64) bool { kept = append(kept, p); return false },
		Skip: func(p string, _ float64, metaID string) {
			if metaID != "" {
				t.Errorf("%s: metaID %q, want \"\"", p, metaID)
			}
			skipped = append(skipped, p)
		},
		Empty: func(p string, _ float64) { t.Errorf("Empty(%s) for a rejected log", p) },
	}, env)
	if len(got) != 0 || len(*parsed) != 0 {
		t.Errorf("yielded %d sessions, parsed %d logs", len(got), len(*parsed))
	}
	if len(kept) == 0 || !reflect.DeepEqual(skipped, kept) {
		t.Errorf("Keep saw %d logs, Skip %d", len(kept), len(skipped))
	}
}

// Keep sees the parent's mtime moved by a subagent written after it: the RawSession.Mtime.
func TestKeepReceivesTheCombinedMtimeThatRawSessionCarries(t *testing.T) {
	root := testkit.CopyCorpus(t, "test_parsers/test_claude_a_newer_subagent_log_moves_the_session_mtime")
	parentLog := filepath.Join(root, "-work-proj", "cc-files.jsonl")
	own, ok := mtime(parentLog)
	if !ok || own >= 1_000_300_000 {
		t.Fatalf("fixture: parent's own mtime %v", own)
	}
	seen := map[string]float64{}
	env, _ := newEnv("darwin")
	got := iterFiltered(root, f64(0), Filter{Keep: func(p string, m float64) bool { seen[p] = m; return true }}, env)
	if len(got) != 1 || got[0].Mtime != 1_000_300_000 {
		t.Fatalf("got %q", ids(got))
	}
	if want := map[string]float64{parentLog: 1_000_300_000}; !reflect.DeepEqual(seen, want) {
		t.Errorf("Keep saw %v, want %v", seen, want)
	}
}

func TestKeepIsConsultedWithoutSince(t *testing.T) {
	root := t.TempDir()
	a := writeFile(t, filepath.Join(root, "p", "a.jsonl"), minimalLog("a"))
	b := writeFile(t, filepath.Join(root, "p", "b.jsonl"), minimalLog("b"))
	setMtime(t, a, 1_000_000_000)
	setMtime(t, b, 1_100_000_000)
	parsed := countParses(t)
	seen := map[string]float64{}
	env, buf := newEnv("darwin")
	got := iterFiltered(root, nil, Filter{Keep: func(p string, m float64) bool { seen[p] = m; return p == b }}, env)
	if want := map[string]float64{a: 1_000_000_000, b: 1_100_000_000}; !reflect.DeepEqual(seen, want) {
		t.Errorf("Keep saw %v, want %v", seen, want)
	}
	if !reflect.DeepEqual(ids(got), []string{"b"}) || !reflect.DeepEqual(*parsed, []string{b}) {
		t.Errorf("yielded %q, parsed %q", ids(got), *parsed)
	}
	if buf.Len() != 0 {
		t.Errorf("warnings %q", buf.String())
	}
}

func TestEmptyIsCalledForAKeptLogThatYieldsNoSession(t *testing.T) {
	root := t.TempDir()
	none := writeFile(t, filepath.Join(root, "p", "none.jsonl"),
		`{"type": "user", "cwd": "/w", "timestamp": "2026-09-18T09:00:00Z", "message": {"content": "hi"}}`)
	writeFile(t, filepath.Join(root, "p", "ok.jsonl"), minimalLog("ok"))
	setMtime(t, none, 1_000_000_000)
	for _, f := range []Filter{{}, {Keep: func(string, float64) bool { return true }}} {
		empty := map[string]float64{}
		f.Empty = func(p string, m float64) { empty[p] = m }
		env, _ := newEnv("darwin")
		got := iterFiltered(root, nil, f, env)
		if !reflect.DeepEqual(ids(got), []string{"ok"}) {
			t.Errorf("keep set %v: yielded %q", f.Keep != nil, ids(got))
		}
		if want := map[string]float64{none: 1_000_000_000}; !reflect.DeepEqual(empty, want) {
			t.Errorf("keep set %v: Empty saw %v, want %v", f.Keep != nil, empty, want)
		}
	}
}

func TestAKeepRejectedLogPrintsNoParseWarning(t *testing.T) {
	p := divergentFile(t, "D1")
	root := filepath.Dir(filepath.Dir(p))
	env, buf := newEnv("darwin")
	iterFiltered(root, nil, Filter{}, env)
	if w := warnLines(buf); len(w) != 1 || !strings.HasPrefix(w[0], "worklog: skipped unreadable log "+p+" (") {
		t.Fatalf("kept: warnings %q", w)
	}
	env, buf = newEnv("darwin")
	iterFiltered(root, nil, Filter{Keep: func(string, float64) bool { return false }}, env)
	if buf.Len() != 0 {
		t.Errorf("rejected: warnings %q", buf.String())
	}
}
