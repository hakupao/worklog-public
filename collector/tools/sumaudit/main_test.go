package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/harvest"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/rt"
)

type fakeRunner struct{ calls int }

func (f *fakeRunner) Run(_ context.Context, _ []string, _ []byte, _ time.Duration) (llm.Result, error) {
	f.calls++
	return llm.Result{Stdout: []byte("帳票の集計を直した\n")}, nil
}

const log = `{"type":"user","sessionId":"s1","cwd":"/work/a","timestamp":"2026-10-20T01:00:00.000Z","message":{"role":"user","content":"帳票の集計処理を修正してほしい"}}
{"type":"assistant","sessionId":"s1","cwd":"/work/a","timestamp":"2026-10-20T01:05:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"修正しました。"}]}}
`

// TestSumauditPrintsCacheDecisionsAndAFreshSummary: one key, its cache entry, its tiers.jsonl
// decisions and a fresh summary through the runner; the home is not written.
func TestSumauditPrintsCacheDecisionsAndAFreshSummary(t *testing.T) {
	dir := t.TempDir()
	root, home, logs := filepath.Join(dir, "root"), filepath.Join(dir, "home"), filepath.Join(dir, "projects")
	for _, d := range []string{root, home, filepath.Join(logs, "-work-a")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	p := filepath.Join(logs, "-work-a", "s1.jsonl")
	must(t, os.WriteFile(p, []byte(log), 0o644))
	must(t, os.WriteFile(filepath.Join(root, "config.toml"), []byte("api_url = \"http://127.0.0.1:1\"\n"), 0o644))
	bm := harvest.Bookmark{Mtime: 1}
	must(t, harvest.SaveState(filepath.Join(home, "harvest_state.json"), map[string]harvest.Bookmark{"claude-code:s1": bm}))
	must(t, harvest.SaveCollectorState(filepath.Join(home, "collector_state.json"), &harvest.CollectorState{
		Jobs:  map[string]string{},
		Files: map[string]harvest.FileEntry{p: {Key: "claude-code:s1", Kind: harvest.KindSession, Mtime: 1}},
		Sessions: map[string]harvest.SummaryEntry{"claude-code:s1": {Summary: "前の要約", Source: "llm", PFP: "old", CurPFP: "old",
			At: 1, Path: p, BM: &bm}},
	}))
	must(t, os.WriteFile(filepath.Join(home, "tiers.jsonl"), []byte(
		`{"ts":1.0,"key":"claude-code:s1","rule":"R1","source":"llm","pfp":"old","cur_pfp":"old","at":1.0}`+"\n"+
			`{"ts":2.0,"job":"review","result":"exists"}`+"\n"), 0o644))
	before := snapshot(t, home)

	var out, errb bytes.Buffer
	env := &rt.Env{Stdout: &out, Stderr: &errb, Now: time.Now, GOOS: runtime.GOOS, Home: dir,
		Getenv: func(k string) string {
			return map[string]string{"WORKLOG_ROOT": root, "WORKLOG_HOME": home}[k]
		}}
	r := &fakeRunner{}
	if code := run([]string{"--claude-root", logs, "--codex-root", filepath.Join(dir, "sessions"), "claude-code:s1"}, env, r); code != 0 {
		t.Fatalf("exit %d: %s", code, errb.String())
	}
	got := out.String()
	for _, want := range []string{"== claude-code:s1", "cache: source=llm tries=0", "pfp=old cur_pfp=old bm_valid=true",
		"cached summary: 前の要約", "tiers.jsonl: 1 decision(s); ", " R1 llm", "== cur_pfp false",
		"fresh summary (llm): 帳票の集計を直した"} {
		if !strings.Contains(got, want) {
			t.Errorf("output lacks %q:\n%s", want, got)
		}
	}
	if r.calls != 1 {
		t.Errorf("%d summarizer call(s), want 1", r.calls)
	}
	if after := snapshot(t, home); after != before {
		t.Errorf("the home changed")
	}
}

func TestSumauditUnknownKey(t *testing.T) {
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "config.toml"), nil, 0o644))
	var out, errb bytes.Buffer
	env := &rt.Env{Stdout: &out, Stderr: &errb, Now: time.Now, GOOS: runtime.GOOS, Home: dir,
		Getenv: func(k string) string { return map[string]string{"WORKLOG_ROOT": dir, "WORKLOG_HOME": dir}[k] }}
	if code := run([]string{"claude-code:nope"}, env, &fakeRunner{}); code != 1 {
		t.Errorf("exit %d, want 1", code)
	}
	if !strings.Contains(out.String(), "cache: no entry") || !strings.Contains(out.String(), "log: unknown") {
		t.Errorf("output: %s", out.String())
	}
	if code := run(nil, env, &fakeRunner{}); code != 2 {
		t.Errorf("no key: exit %d, want 2", code)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func snapshot(t *testing.T, dir string) string {
	t.Helper()
	var b strings.Builder
	entries, err := os.ReadDir(dir)
	must(t, err)
	for _, e := range entries {
		c, err := os.ReadFile(filepath.Join(dir, e.Name()))
		must(t, err)
		b.WriteString(e.Name() + "\x00" + string(c) + "\x00")
	}
	return b.String()
}
