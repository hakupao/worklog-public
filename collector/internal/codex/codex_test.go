package codex

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/logparse"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// home is the HOME the corpus and its goldens assume (testdata/logs/INDEX.md).
const home = "/home/wl"

// parent is the session id of the fixtures' rollout and of test_tokens.py's PARENT.
const parent = "11112222-3333-4444-5555-666677778888"

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

// iterQuiet is iterAll that also asserts no warnings.
func iterQuiet(t *testing.T, root string, since *float64) []*session.RawSession {
	t.Helper()
	env, buf := newEnv("darwin")
	out := iterAll(t, root, since, env)
	if w := warnLines(buf); w != nil {
		t.Errorf("unexpected warnings: %q", w)
	}
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

func mustJSON(t *testing.T, s string) pyjson.Value {
	t.Helper()
	v, err := pyjson.Decode([]byte(s))
	if err != nil {
		t.Fatalf("bad JSON literal %s: %v", s, err)
	}
	return v
}

func mustGet(o *pyjson.Object, k string) pyjson.Value {
	v, ok := o.Get(k)
	if !ok {
		panic("missing key " + k)
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

func tokensOf(s *session.RawSession) pyjson.Value {
	if s.Tokens == nil {
		return nil
	}
	return s.Tokens.Value()
}

func messageTexts(s *session.RawSession) []string {
	out := []string{}
	for _, m := range s.Messages {
		out = append(out, m.Text)
	}
	return out
}

// dump copies every log a test writes under <dir>/<test name>/, so the synthesized cases can be run
// through .venv Python: go test ./internal/codex -args -dump=<dir>.
var dump = flag.String("dump", "", "also write each synthesized log under this directory")

func writeFile(t *testing.T, path string, lines ...string) string {
	t.Helper()
	return writeBytes(t, path, []byte(strings.Join(lines, "\n")+"\n"))
}

func writeBytes(t *testing.T, path string, b []byte) string {
	t.Helper()
	targets := []string{path}
	if *dump != "" {
		rel, err := filepath.Rel(filepath.Dir(t.TempDir()), path)
		if err == nil && !strings.HasPrefix(rel, "..") {
			targets = append(targets, filepath.Join(*dump, filepath.FromSlash(t.Name()), rel))
		}
	}
	for _, p := range targets {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
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

// ---- record builders (test_tokens.py's meta / turn_context / token_count / message) ---------------

func meta(sessionID, ownID, forkedFrom, source string) string {
	if ownID == "" {
		ownID = sessionID
	}
	if source == "" {
		source = `"cli"`
	}
	fork := ""
	if forkedFrom != "" {
		fork = fmt.Sprintf(`, "forked_from_id": %q`, forkedFrom)
	}
	return fmt.Sprintf(`{"timestamp": "2026-09-18T08:55:00.000Z", "type": "session_meta", "payload": {"id": %q, "session_id": %q, "cwd": "/w", "source": %s%s}}`,
		ownID, sessionID, source, fork)
}

func forkSource(from string) string {
	return fmt.Sprintf(`{"subagent": {"thread_spawn": {"parent_thread_id": %q, "depth": 1}}}`, from)
}

func turnContext(model string) string {
	return fmt.Sprintf(`{"type": "turn_context", "payload": {"model": %q, "cwd": "/w"}}`, model)
}

// tokenCount takes (input, cached, output, reasoning) for the total and the last request.
func tokenCount(total, last [4]int) string {
	u := func(x [4]int) string {
		return fmt.Sprintf(`{"input_tokens": %d, "cached_input_tokens": %d, "cache_write_input_tokens": 0, "output_tokens": %d, "reasoning_output_tokens": %d, "total_tokens": %d}`,
			x[0], x[1], x[2], x[3], x[0]+x[2])
	}
	return fmt.Sprintf(`{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": %s, "last_token_usage": %s}}}`, u(total), u(last))
}

func message(role, text string) string {
	kind := "output_text"
	if role == "user" {
		kind = "input_text"
	}
	return fmt.Sprintf(`{"timestamp": "2026-09-18T09:00:00.000Z", "type": "response_item", "payload": {"type": "message", "role": %q, "content": [{"type": %q, "text": %q}]}}`,
		role, kind, text)
}

func forkLog(forkID, forkedFrom, model string, tok [4]int) []string {
	return []string{meta(parent, forkID, forkedFrom, forkSource(forkedFrom)), meta(parent, "", "", ""),
		message("user", "replayed parent prompt"), turnContext(model), tokenCount(tok, tok)}
}

// ---- test_codex_fork.py -----------------------------------------------------------------------------

func TestForkedSubagentRolloutIsSkipped(t *testing.T) {
	env, buf := newEnv("darwin")
	s, _ := ParseFile(testkit.CopyCorpus(t, "../fixtures/codex_rollout_fork.jsonl"), env)
	if s != nil || buf.Len() != 0 {
		t.Errorf("got %v, warnings %q", s, buf.String())
	}
}

func TestNormalRolloutStillParses(t *testing.T) {
	if s := parse(t, testkit.CopyCorpus(t, "../fixtures/codex_rollout.jsonl")); s.SessionID != parent {
		t.Errorf("session id %q", s.SessionID)
	}
}

func TestIterSessionsYieldsOnlyTheParent(t *testing.T) {
	root := testkit.CopyCorpus(t, "test_codex_fork/test_iter_sessions_yields_only_the_parent")
	if got := ids(iterQuiet(t, root, nil)); !reflect.DeepEqual(got, []string{parent}) {
		t.Errorf("got %q", got)
	}
}

func TestForkFlagInALaterMetaDoesNotSkip(t *testing.T) {
	parse(t, testkit.CopyCorpus(t, "test_codex_fork/test_fork_flag_in_a_later_meta_does_not_skip/r.jsonl"))
}

// ---- test_codex_archive.py --------------------------------------------------------------------------

func TestArchivedRolloutIsHarvested(t *testing.T) {
	unit := testkit.CopyCorpus(t, "test_codex_archive/test_archived_rollout_is_harvested")
	sessions := filepath.Join(unit, "sessions")
	if err := os.Mkdir(sessions, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := ids(iterQuiet(t, sessions, nil)); !reflect.DeepEqual(got, []string{parent}) {
		t.Errorf("got %q", got)
	}
}

func TestRolloutInBothPlacesIsYieldedOnce(t *testing.T) {
	unit := testkit.CopyCorpus(t, "test_codex_archive/test_rollout_in_both_places_is_yielded_once")
	if got := ids(iterQuiet(t, filepath.Join(unit, "sessions"), nil)); !reflect.DeepEqual(got, []string{parent}) {
		t.Errorf("got %q", got)
	}
}

// Python checks each base on its own: a missing sessions/ still lets archived_sessions/ be read.
func TestMissingRootStillReadsArchivedSessions(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "archived_sessions", "r.jsonl"), meta("arch", "", "", ""), message("user", "x"))
	if got := ids(iterQuiet(t, filepath.Join(dir, "sessions"), nil)); !reflect.DeepEqual(got, []string{"arch"}) {
		t.Errorf("got %q", got)
	}
}

// The same session in both places: sessions/ is read first and wins.
func TestSessionsWinOverArchived(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "archived_sessions", "a.jsonl"), meta("s", "", "", ""), message("user", "archived"))
	writeFile(t, filepath.Join(dir, "sessions", "z", "z.jsonl"), meta("s", "", "", ""), message("user", "live"))
	got := iterQuiet(t, filepath.Join(dir, "sessions"), nil)
	if len(got) != 1 || !reflect.DeepEqual(messageTexts(got[0]), []string{"live"}) {
		t.Errorf("got %d sessions %v", len(got), got)
	}
}

// ---- test_parsers.py (Codex) ------------------------------------------------------------------------

func fixture(t *testing.T) string { return testkit.CopyCorpus(t, "../fixtures/codex_rollout.jsonl") }

func TestCodexParse(t *testing.T) {
	s := parse(t, fixture(t))
	if s.Agent != "codex" || s.SessionID != parent || s.Cwd != "/work/proj-b" {
		t.Errorf("got agent=%q id=%q cwd=%q", s.Agent, s.SessionID, s.Cwd)
	}
	if n := session.Turns(s.Messages); n != 3 {
		t.Errorf("turns = %d, want 3", n)
	}
	if n := session.ActiveMinutes(s.Messages, 30); n != 15 {
		t.Errorf("active minutes = %d, want 15", n)
	}
}

func TestCodexSkipsEnvironmentContextAndAgentsMD(t *testing.T) {
	for _, text := range messageTexts(parse(t, fixture(t))) {
		if strings.Contains(text, "environment_context") || strings.Contains(text, "AGENTS.md") {
			t.Errorf("text %q should have been skipped", text)
		}
	}
}

func TestCodexMissingMetaReturnsNone(t *testing.T) {
	env, buf := newEnv("darwin")
	p := testkit.CopyCorpus(t, "test_parsers/test_codex_missing_meta_returns_none/rollout-empty.jsonl")
	if s, err := ParseFile(p, env); s != nil || err != nil || buf.Len() != 0 {
		t.Errorf("got %v, %v, warnings %q", s, err, buf.String())
	}
}

func TestCodexMissingFileReturnsNone(t *testing.T) {
	env, buf := newEnv("darwin")
	if s, err := ParseFile(filepath.Join(t.TempDir(), "nope.jsonl"), env); s != nil || err != nil || buf.Len() != 0 {
		t.Errorf("got %v, %v, warnings %q", s, err, buf.String())
	}
}

func TestCodexIterSessionsMissingRootYieldsNothing(t *testing.T) {
	if got := iterQuiet(t, filepath.Join(t.TempDir(), "does-not-exist"), nil); len(got) != 0 {
		t.Errorf("got %q", ids(got))
	}
}

func TestCodexIterSessionsFindsFixture(t *testing.T) {
	unit := testkit.CopyCorpus(t, "test_parsers/test_codex_iter_sessions_finds_fixture")
	got := iterQuiet(t, filepath.Join(unit, "sessions"), nil)
	if len(got) != 1 || got[0].Agent != "codex" {
		t.Fatalf("got %q", ids(got))
	}
}

func codexFiles(t *testing.T, test string) []string {
	t.Helper()
	return parse(t, testkit.CopyCorpus(t, "test_parsers/"+test+"/rollout.jsonl")).FilesWritten
}

func assertFiles(t *testing.T, got []string, want ...string) {
	t.Helper()
	if want == nil {
		want = []string{}
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("files_written = %q, want %q", got, want)
	}
}

func TestCodexFilesWrittenFromApplyPatch(t *testing.T) {
	s := parse(t, testkit.CopyCorpus(t, "test_parsers/test_codex_files_written_from_apply_patch/rollout.jsonl"))
	assertFiles(t, s.FilesWritten,
		"/work/atlas/成果物/2.1-定义/DOC-0100-保存规格.md",
		"/work/atlas/docs/log.md",
		"/work/atlas/new-name.md",
		"/work/atlas/raw.md",
		"/work/atlas/fn.md")
	if len(s.Messages) != 1 || s.Messages[0].Role != "user" {
		t.Errorf("messages %v", s.Messages)
	}
}

func TestCodexEscapedWindowsPathKeepsItsBackslashes(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_escaped_windows_path_keeps_its_backslashes"), `C:\work\new\a.md`, `C:\work\rel\b.md`)
}

func TestCodexEscapedQuoteInPathDoesNotSwallowThePatch(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_escaped_quote_in_path_does_not_swallow_the_patch"), `/work/say "hi".md`)
}

func TestCodexIgnoresAHeaderMentionedMidLineInCode(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_ignores_a_header_mentioned_mid_line_in_code"))
}

func TestCodexBareWindowsPathsAreKeptIntact(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_bare_windows_paths_are_kept_intact"), `C:\Users\me\notes\new.md`, `C:\work\src\new_mod.py`)
}

func TestCodexDecodesUnicodeEscapesInTheLiteral(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_decodes_unicode_escapes_in_the_literal"), "/work/成果物/a.md")
}

func TestCodexAHeaderInsideAddedTextIsNotAFile(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_a_header_inside_added_text_is_not_a_file"), "/work/docs/how.md")
}

func TestCodexPatchBoundToAVariableFirst(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_patch_bound_to_a_variable_first"), "/work/a.md")
}

func TestCodexHeredocPatchIsReadWithoutDecoding(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_heredoc_patch_is_read_without_decoding"), `C:\notes\new.md`)
}

func TestCodexFunctionCallArgvListsAreSearched(t *testing.T) {
	assertFiles(t, codexFiles(t, "test_codex_function_call_argv_lists_are_searched"), "/work/docs/a.md")
}

// test_claude_and_codex_sessions_without_publishes_have_no_artifacts, Codex half: [] (not None).
func TestCodexSessionsWithoutPublishesHaveNoArtifacts(t *testing.T) {
	if a := parse(t, fixture(t)).Artifacts; a == nil || len(a) != 0 {
		t.Errorf("artifacts = %#v, want an empty list", a)
	}
}

// ---- patches ------------------------------------------------------------------------------------

// The JS string literal decoder, case by case as .venv Python's _decode_js_literal(body, 0, '"')
// decodes it: \x takes 2 and \u 4 code points, int(digits, 16) is Python's (whitespace, sign, 0x,
// underscores, any Unicode decimal digit), an escape chr() rejects stays as its letter, and
// surrogates are paired (an unpaired one is U+FFFD) at the end.
var jsCases = [][2]string{
	{"a\\nb\"", "a\u000ab"},
	{"\\x41\\x4\"", "Ax4"},
	{"\\x 1\"", "\u0001"},
	{"\\x+1\"", "\u0001"},
	{"\\x_1\"", "x_1"},
	{"\\u0x41\"", "A"},
	{"\\u 41 \"", "A"},
	{"\\u1_23\"", "\u0123"},
	{"\\u{1F600}\"", "\U0001f600"},
	{"\\u{ZZ}\"", "u{ZZ}"},
	{"\\u{}\"", "u{}"},
	{"\\u{-1}\"", "u{-1}"},
	{"\\u{110000}\"", "u{110000}"},
	{"\\u{FFFFFFFFFFFF}\"", "u{FFFFFFFFFFFF}"},
	{"\\u{0x41}\"", "A"},
	{"\\u{ 41 }\"", "A"},
	{"\\u{4_1}\"", "A"},
	{"\\uD83D\\uDE00\"", "\U0001f600"},
	{"\\uD83D\"", "\ufffd"},
	{"\\uDE00\\uD83D\"", "\ufffd\ufffd"},
	{"\\uD83Dx\"", "\ufffdx"},
	{"\\\u000ac\"", "c"},
	{"\\\u000d\u000ac\"", "\u000d\u000ac"},
	{"\\\u00e9\"", "\u00e9"},
	{"\\q\"", "q"},
	{"\\0\\v\\b\\f\\t\\r\"", "\u0000\u000b\u0008\u000c\u0009\u000d"},
	{"abc\\\"", "abc\""},
	{"end\\", "end\\"},
	{"\\u12", "\u0012"},
	{"\\u{12", "u{12"},
	{"\\x\"", "x"},
	{"\\u\u0661\u0662\u0663\u0664\"", "\u1234"},
	{"\\x\u0664\u0661\"", "A"},
	{"\\u{  }\"", "u{  }"},
	{"\\u-041\"", "u-041"},
	{"\\u{+41}\"", "A"},
	{"\\U0041\"", "U0041"},
	{"\\u{0_41}\"", "A"},
	{"\\u{_41}\"", "u{_41}"},
	{"\\x4\u3000\"", "\u0004"},
	{"\\u{1F600\"", "u{1F600"},
	{"\\uD83D\\uD83D\\uDE00\"", "\ufffd\U0001f600"},
	{"\\u-000\"", "\u0000"},
	{"\\u0x_4\"", "\u0004"},
	{"\\u{0X41}\"", "A"},
	{"\\x\uff11\uff11\"", "\u0011"},
	{"\\x\uff21\uff21\"", "x\uff21\uff21"},
	{"\\u{0x}\"", "u{0x}"},
	{"\\u{4__1}\"", "u{4__1}"},
	{"\\u{41_}\"", "u{41_}"},
	{"\\u{\u001c41}\"", "u{\u001c41}"},
	{"\\u{\u000b41}\"", "A"},
	{"raw\xed\xa0\xbd\xed\xb8\x80 and lone \xed\xa0\xbd.\"", "raw\U0001f600 and lone \ufffd."},
	{"x\\\"y'z`\"", "x\"y'z`"},
	{"\\u{41}\\u{42}tail", "ABtail"},
	{"\\\xed\xa0\xbd\xed\xb8\x80\"", "\U0001f600"},
	{"\\uDBFF\\uDFFF\"", "\U0010ffff"},
	{"\\x41\u00e9\"", "A\u00e9"},
	{"\\u{4\u0661}\"", "A"},
	{"\\u00\u00e941\"", "u00\u00e941"},
}

func TestDecodeJSLiteralMatchesPython(t *testing.T) {
	for _, c := range jsCases {
		if got := decodeJSLiteral(c[0], '"'); got != c[1] {
			t.Errorf("decodeJSLiteral(%q) = %q, want %q", c[0], got, c[1])
		}
	}
}

// int(s, 16) as .venv Python computes it (false = ValueError, or beyond int64).
func TestHexIntIsPythonsIntBase16(t *testing.T) {
	for _, c := range []struct {
		s  string
		n  int64
		ok bool
	}{
		{"41", 65, true},
		{" 41 ", 65, true},
		{"+41", 65, true},
		{"-41", -65, true},
		{"-0", 0, true},
		{"0x41", 65, true},
		{"0X41", 65, true},
		{"0x_41", 65, true},
		{"_41", 0, false},
		{"4_1", 65, true},
		{"4__1", 0, false},
		{"41_", 0, false},
		{"0x", 0, false},
		{"", 0, false},
		{"  ", 0, false},
		{"\u0661\u0662", 18, true},
		{"\uff11", 1, true},
		{"\uff21", 0, false},
		{"g", 0, false},
		{"\u001c41", 0, false},
		{"\u000b41", 65, true},
		{"41\u3000", 65, true},
		{"4 1", 0, false},
		{"- 41", 0, false},
		{"0x-41", 0, false},
		{"00x41", 0, false},
		{"ffffffffffffffffffffffffff", 0, false},
		{"FfFf", 65535, true},
		{"0_x41", 0, false},
		{"0x41_", 0, false},
	} {
		n, ok := hexInt([]rune(c.s))
		if n != c.n || ok != c.ok {
			t.Errorf("hexInt(%q) = %d, %v; want %d, %v", c.s, n, ok, c.n, c.ok)
		}
	}
}

func payloadOf(t *testing.T, s string) *pyjson.Object {
	return mustJSON(t, s).(*pyjson.Object)
}

// Headers: a Move to with nothing before it is a path of its own, the one after an Update File
// replaces it, Delete File is left out, trailing \r goes, the rest of the line is kept as is, and
// nothing after End Patch counts. Checked against .venv Python's _patched_paths.
func TestPatchHeaders(t *testing.T) {
	w := logparse.NewWarner(nil)
	p := pyjson.NewObject()
	p.Set("type", "custom_tool_call")
	p.Set("input", "*** Begin Patch\n*** Move to: first.md\n*** Add File: a.md\n*** Update File: b.md\r\r\n*** Move to: c.md\n*** Delete File: d.md\n*** Add File:  e.md \n*** End Patch\n*** Add File: after.md\n")
	if got := patchedPaths(p, "x", w); !reflect.DeepEqual(got, []string{"first.md", "a.md", "c.md", " e.md "}) {
		t.Errorf("got %q", got)
	}
}

// Where a "*** Begin Patch" counts: at a line start after spaces/tabs (taken raw), or right after a
// JS quote (decoded); not after a quote and a space, nor mid-line in code.
func TestPatchStartRules(t *testing.T) {
	w := logparse.NewWarner(nil)
	for _, c := range []struct {
		input string
		want  []string
	}{
		{"x\n \t*** Begin Patch\n*** Add File: raw\\n.md\n*** End Patch", []string{"raw\\n.md"}},
		{"f(\" *** Begin Patch\\n*** Add File: no.md\\n\")", []string{}},
		{"f(`*** Begin Patch\\n*** Add File: tick.md\\n`)", []string{"tick.md"}},
		{"say *** Begin Patch\n*** Add File: mid.md\n", []string{}},
		{"*** Begin Patch\n*** Add File: one.md\n*** End Patch\n\"*** Begin Patch\\n*** Update File: two.md\\n\"", []string{"one.md", "two.md"}},
	} {
		p := pyjson.NewObject()
		p.Set("type", "custom_tool_call")
		p.Set("input", c.input)
		got := patchedPaths(p, "x", w)
		if got == nil {
			got = []string{}
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q: got %q, want %q", c.input, got, c.want)
		}
	}
	// function_call: only JSON arguments that decode, string values (argv lists flattened) that
	// contain the start marker; other types and other kinds carry no patch.
	for _, c := range []struct {
		payload string
		want    []string
	}{
		{`{"type": "function_call", "arguments": "{\"a\": [\"x\", [\"*** Begin Patch\\n*** Add File: deep.md\\n\"]], \"b\": 5}"}`, []string{"deep.md"}},
		{`{"type": "function_call", "arguments": "not json *** Begin Patch\n*** Add File: no.md\n"}`, []string{}},
		{`{"type": "function_call", "arguments": "[\"*** Begin Patch\\n*** Add File: list.md\\n\"]"}`, []string{}},
		{`{"type": "custom_tool_call", "input": ["*** Begin Patch\n*** Add File: no.md\n"]}`, []string{}},
		{`{"type": "local_shell_call", "input": "*** Begin Patch\n*** Add File: no.md\n"}`, []string{}},
		{`{"type": 5, "input": "*** Begin Patch\n*** Add File: no.md\n"}`, []string{}},
	} {
		got := patchedPaths(payloadOf(t, c.payload), "x", w)
		if got == nil {
			got = []string{}
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %q, want %q", c.payload, got, c.want)
		}
	}
}

// ---- test_tokens.py (Codex) -------------------------------------------------------------------------

func tokenLog(t *testing.T, test string) string {
	return filepath.Join(testkit.CopyCorpus(t, "test_tokens/"+test), "r.jsonl")
}

func TestCodexCountsEachRequestUnderItsModelWithUncachedInput(t *testing.T) {
	s := parse(t, tokenLog(t, "test_codex_counts_each_request_under_its_model_with_uncached_input"))
	assertJSON(t, "tokens", tokensOf(s), `{"by_model": {"gpt-6-astra": `+row(90, 30, 160, 0, 0, 5)+`, "gpt-6-sol": `+row(0, 10, 200)+`}, "subagent": {}}`)
	var total int64
	byModel := mustGet(s.Tokens.Value(), "by_model").(*pyjson.Object)
	for _, m := range byModel.Keys() {
		r := mustGet(byModel, m).(*pyjson.Object)
		for _, f := range []string{"input", "cache_read", "output"} {
			total += int64(mustGet(r, f).(pyjson.Int))
		}
	}
	if total != 450+40 {
		t.Errorf("total = %d", total)
	}
}

func TestCodexCounterRestartDoesNotLoseTheFirstRun(t *testing.T) {
	s := parse(t, tokenLog(t, "test_codex_counter_restart_does_not_lose_the_first_run"))
	assertJSON(t, "gpt-6-sol", mustGet(mustGet(s.Tokens.Value(), "by_model").(*pyjson.Object), "gpt-6-sol"), row(150, 15))
}

func TestCodexUncachedInputNeverGoesNegative(t *testing.T) {
	s := parse(t, tokenLog(t, "test_codex_uncached_input_never_goes_negative"))
	assertJSON(t, "gpt-6-sol", mustGet(mustGet(s.Tokens.Value(), "by_model").(*pyjson.Object), "gpt-6-sol"), row(0, 1, 12))
}

func TestCodexWithoutTokenCountsIsUnknownNotZero(t *testing.T) {
	if s := parse(t, tokenLog(t, "test_codex_without_token_counts_is_unknown_not_zero")); s.Tokens != nil {
		t.Errorf("tokens = %s", pyjson.Dumps(s.Tokens.Value(), pyjson.Unicode()))
	}
}

func TestCodexForkUsageIsTheParentSessionsSubagentUsage(t *testing.T) {
	root := filepath.Join(testkit.CopyCorpus(t, "test_tokens/test_codex_fork_usage_is_the_parent_sessions_subagent_usage"), "sessions")
	got := iterQuiet(t, root, nil)
	if len(got) != 1 || got[0].SessionID != parent {
		t.Fatalf("got %q", ids(got))
	}
	tk := got[0].Tokens.Value()
	assertJSON(t, "subagent", mustGet(tk, "subagent"), `{"gpt-6-sol": `+row(10, 5, 20, 0, 0, 1)+`, "gpt-6-astra": `+row(10, 1)+`}`)
	assertJSON(t, "by_model", mustGet(tk, "by_model"), `{"gpt-6-astra": `+row(90+10, 30+1, 160, 0, 0, 5)+`, "gpt-6-sol": `+row(0+10, 10+5, 200+20, 0, 0, 1)+`}`)
	// The rollout alone still knows nothing of its forks.
	s := parse(t, filepath.Join(root, "2026", "09", "18", "rollout-parent.jsonl"))
	assertJSON(t, "ParseFile subagent", mustGet(s.Tokens.Value(), "subagent"), `{}`)
}

func TestCodexForkCountsOnceWhenArchivedAndStillInSessions(t *testing.T) {
	root := filepath.Join(testkit.CopyCorpus(t, "test_tokens/test_codex_fork_counts_once_when_archived_and_still_in_sessions"), "sessions")
	got := iterQuiet(t, root, nil)
	if len(got) != 1 {
		t.Fatalf("got %q", ids(got))
	}
	assertJSON(t, "subagent", mustGet(got[0].Tokens.Value(), "subagent"), `{"gpt-6-sol": `+row(10, 5, 20, 0, 0, 1)+`}`)
}

func TestCodexForkMtimeIsTheParents(t *testing.T) {
	root := filepath.Join(testkit.CopyCorpus(t, "test_tokens/test_codex_fork_mtime_is_the_parents"), "sessions")
	day := filepath.Join(root, "2026", "09", "18")
	setMtime(t, filepath.Join(day, "rollout-parent.jsonl"), 1_000_000_000)
	setMtime(t, filepath.Join(day, "rollout-fork-a.jsonl"), 2_000_000_000)
	got := iterQuiet(t, root, f64(1_500_000_000))
	if len(got) != 1 || got[0].Mtime != 2_000_000_000 {
		t.Fatalf("got %q", ids(got))
	}
	if got := iterQuiet(t, root, f64(2_100_000_000)); len(got) != 0 {
		t.Errorf("got %q", ids(got))
	}
}

// Forks attach in path order (sessions/ sorted, then archived_sessions/), which is the subagent
// key order; a fork whose parent is missing counts nowhere.
func TestForksAttachInPathOrder(t *testing.T) {
	dir := t.TempDir()
	day := filepath.Join(dir, "sessions", "d")
	writeFile(t, filepath.Join(day, "p.jsonl"), meta(parent, "", "", ""), message("user", "x"))
	writeFile(t, filepath.Join(day, "f-b.jsonl"), forkLog("fb", parent, "model-b", [4]int{1, 0, 1, 0})...)
	writeFile(t, filepath.Join(day, "f-a.jsonl"), forkLog("fa", parent, "model-a", [4]int{2, 0, 2, 0})...)
	writeFile(t, filepath.Join(dir, "archived_sessions", "a-0.jsonl"), forkLog("fz", parent, "model-z", [4]int{3, 0, 3, 0})...)
	// An orphan: its session_id names a session that is not here.
	writeFile(t, filepath.Join(day, "orphan.jsonl"), meta("nobody", "fo", "nobody", forkSource("nobody")), turnContext("m"), tokenCount([4]int{9, 0, 9, 0}, [4]int{9, 0, 9, 0}))
	got := iterQuiet(t, filepath.Join(dir, "sessions"), nil)
	if len(got) != 1 {
		t.Fatalf("got %q", ids(got))
	}
	assertJSON(t, "subagent", mustGet(got[0].Tokens.Value(), "subagent"),
		`{"model-a": `+row(2, 2)+`, "model-b": `+row(1, 1)+`, "model-z": `+row(3, 3)+`}`)
}

// total == previous total is Python dict equality: key order is ignored and 10 == 10.0.
func TestRepeatedTotalsCompareLikePythonDicts(t *testing.T) {
	p := writeFile(t, filepath.Join(t.TempDir(), "r.jsonl"),
		meta("s", "", "", ""), turnContext("m"), message("user", "x"),
		`{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"a": 10, "b": [1, {"c": true}]}, "last_token_usage": {"input_tokens": 5}}}}`,
		`{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"b": [1.0, {"c": 1}], "a": 10.0}, "last_token_usage": {"input_tokens": 5}}}}`,
		`{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"a": 11, "b": [1, {"c": true}]}, "last_token_usage": {"input_tokens": 7}}}}`)
	assertJSON(t, "tokens", tokensOf(parse(t, p)), `{"by_model": {"m": `+row(12)+`}, "subagent": {}}`)
}

// The last non-empty session_id and cwd of any session_meta win; a falsy one keeps the previous;
// turn_context's model sticks until the next one names one.
func TestLastMetaWinsAndModelSticks(t *testing.T) {
	p := writeFile(t, filepath.Join(t.TempDir(), "r.jsonl"),
		meta("first", "", "", ""),
		`{"type": "session_meta", "payload": {"session_id": "second", "cwd": "/second"}}`,
		`{"type": "session_meta", "payload": {"session_id": "", "cwd": null}}`,
		turnContext("m1"), message("user", "x"),
		tokenCount([4]int{1, 0, 1, 0}, [4]int{1, 0, 1, 0}),
		`{"type": "turn_context", "payload": {"model": ""}}`,
		tokenCount([4]int{2, 0, 2, 0}, [4]int{1, 0, 1, 0}))
	s := parse(t, p)
	if s.SessionID != "second" || s.Cwd != "/second" {
		t.Errorf("id %q cwd %q", s.SessionID, s.Cwd)
	}
	assertJSON(t, "tokens", tokensOf(s), `{"by_model": {"m1": `+row(2, 2)+`}, "subagent": {}}`)
}

// The walk order of each base is sorted(rglob()) under the host's path flavour: case-sensitive on
// POSIX, lower-cased on Windows; the first of two rollouts naming one session wins.
func TestIterOrderFollowsTheHostPathFlavour(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "sessions", "B.jsonl"), meta("upper", "", "", ""), message("user", "x"))
	writeFile(t, filepath.Join(dir, "sessions", "a.jsonl"), meta("lower", "", "", ""), message("user", "x"))
	writeFile(t, filepath.Join(dir, "archived_sessions", "0.jsonl"), meta("arch", "", "", ""), message("user", "x"))
	for goos, want := range map[string][]string{"darwin": {"upper", "lower", "arch"}, "windows": {"lower", "upper", "arch"}} {
		env, _ := newEnv(goos)
		if got := ids(iterAll(t, filepath.Join(dir, "sessions"), nil, env)); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: got %q, want %q", goos, got, want)
		}
	}
}

// ---- spec §6 rows ---------------------------------------------------------------------------------

func pythonError(t *testing.T, key string) string {
	var raw []byte
	testkit.Golden(t, "parsers", &raw)
	v, err := pyjson.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	files := mustGet(v.(*pyjson.Object), "files").(*pyjson.Object)
	e := mustGet(mustGet(files, key).(*pyjson.Object), "codex").(*pyjson.Object)
	return mustGet(e, "message").(string)
}

// D1 through ParseFile: the file is skipped with Python's decode error.
func TestD1InvalidUTF8IsSkippedWithOneWarning(t *testing.T) {
	for _, key := range []string{
		"divergent/D1/-work-div/div00001-0000-0000-0000-000000000001.jsonl",
		"divergent/D2/sessions/2026/09/18/rollout-d2.jsonl",
	} {
		p := testkit.CopyCorpus(t, key)
		env, buf := newEnv("darwin")
		if s, err := ParseFile(p, env); s != nil || err != nil {
			t.Errorf("%s: got %v, %v", key, s, err)
		}
		want := fmt.Sprintf("worklog: skipped unreadable log %s (%s)", p, pythonError(t, "logs/"+key))
		if got := warnLines(buf); !reflect.DeepEqual(got, []string{want}) {
			t.Errorf("%s: warnings %q, want %q", key, got, want)
		}
	}
}

// D2 through IterSessions: _first_meta decodes in 8192-byte chunks, so a bad byte in a chunk it
// reads before reaching the meta line is the D1 warning (with the position Python's chunk decoder
// gives) and the file is skipped, whatever `since` says (Python raises before the since filter).
func TestD2BadBytesBeforeTheMetaIsReadSkipTheFileWithOneWarning(t *testing.T) {
	unit := testkit.CopyCorpus(t, "divergent/D2")
	p := filepath.Join(unit, "sessions", "2026", "09", "18", "rollout-d2.jsonl")
	want := fmt.Sprintf("worklog: skipped unreadable log %s (%s)", p, pythonError(t, "logs/divergent/D2/sessions/2026/09/18/rollout-d2.jsonl"))
	for _, since := range []*float64{nil, f64(0), f64(4e9)} {
		env, buf := newEnv("darwin")
		if got := iterAll(t, filepath.Join(unit, "sessions"), since, env); len(got) != 0 {
			t.Errorf("got %q", ids(got))
		}
		if got := warnLines(buf); !reflect.DeepEqual(got, []string{want}) {
			t.Errorf("warnings %q, want %q", got, want)
		}
	}
}

// Python's chunking, case by case (each confirmed with .venv Python's _first_meta): a bad byte at
// 8191 is read with the first chunk, one at 8192 is not; a character split across the chunk boundary
// is fine; a truncated sequence completed by a bad byte in the next chunk fails at position 0.
func TestFirstMetaDecodesInPythonsChunks(t *testing.T) {
	metaLine := `{"type": "session_meta", "payload": {"id": "f", "session_id": "p", "forked_from_id": "p"}}` + "\n"
	pad := func(n int) []byte { return bytes.Repeat([]byte("x"), n) }
	for _, c := range []struct {
		name string
		data []byte
		err  string // "" = meta found
	}{
		{"bad at 8191", append(append([]byte(metaLine), pad(8191-len(metaLine))...), 0xff, '\n'), "'utf-8' codec can't decode byte 0xff in position 8191: invalid start byte"},
		{"bad at 8192", append(append([]byte(metaLine), pad(8192-len(metaLine))...), 0xff, '\n'), ""},
		{"split character", append(append(pad(8191), "あ\n"...), metaLine...), ""},
		{"truncated then bad", append(append(pad(8191), 0xe3, 'A', '\n'), metaLine...), "'utf-8' codec can't decode byte 0xe3 in position 0: invalid continuation byte"},
		{"meta line longer than a chunk", append([]byte(`{"type": "session_meta", "payload": {"id": "f", "pad": "`+strings.Repeat("y", 9000)+`"}}`+"\n"+strings.Repeat("z", 10)), 0xff, '\n'), "'utf-8' codec can't decode byte 0xff in position 878: invalid start byte"},
		{"truncated at EOF", append(append([]byte("x\n"), pad(10)...), 0xe3), "'utf-8' codec can't decode byte 0xe3 in position 0: unexpected end of data"},
	} {
		p := writeBytes(t, filepath.Join(t.TempDir(), "r.jsonl"), c.data)
		env, buf := newEnv("darwin")
		m, ok := firstMeta(p, logparse.NewWarner(env))
		if c.err == "" {
			if !ok || m == nil || logparse.Get(m, "id") != "f" || buf.Len() != 0 {
				t.Errorf("%s: meta %v ok %v warnings %q", c.name, m, ok, buf.String())
			}
			continue
		}
		want := fmt.Sprintf("worklog: skipped unreadable log %s (%s)", p, c.err)
		if ok || !reflect.DeepEqual(warnLines(buf), []string{want}) {
			t.Errorf("%s: ok %v warnings %q, want %q", c.name, ok, warnLines(buf), want)
		}
	}
}

// A fork whose bad bytes lie beyond what _first_meta reads: its parent is yielded without it and
// one warning names the fork (Python raises reading its usage); with no parent to read it, Python
// never reads it and Go says nothing.
func TestD1InAForkLog(t *testing.T) {
	dir := t.TempDir()
	day := filepath.Join(dir, "sessions", "d")
	writeFile(t, filepath.Join(day, "p.jsonl"), meta(parent, "", "", ""), message("user", "x"), turnContext("m"), tokenCount([4]int{1, 0, 1, 0}, [4]int{1, 0, 1, 0}))
	fork := strings.Join(forkLog("fa", parent, "m", [4]int{5, 0, 5, 0}), "\n") + "\n"
	bad := append(append([]byte(fork), bytes.Repeat([]byte("x"), 9000)...), 0xff, '\n')
	f := writeBytes(t, filepath.Join(day, "f.jsonl"), bad)
	env, buf := newEnv("darwin")
	got := iterAll(t, filepath.Join(dir, "sessions"), nil, env)
	if len(got) != 1 {
		t.Fatalf("got %q", ids(got))
	}
	assertJSON(t, "tokens", tokensOf(got[0]), `{"by_model": {"m": `+row(1, 1)+`}, "subagent": {}}`)
	if w := warnLines(buf); len(w) != 1 || !strings.HasPrefix(w[0], "worklog: skipped unreadable log "+f+" (") {
		t.Errorf("warnings %q", w)
	}

	if err := os.Remove(filepath.Join(day, "p.jsonl")); err != nil {
		t.Fatal(err)
	}
	if got := iterQuiet(t, filepath.Join(dir, "sessions"), nil); len(got) != 0 {
		t.Errorf("got %q", ids(got))
	}
}

func TestD3MixedOffsetsWarnOnceAndParseUnchanged(t *testing.T) {
	p := writeFile(t, filepath.Join(t.TempDir(), "r.jsonl"), meta("s", "", "", ""),
		`{"timestamp": "2026-09-18T09:00:00Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "a"}]}}`,
		`{"timestamp": "2026-09-18T09:10:00", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "b"}]}}`,
		`{"timestamp": "2026-09-18T09:20:00+09:00", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "c"}]}}`)
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
	want := fmt.Sprintf("worklog: %s: timestamps with and without a UTC offset are mixed; the ones without are taken as UTC", p)
	if w := warnLines(buf); !reflect.DeepEqual(w, []string{want}) {
		t.Errorf("warnings %q", w)
	}
}

func TestD4BadTokenCountIsZeroWithOneWarning(t *testing.T) {
	bad := `{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": %d}, "last_token_usage": {"input_tokens": "1.5", "cached_input_tokens": [1], "output_tokens": %d}}}}`
	p := writeFile(t, filepath.Join(t.TempDir(), "r.jsonl"), meta("s", "", "", ""), turnContext("m"), message("user", "x"),
		fmt.Sprintf(bad, 1, 2), fmt.Sprintf(bad, 2, 3))
	env, buf := newEnv("darwin")
	s, _ := ParseFile(p, env)
	if s == nil {
		t.Fatal("no session")
	}
	assertJSON(t, "tokens", tokensOf(s), `{"by_model": {"m": `+row(0, 5)+`}, "subagent": {}}`)
	want := fmt.Sprintf("worklog: %s: token count [1] is not an integer; counted as 0", p)
	if w := warnLines(buf); !reflect.DeepEqual(w, []string{want}) {
		t.Errorf("warnings %q, want %q", w, want)
	}
}

// A fork's bad token count is reported under the fork's own path.
func TestD4InAForkNamesTheFork(t *testing.T) {
	dir := t.TempDir()
	day := filepath.Join(dir, "sessions", "d")
	writeFile(t, filepath.Join(day, "p.jsonl"), meta(parent, "", "", ""), message("user", "x"))
	f := writeFile(t, filepath.Join(day, "f.jsonl"), meta(parent, "fa", parent, forkSource(parent)), turnContext("m"),
		`{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {}, "last_token_usage": {"output_tokens": "x"}}}}`)
	env, buf := newEnv("darwin")
	got := iterAll(t, filepath.Join(dir, "sessions"), nil, env)
	if len(got) != 1 {
		t.Fatalf("got %q", ids(got))
	}
	assertJSON(t, "tokens", tokensOf(got[0]), `{"by_model": {"m": `+row()+`}, "subagent": {"m": `+row()+`}}`)
	want := fmt.Sprintf(`worklog: %s: token count "x" is not an integer; counted as 0`, f)
	if w := warnLines(buf); !reflect.DeepEqual(w, []string{want}) {
		t.Errorf("warnings %q, want %q", w, want)
	}
}

func TestD11AndD12DropTheRecordWithOneWarning(t *testing.T) {
	for name, ts := range map[string]string{"D11": `"yesterday"`, "D12": `5`, "D15": `"2026-09-18T09:00:00+09:00:30.5"`} {
		bad := `{"timestamp": ` + ts + `, "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "bad"}]}}`
		p := writeFile(t, filepath.Join(t.TempDir(), "r.jsonl"), meta("s", "", "", ""), message("user", "ok"), bad, bad,
			`{"timestamp": "", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "falsy"}]}}`)
		env, buf := newEnv("darwin")
		s, _ := ParseFile(p, env)
		if s == nil {
			t.Fatalf("%s: no session", name)
		}
		if got := messageTexts(s); !reflect.DeepEqual(got, []string{"ok"}) {
			t.Errorf("%s: texts %q", name, got)
		}
		w := warnLines(buf)
		if len(w) != 1 || !strings.HasPrefix(w[0], "worklog: "+p+": dropped a record whose timestamp ") {
			t.Errorf("%s: warnings %q", name, w)
		}
	}
}

// D17: each Codex site where Python's parser raises on a record's shape, or keeps a value harvest
// cannot use, gives one warning per file and otherwise the result of the `same` log. Every `bad`
// log was run through .venv Python (see the report): all raise, except "model not a string (int)",
// "session_id not a string" and "cwd not a string", which keep the value.
var (
	dMeta = `{"timestamp": "2026-09-18T09:00:00Z", "type": "session_meta", "payload": {"id": "x", "session_id": "x", "cwd": "/w"}}`
	dUser = `{"timestamp": "2026-09-18T09:00:00Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "go"}]}}`
	dTC   = `{"type": "turn_context", "payload": {"model": "gpt-a"}}`
	dTok1 = `{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 10}, "last_token_usage": {"input_tokens": 10, "output_tokens": 2}}}}`
	dTok2 = `{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 20}, "last_token_usage": {"input_tokens": 10, "output_tokens": 3}}}}`
	dAsst = `{"timestamp": "2026-09-18T09:01:00Z", "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "ok"}]}}`
)

var d17Cases = []struct {
	name      string
	bad, same []string
}{
	{"session_meta payload not an object",
		[]string{`{"type": "session_meta", "payload": "x"}`, dMeta, dUser, dTC, dTok1, dAsst, `{"type": "session_meta", "payload": "x"}`},
		[]string{`{"type": "session_meta", "payload": {}}`, dMeta, dUser, dTC, dTok1, dAsst, `{"type": "session_meta", "payload": {}}`}},
	{"response_item payload not an object",
		[]string{dMeta, `{"type": "response_item", "payload": [1]}`, dUser, dTC, dTok1, dAsst, `{"type": "response_item", "payload": [1]}`},
		[]string{dMeta, dUser, dTC, dTok1, dAsst}},
	{"turn_context payload not an object",
		[]string{dMeta, dUser, dTC, `{"type": "turn_context", "payload": 5}`, dTok1, dAsst, `{"type": "turn_context", "payload": 5}`},
		[]string{dMeta, dUser, dTC, dTok1, dAsst}},
	{"event_msg payload not an object",
		[]string{dMeta, dUser, dTC, `{"type": "event_msg", "payload": "x"}`, dTok1, dAsst, `{"type": "event_msg", "payload": "x"}`},
		[]string{dMeta, dUser, dTC, dTok1, dAsst}},
	{"model not a string (int)",
		[]string{dMeta, dUser, dTC, `{"type": "turn_context", "payload": {"model": 5}}`, dTok1, dTok2, dAsst},
		[]string{dMeta, dUser, dTC, dTok1, dTok2, dAsst}},
	{"model not a string (list)",
		[]string{dMeta, dUser, dTC, `{"type": "turn_context", "payload": {"model": ["m"]}}`, dTok1, dAsst},
		[]string{dMeta, dUser, dTC, dTok1, dAsst}},
	{"text not a string",
		[]string{dMeta, `{"timestamp": "2026-09-18T09:00:00Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": null}, {"type": "input_text", "text": "go"}, {"type": "input_text", "text": 5}]}}`, dAsst},
		[]string{dMeta, dUser, dAsst}},
	{"response_item type a list",
		[]string{dMeta, dUser, `{"type": "response_item", "payload": {"type": ["custom_tool_call"], "input": "*** Begin Patch\n*** Add File: /w/a.md\n"}}`, dAsst, `{"type": "response_item", "payload": {"type": {"k": 1}}}`},
		[]string{dMeta, dUser, dAsst}},
	{"session_id not a string",
		[]string{dMeta, `{"type": "session_meta", "payload": {"session_id": 5}}`, dUser, `{"type": "session_meta", "payload": {"session_id": ["y"]}}`, dAsst},
		[]string{dMeta, `{"type": "session_meta", "payload": {}}`, dUser, dAsst}},
	{"cwd not a string",
		[]string{dMeta, `{"type": "session_meta", "payload": {"cwd": ["/x"]}}`, dUser, `{"type": "session_meta", "payload": {"cwd": 5}}`, dAsst},
		[]string{dMeta, `{"type": "session_meta", "payload": {}}`, dUser, dAsst}},
}

func TestD17ShapesWarnOncePerFileAndAreOtherwiseIgnored(t *testing.T) {
	for _, c := range d17Cases {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			bad := writeFile(t, filepath.Join(dir, "bad.jsonl"), c.bad...)
			want := parse(t, writeFile(t, filepath.Join(dir, "same.jsonl"), c.same...))
			env, buf := newEnv("darwin")
			got, _ := ParseFile(bad, env)
			w := warnLines(buf)
			if len(w) != 1 || !strings.HasPrefix(w[0], "worklog: "+bad+": ignored a part of a record the parser cannot read (") {
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

// D17 sites of iter_sessions itself (each raises in .venv Python): one warning per file, and the
// session as if the offending part were absent.
func TestD17IterSites(t *testing.T) {
	tok := [4]int{3, 0, 3, 0}
	for _, c := range []struct {
		name     string
		files    map[string][]string // under sessions/d/
		bad      string              // the file the warning names
		subagent string              // the parent's tokens.subagent; "" = tokens None
	}{
		{"first meta payload not an object", map[string][]string{
			"p.jsonl": {`{"type": "session_meta", "payload": "x"}`, meta(parent, "", "", ""), message("user", "x")},
		}, "p.jsonl", ""},
		{"fork id unhashable", map[string][]string{
			"p.jsonl": {meta(parent, "", "", ""), message("user", "x")},
			"f.jsonl": {`{"type": "session_meta", "payload": {"id": [1], "session_id": "` + parent + `", "forked_from_id": "` + parent + `"}}`, turnContext("m"), tokenCount(tok, tok)},
		}, "f.jsonl", `{"m": ` + row(3, 3) + `}`},
		{"fork parent unhashable", map[string][]string{
			"p.jsonl": {meta(parent, "", "", ""), message("user", "x")},
			"f.jsonl": {`{"type": "session_meta", "payload": {"id": "f", "session_id": ["` + parent + `"], "forked_from_id": "` + parent + `"}}`, turnContext("m"), tokenCount(tok, tok)},
		}, "f.jsonl", ""},
		{"rollout key unhashable", map[string][]string{
			"p.jsonl": {`{"type": "session_meta", "payload": {"id": "r", "session_id": ["` + parent + `"]}}`, meta(parent, "", "", ""), message("user", "x")},
		}, "p.jsonl", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			day := filepath.Join(dir, "sessions", "d")
			for name, lines := range c.files {
				writeFile(t, filepath.Join(day, name), lines...)
			}
			env, buf := newEnv("darwin")
			got := iterAll(t, filepath.Join(dir, "sessions"), nil, env)
			if len(got) != 1 || got[0].SessionID != parent {
				t.Fatalf("got %q", ids(got))
			}
			if c.subagent == "" {
				if got[0].Tokens != nil {
					t.Errorf("tokens = %s", pyjson.Dumps(got[0].Tokens.Value(), pyjson.Unicode()))
				}
			} else if got[0].Tokens == nil {
				t.Errorf("no tokens")
			} else {
				assertJSON(t, "subagent", mustGet(got[0].Tokens.Value(), "subagent"), c.subagent)
			}
			w := warnLines(buf)
			if len(w) != 1 || !strings.HasPrefix(w[0], "worklog: "+filepath.Join(day, c.bad)+": ignored a part of a record the parser cannot read (") {
				t.Errorf("warnings %q", w)
			}
		})
	}
}

// A rollout that cannot be stat'd (a dangling symlink) is skipped with the os.Stat error, with or
// without since (iter_sessions stats every rollout); ParseFile alone gives nothing quietly.
func TestDanglingSymlinkRolloutIsSkippedWithTheStatError(t *testing.T) {
	dir := t.TempDir()
	day := filepath.Join(dir, "sessions", "d")
	writeFile(t, filepath.Join(day, "p.jsonl"), meta(parent, "", "", ""), message("user", "x"))
	lone := filepath.Join(day, "dangling.jsonl")
	if err := os.Symlink(filepath.Join(dir, "missing"), lone); err != nil {
		t.Skip("no symlinks:", err)
	}
	_, statErr := os.Stat(lone)
	want := []string{fmt.Sprintf("worklog: skipped unreadable log %s (%s)", lone, statErr)}
	for _, since := range []*float64{nil, f64(0)} {
		env, buf := newEnv("darwin")
		if got := ids(iterAll(t, filepath.Join(dir, "sessions"), since, env)); !reflect.DeepEqual(got, []string{parent}) {
			t.Errorf("got %q", got)
		}
		if w := warnLines(buf); !reflect.DeepEqual(w, want) {
			t.Errorf("warnings %q, want %q", w, want)
		}
	}
	env, buf := newEnv("darwin")
	if s, _ := ParseFile(lone, env); s != nil || buf.Len() != 0 {
		t.Errorf("ParseFile: %v, %q", s, buf.String())
	}
}

// The D17 reason names the field the rollout lookup used: `id` when session_id is falsy.
func TestD17RolloutKeyReasonNamesTheField(t *testing.T) {
	dir := t.TempDir()
	p := writeFile(t, filepath.Join(dir, "sessions", "r.jsonl"), `{"type": "session_meta", "payload": {"id": [1]}}`)
	env, buf := newEnv("darwin")
	iterAll(t, filepath.Join(dir, "sessions"), nil, env)
	want := []string{"worklog: " + p + ": ignored a part of a record the parser cannot read (a session_meta whose id is a list or an object)"}
	if w := warnLines(buf); !reflect.DeepEqual(w, want) {
		t.Errorf("warnings %q, want %q", w, want)
	}
}

// An integer beyond int64 keeps its record (Python reads it as an int); as a token count it is D4.
func TestBigIntegersKeepTheRecord(t *testing.T) {
	bad := `{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 1}, "last_token_usage": {"input_tokens": 12345678901234567890, "output_tokens": 2}}}}`
	p := writeFile(t, filepath.Join(t.TempDir(), "r.jsonl"), meta("s", "", "", ""), turnContext("m"), message("user", "x"),
		`{"type": "event_msg", "payload": {"type": "other", "n": -12345678901234567890}}`, bad, message("assistant", "y"))
	env, buf := newEnv("darwin")
	s, _ := ParseFile(p, env)
	if s == nil {
		t.Fatal("no session")
	}
	if got := messageTexts(s); !reflect.DeepEqual(got, []string{"x", "y"}) {
		t.Errorf("texts %q", got)
	}
	assertJSON(t, "tokens", tokensOf(s), `{"by_model": {"m": `+row(0, 2)+`}, "subagent": {}}`)
	want := fmt.Sprintf("worklog: %s: token count 12345678901234567890 is not an integer; counted as 0", p)
	if w := warnLines(buf); !reflect.DeepEqual(w, []string{want}) {
		t.Errorf("warnings %q, want %q", w, want)
	}
}

// pyEqual compares a BigInt by value, as Python's == compares ints (fork parent ids).
func TestPyEqualBigInt(t *testing.T) {
	big := pyjson.BigInt("18446744073709551616")
	for _, c := range []struct {
		a, b pyjson.Value
		want bool
	}{
		{big, pyjson.BigInt("18446744073709551616"), true},
		{big, pyjson.Float(18446744073709551616), true},
		{pyjson.Float(18446744073709551616), big, true},
		{big, pyjson.Int(math.MaxInt64), false},
		{big, true, false},
		{[]pyjson.Value{big}, []pyjson.Value{pyjson.BigInt("18446744073709551616")}, true},
	} {
		if got := pyEqual(c.a, c.b); got != c.want {
			t.Errorf("pyEqual(%#v, %#v) = %v", c.a, c.b, got)
		}
	}
}

// ---- the stat-first seam (IterSessionsFiltered) ----------------------------------------------------

func iterFiltered(root string, since *float64, f Filter, env *rt.Env) []*session.RawSession {
	var out []*session.RawSession
	IterSessionsFiltered(root, since, f, env, func(s *session.RawSession) { out = append(out, s) })
	return out
}

// countParses counts the calls through the parseRollout seam until the test ends.
func countParses(t *testing.T) *[]string {
	t.Helper()
	var parsed []string
	real := parseRollout
	parseRollout = func(p string, w *logparse.Warner, env *rt.Env) (*session.RawSession, *usage) {
		parsed = append(parsed, p)
		return real(p, w, env)
	}
	t.Cleanup(func() { parseRollout = real })
	return &parsed
}

// codexRoots is every directory of the corpus named sessions (so archived_sessions/ siblings are
// read), plus the corpus root itself.
func codexRoots(t *testing.T, root string) []string {
	t.Helper()
	roots := []string{root}
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err == nil && d.IsDir() && d.Name() == "sessions" {
			roots = append(roots, p)
		}
		return nil
	})
	if len(roots) < 3 {
		t.Fatalf("only %d roots", len(roots))
	}
	return roots
}

// A zero Filter is today's IterSessions, session for session and warning for warning, over the whole
// corpus.
func TestIterSessionsFilteredZeroFilterYieldsExactlyIterSessions(t *testing.T) {
	corpus := testkit.CopyCorpus(t, ".")
	total := 0
	for _, root := range codexRoots(t, corpus) {
		for _, since := range []*float64{nil, f64(0), f64(1_500_000_000)} {
			env, buf := newEnv("darwin")
			want := iterAll(t, root, since, env)
			env2, buf2 := newEnv("darwin")
			got := iterFiltered(root, since, Filter{}, env2)
			total += len(want)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s since %v: sessions differ: %q vs %q", root, since, ids(got), ids(want))
			}
			if buf2.String() != buf.String() {
				t.Errorf("%s since %v: warnings differ:\n got %q\nwant %q", root, since, buf2.String(), buf.String())
			}
		}
	}
	if total == 0 {
		t.Fatal("the corpus yielded nothing")
	}
}

func TestKeepFalseNeverParses(t *testing.T) {
	corpus := testkit.CopyCorpus(t, ".")
	parsed := countParses(t)
	kept := 0
	for _, root := range codexRoots(t, corpus) {
		env, _ := newEnv("darwin")
		got := iterFiltered(root, nil, Filter{
			Keep:  func(string, float64) bool { kept++; return false },
			Empty: func(p string, _ float64) { t.Errorf("Empty(%s) for a rejected rollout", p) },
		}, env)
		if len(got) != 0 {
			t.Errorf("%s: yielded %d sessions", root, len(got))
		}
	}
	if kept == 0 || len(*parsed) != 0 {
		t.Errorf("Keep saw %d rollouts, parsed %d", kept, len(*parsed))
	}
}

// Keep sees the rollout's mtime moved by a fork written after it: the RawSession.Mtime.
func TestKeepReceivesTheCombinedMtimeThatRawSessionCarries(t *testing.T) {
	root := filepath.Join(testkit.CopyCorpus(t, "test_tokens/test_codex_fork_mtime_is_the_parents"), "sessions")
	day := filepath.Join(root, "2026", "09", "18")
	rollout := filepath.Join(day, "rollout-parent.jsonl")
	setMtime(t, rollout, 1_000_000_000)
	setMtime(t, filepath.Join(day, "rollout-fork-a.jsonl"), 2_000_000_000)
	seen := map[string]float64{}
	env, _ := newEnv("darwin")
	got := iterFiltered(root, nil, Filter{Keep: func(p string, m float64) bool { seen[p] = m; return true }}, env)
	if len(got) != 1 || got[0].Mtime != 2_000_000_000 {
		t.Fatalf("got %q", ids(got))
	}
	if want := map[string]float64{rollout: 2_000_000_000}; !reflect.DeepEqual(seen, want) {
		t.Errorf("Keep saw %v, want %v", seen, want)
	}
}

func TestKeepIsConsultedWithoutSince(t *testing.T) {
	dir := t.TempDir()
	a := writeFile(t, filepath.Join(dir, "sessions", "d", "a.jsonl"), meta("a", "", "", ""), message("user", "x"))
	b := writeFile(t, filepath.Join(dir, "sessions", "d", "b.jsonl"), meta("b", "", "", ""), message("user", "y"))
	setMtime(t, a, 1_000_000_000)
	setMtime(t, b, 1_100_000_000)
	parsed := countParses(t)
	seen := map[string]float64{}
	env, buf := newEnv("darwin")
	got := iterFiltered(filepath.Join(dir, "sessions"), nil, Filter{Keep: func(p string, m float64) bool { seen[p] = m; return p == b }}, env)
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

// A subagent rollout that names only itself (not folded into any session) and a rollout without a
// session_meta both reach the parse and yield nothing.
func TestEmptyIsCalledForAKeptLogThatYieldsNoSession(t *testing.T) {
	dir := t.TempDir()
	day := filepath.Join(dir, "sessions", "d")
	fork := writeFile(t, filepath.Join(day, "fork.jsonl"), meta("mem", "mem", "", forkSource("mem")), message("user", "x"))
	noMeta := writeFile(t, filepath.Join(day, "nometa.jsonl"), message("user", "x"))
	writeFile(t, filepath.Join(day, "ok.jsonl"), meta("ok", "", "", ""), message("user", "x"))
	setMtime(t, fork, 1_000_000_000)
	setMtime(t, noMeta, 1_100_000_000)
	for _, f := range []Filter{{}, {Keep: func(string, float64) bool { return true }}} {
		empty := map[string]float64{}
		f.Empty = func(p string, m float64) { empty[p] = m }
		env, _ := newEnv("darwin")
		got := iterFiltered(filepath.Join(dir, "sessions"), nil, f, env)
		if !reflect.DeepEqual(ids(got), []string{"ok"}) {
			t.Errorf("keep set %v: yielded %q", f.Keep != nil, ids(got))
		}
		if want := map[string]float64{fork: 1_000_000_000, noMeta: 1_100_000_000}; !reflect.DeepEqual(empty, want) {
			t.Errorf("keep set %v: Empty saw %v, want %v", f.Keep != nil, empty, want)
		}
	}
}

// Today the sessions/ copy is yielded and the archived_sessions/ copy deduped (TestSessionsWinOverArchived,
// TestRolloutInBothPlacesIsYieldedOnce). Rejecting the sessions/ copy must not let the archived one
// through in its place: nothing is yielded, and Skip names the meta session id.
func TestCodexSkippedRolloutStillDedupesItsArchivedCopy(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "archived_sessions", "a.jsonl"), meta("s", "", "", ""), message("user", "archived"))
	live := writeFile(t, filepath.Join(dir, "sessions", "z", "z.jsonl"), meta("s", "", "", ""), message("user", "live"))
	root := filepath.Join(dir, "sessions")

	today := iterQuiet(t, root, nil)
	if len(today) != 1 || today[0].Path != live {
		t.Fatalf("today: got %d sessions %v", len(today), today)
	}

	var skips []string
	env, buf := newEnv("darwin")
	got := iterFiltered(root, nil, Filter{
		Keep: func(p string, _ float64) bool { return p != live },
		Skip: func(p string, _ float64, metaID string) { skips = append(skips, p+" "+metaID) },
	}, env)
	if len(got) != 0 {
		t.Errorf("yielded %d sessions, from %q", len(got), got[0].Path)
	}
	if want := []string{live + " s"}; !reflect.DeepEqual(skips, want) {
		t.Errorf("Skip calls %q, want %q", skips, want)
	}
	if buf.Len() != 0 {
		t.Errorf("warnings %q", buf.String())
	}
}

// The meta id for dedupe is `session_id or id`: a meta whose session_id is empty is keyed by its id.
func TestSkipNamesTheMetaIDBySessionIDOrID(t *testing.T) {
	dir := t.TempDir()
	p := writeFile(t, filepath.Join(dir, "sessions", "r.jsonl"),
		`{"type": "session_meta", "payload": {"id": "own", "session_id": "", "cwd": "/w"}}`, message("user", "x"))
	var got []string
	env, _ := newEnv("darwin")
	iterFiltered(filepath.Join(dir, "sessions"), nil, Filter{
		Keep: func(string, float64) bool { return false },
		Skip: func(path string, _ float64, metaID string) { got = append(got, path+" "+metaID) },
	}, env)
	if want := []string{p + " own"}; !reflect.DeepEqual(got, want) {
		t.Errorf("Skip calls %q, want %q", got, want)
	}
}

// A D1 rollout (bad bytes past the head firstMeta reads) prints its warning only when parsed; the
// D2 head warning prints whatever Keep says, as it comes before Keep.
func TestAKeepRejectedLogPrintsNoParseWarning(t *testing.T) {
	dir := t.TempDir()
	head := strings.Join([]string{meta("s", "", "", ""), message("user", "x")}, "\n") + "\n"
	p := writeBytes(t, filepath.Join(dir, "sessions", "d", "r.jsonl"),
		append(append([]byte(head), bytes.Repeat([]byte("x"), 9000)...), 0xff, '\n'))
	root := filepath.Join(dir, "sessions")
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

	unit := testkit.CopyCorpus(t, "divergent/D2")
	d2 := filepath.Join(unit, "sessions", "2026", "09", "18", "rollout-d2.jsonl")
	want := fmt.Sprintf("worklog: skipped unreadable log %s (%s)", d2, pythonError(t, "logs/divergent/D2/sessions/2026/09/18/rollout-d2.jsonl"))
	env, buf = newEnv("darwin")
	iterFiltered(filepath.Join(unit, "sessions"), nil, Filter{Keep: func(string, float64) bool { return false }}, env)
	if got := warnLines(buf); !reflect.DeepEqual(got, []string{want}) {
		t.Errorf("D2: warnings %q, want %q", got, want)
	}
}

// A kept archived_sessions/ copy of a session already yielded from sessions/ is parsed and dropped
// as seen. It reaches Empty, so a caller can index it as yielding nothing (Task 3a ruling); Skip is
// not called, as Keep accepted it.
func TestASeenArchivedCopyIsReportedToEmpty(t *testing.T) {
	dir := t.TempDir()
	archived := writeFile(t, filepath.Join(dir, "archived_sessions", "a.jsonl"), meta("s", "", "", ""), message("user", "archived"))
	live := writeFile(t, filepath.Join(dir, "sessions", "z", "z.jsonl"), meta("s", "", "", ""), message("user", "live"))
	setMtime(t, archived, 1_000_000_000)
	empty := map[string]float64{}
	skips := 0
	env, _ := newEnv("darwin")
	got := iterFiltered(filepath.Join(dir, "sessions"), nil, Filter{
		Keep:  func(string, float64) bool { return true },
		Empty: func(p string, m float64) { empty[p] = m },
		Skip:  func(string, float64, string) { skips++ },
	}, env)
	if len(got) != 1 || got[0].Path != live {
		t.Fatalf("yielded %d sessions %v", len(got), got)
	}
	if want := map[string]float64{archived: 1_000_000_000}; !reflect.DeepEqual(empty, want) || skips != 0 {
		t.Errorf("Empty saw %v (want %v), Skip called %d times", empty, want, skips)
	}
}
