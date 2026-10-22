// Package session holds the parsed-session types and the helpers of harvest/base.py that the
// parsers, summarize and harvest share: turns, start/end, active intervals and minutes (spec §4.9),
// clean_paths (spec §4.8), and int(x or 0) on token counts (spec §5.9).
package session

import (
	"math"
	"sort"
	"strings"
	"unicode"

	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/tokens"
)

// Message is base.RawMessage; Role is "user" or "assistant".
type Message struct {
	Role, Text string
	TS         pytime.Instant
}

// RawSession is base.RawSession: one parsed log, before summarizing and linking.
type RawSession struct {
	Agent, SessionID, Cwd, Path string
	Messages                    []Message
	Mtime                       float64
	// Files the agent wrote or edited through its own file tools, as deliverable candidates.
	FilesWritten []string
	// Token usage per model (no cost yet); nil when the log recorded none.
	Tokens *tokens.Tally
	// Artifact pages the session published (Codex never has any).
	Artifacts []model.Artifact
}

// Turns is the number of user messages.
func Turns(ms []Message) int {
	n := 0
	for _, m := range ms {
		if m.Role == "user" {
			n++
		}
	}
	return n
}

// StartedAt is min(m.ts): the first of equal instants wins, keeping its own spelling.
func StartedAt(ms []Message) (pytime.Instant, bool) {
	if len(ms) == 0 {
		return pytime.Instant{}, false
	}
	best := ms[0].TS
	for _, m := range ms[1:] {
		if m.TS.Before(best) {
			best = m.TS
		}
	}
	return best, true
}

// EndedAt is max(m.ts): the first of equal instants wins.
func EndedAt(ms []Message) (pytime.Instant, bool) {
	if len(ms) == 0 {
		return pytime.Instant{}, false
	}
	best := ms[0].TS
	for _, m := range ms[1:] {
		if best.Before(m.TS) {
			best = m.TS
		}
	}
	return best, true
}

// totalSeconds is timedelta.total_seconds() of b - a: whole microseconds / 10**6.
func totalSeconds(a, b pytime.Instant) float64 {
	return float64(b.T.Sub(a.T).Microseconds()) / 1e6
}

// ActiveIntervals is base.active_intervals: messages at most gapMinutes apart (float minutes) share
// a stretch, a longer silence starts the next; a lone message is (t, t). Instants, not days. Never
// nil, so an empty session sends [] (the model writes nil as null).
func ActiveIntervals(ms []Message, gapMinutes int) []model.Interval {
	out := []model.Interval{}
	if len(ms) == 0 {
		return out
	}
	ordered := append([]Message(nil), ms...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].TS.Before(ordered[j].TS) })
	start, end := ordered[0].TS, ordered[0].TS
	for _, m := range ordered[1:] {
		if totalSeconds(end, m.TS)/60 <= float64(gapMinutes) {
			end = m.TS
			continue
		}
		out = append(out, model.Interval{start, end})
		start, end = m.TS, m.TS
	}
	return append(out, model.Interval{start, end})
}

// ActiveMinutes is int(sum(seconds of each interval) // 60), with CPython's float sum (Neumaier
// compensation since 3.12) and float floor division.
func ActiveMinutes(ms []Message, gapMinutes int) int {
	ivs := ActiveIntervals(ms, gapMinutes)
	if len(ivs) == 0 {
		return 0 // sum() of nothing is the int 0
	}
	return int(floorDiv(pySum(ivs), 60))
}

// pySum is builtin sum() over the intervals' total_seconds(), starting from the int 0.
func pySum(ivs []model.Interval) float64 {
	sum := totalSeconds(ivs[0][0], ivs[0][1])
	c := 0.0
	for _, iv := range ivs[1:] {
		x := totalSeconds(iv[0], iv[1])
		t := sum + x
		if math.Abs(sum) >= math.Abs(x) {
			c += (sum - t) + x
		} else {
			c += (x - t) + sum
		}
		sum = t
	}
	if c != 0 && !math.IsInf(c, 0) && !math.IsNaN(c) {
		sum += c
	}
	return sum
}

// floorDiv is CPython's float // (float_floor_div), which is not always math.Floor(a / b).
func floorDiv(vx, wx float64) float64 {
	mod := math.Mod(vx, wx)
	div := (vx - mod) / wx
	if mod != 0 && (wx < 0) != (mod < 0) {
		div -= 1
	}
	if div == 0 {
		return math.Copysign(0, vx/wx)
	}
	floor := math.Floor(div)
	if div-floor > 0.5 {
		floor++
	}
	return floor
}

// isWindowsAbs is base._WINDOWS_ABS: ^[A-Za-z]:[\\/] or \\.
func isWindowsAbs(p string) bool {
	return !strings.HasPrefix(p, "/") && pypath.IsAbsAny(p)
}

// noiseKey is base._noise_key: forward slashes, case-folded for a Windows-absolute path.
func noiseKey(p string) string {
	key := strings.ReplaceAll(p, `\`, "/")
	if isWindowsAbs(p) {
		return pypath.Casefold(key)
	}
	return key
}

// isNoise is base._is_noise with home already noise-keyed: scratch and agent-internal locations,
// Claude Code's worktree copies, and %TEMP% under any Windows profile.
func isNoise(p, homeKey string) bool {
	key := noiseKey(p)
	prefixes := []string{"/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/",
		homeKey + "/.claude/", homeKey + "/.codex/", homeKey + "/.worklog/"}
	for _, pre := range prefixes {
		if strings.HasPrefix(key, pre) {
			return true
		}
	}
	if strings.Contains(key, "/.claude/worktrees/") {
		return true
	}
	return isWindowsAbs(p) && strings.Contains(key, "/appdata/local/temp/")
}

// CleanPaths is base.clean_paths: absolute, normalised with each path's own flavour, noise dropped,
// de-duplicated (first occurrence wins). A relative path is joined onto cwd with cwd's flavour, or
// dropped when cwd is not absolute. home is this machine's home directory (base._HOME).
func CleanPaths(paths []string, cwd, home string) []string {
	homeKey := noiseKey(home)
	out := []string{}
	seen := map[string]bool{}
	for _, p := range paths {
		p = pystr.Strip(p)
		if p == "" {
			continue
		}
		if !pypath.IsAbsAny(p) {
			if !pypath.IsAbsAny(cwd) {
				continue
			}
			p = pypath.FlavourOf(cwd).Join(cwd, p)
		}
		// Absolute ones too: real logs carry paths like backend/../evidence/x.md.
		p = pypath.FlavourOf(p).Normpath(p)
		if isNoise(p, homeKey) || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

// ToInt is int(x or 0) on a decoded token count: ints pass, floats truncate toward zero, bools are
// 0/1, falsy values (null, 0, "", [], {}) are 0, and a string must be an int() literal. false means
// int() would raise (spec §6 D4); an int, float or string beyond int64 is reported the same way.
func ToInt(v pyjson.Value) (int64, bool) {
	switch x := v.(type) {
	case nil:
		return 0, true
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	case pyjson.Int:
		return int64(x), true
	case pyjson.BigInt:
		return 0, false
	case int64:
		return x, true
	case int:
		return int64(x), true
	case pyjson.Float:
		return truncFloat(float64(x))
	case float64:
		return truncFloat(x)
	case string:
		if x == "" {
			return 0, true
		}
		return parseIntLiteral(x)
	case []pyjson.Value:
		return 0, len(x) == 0
	case *pyjson.Object:
		return 0, x == nil || x.Len() == 0
	}
	return 0, false
}

func truncFloat(f float64) (int64, bool) {
	t := math.Trunc(f)
	if math.IsNaN(t) || t < math.MinInt64 || t >= math.MaxInt64 {
		return 0, false
	}
	return int64(t), true
}

// isIntSpace is the whitespace int() skips around a literal: ASCII " \t\n\v\f\r" (not \x1c-\x1f,
// which str.strip() would take) and the non-ASCII White_Space code points.
func isIntSpace(r rune) bool {
	if r < 0x80 {
		return strings.ContainsRune(" \t\n\v\f\r", r)
	}
	return unicode.Is(unicode.White_Space, r)
}

// decimal is Py_UNICODE_TO_DECIMAL: the value of a Unicode decimal digit (Nd). Every Nd run is ten
// consecutive code points from its zero, and a merged table range starts at a zero.
func decimal(r rune) (int64, bool) {
	if r >= '0' && r <= '9' {
		return int64(r - '0'), true
	}
	for _, rg := range unicode.Nd.R16 {
		if r >= rune(rg.Lo) && r <= rune(rg.Hi) && (r-rune(rg.Lo))%rune(rg.Stride) == 0 {
			return int64(r-rune(rg.Lo)) % 10, true
		}
	}
	for _, rg := range unicode.Nd.R32 {
		if r >= rune(rg.Lo) && r <= rune(rg.Hi) && (r-rune(rg.Lo))%rune(rg.Stride) == 0 {
			return int64(r-rune(rg.Lo)) % 10, true
		}
	}
	return 0, false
}

// parseIntLiteral is int(s) in base 10: optional whitespace, an optional sign right before the
// digits, Unicode decimal digits with single underscores between them.
func parseIntLiteral(s string) (int64, bool) {
	rs := []rune(strings.TrimFunc(s, isIntSpace))
	neg := false
	if len(rs) > 0 && (rs[0] == '+' || rs[0] == '-') {
		neg = rs[0] == '-'
		rs = rs[1:]
	}
	if len(rs) == 0 {
		return 0, false
	}
	var n uint64
	prevDigit := false
	for i, r := range rs {
		if r == '_' {
			if !prevDigit || i == len(rs)-1 {
				return 0, false
			}
			prevDigit = false
			continue
		}
		d, ok := decimal(r)
		if !ok || n > (math.MaxUint64-uint64(d))/10 {
			return 0, false
		}
		n = n*10 + uint64(d)
		prevDigit = true
	}
	if neg {
		if n > 1<<63 {
			return 0, false
		}
		return -int64(n), true
	}
	if n > math.MaxInt64 {
		return 0, false
	}
	return int64(n), true
}
