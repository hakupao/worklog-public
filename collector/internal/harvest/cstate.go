package harvest

import (
	"maps"
	"math"
	"os"
	"path/filepath"
	"slices"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
)

// FileKind says what a log file turned out to be (spec §5.4).
type FileKind string

const (
	KindSession  FileKind = "session"
	KindNone     FileKind = "none"
	KindExcluded FileKind = "excluded"
)

// FileEntry is one log file in the path index.
type FileEntry struct {
	Key         string
	Kind        FileKind
	Mtime, Seen float64
}

// SummaryEntry is one session's cached summary (spec §5.2). BM is the harvest_state bookmark Go last
// wrote for the key; nil means none existed.
type SummaryEntry struct {
	Summary, Source string // Source: "llm" | "fallback"
	PFP, CurPFP     string
	At, Tried       float64 // epoch s; At == 0 means due now
	Tries           int
	LastMsg         *float64 // EndedAt as epoch s (naive read as UTC)
	Path            string
	Seen            float64
	BM              *Bookmark
}

// CollectorState is <Home>/collector_state.json. Python never reads it.
type CollectorState struct {
	Jobs     map[string]string
	Files    map[string]FileEntry
	Sessions map[string]SummaryEntry
}

const collectorStateVersion = 1

// sessionKeepDays is how long a session entry survives without being seen (spec §5.4).
const sessionKeepDays = 15

func emptyCollectorState() *CollectorState {
	return &CollectorState{Jobs: map[string]string{}, Files: map[string]FileEntry{}, Sessions: map[string]SummaryEntry{}}
}

func fstr(o *pyjson.Object, k string) string {
	v, _ := o.Get(k)
	s, _ := v.(string)
	return s
}

func fnum(o *pyjson.Object, k string) float64 {
	v, _ := o.Get(k)
	if f := number(v); !math.IsNaN(f) {
		return f
	}
	return 0
}

// LoadCollectorState reads the file. A missing, unreadable, non-UTF-8, unparseable, non-object or
// unknown-version file is an empty state, never a panic; a malformed entry is dropped.
func LoadCollectorState(path string) *CollectorState {
	s := emptyCollectorState()
	b, err := os.ReadFile(path)
	if err != nil || !utf8.Valid(b) {
		return s
	}
	v, err := pyjson.Decode(b)
	root, ok := v.(*pyjson.Object)
	if err != nil || !ok {
		return s
	}
	if ver, _ := root.Get("version"); ver != pyjson.Int(collectorStateVersion) {
		return s
	}
	if jv, _ := root.Get("jobs"); jv != nil {
		if jo, ok := jv.(*pyjson.Object); ok {
			for _, k := range jo.Keys() {
				if x, ok := jo.Get(k); ok {
					if js, ok := x.(string); ok {
						s.Jobs[k] = js
					}
				}
			}
		}
	}
	each(root, "files", func(k string, e *pyjson.Object) {
		s.Files[k] = FileEntry{Key: fstr(e, "key"), Kind: FileKind(fstr(e, "kind")), Mtime: fnum(e, "mtime"), Seen: fnum(e, "seen")}
	})
	each(root, "sessions", func(k string, e *pyjson.Object) {
		se := SummaryEntry{
			Summary: fstr(e, "summary"), Source: fstr(e, "source"), PFP: fstr(e, "pfp"), CurPFP: fstr(e, "cur_pfp"),
			At: fnum(e, "at"), Tried: fnum(e, "tried"), Tries: int(fnum(e, "tries")), Path: fstr(e, "path"), Seen: fnum(e, "seen"),
		}
		if lm, _ := e.Get("last_msg"); lm != nil {
			if f := number(lm); !math.IsNaN(f) {
				se.LastMsg = &f
			}
		}
		if bv, _ := e.Get("bm"); bv != nil {
			if bo, ok := bv.(*pyjson.Object); ok {
				m, _ := bo.Get("mtime")
				bm := Bookmark{Mtime: number(m)}
				if f, ok := bo.Get("fp"); ok {
					if fs, ok := f.(string); ok {
						bm.FP = &fs
					}
				}
				se.BM = &bm
			}
		}
		s.Sessions[k] = se
	})
	return s
}

// each calls f for every object-valued member of root[section].
func each(root *pyjson.Object, section string, f func(k string, e *pyjson.Object)) {
	sv, _ := root.Get(section)
	so, ok := sv.(*pyjson.Object)
	if !ok {
		return
	}
	for _, k := range so.Keys() {
		x, _ := so.Get(k)
		if e, ok := x.(*pyjson.Object); ok {
			f(k, e)
		}
	}
}

func flt(f float64) pyjson.Value {
	if math.IsNaN(f) {
		return nil
	}
	return pyjson.Float(f)
}

// SaveCollectorState writes a temporary file in the same directory and renames it over path
// (replaceFile, with its Windows retry), as SaveState does. Keys are written in sorted order.
func SaveCollectorState(path string, s *CollectorState) error {
	root := pyjson.NewObject()
	root.Set("version", pyjson.Int(collectorStateVersion))
	jobs := pyjson.NewObject()
	for _, k := range slices.Sorted(maps.Keys(s.Jobs)) {
		jobs.Set(k, s.Jobs[k])
	}
	root.Set("jobs", jobs)
	files := pyjson.NewObject()
	for _, k := range slices.Sorted(maps.Keys(s.Files)) {
		f := s.Files[k]
		e := pyjson.NewObject()
		e.Set("key", f.Key)
		e.Set("kind", string(f.Kind))
		e.Set("mtime", flt(f.Mtime))
		e.Set("seen", flt(f.Seen))
		files.Set(k, e)
	}
	root.Set("files", files)
	sessions := pyjson.NewObject()
	for _, k := range slices.Sorted(maps.Keys(s.Sessions)) {
		se := s.Sessions[k]
		e := pyjson.NewObject()
		e.Set("summary", se.Summary)
		e.Set("source", se.Source)
		e.Set("pfp", se.PFP)
		e.Set("cur_pfp", se.CurPFP)
		e.Set("at", flt(se.At))
		e.Set("tried", flt(se.Tried))
		e.Set("tries", pyjson.Int(se.Tries))
		if se.LastMsg != nil {
			e.Set("last_msg", flt(*se.LastMsg))
		} else {
			e.Set("last_msg", nil)
		}
		e.Set("path", se.Path)
		e.Set("seen", flt(se.Seen))
		if se.BM != nil {
			bm := pyjson.NewObject()
			bm.Set("mtime", flt(se.BM.Mtime))
			if se.BM.FP != nil {
				bm.Set("fp", *se.BM.FP)
			}
			e.Set("bm", bm)
		} else {
			e.Set("bm", nil)
		}
		sessions.Set(k, e)
	}
	root.Set("sessions", sessions)

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".collector_state-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	werr := f.Chmod(0o644)
	if werr == nil {
		_, werr = f.Write(pyjson.Dumps(root, pyjson.Default()))
	}
	if werr == nil {
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

// Valid returns the cache entry for key only while hs[key] equals entry.BM exactly; absent on both
// sides counts as equal (spec §5.2). An mtime that is NaN is never equal.
func (s *CollectorState) Valid(key string, hs map[string]Bookmark) (SummaryEntry, bool) {
	e, ok := s.Sessions[key]
	if !ok {
		return SummaryEntry{}, false
	}
	cur, has := hs[key]
	if e.BM == nil || !has {
		return e, e.BM == nil && !has
	}
	if e.BM.Mtime != cur.Mtime {
		return e, false
	}
	if (e.BM.FP == nil) != (cur.FP == nil) || (e.BM.FP != nil && *e.BM.FP != *cur.FP) {
		return e, false
	}
	return e, true
}

// Prune drops file entries whose path is gone (exists false) or whose mtime is older than sinceDays
// before now, and session entries not seen for 15 days (spec §5.4).
func (s *CollectorState) Prune(now float64, sinceDays int, exists func(string) bool) {
	cutoff := now - float64(sinceDays)*86400
	for p, f := range s.Files {
		if f.Mtime < cutoff || !exists(p) {
			delete(s.Files, p)
		}
	}
	seenCutoff := now - sessionKeepDays*86400
	for k, e := range s.Sessions {
		if e.Seen < seenCutoff {
			delete(s.Sessions, k)
		}
	}
}

// PathOf is the log path of a session: the files index first (a rollout that moved is re-indexed
// there), then the entry's own Path. With several index hits the newest mtime wins, then the
// smaller path, so the answer does not depend on map order.
func (s *CollectorState) PathOf(key string) (string, bool) {
	if key == "" {
		return "", false
	}
	best, found := "", false
	for p, f := range s.Files {
		if f.Key != key || f.Kind != KindSession {
			continue
		}
		if !found || f.Mtime > s.Files[best].Mtime || (f.Mtime == s.Files[best].Mtime && p < best) {
			best, found = p, true
		}
	}
	if found {
		return best, true
	}
	if e, ok := s.Sessions[key]; ok && e.Path != "" {
		return e.Path, true
	}
	return "", false
}
