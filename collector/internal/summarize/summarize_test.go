package summarize

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/claudecode"
	"github.com/hakupao/worklog/collector/internal/codex"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// fake is the Python tests' runner: it answers (code, stdout) or raises, and records the call.
type fake struct {
	code   int
	stdout string
	err    error
	calls  []call
}

type call struct {
	argv    []string
	stdin   string
	timeout time.Duration
}

func (f *fake) Run(_ context.Context, argv []string, stdin []byte, timeout time.Duration) (llm.Result, error) {
	f.calls = append(f.calls, call{argv, string(stdin), timeout})
	return llm.Result{Stdout: []byte(f.stdout), ExitCode: f.code}, f.err
}

func raw(texts ...string) *session.RawSession {
	s := &session.RawSession{}
	for _, t := range texts {
		s.Messages = append(s.Messages, session.Message{Role: "user", Text: t})
	}
	return s
}

func TestPromptsAskFor30CharsAndOutcomesOnly(t *testing.T) {
	for _, p := range []string{systemPrompt, instruction} {
		if !strings.Contains(p, "30 字以内") || !strings.Contains(p, "成果") || !strings.Contains(p, "手順") {
			t.Errorf("prompt lacks a rule: %s", p)
		}
	}
	if summaryTruncate != 60 {
		t.Errorf("summaryTruncate = %d", summaryTruncate)
	}
}

func TestLLMSummaryIsCutToLimit(t *testing.T) {
	s, kind := Summarize(&fake{stdout: strings.Repeat("あ", 100)}, raw("直して"), "haiku")
	if kind != "llm" || utf8.RuneCountInString(s) != 60 {
		t.Fatalf("%q %s", s, kind)
	}
}

func TestFallbackIsFirst30Chars(t *testing.T) {
	s, kind := Summarize(&fake{err: errors.New("boom")}, raw(strings.Repeat("あ", 100)), "haiku")
	if kind != "fallback" || utf8.RuneCountInString(s) != 30 {
		t.Fatalf("%q %s", s, kind)
	}
}

func TestPromptsAskForPlainWords(t *testing.T) {
	for _, p := range []string{systemPrompt, instruction} {
		if !strings.Contains(p, "技術に詳しくない人") || !strings.Contains(p, "30 字以内") {
			t.Errorf("prompt lacks a rule: %s", p)
		}
	}
	if !strings.Contains(systemPrompt, "ライブラリ名") || !strings.Contains(systemPrompt, "決まり文句") {
		t.Error("system prompt lacks a rule")
	}
}

// The summarize side of test_harvest_fallback: every failure of the call gives the fallback.
func TestEveryFailedCallFallsBack(t *testing.T) {
	for _, f := range []*fake{
		{err: errors.New("spawn")}, {err: context.DeadlineExceeded}, {code: 1, stdout: "要約"},
		{stdout: " \n"}, {stdout: "Not logged in · Please run /login"},
	} {
		if s, kind := Summarize(f, raw("最初の依頼"), "haiku"); s != "最初の依頼" || kind != "fallback" {
			t.Errorf("%+v: %q %s", f, s, kind)
		}
	}
	if s, kind := Summarize(&fake{err: errors.New("x")}, &session.RawSession{}, "haiku"); s != "" || kind != "fallback" {
		t.Errorf("no user text: %q %s", s, kind)
	}
}

type outputsCase struct {
	Session, Stdout, Summary, Source, Input string
	Returncode                              int
	Argv                                    []string
	Kwargs                                  struct{ Timeout float64 }
}

func ts(t *testing.T, s string) pytime.Instant {
	t.Helper()
	i, err := pytime.FromISO(s)
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func env() *rt.Env { return &rt.Env{Stderr: &bytes.Buffer{}, GOOS: runtime.GOOS} }

// golden prompts.json summarize_outputs: gen_side_jobs's three sessions × eight answers.
func TestSummarizeOutputsGolden(t *testing.T) {
	var g struct {
		SummarizeOutputs []outputsCase `json:"summarize_outputs"`
	}
	testkit.Golden(t, "prompts", &g)
	fixture, err := claudecode.ParseFile(filepath.Join(testkit.TestdataDir(t), "fixtures", "claude_code_session.jsonl"), env())
	if err != nil || fixture == nil {
		t.Fatal(err)
	}
	msg := func(role, text, at string) session.Message {
		return session.Message{Role: role, Text: text, TS: ts(t, at)}
	}
	sessions := map[string]*session.RawSession{
		"fixture": fixture,
		"long": {Agent: "codex", Messages: []session.Message{
			msg("user", strings.Repeat("依", 600), "2026-09-18T09:00:00"),
			msg("assistant", strings.Repeat("前", 10), "2026-09-18T09:01:00"),
			msg("user", strings.Repeat("二番目 😀", 3), "2026-09-18T09:02:00"),
			msg("assistant", strings.Repeat("答", 1200)+"😀", "2026-09-18T09:03:00"),
		}},
		"no_user": {Agent: "codex", Messages: []session.Message{msg("assistant", "only", "2026-09-18T09:00:00")}},
	}
	if len(g.SummarizeOutputs) != 24 {
		t.Fatalf("%d cases", len(g.SummarizeOutputs))
	}
	for i, c := range g.SummarizeOutputs {
		f := &fake{code: c.Returncode, stdout: c.Stdout}
		s, src := Summarize(f, sessions[c.Session], "haiku")
		if s != c.Summary || src != c.Source {
			t.Errorf("#%d %s %q: got %q %s, want %q %s", i, c.Session, c.Stdout, s, src, c.Summary, c.Source)
		}
		if len(f.calls) != 1 {
			t.Fatalf("#%d: %d calls", i, len(f.calls))
		}
		got := f.calls[0]
		if strings.Join(got.argv, "\x00") != strings.Join(c.Argv, "\x00") || got.stdin != c.Input ||
			got.timeout != time.Duration(c.Kwargs.Timeout)*time.Second {
			t.Errorf("#%d: call %q %q %v", i, got.argv, got.stdin, got.timeout)
		}
	}
}

// golden prompts.json summarize_harvest: which sessions harvest summarizes is Task 9's; here every
// prompt Python sent for a corpus unit must be Prompt() of a session the parsers find there, with
// the summarizer's argv.
func TestSummarizeHarvestPromptsGolden(t *testing.T) {
	var g struct {
		SummarizeHarvest map[string][]struct {
			Argv   []string
			Input  string
			Kwargs struct{ Timeout float64 }
		} `json:"summarize_harvest"`
	}
	testkit.Golden(t, "prompts", &g)
	if len(g.SummarizeHarvest) == 0 {
		t.Fatal("no units")
	}
	want := strings.Join(llm.ClaudeArgv("haiku", systemPrompt), "\x00")
	n := 0
	for unit, calls := range g.SummarizeHarvest {
		dir := filepath.Join(testkit.TestdataDir(t), filepath.FromSlash(unit))
		codexRoot := dir
		if fi, err := os.Stat(filepath.Join(dir, "sessions")); err == nil && fi.IsDir() {
			codexRoot = filepath.Join(dir, "sessions")
		}
		prompts := map[string]bool{}
		add := func(r *session.RawSession) { prompts[Prompt(r)] = true }
		claudecode.IterSessions(dir, nil, env(), add)
		codex.IterSessions(codexRoot, nil, env(), add)
		for i, c := range calls {
			if strings.Join(c.Argv, "\x00") != want || c.Kwargs.Timeout != 90 {
				t.Errorf("%s #%d: argv %q timeout %v", unit, i, c.Argv, c.Kwargs.Timeout)
			}
			if !prompts[c.Input] {
				t.Errorf("%s #%d: no parsed session gives the prompt %q", unit, i, c.Input)
			}
			n++
		}
	}
	t.Logf("%d prompts checked", n)
}
