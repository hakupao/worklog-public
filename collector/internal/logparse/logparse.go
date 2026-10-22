// Package logparse holds what the two log parsers (internal/claudecode, internal/codex) share: Python
// value semantics on decoded JSON, the once-per-file warnings of spec §6, CPython's UTF-8 decode
// errors, the JSONL record reader and the rglob walk.
//
// Every warning goes out at most once per (file, row) through env.Warnf, in these words:
//   - D1  `worklog: skipped unreadable log {path} ({err})`, err being Python's UnicodeDecodeError text
//     or the OS error;
//   - D3  `worklog: {path}: timestamps with and without a UTC offset are mixed; the ones without are taken as UTC`;
//   - D4  `worklog: {path}: token count {json} is not an integer; counted as 0`;
//   - D11 `worklog: {path}: dropped a record whose timestamp cannot be read ({err})` (D15 too);
//   - D12 `worklog: {path}: dropped a record whose timestamp is not a string ({json})`;
//   - D17 `worklog: {path}: ignored a part of a record the parser cannot read ({reason})`.
package logparse

import (
	"io"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
)

// ---- Python values -----------------------------------------------------------------------------

// Get is dict.get on a decoded JSON object; a nil object (Python's `or {}`) has nothing.
func Get(o *pyjson.Object, k string) pyjson.Value {
	if o == nil {
		return nil
	}
	v, _ := o.Get(k)
	return v
}

// Obj is v when it is a JSON object (isinstance(v, dict)), else nil.
func Obj(v pyjson.Value) *pyjson.Object {
	o, _ := v.(*pyjson.Object)
	return o
}

// Truthy is bool(v).
func Truthy(v pyjson.Value) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case pyjson.Int:
		return x != 0
	case pyjson.BigInt:
		return pyjson.Truthy(x)
	case pyjson.Float:
		return x != 0
	case string:
		return x != ""
	case []pyjson.Value:
		return len(x) > 0
	case *pyjson.Object:
		return x != nil && x.Len() > 0
	}
	return true
}

// HashKey is v as a dict key or set member: equal Python values (1, 1.0, True) get equal keys. A
// list or object is unhashable (Python raises TypeError); false is returned for it.
func HashKey(v pyjson.Value) (string, bool) {
	switch x := v.(type) {
	case nil:
		return "none", true
	case bool:
		if x {
			return "n:1", true
		}
		return "n:0", true
	case pyjson.Int:
		return "n:" + strconv.FormatInt(int64(x), 10), true
	case pyjson.BigInt:
		return "n:" + string(x), true
	case pyjson.Float:
		f := float64(x)
		if math.Trunc(f) == f && math.Abs(f) < 1<<63 {
			return "n:" + strconv.FormatInt(int64(f), 10), true
		}
		if math.Trunc(f) == f && !math.IsInf(f, 0) { // equal to the BigInt of its exact value
			n, _ := big.NewFloat(f).Int(nil)
			return "n:" + n.String(), true
		}
		return "f:" + pytime.FloatRepr(f), true
	case string:
		return "s:" + x, true
	}
	return "", false
}

// ---- warnings ----------------------------------------------------------------------------------

// Warner reports each spec §6 row at most once per file.
type Warner struct {
	env  *rt.Env
	done map[[2]string]bool
}

func NewWarner(env *rt.Env) *Warner { return &Warner{env: env, done: map[[2]string]bool{}} }

// Once prints the warning unless row was already reported for path.
func (w *Warner) Once(path, row, format string, a ...any) {
	k := [2]string{path, row}
	if w.done[k] {
		return
	}
	w.done[k] = true
	w.env.Warnf(format, a...)
}

// ShapeError reports spec §6 D17: a record part whose shape makes Python's parser raise (or keep a
// value nothing later can use). The caller ignores that part.
func (w *Warner) ShapeError(path, reason string) {
	w.Once(path, "D17", "worklog: %s: ignored a part of a record the parser cannot read (%s)", path, reason)
}

// Unreadable reports D1: the file is skipped.
func (w *Warner) Unreadable(path, reason string) {
	w.Once(path, "D1", "worklog: skipped unreadable log %s (%s)", path, reason)
}

// MixedOffsets reports D3: the session's naive timestamps are taken as UTC (pytime.Instant.Before
// already compares them so).
func (w *Warner) MixedOffsets(path string) {
	w.Once(path, "D3", "worklog: %s: timestamps with and without a UTC offset are mixed; the ones without are taken as UTC", path)
}

// ToInt is int(v or 0) on a token count; a value int() rejects counts 0 (D4).
func (w *Warner) ToInt(v pyjson.Value, path string) int64 {
	n, ok := session.ToInt(v)
	if !ok {
		w.Once(path, "D4", "worklog: %s: token count %s is not an integer; counted as 0", path, pyjson.Dumps(v, pyjson.Unicode()))
		return 0
	}
	return n
}

// Timestamp is a message record's timestamp: ok false when the record is dropped. A falsy one is
// dropped silently (`if not timestamp: continue`); a non-string (D12) or unparseable (D11, D15) one
// with a warning.
func (w *Warner) Timestamp(v pyjson.Value, path string) (pytime.Instant, bool) {
	if !Truthy(v) {
		return pytime.Instant{}, false
	}
	s, ok := v.(string)
	if !ok {
		w.Once(path, "D12", "worklog: %s: dropped a record whose timestamp is not a string (%s)", path, pyjson.Dumps(v, pyjson.Unicode()))
		return pytime.Instant{}, false
	}
	return w.ParseTS(s, path)
}

// ParseTS is _parse_timestamp on a string: ok false (D11, D15 included) when fromisoformat rejects it.
func (w *Warner) ParseTS(s, path string) (pytime.Instant, bool) {
	t, err := pytime.FromISO(s)
	if err != nil {
		w.Once(path, "D11", "worklog: %s: dropped a record whose timestamp cannot be read (%s)", path, err)
		return pytime.Instant{}, false
	}
	return t, true
}

// Mixed tells whether ms holds timestamps both with and without a UTC offset (D3).
func Mixed(ms []session.Message) bool {
	var aware, naive bool
	for _, m := range ms {
		if m.TS.Aware {
			aware = true
		} else {
			naive = true
		}
	}
	return aware && naive
}

// ---- reading -----------------------------------------------------------------------------------

// UTF8Scan decodes b as Python's UTF-8 decoder does: valid is how many bytes decode, and err is the
// UnicodeDecodeError text ("" when there is none). Unless final, an incomplete but so far valid
// sequence at the end is not an error: it is left over (b[valid:]) for the next chunk, as the
// incremental decoder keeps it. Positions are byte offsets into b.
func UTF8Scan(b []byte, final bool) (valid int, err string) {
	for i := 0; i < len(b); {
		c := b[i]
		if c < 0x80 {
			i++
			continue
		}
		// The continuation bytes allowed after c: the second byte's range, then 80..BF.
		lo, hi, need := byte(0x80), byte(0xbf), 0
		switch {
		case c >= 0xc2 && c <= 0xdf:
			need = 1
		case c == 0xe0:
			lo, need = 0xa0, 2
		case c == 0xed:
			hi, need = 0x9f, 2
		case c >= 0xe1 && c <= 0xef:
			need = 2
		case c == 0xf0:
			lo, need = 0x90, 3
		case c >= 0xf1 && c <= 0xf3:
			need = 3
		case c == 0xf4:
			hi, need = 0x8f, 3
		default:
			return i, decodeErr(b[i], i, i, "invalid start byte")
		}
		for k := 0; k < need; k++ {
			j := i + 1 + k
			if j >= len(b) {
				if !final {
					return i, ""
				}
				return i, decodeErr(b[i], i, len(b)-1, "unexpected end of data")
			}
			l, h := byte(0x80), byte(0xbf)
			if k == 0 {
				l, h = lo, hi
			}
			if b[j] < l || b[j] > h {
				return i, decodeErr(b[i], i, i+k, "invalid continuation byte")
			}
		}
		i += 1 + need
	}
	return len(b), ""
}

// UTF8Error is the text of the UnicodeDecodeError that bytes.decode("utf-8") raises on b ("" when b
// is valid).
func UTF8Error(b []byte) string {
	if utf8.Valid(b) { // the same bytes Python accepts, checked word by word
		return ""
	}
	_, err := UTF8Scan(b, true)
	return err
}

func decodeErr(first byte, start, end int, reason string) string {
	if start == end {
		return "'utf-8' codec can't decode byte 0x" + strconv.FormatUint(uint64(first)|0x100, 16)[1:] +
			" in position " + strconv.Itoa(start) + ": " + reason
	}
	return "'utf-8' codec can't decode bytes in position " + strconv.Itoa(start) + "-" + strconv.Itoa(end) + ": " + reason
}

// readBufs holds the buffers logs are read into. A harvest reads every log, gigabytes in all, and a
// fresh buffer per file made the runtime fault in and give back that much memory again and again
// (on the Mac, madvise took a quarter of the run). Nothing decoded from a log points into its buffer.
var readBufs = sync.Pool{New: func() any { return new([]byte) }}

// maxPooled is the largest buffer kept for the next log; a bigger one is left to the GC, so one huge
// log does not pin its size in memory for the rest of the run.
const maxPooled = 64 << 20

// readFile is os.ReadFile into buf, which grows as needed and is returned even on an error.
func readFile(path string, buf []byte) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return buf, err
	}
	defer f.Close()
	if fi, err := f.Stat(); err == nil && int(fi.Size()) >= cap(buf) {
		buf = make([]byte, 0, int(fi.Size())+512)
	}
	for {
		if len(buf) == cap(buf) {
			buf = append(buf, 0)[:len(buf)]
		}
		n, err := f.Read(buf[len(buf):cap(buf)])
		buf = buf[:len(buf)+n]
		if err == io.EOF {
			return buf, nil
		}
		if err != nil {
			return buf, err
		}
	}
}

// Records is both parsers' _records: path.read_text(encoding="utf-8").splitlines(), each line
// stripped, the ones that parse as JSON objects. read_text's universal newlines are not applied
// first: str.splitlines() already breaks on "\r\n" and "\r", so the lines are the same. ok is false
// when the file cannot be read or is not UTF-8 (D1), after one warning.
func Records(path string, w *Warner) ([]*pyjson.Object, bool) {
	buf := readBufs.Get().(*[]byte)
	data, err := readFile(path, (*buf)[:0])
	if cap(data) <= maxPooled {
		*buf = data
		defer readBufs.Put(buf)
	}
	if err != nil {
		w.Unreadable(path, err.Error())
		return nil, false
	}
	if e := UTF8Error(data); e != "" {
		w.Unreadable(path, e)
		return nil, false
	}
	var out []*pyjson.Object
	for _, line := range pystr.SplitLines(data) {
		line = pystr.StripBytes(line)
		if len(line) == 0 {
			continue
		}
		v, err := pyjson.Decode(line)
		if err != nil {
			continue
		}
		if o := Obj(v); o != nil {
			out = append(out, o)
		}
	}
	return out, true
}

// IsJSONL is the "*.jsonl" glob on one name; Windows matches it case-insensitively.
func IsJSONL(name string, f pypath.Flavour) bool {
	if f == pypath.Windows {
		name = strings.ToLower(name)
	}
	return strings.HasSuffix(name, ".jsonl")
}

// Found is one rglob match: its path and its components below the walk's root.
type Found struct {
	Path string
	Rel  []string
}

// Rglob is Path.rglob("*.jsonl") (unsorted): the root is opened as given, but no symlinked directory
// below it is entered (recurse_symlinks=False). A directory that cannot be listed is skipped.
func Rglob(root string, f pypath.Flavour) []Found {
	var out []Found
	var walk func(dir string, rel []string)
	walk = func(dir string, rel []string) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			p := filepath.Join(dir, e.Name())
			r := append(append([]string(nil), rel...), e.Name())
			if IsJSONL(e.Name(), f) {
				out = append(out, Found{p, r})
			}
			if e.IsDir() {
				walk(p, r)
			}
		}
	}
	walk(root, nil)
	return out
}
