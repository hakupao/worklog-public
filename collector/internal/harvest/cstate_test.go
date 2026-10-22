package harvest

import (
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func f64(v float64) *float64 { return &v }

func TestCollectorStateMissingCorruptOrUnknownVersionIsEmpty(t *testing.T) {
	p := filepath.Join(t.TempDir(), "collector_state.json")
	check := func(label string) {
		t.Helper()
		s := LoadCollectorState(p)
		if s == nil || s.Jobs == nil || s.Files == nil || s.Sessions == nil ||
			len(s.Jobs) != 0 || len(s.Files) != 0 || len(s.Sessions) != 0 {
			t.Errorf("%s: not an empty state: %+v", label, s)
		}
	}
	check("missing")
	for _, bad := range []string{"", "{", "[]", `{"version":2}`, `{"version":"1"}`, `{"jobs":{"hour":"x"}}`, "null", "\xff\xfe{}", "\xff"} {
		write(t, p, []byte(bad))
		check(bad)
	}
}

func TestCollectorStateRoundTripsEveryField(t *testing.T) {
	p := filepath.Join(t.TempDir(), "collector_state.json")
	fpv := "abc"
	in := &CollectorState{
		Jobs: map[string]string{"hour": "2026-10-20T14", "review": "2026-W43"},
		Files: map[string]FileEntry{
			"/a/x.jsonl": {Key: "claude-code:x", Kind: "session", Mtime: 1760940000.123, Seen: 1760940900},
			"/a/y.jsonl": {Key: "", Kind: "none", Mtime: 5, Seen: 6},
			"/a/z.jsonl": {Key: "", Kind: "excluded", Mtime: 7.5, Seen: 8},
		},
		Sessions: map[string]SummaryEntry{
			"claude-code:x": {Summary: "要約 \"q\"", Source: "llm", PFP: "p1", CurPFP: "p2", At: 1760940000, Tried: 1760940100,
				Tries: 2, LastMsg: f64(1760939000.5), Path: "/a/x.jsonl", Seen: 1760940900, BM: &Bookmark{Mtime: 1760940000.123, FP: &fpv}},
			"claude-code:nobm": {Summary: "s", Source: "fallback", Path: "/b", BM: nil},
			"codex:nofp":       {Summary: "s", Source: "llm", LastMsg: nil, BM: &Bookmark{Mtime: 3}},
		},
	}
	if err := SaveCollectorState(p, in); err != nil {
		t.Fatal(err)
	}
	out := LoadCollectorState(p)
	if !reflect.DeepEqual(in, out) {
		t.Fatalf("round trip:\n in %+v\nout %+v", in, out)
	}
	raw, _ := os.ReadFile(p)
	got := string(raw)
	if !strings.HasPrefix(got, `{"version": 1, "jobs": {`) || strings.Index(got, `"jobs"`) > strings.Index(got, `"files"`) ||
		strings.Index(got, `"files"`) > strings.Index(got, `"sessions"`) {
		t.Errorf("section order: %s", got)
	}
	if !strings.Contains(got, `"summary": "\u8981`) || !strings.Contains(got, `"last_msg": null`) || !strings.Contains(got, `"bm": null`) {
		t.Errorf("fields: %s", got)
	}
	if !strings.Contains(got, `"bm": {"mtime": 3.0}`) {
		t.Errorf("bm without fp should omit fp: %s", got)
	}
	if fi, _ := os.Stat(p); fi.Mode().Perm() != 0o644 && !strings.Contains(os.Getenv("OS"), "Windows") {
		t.Errorf("mode %v", fi.Mode())
	}
}

func TestSaveCollectorStateIsAtomicAndKeepsTheOldFileOnFailure(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "collector_state.json")
	old := &CollectorState{Jobs: map[string]string{"hour": "old"}}
	if err := SaveCollectorState(p, old); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(p)
	// Overwrite works and leaves no temporary file.
	if err := SaveCollectorState(p, &CollectorState{Jobs: map[string]string{"hour": "new"}}); err != nil {
		t.Fatal(err)
	}
	if LoadCollectorState(p).Jobs["hour"] != "new" {
		t.Fatal("not replaced")
	}
	// A rename that cannot succeed (target is a non-empty directory) fails, keeps the target and removes the temp file.
	bad := filepath.Join(dir, "sub", "collector_state.json")
	write(t, filepath.Join(bad, "keep"), []byte("x"))
	if err := SaveCollectorState(bad, old); err == nil {
		t.Fatal("expected an error")
	}
	if b, err := os.ReadFile(filepath.Join(bad, "keep")); err != nil || string(b) != "x" {
		t.Fatalf("target disturbed: %v", err)
	}
	for _, d := range []string{dir, filepath.Join(dir, "sub")} {
		ents, _ := os.ReadDir(d)
		for _, e := range ents {
			if strings.HasSuffix(e.Name(), ".tmp") {
				t.Errorf("leftover %s", e.Name())
			}
		}
	}
	_ = before
}

func TestValidRequiresTheBookmarkGoLastWrote(t *testing.T) {
	a, b := "a", "b"
	cases := []struct {
		name string
		bm   *Bookmark
		hs   map[string]Bookmark
		want bool
	}{
		{"equal", &Bookmark{Mtime: 10, FP: &a}, map[string]Bookmark{"k": {Mtime: 10, FP: &a}}, true},
		{"absent on both sides", nil, map[string]Bookmark{}, true},
		{"mtime differs", &Bookmark{Mtime: 10, FP: &a}, map[string]Bookmark{"k": {Mtime: 11, FP: &a}}, false},
		{"fp differs", &Bookmark{Mtime: 10, FP: &a}, map[string]Bookmark{"k": {Mtime: 10, FP: &b}}, false},
		{"fp absent on one side", &Bookmark{Mtime: 10}, map[string]Bookmark{"k": {Mtime: 10, FP: &a}}, false},
		{"fp absent on both", &Bookmark{Mtime: 10}, map[string]Bookmark{"k": {Mtime: 10}}, true},
		{"entry has none, state has one", nil, map[string]Bookmark{"k": {Mtime: 10}}, false},
		{"entry has one, state has none", &Bookmark{Mtime: 10}, map[string]Bookmark{}, false},
		{"NaN never equal", &Bookmark{Mtime: math.NaN()}, map[string]Bookmark{"k": {Mtime: math.NaN()}}, false},
	}
	for _, c := range cases {
		s := &CollectorState{Sessions: map[string]SummaryEntry{"k": {Summary: "S", BM: c.bm}}}
		e, ok := s.Valid("k", c.hs)
		if ok != c.want || (ok && e.Summary != "S") {
			t.Errorf("%s: ok=%v want %v", c.name, ok, c.want)
		}
	}
	s := &CollectorState{Sessions: map[string]SummaryEntry{}}
	if _, ok := s.Valid("nope", nil); ok {
		t.Error("no entry must not be valid")
	}
}

func TestPruneDropsGoneFilesOutOfWindowFilesAndSessionsUnseenFor15Days(t *testing.T) {
	const day = 86400.0
	now := 100 * day
	s := &CollectorState{
		Files: map[string]FileEntry{
			"/keep":   {Kind: "session", Mtime: now - 13*day},
			"/gone":   {Kind: "session", Mtime: now - day},
			"/old":    {Kind: "none", Mtime: now - 15*day},
			"/edge":   {Kind: "none", Mtime: now - 14*day},
			"/future": {Kind: "excluded", Mtime: now + day},
		},
		Sessions: map[string]SummaryEntry{
			"fresh": {Seen: now - 14*day},
			"edge":  {Seen: now - 15*day},
			"stale": {Seen: now - 15*day - 1},
		},
	}
	s.Prune(now, 14, func(p string) bool { return p != "/gone" })
	for _, k := range []string{"/keep", "/edge", "/future"} {
		if _, ok := s.Files[k]; !ok {
			t.Errorf("%s pruned", k)
		}
	}
	for _, k := range []string{"/gone", "/old"} {
		if _, ok := s.Files[k]; ok {
			t.Errorf("%s kept", k)
		}
	}
	if _, ok := s.Sessions["fresh"]; !ok {
		t.Error("fresh pruned")
	}
	if _, ok := s.Sessions["edge"]; !ok {
		t.Error("exactly 15 days must stay")
	}
	if _, ok := s.Sessions["stale"]; ok {
		t.Error("stale kept")
	}
}

func TestPathOfPrefersTheFilesIndex(t *testing.T) {
	s := &CollectorState{
		Files: map[string]FileEntry{
			"/idx/a.jsonl": {Key: "k1", Kind: "session"},
			"/idx/n":       {Key: "", Kind: "none"},
		},
		Sessions: map[string]SummaryEntry{
			"k1": {Path: "/entry/a.jsonl"},
			"k2": {Path: "/entry/b.jsonl"},
			"k3": {},
		},
	}
	if p, ok := s.PathOf("k1"); !ok || p != "/idx/a.jsonl" {
		t.Errorf("k1: %q %v", p, ok)
	}
	if p, ok := s.PathOf("k2"); !ok || p != "/entry/b.jsonl" {
		t.Errorf("k2: %q %v", p, ok)
	}
	for _, k := range []string{"k3", "nope", ""} {
		if p, ok := s.PathOf(k); ok {
			t.Errorf("%q: %q", k, p)
		}
	}
}
