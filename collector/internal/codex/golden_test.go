package codex

import (
	"path/filepath"
	"sort"
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
	if s.Artifacts == nil {
		o.Set("artifacts", nil) // Python's RawSession.artifacts is always a list: nil fails the comparison
	} else {
		o.Set("artifacts", []pyjson.Value{})
		if len(s.Artifacts) > 0 {
			o.Set("artifacts", "unexpected Codex artifacts")
		}
	}
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

// corpusPath maps a golden key ("logs/...", "fixtures", "fixtures/...") into the copied corpus.
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

// parsers.json → files: codex.parse_file of every corpus file (Claude logs included: they give no
// session). Python raised only on the D1/D2 files, where Go prints exactly one warning instead;
// nothing else prints any.
func TestParsersGoldenFiles(t *testing.T) {
	g := loadParsersGolden(t)
	files := mustGet(g, "files").(*pyjson.Object)
	logs := testkit.CopyCorpus(t, ".")
	fixtures := testkit.CopyCorpus(t, "../fixtures")
	sessions := 0
	for _, key := range files.Keys() {
		want := mustGet(mustGet(files, key).(*pyjson.Object), "codex")
		env, buf := newEnv(hostGOOS())
		got, err := ParseFile(corpusPath(logs, fixtures, key), env)
		if err != nil {
			t.Errorf("%s: %v", key, err)
			continue
		}
		wantWarnings := 0
		if isError(want) {
			wantWarnings = 1
		}
		if w := warnLines(buf); len(w) != wantWarnings {
			t.Errorf("%s: warnings %q, want %d", key, w, wantWarnings)
		}
		if isError(want) {
			if got != nil || !strings.HasPrefix(key, "logs/divergent/") {
				t.Errorf("%s: Python raised; got %v", key, got)
			}
			continue
		}
		if want != nil {
			sessions++
		}
		if !pyjson.Equal(rawDict(got), want) {
			t.Errorf("%s:\n got %s\nwant %s", key, pyjson.Dumps(rawDict(got), pyjson.Unicode()), pyjson.Dumps(want, pyjson.Unicode()))
		}
	}
	if sessions < 60 {
		t.Errorf("only %d Codex sessions compared", sessions)
	}
}

// parsers.json → iter: codex.iter_sessions per corpus unit, unfiltered and with three `since`
// values, under every path flavour the host's paths can be read in.
func TestParsersGoldenIter(t *testing.T) {
	for _, goos := range flavours() {
		t.Run(goos, func(t *testing.T) { goldenIter(t, goos) })
	}
}

// unitMtimes is gen_golden's `mt`: the sorted distinct mtimes of the unit's corpus files.
func unitMtimes(t *testing.T, unit string) []float64 {
	seen := map[float64]bool{}
	var out []float64
	for k, m := range testkit.Mtimes(t) {
		if strings.HasPrefix(k, unit+"/") {
			f := float64(m[0]) + float64(m[1])*1e-9
			if !seen[f] {
				seen[f] = true
				out = append(out, f)
			}
		}
	}
	sort.Float64s(out)
	return out
}

func goldenIter(t *testing.T, goos string) {
	g := loadParsersGolden(t)
	iters := mustGet(g, "iter").(*pyjson.Object)
	logs := testkit.CopyCorpus(t, ".")
	fixtures := testkit.CopyCorpus(t, "../fixtures")
	compared := 0
	for _, unit := range iters.Keys() {
		entry := mustGet(mustGet(iters, unit).(*pyjson.Object), "codex").(*pyjson.Object)
		root := corpusPath(logs, fixtures, mustGet(entry, "root").(string))
		mt := unitMtimes(t, unit)
		for _, variant := range entry.Keys() {
			var since *float64
			switch variant {
			case "root":
				continue
			case "all":
			case "since_min":
				since = f64(mt[0])
			case "since_max":
				since = f64(mt[len(mt)-1])
			case "since_after_max":
				since = f64(mt[len(mt)-1] + 1)
			default:
				t.Fatalf("%s: unknown variant %s", unit, variant)
			}
			want := mustGet(entry, variant)
			if o, ok := want.(*pyjson.Object); ok && since != nil && !isError(want) {
				if s := mustGet(o, "since"); !pyjson.Equal(s, pyjson.Float(*since)) {
					t.Fatalf("%s %s: since %v, golden %v", unit, variant, *since, s)
				}
			}
			env, buf := newEnv(goos)
			found := iterAll(t, root, since, env)
			wantWarnings := 0
			if isError(want) {
				wantWarnings = 1
			}
			if w := warnLines(buf); len(w) != wantWarnings {
				t.Errorf("%s %s: warnings %q, want %d", unit, variant, w, wantWarnings)
			}
			if isError(want) {
				if len(found) != 0 || !strings.HasPrefix(unit, "logs/divergent/") {
					t.Errorf("%s %s: Python raised; got %q", unit, variant, ids(found))
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
			compared++
		}
	}
	if compared < 200 {
		t.Errorf("only %d iter results compared", compared)
	}
}

// hostGOOS is the flavour the goldens are compared under: the host's own, since a log tree's paths
// carry the host's separators.
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
