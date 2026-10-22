package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/hakupao/worklog/collector/internal/harvest"
)

func ptr(s string) *string { return &s }

// TestRollbackResetsExactlyTheStaleKeys runs the documented command (spec §5.11) from the repo root as
// a subprocess: `go -C collector run ./tools/tiered-rollback <Home>`. The keys whose cached
// summary is stale (cur_pfp != pfp) or a fallback get {mtime: 0} with no fp; every other bookmark,
// and collector_state.json itself, are left as they were.
func TestRollbackResetsExactlyTheStaleKeys(t *testing.T) {
	if testing.Short() {
		t.Skip("builds and runs the tool with go run")
	}
	repo, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(repo, "collector", "go.mod")); err != nil {
		t.Fatalf("repo root not found at %s: %v", repo, err)
	}
	home := t.TempDir()
	state := map[string]harvest.Bookmark{
		"claude-code:fresh":     {Mtime: 100.5, FP: ptr("fp-fresh")},  // llm, pfp == cur_pfp: kept
		"claude-code:stale":     {Mtime: 200.25, FP: ptr("fp-stale")}, // llm, cur_pfp moved (R3f/R4): reset
		"codex:fallback":        {Mtime: 300},                         // fallback (R6): reset
		"codex:fallback-moved":  {Mtime: 350, FP: ptr("fp-x")},        // fallback and stale: reset once
		"claude-code:no-entry":  {Mtime: 400, FP: ptr("fp-none")},     // no cache entry: kept
		"claude-code:trivial":   {Mtime: 500},                         // no cache entry, no fp: kept
		"codex:fresh-llm-no-bm": {Mtime: 600, FP: ptr("fp-6")},        // llm, current: kept
	}
	cs := &harvest.CollectorState{
		Jobs:  map[string]string{"hour": "2026-10-21T14"},
		Files: map[string]harvest.FileEntry{"/logs/a.jsonl": {Key: "claude-code:fresh", Kind: harvest.KindSession, Mtime: 100.5, Seen: 1}},
		Sessions: map[string]harvest.SummaryEntry{
			"claude-code:fresh":     {Summary: "a", Source: "llm", PFP: "p1", CurPFP: "p1", At: 1},
			"claude-code:stale":     {Summary: "b", Source: "llm", PFP: "p2", CurPFP: "p2b", At: 1},
			"codex:fallback":        {Summary: "c", Source: "fallback", PFP: "p3", CurPFP: "p3", At: 1, Tries: 2},
			"codex:fallback-moved":  {Summary: "d", Source: "fallback", PFP: "p4", CurPFP: "p4b", At: 1, Tries: 1},
			"codex:fresh-llm-no-bm": {Summary: "e", Source: "llm", PFP: "p6", CurPFP: "p6", At: 1},
			"claude-code:gone":      {Summary: "f", Source: "fallback", PFP: "p7", CurPFP: "p7", At: 1}, // no bookmark: nothing to reset
		},
	}
	statePath, csPath := filepath.Join(home, "harvest_state.json"), filepath.Join(home, "collector_state.json")
	if err := harvest.SaveState(statePath, state); err != nil {
		t.Fatal(err)
	}
	if err := harvest.SaveCollectorState(csPath, cs); err != nil {
		t.Fatal(err)
	}
	csBefore, _ := os.ReadFile(csPath)

	cmd := exec.Command("go", "-C", "collector", "run", "./tools/tiered-rollback", home)
	cmd.Dir = repo
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("%v\nstdout: %s\nstderr: %s", err, stdout.String(), stderr.String())
	}
	if got := strings.TrimSpace(stdout.String()); got != "reset=3" {
		t.Errorf("stdout %q, want reset=3", got)
	}

	want := map[string]harvest.Bookmark{}
	for k, v := range state {
		want[k] = v
	}
	for _, k := range []string{"claude-code:stale", "codex:fallback", "codex:fallback-moved"} {
		want[k] = harvest.Bookmark{Mtime: 0}
	}
	if got := harvest.LoadState(statePath); !reflect.DeepEqual(got, want) {
		t.Errorf("harvest_state.json after the rollback:\n got %v\nwant %v", got, want)
	}
	if csAfter, _ := os.ReadFile(csPath); !bytes.Equal(csAfter, csBefore) {
		t.Errorf("collector_state.json changed")
	}
	entries, _ := os.ReadDir(home)
	if len(entries) != 2 {
		t.Errorf("home holds %d entries after the rollback, want the 2 files only", len(entries))
	}
}

// TestRollbackUsage: no Home, or a Home without harvest_state.json, is an error that writes nothing.
func TestRollbackUsage(t *testing.T) {
	var out, errb bytes.Buffer
	if code := run(nil, &out, &errb); code != 2 {
		t.Errorf("no argument: exit %d, want 2", code)
	}
	home := t.TempDir()
	if code := run([]string{home}, &out, &errb); code != 1 {
		t.Errorf("missing harvest_state.json: exit %d, want 1", code)
	}
	if entries, _ := os.ReadDir(home); len(entries) != 0 {
		t.Errorf("a failed rollback wrote %d file(s)", len(entries))
	}
}
