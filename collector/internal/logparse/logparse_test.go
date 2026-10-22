package logparse

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
)

func newEnv() (*rt.Env, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	return &rt.Env{Stdout: io.Discard, Stderr: buf, Now: func() time.Time { return time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC) }, Getenv: func(string) string { return "" }, GOOS: "darwin"}, buf
}

func lines(buf *bytes.Buffer) []string {
	if buf.Len() == 0 {
		return nil
	}
	return strings.Split(strings.TrimSuffix(buf.String(), "\n"), "\n")
}

func decode(t *testing.T, s string) pyjson.Value {
	t.Helper()
	v, err := pyjson.Decode([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// Moved from internal/claudecode (Task 7 fix round 1); each text checked against CPython.
func TestUTF8ErrorTextIsPythons(t *testing.T) {
	for _, c := range []struct {
		in   string
		want string
	}{
		{"ab\xffc", "'utf-8' codec can't decode byte 0xff in position 2: invalid start byte"},
		{"\xc3\x28", "'utf-8' codec can't decode byte 0xc3 in position 0: invalid continuation byte"},
		{"x\xe3\x81\x28", "'utf-8' codec can't decode bytes in position 1-2: invalid continuation byte"},
		{"x\xe3\x81", "'utf-8' codec can't decode bytes in position 1-2: unexpected end of data"},
		{"\xe3", "'utf-8' codec can't decode byte 0xe3 in position 0: unexpected end of data"},
		{"\xed\xa0\x80", "'utf-8' codec can't decode byte 0xed in position 0: invalid continuation byte"},
		{"\xf4\x90\x80\x80", "'utf-8' codec can't decode byte 0xf4 in position 0: invalid continuation byte"},
		{"\xc0\xaf", "'utf-8' codec can't decode byte 0xc0 in position 0: invalid start byte"},
		{"\xf0\x9f\x98", "'utf-8' codec can't decode bytes in position 0-2: unexpected end of data"},
	} {
		if got := UTF8Error([]byte(c.in)); got != c.want {
			t.Errorf("%q: %q, want %q", c.in, got, c.want)
		}
	}
	if got := UTF8Error([]byte("ok ✓")); got != "" {
		t.Errorf("valid input: %q", got)
	}
}

// Not final: a sequence cut by the end of the chunk is held back, not an error; a bad one still is.
func TestUTF8ScanHoldsBackAnIncompleteTail(t *testing.T) {
	for _, c := range []struct {
		in    string
		valid int
		err   string
	}{
		{"ok", 2, ""},
		{"ab\xe3\x81", 2, ""},
		{"ab\xf0", 2, ""},
		{"ab\xe3\x28", 2, "'utf-8' codec can't decode byte 0xe3 in position 2: invalid continuation byte"},
		{"\xff", 0, "'utf-8' codec can't decode byte 0xff in position 0: invalid start byte"},
	} {
		valid, err := UTF8Scan([]byte(c.in), false)
		if valid != c.valid || err != c.err {
			t.Errorf("%q: %d %q, want %d %q", c.in, valid, err, c.valid, c.err)
		}
	}
}

func TestTruthyAndHashKeyArePythons(t *testing.T) {
	for _, c := range []struct {
		json   string
		truthy bool
	}{
		{`null`, false}, {`false`, false}, {`0`, false}, {`0.0`, false}, {`""`, false}, {`[]`, false}, {`{}`, false},
		{`true`, true}, {`-1`, true}, {`0.5`, true}, {`"0"`, true}, {`[0]`, true}, {`{"a": null}`, true},
	} {
		if got := Truthy(decode(t, c.json)); got != c.truthy {
			t.Errorf("Truthy(%s) = %v", c.json, got)
		}
	}
	key := func(s string) string {
		k, ok := HashKey(decode(t, s))
		if !ok {
			t.Fatalf("HashKey(%s) unhashable", s)
		}
		return k
	}
	if key(`1`) != key(`1.0`) || key(`1`) != key(`true`) || key(`0`) != key(`false`) {
		t.Error("1, 1.0 and true must be one key, as 0 and false")
	}
	if key(`"1"`) == key(`1`) || key(`1.5`) == key(`1`) || key(`null`) == key(`""`) {
		t.Error("distinct Python values share a key")
	}
	// An int beyond int64 is hashable and equals the float of the same exact value (2**64 ==
	// float(2**64)); 12345678901234567890 is not 1.2345678901234567e19.
	if !Truthy(decode(t, `12345678901234567890`)) || key(`18446744073709551616`) != key(`1.8446744073709552e19`) ||
		key(`12345678901234567890`) == key(`1.2345678901234567e19`) || key(`-18446744073709551616`) != key(`-1.8446744073709552e19`) {
		t.Error("big ints")
	}
	for _, s := range []string{`[1]`, `{}`} {
		if _, ok := HashKey(decode(t, s)); ok {
			t.Errorf("HashKey(%s) should be unhashable", s)
		}
	}
	if Get(nil, "x") != nil || Obj(decode(t, `[1]`)) != nil || Obj(decode(t, `{}`)) == nil {
		t.Error("Get/Obj")
	}
}

// Each row warns once per (file, row); another file or another row warns again.
func TestWarnerReportsEachRowOncePerFile(t *testing.T) {
	env, buf := newEnv()
	w := NewWarner(env)
	w.ShapeError("a", "one")
	w.ShapeError("a", "two")
	w.ShapeError("b", "one")
	w.Unreadable("a", "e")
	w.MixedOffsets("a")
	w.MixedOffsets("a")
	if n := w.ToInt(decode(t, `"1.5"`), "a"); n != 0 {
		t.Errorf("ToInt = %d", n)
	}
	if n := w.ToInt(decode(t, `2.7`), "a"); n != 2 {
		t.Errorf("ToInt = %d", n)
	}
	if _, ok := w.Timestamp(decode(t, `""`), "a"); ok {
		t.Error("a falsy timestamp is dropped")
	}
	if _, ok := w.Timestamp(decode(t, `5`), "a"); ok {
		t.Error("D12")
	}
	if _, ok := w.Timestamp(decode(t, `"yesterday"`), "a"); ok {
		t.Error("D11")
	}
	if ts, ok := w.Timestamp(decode(t, `"2026-09-18T09:00:00Z"`), "a"); !ok || ts.ISOFormat() != "2026-09-18T09:00:00+00:00" {
		t.Errorf("ts %v %v", ts, ok)
	}
	want := []string{
		"worklog: a: ignored a part of a record the parser cannot read (one)",
		"worklog: b: ignored a part of a record the parser cannot read (one)",
		"worklog: skipped unreadable log a (e)",
		"worklog: a: timestamps with and without a UTC offset are mixed; the ones without are taken as UTC",
		`worklog: a: token count "1.5" is not an integer; counted as 0`,
		"worklog: a: dropped a record whose timestamp is not a string (5)",
	}
	got := lines(buf)
	if len(got) != len(want)+1 || !reflect.DeepEqual(got[:len(want)], want) ||
		!strings.HasPrefix(got[len(want)], "worklog: a: dropped a record whose timestamp cannot be read (") {
		t.Errorf("got %q\nwant %q + D11", got, want)
	}
}

func TestMixed(t *testing.T) {
	env, _ := newEnv()
	w := NewWarner(env)
	a, _ := w.ParseTS("2026-09-18T09:00:00Z", "x")
	n, _ := w.ParseTS("2026-09-18T09:00:00", "x")
	if Mixed([]session.Message{{TS: a}, {TS: a}}) || Mixed([]session.Message{{TS: n}}) || !Mixed([]session.Message{{TS: a}, {TS: n}}) {
		t.Error("Mixed")
	}
}

// Records: splitlines (all of Python's line breaks, "\r\n" one break), strip, JSON objects only; a
// file that is not UTF-8 or cannot be read is one D1 warning.
func TestRecordsReadLikePythonsRecords(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "r.jsonl")
	data := "{\"a\": 1}\r\n  {\"b\": 2}　\r[3]\n\nnot json\n{\"c\": \"x y\"}\x0b{\"d\": 4}\n{\"e\": 5}"
	if err := os.WriteFile(p, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	env, buf := newEnv()
	recs, ok := Records(p, NewWarner(env))
	var keys []string
	for _, r := range recs {
		keys = append(keys, r.Keys()...)
	}
	if !ok || !reflect.DeepEqual(keys, []string{"a", "b", "d", "e"}) || buf.Len() != 0 {
		t.Errorf("ok %v keys %q warnings %q", ok, keys, buf.String())
	}

	bad := filepath.Join(dir, "bad.jsonl")
	if err := os.WriteFile(bad, []byte("{}\n\xff\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	w := NewWarner(env)
	if _, ok := Records(bad, w); ok {
		t.Error("bad UTF-8 read")
	}
	Records(bad, w)
	if _, ok := Records(filepath.Join(dir, "missing.jsonl"), w); ok {
		t.Error("missing file read")
	}
	if got := lines(buf); len(got) != 2 || got[0] != "worklog: skipped unreadable log "+bad+" ('utf-8' codec can't decode byte 0xff in position 3: invalid start byte)" {
		t.Errorf("warnings %q", got)
	}
}

// Records holds each log byte in memory about twice at most: the file as read, and the decoded
// string values. Copying the file into a string, every line into a []byte, and every string value
// through a growing buffer made a 4 GB harvest allocate several times its size, and on the Mac
// the runtime's page churn (madvise) and the GC took more time than the parse (Task 13 timing).
func TestRecordsDoesNotCopyTheFileOverAndOver(t *testing.T) {
	p := filepath.Join(t.TempDir(), "big.jsonl")
	var b strings.Builder
	for i := range 2000 {
		b.WriteString(`{"type": "assistant", "n": ` + strconv.Itoa(i) + `, "text": "` + strings.Repeat("x", 2000) + `", "out": "` + strings.Repeat(`a\n\"b\u00e9`, 200) + `"}` + "\n")
	}
	size := b.Len()
	if err := os.WriteFile(p, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	env, _ := newEnv()
	w := NewWarner(env)
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	recs, ok := Records(p, w)
	runtime.ReadMemStats(&after)
	if !ok || len(recs) != 2000 {
		t.Fatalf("ok %v records %d", ok, len(recs))
	}
	if got := after.TotalAlloc - before.TotalAlloc; got > uint64(size)*5/2 {
		t.Errorf("Records allocated %d bytes for a %d-byte log (%.1fx), want at most 2.5x", got, size, float64(got)/float64(size))
	}
}

// Rglob finds *.jsonl (case-insensitively under the Windows flavour), directories named so too, with
// their components below the root, and does not enter a symlinked directory.
func TestRglob(t *testing.T) {
	root := t.TempDir()
	for _, p := range []string{"a.jsonl", "d/b.jsonl", "d/e/C.JSONL", "d/x.txt"} {
		full := filepath.Join(root, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "dir.jsonl"), 0o755); err != nil {
		t.Fatal(err)
	}
	linked := os.Symlink(filepath.Join(root, "d"), filepath.Join(root, "link")) == nil
	rels := func(f pypath.Flavour) []string {
		var out []string
		for _, x := range Rglob(root, f) {
			out = append(out, strings.Join(x.Rel, "/"))
			if x.Path != filepath.Join(append([]string{root}, x.Rel...)...) {
				t.Errorf("path %s rel %q", x.Path, x.Rel)
			}
		}
		sort.Strings(out)
		return out
	}
	if got := rels(pypath.Posix); !reflect.DeepEqual(got, []string{"a.jsonl", "d/b.jsonl", "dir.jsonl"}) {
		t.Errorf("posix %q (symlink made: %v)", got, linked)
	}
	if got := rels(pypath.Windows); !reflect.DeepEqual(got, []string{"a.jsonl", "d/b.jsonl", "d/e/C.JSONL", "dir.jsonl"}) {
		t.Errorf("windows %q", got)
	}
}
