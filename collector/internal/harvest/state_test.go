package harvest

import (
	"math"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
)

func fp(s string) *string { return &s }

// _load_state: missing, unparseable or non-object → {}; a bare number is {"mtime": v}; an int mtime
// compares equal to the same float, as in Python.
func TestLoadState(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "harvest_state.json")
	if s := LoadState(p); len(s) != 0 {
		t.Fatalf("missing: %v", s)
	}
	for _, bad := range []string{"", "{", "[]", "1.5", `"x"`, "null", "\xff"} {
		write(t, p, []byte(bad))
		if s := LoadState(p); len(s) != 0 {
			t.Errorf("%q: %v", bad, s)
		}
	}
	write(t, p, []byte(`{"a": 1790294400.0001235, "b": {"mtime": 12, "fp": "f"}, "c": {"mtime": 1.5}, "d": {"fp": 3}, "e": {"mtime": "x", "fp": null}, "f": 7, "g": NaN, "h": {"mtime": 18446744073709551616}}`))
	s := LoadState(p)
	if len(s) != 8 {
		t.Fatalf("%v", s)
	}
	check := func(k string, mtime float64, f *string) {
		t.Helper()
		b := s[k]
		if !(b.Mtime == mtime || math.IsNaN(mtime) && math.IsNaN(b.Mtime)) {
			t.Errorf("%s: mtime %v, want %v", k, b.Mtime, mtime)
		}
		if (b.FP == nil) != (f == nil) || f != nil && *b.FP != *f {
			t.Errorf("%s: fp %v, want %v", k, b.FP, f)
		}
	}
	check("a", 1790294400.0001235, nil)
	check("b", 12, fp("f"))
	check("c", 1.5, nil)
	// No usable mtime matches no log's: NaN never compares equal.
	check("d", math.NaN(), nil)
	check("e", math.NaN(), nil)
	check("f", 7, nil)
	check("g", math.NaN(), nil)
	// An int beyond int64 is float(n) (it equals no real mtime either way).
	check("h", 18446744073709551616, nil)
}

// json.dumps(state): fields mtime then fp (fp only when set), mtime in Python's float repr so a
// rollback to Python reads the same value; a NaN mtime (no usable value was read) is written as null.
func TestSaveStateRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "nested", "harvest_state.json")
	in := map[string]Bookmark{
		"claude-code:b": {Mtime: 1790294400.0001235, FP: fp("362ab4b64e2c67244eed05e51fd5f8e0")},
		"codex:a":       {Mtime: 1790336604.0951538},
		"codex:n":       {Mtime: math.NaN()},
	}
	if err := SaveState(p, in); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"claude-code:b": {"mtime": 1790294400.0001235, "fp": "362ab4b64e2c67244eed05e51fd5f8e0"}, "codex:a": {"mtime": 1790336604.0951538}, "codex:n": {"mtime": null}}`
	if string(b) != want {
		t.Fatalf("%s", b)
	}
	out := LoadState(p)
	if len(out) != 3 || out["codex:a"].Mtime != 1790336604.0951538 || *out["claude-code:b"].FP != *in["claude-code:b"].FP ||
		!math.IsNaN(out["codex:n"].Mtime) {
		t.Fatalf("%v", out)
	}
	v, _ := pyjson.Decode(b)
	if e, _ := v.(*pyjson.Object).Get("codex:a"); !slices.Equal(e.(*pyjson.Object).Keys(), []string{"mtime"}) {
		t.Fatal("fields")
	}
}

// D9: the state file is replaced by rename, never rewritten in place: a second name for the old
// file still reads the old content, and no temporary file is left behind.
func TestD9SaveStateIsAtomic(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "harvest_state.json")
	write(t, p, []byte(`{"old": {"mtime": 1.0}}`))
	alias := filepath.Join(dir, "alias.json")
	if err := os.Link(p, alias); err != nil {
		t.Skip("no hard links here:", err)
	}
	if err := SaveState(p, map[string]Bookmark{"new": {Mtime: 2}}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(alias); string(b) != `{"old": {"mtime": 1.0}}` {
		t.Fatalf("written in place: %s", b)
	}
	if b, _ := os.ReadFile(p); string(b) != `{"new": {"mtime": 2.0}}` {
		t.Fatalf("%s", b)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		t.Fatalf("left behind: %v", entries)
	}
}

// A write that fails leaves the old state whole and no temporary file.
func TestD9FailedSaveKeepsTheOldState(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "harvest_state.json")
	write(t, p, []byte(`{"old": {"mtime": 1.0}}`))
	rename = func(string, string) error { return os.ErrPermission }
	t.Cleanup(func() { rename = os.Rename })
	if err := SaveState(p, map[string]Bookmark{"new": {Mtime: 2}}); err == nil {
		t.Fatal("no error")
	}
	if b, _ := os.ReadFile(p); string(b) != `{"old": {"mtime": 1.0}}` {
		t.Fatalf("%s", b)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("left behind: %v", entries)
	}
}
