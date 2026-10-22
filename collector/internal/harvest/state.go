package harvest

import (
	"maps"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
)

// Bookmark is one session's entry in harvest_state.json (run.py Bookmark). FP is nil for a bookmark
// from before fingerprints existed (a bare float in the file), for a trivial session, and for one
// whose summary fell back.
type Bookmark struct {
	Mtime float64
	FP    *string
}

// LoadState is _load_state: a missing, unreadable, unparseable or non-object file is {}; a bare
// value is upgraded to {"mtime": v}. Python keeps a malformed entry as it is and compares it with
// ==; here an mtime that is not a number reads as NaN and a fp that is not a string as absent,
// which compare unequal exactly where Python's would.
func LoadState(path string) map[string]Bookmark {
	state := map[string]Bookmark{}
	b, err := os.ReadFile(path)
	if err != nil || !utf8.Valid(b) {
		return state
	}
	v, err := pyjson.Decode(b)
	o, isObj := v.(*pyjson.Object)
	if err != nil || !isObj {
		return state
	}
	for _, k := range o.Keys() {
		e, _ := o.Get(k)
		entry, isDict := e.(*pyjson.Object)
		if !isDict {
			state[k] = Bookmark{Mtime: number(e)}
			continue
		}
		m, _ := entry.Get("mtime")
		bm := Bookmark{Mtime: number(m)}
		if f, ok := entry.Get("fp"); ok {
			if s, ok := f.(string); ok {
				bm.FP = &s
			}
		}
		state[k] = bm
	}
	return state
}

// number is a JSON number as a float64 (int == float in Python; an int beyond int64 as float(n));
// anything else is NaN. A bool would equal 0.0/1.0 in Python, which no mtime is.
func number(v pyjson.Value) float64 {
	switch x := v.(type) {
	case pyjson.Float:
		return float64(x)
	case pyjson.Int:
		return float64(x)
	case pyjson.BigInt:
		if f, err := strconv.ParseFloat(string(x), 64); err == nil {
			return f
		}
	}
	return math.NaN()
}

// SaveState is _save_state, written to a temporary file in the same directory and renamed over
// the old one (spec §6 D9), so a crash mid-write cannot leave a truncated state. The content is
// json.dumps(state): mtime in Python's float repr, fp only when set. Entries are written in key
// order; Python writes insertion order, and spec §5.2 compares the key set only.
func SaveState(path string, s map[string]Bookmark) error {
	o := pyjson.NewObject()
	for _, k := range slices.Sorted(maps.Keys(s)) {
		b := s[k]
		e := pyjson.NewObject()
		if math.IsNaN(b.Mtime) {
			e.Set("mtime", nil)
		} else {
			e.Set("mtime", pyjson.Float(b.Mtime))
		}
		if b.FP != nil {
			e.Set("fp", *b.FP)
		}
		o.Set(k, e)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".harvest_state-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	// CreateTemp makes 0600; write_text made the file as open() does.
	werr := f.Chmod(0o644)
	if werr == nil {
		_, werr = f.Write(pyjson.Dumps(o, pyjson.Default()))
	}
	if werr == nil {
		// On disk before the rename, so a power loss leaves the old state or the new one.
		werr = f.Sync()
	}
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr == nil {
		werr = replaceFile(tmp, path)
	}
	if werr != nil {
		os.Remove(tmp)
	}
	return werr
}
