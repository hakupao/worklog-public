package testkit_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// CopyCorpus reproduces mtimes.json exactly: every corpus file's copy reads back, through
// MtimeFloat, as the float Python's os.stat gave (golden mtime.json "corpus").
func TestCopyCorpusReproducesMtimes(t *testing.T) {
	var g struct {
		Corpus map[string]string `json:"corpus"`
	}
	testkit.Golden(t, "mtime", &g)
	mt := testkit.Mtimes(t)
	if len(g.Corpus) == 0 || len(g.Corpus) != len(mt) {
		t.Fatalf("golden corpus %d entries, mtimes.json %d", len(g.Corpus), len(mt))
	}
	seen := map[string]bool{}
	for _, rel := range []string{".", "../fixtures"} {
		root := testkit.CopyCorpus(t, rel)
		prefix := filepath.ToSlash(filepath.Clean(filepath.Join("logs", rel)))
		err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			r, _ := filepath.Rel(root, p)
			key := filepath.ToSlash(filepath.Join(prefix, r))
			want, ok := g.Corpus[key]
			if !ok {
				return nil // INDEX.md, config.toml: not corpus files
			}
			info, err := os.Stat(p)
			if err != nil {
				return err
			}
			if got := pytime.FloatRepr(pytime.MtimeFloat(info)); got != want {
				t.Errorf("%s: mtime %s, want %s", key, got, want)
			}
			seen[key] = true
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	for k := range g.Corpus {
		if !seen[k] {
			t.Errorf("%s: not copied", k)
		}
	}
}

func TestCopyCorpusOneFileAndSubtree(t *testing.T) {
	f := testkit.CopyCorpus(t, "../fixtures/claude_code_session.jsonl")
	info, err := os.Stat(f)
	if err != nil || info.IsDir() || filepath.Base(f) != "claude_code_session.jsonl" {
		t.Fatalf("file copy: %v %v", f, err)
	}
	if got := pytime.FloatRepr(pytime.MtimeFloat(info)); got != "1790294400.0001235" {
		t.Fatalf("mtime %s", got)
	}
	d := testkit.CopyCorpus(t, "divergent/D1")
	if _, err := os.Stat(filepath.Join(d, "-work-div", "div00001-0000-0000-0000-000000000001.jsonl")); err != nil {
		t.Fatal(err)
	}
}

func TestGoldenRawBytes(t *testing.T) {
	var raw []byte
	testkit.Golden(t, "pyjson.json", &raw)
	if !strings.HasPrefix(string(raw), "{") {
		t.Fatalf("raw golden starts %q", raw[:10])
	}
}

// NTFS keeps mtimes at 100 ns, so every corpus stamp sits on that grid: a stamp off it would read
// back as a different float on Windows (CPython and Go alike) and the goldens would not hold there.
func TestMtimesOnNTFSGrid(t *testing.T) {
	mt := testkit.Mtimes(t)
	if len(mt) == 0 {
		t.Fatal("mtimes.json is empty")
	}
	for k, v := range mt {
		if v[1]%100 != 0 || v[1] < 0 || v[1] >= 1_000_000_000 {
			t.Errorf("%s: nsec %d is not on the 100 ns grid", k, v[1])
		}
	}
}
