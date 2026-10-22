package claudecode

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// rawDict is gen_golden.raw_dict: the RawSession minus its path, message ts in isoformat().
func rawDict(s *session.RawSession) pyjson.Value {
	if s == nil {
		return nil
	}
	o := pyjson.NewObject()
	o.Set("agent", s.Agent)
	o.Set("session_id", s.SessionID)
	o.Set("cwd", s.Cwd)
	msgs := []pyjson.Value{}
	for _, m := range s.Messages {
		mo := pyjson.NewObject()
		mo.Set("role", m.Role)
		mo.Set("text", m.Text)
		mo.Set("ts", m.TS.ISOFormat())
		msgs = append(msgs, mo)
	}
	o.Set("messages", msgs)
	o.Set("mtime", pyjson.Float(s.Mtime))
	files := []pyjson.Value{}
	for _, f := range s.FilesWritten {
		files = append(files, f)
	}
	o.Set("files_written", files)
	if s.Tokens == nil {
		o.Set("tokens", nil)
	} else {
		o.Set("tokens", s.Tokens.Value())
	}
	arts := []pyjson.Value{}
	for _, a := range s.Artifacts {
		ao := pyjson.NewObject()
		ao.Set("url", a.URL)
		opt := func(p *string) pyjson.Value {
			if p == nil {
				return nil
			}
			return *p
		}
		ao.Set("title", opt(a.Title))
		ao.Set("artifact_id", opt(a.ArtifactID))
		ao.Set("ts", a.TS)
		arts = append(arts, ao)
	}
	o.Set("artifacts", arts)
	return o
}

func loadParsersGolden(t *testing.T) *pyjson.Object {
	t.Helper()
	var raw []byte
	testkit.Golden(t, "parsers", &raw)
	v, err := pyjson.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	return v.(*pyjson.Object)
}

// corpusPath maps a golden key ("logs/...", "fixtures/...") into the copied corpus.
func corpusPath(logs, fixtures, key string) string {
	if rest, ok := strings.CutPrefix(key, "logs/"); ok {
		return filepath.Join(logs, filepath.FromSlash(rest))
	}
	if key == "fixtures" {
		return fixtures
	}
	return filepath.Join(fixtures, filepath.FromSlash(strings.TrimPrefix(key, "fixtures/")))
}

func isError(v pyjson.Value) bool {
	o, ok := v.(*pyjson.Object)
	if !ok {
		return false
	}
	_, has := o.Get("error")
	return has
}

func number(v pyjson.Value) float64 {
	switch x := v.(type) {
	case pyjson.Float:
		return float64(x)
	case pyjson.Int:
		return float64(x)
	}
	panic("not a number")
}

// parsers.json → files: parse_file of every corpus file. The whole corpus is copied so a parent log
// sees its subagents, and every subagent transcript on its own must give no session. The divergent
// files print exactly one warning each; nothing else prints any.
func TestParsersGoldenFiles(t *testing.T) {
	g := loadParsersGolden(t)
	files := mustGet(g, "files").(*pyjson.Object)
	logs := testkit.CopyCorpus(t, ".")
	fixtures := testkit.CopyCorpus(t, "../fixtures")
	n := 0
	for _, key := range files.Keys() {
		want := mustGet(mustGet(files, key).(*pyjson.Object), "claude-code")
		p := corpusPath(logs, fixtures, key)
		env, buf := newEnv(hostGOOS())
		got, err := ParseFile(p, env)
		if err != nil {
			t.Errorf("%s: %v", key, err)
			continue
		}
		divergent := strings.HasPrefix(key, "logs/divergent/")
		wantWarnings := 0
		if divergent {
			wantWarnings = 1
		}
		if w := warnLines(buf); len(w) != wantWarnings {
			t.Errorf("%s: warnings %q, want %d", key, w, wantWarnings)
		}
		if strings.Contains(key, "/subagents/") && got != nil {
			t.Errorf("%s: a subagent transcript parsed as a session", key)
		}
		if isError(want) {
			// Python raised; TestD* assert what Go does instead.
			if !divergent {
				t.Errorf("%s: Python raised outside logs/divergent/", key)
			}
			continue
		}
		if !pyjson.Equal(rawDict(got), want) {
			t.Errorf("%s:\n got %s\nwant %s", key, pyjson.Dumps(rawDict(got), pyjson.Unicode()), pyjson.Dumps(want, pyjson.Unicode()))
		}
		n++
	}
	if n < 150 {
		t.Errorf("only %d files compared", n)
	}
}

// parsers.json → iter: iter_sessions per corpus unit, unfiltered and with three `since` values, under
// every path flavour the host's paths can be read in.
func TestParsersGoldenIter(t *testing.T) {
	for _, goos := range flavours() {
		t.Run(goos, func(t *testing.T) { goldenIter(t, goos) })
	}
}

func goldenIter(t *testing.T, goos string) {
	g := loadParsersGolden(t)
	iters := mustGet(g, "iter").(*pyjson.Object)
	logs := testkit.CopyCorpus(t, ".")
	fixtures := testkit.CopyCorpus(t, "../fixtures")
	for _, unit := range iters.Keys() {
		entry := mustGet(mustGet(iters, unit).(*pyjson.Object), "claude-code").(*pyjson.Object)
		root := corpusPath(logs, fixtures, mustGet(entry, "root").(string))
		divergent := strings.HasPrefix(unit, "logs/divergent/")
		for _, variant := range entry.Keys() {
			if variant == "root" {
				continue
			}
			want := mustGet(entry, variant)
			var since *float64
			if variant != "all" && !isError(want) {
				since = f64(number(mustGet(want.(*pyjson.Object), "since")))
			} else if variant != "all" {
				// Python raised: the since value is the unit's own (every divergent unit is one file),
				// so take it from the matching non-error variant's sibling.
				since = divergentSince(t, entry)
			}
			env, buf := newEnv(goos)
			found := iterAll(t, root, since, env)
			wantWarnings := 0
			if divergent && (isError(want) || len(found) > 0) {
				wantWarnings = 1
			}
			if w := warnLines(buf); len(w) != wantWarnings {
				t.Errorf("%s %s: warnings %q, want %d", unit, variant, w, wantWarnings)
			}
			if isError(want) {
				if !divergent {
					t.Errorf("%s %s: Python raised outside logs/divergent/", unit, variant)
				}
				continue
			}
			var got pyjson.Value
			if variant == "all" {
				list := []pyjson.Value{}
				for _, s := range found {
					list = append(list, rawDict(s))
				}
				got = list
				want = want.([]pyjson.Value)
			} else {
				list := []pyjson.Value{}
				for _, id := range ids(found) {
					list = append(list, id)
				}
				got = list
				want = mustGet(want.(*pyjson.Object), "session_ids")
			}
			if !pyjson.Equal(got, want) {
				t.Errorf("%s %s:\n got %s\nwant %s", unit, variant, pyjson.Dumps(got, pyjson.Unicode()), pyjson.Dumps(want, pyjson.Unicode()))
			}
		}
	}
}

// divergentSince is the `since` gen_golden.py used for a variant that raised: since_min and since_max
// are the unit's one file mtime (read from since_after_max - 1, which never raises).
func divergentSince(t *testing.T, entry *pyjson.Object) *float64 {
	t.Helper()
	after := mustGet(entry, "since_after_max")
	if isError(after) {
		t.Fatalf("since_after_max raised too")
	}
	v := number(mustGet(after.(*pyjson.Object), "since")) - 1
	return &v
}

// hostGOOS is the flavour the goldens are compared under: the host's own, since a log tree's paths
// carry the host's separators. The goldens were written on POSIX; under the Windows flavour the
// corpus sorts the same (no unit holds two Claude logs that only case or a '-' vs '/' would order).
func hostGOOS() string {
	if filepath.Separator == '\\' {
		return "windows"
	}
	return "darwin"
}

// flavours are the GOOS values whose path flavour can read this host's paths: both on POSIX (a
// Windows path flavour also splits on "/"), only Windows on Windows.
func flavours() []string {
	if filepath.Separator == '\\' {
		return []string{"windows"}
	}
	return []string{"darwin", "windows"}
}
