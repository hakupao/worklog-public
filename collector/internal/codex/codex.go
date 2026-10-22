// Package codex is harvest/codex.py: the sessions in Codex's rollout logs (spec §4.7).
//
// Where Python raises on a malformed log and aborts the whole harvest, this package warns once per
// file through env.Warnf (internal/logparse's Warner and wording) and skips only the offending part
// (spec §6):
//   - D1  a file that is not valid UTF-8 (or cannot be read): the file is skipped. D2, the same met
//     by _first_meta's chunked read before the meta line, skips the file whatever `since` says;
//   - D3  timestamps with and without a UTC offset in one session: the naive ones are taken as UTC;
//   - D4  a token count int() rejects: it counts 0;
//   - D11 a timestamp fromisoformat rejects (D15, an offset with a fraction of a second, included),
//     D12 a truthy timestamp that is not a string: that message is dropped;
//   - D17 a record part whose shape Python's parser cannot handle (see the ShapeError calls): that
//     part is ignored.
package codex

import (
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/logparse"
	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/tokens"
)

const agentName = "codex"

// DefaultRoot is DEFAULT_ROOT: ~/.codex/sessions.
func DefaultRoot(home string) string { return filepath.Join(home, ".codex", "sessions") }

// A patch arrives in one of two forms. A bare apply_patch call's input IS the patch, real newlines
// and all, as is a patch fed to a shell command as a heredoc. Through the `exec` tool the patch is a
// JS string literal in the script (`tools.apply_patch("*** Begin Patch\n...")`, or bound to a
// variable first): that literal is decoded before anything is matched, so an escaped backslash,
// quote or \uXXXX in a path comes out as the character itself, and a "\\n" inside an added file's
// text stays text, never a line break.
const (
	patchStart = "*** Begin Patch"
	patchEnd   = "*** End Patch"
)

var jsEscapes = map[rune]rune{'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f', 'v': '\v', '0': 0}

// patchHeader matches the headers on a line of their own. Delete File is left out on purpose, and a
// Move to names where the file the Update File just before it ends up. RE2's (?m) ^, $ and . agree
// with Python's re.MULTILINE here: lines end at "\n" only.
var patchHeader = regexp.MustCompile(`(?m)^\*\*\* (?:(?:Add|Update) File|(Move) to): (.+)$`)

// ---- Python values -----------------------------------------------------------------------------

// number is v as a Python number (bool is an int); ok false for anything else.
func number(v pyjson.Value) (i int64, f float64, isInt, ok bool) {
	switch x := v.(type) {
	case bool:
		if x {
			return 1, 0, true, true
		}
		return 0, 0, true, true
	case pyjson.Int:
		return int64(x), 0, true, true
	case pyjson.Float:
		return 0, float64(x), false, true
	}
	return 0, 0, false, false
}

// pyEqual is Python's == on decoded JSON values: objects ignore key order, numbers compare by value
// (1 == 1.0 == True, exactly, NaN equal to nothing).
func pyEqual(a, b pyjson.Value) bool {
	_, aBig := a.(pyjson.BigInt)
	_, bBig := b.(pyjson.BigInt)
	if aBig || bBig { // never 0 or 1, so never equal to a bool
		return pyjson.Equal(a, b)
	}
	if ai, af, aInt, ok := number(a); ok {
		bi, bf, bInt, ok := number(b)
		switch {
		case !ok:
			return false
		case aInt && bInt:
			return ai == bi
		case aInt:
			return intEqualsFloat(ai, bf)
		case bInt:
			return intEqualsFloat(bi, af)
		}
		return af == bf
	}
	switch x := a.(type) {
	case nil:
		return b == nil
	case string:
		y, ok := b.(string)
		return ok && x == y
	case []pyjson.Value:
		y, ok := b.([]pyjson.Value)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !pyEqual(x[i], y[i]) {
				return false
			}
		}
		return true
	case *pyjson.Object:
		y, ok := b.(*pyjson.Object)
		if !ok || x.Len() != y.Len() {
			return false
		}
		for _, k := range x.Keys() {
			yv, has := y.Get(k)
			if xv, _ := x.Get(k); !has || !pyEqual(xv, yv) {
				return false
			}
		}
		return true
	}
	return false
}

func intEqualsFloat(i int64, f float64) bool {
	return math.Trunc(f) == f && f >= -(1<<63) && f < 1<<63 && int64(f) == i
}

// ---- warnings ----------------------------------------------------------------------------------

// payload is `record.get("payload") or {}` at a site that calls .get on it: a truthy payload that is
// not an object raises AttributeError in Python, so it is ignored (D17) and read as {} (nil).
func payload(record *pyjson.Object, path string, w *logparse.Warner) *pyjson.Object {
	p := logparse.Get(record, "payload")
	if logparse.Truthy(p) && logparse.Obj(p) == nil {
		w.ShapeError(path, "a payload that is not an object")
		return nil
	}
	return logparse.Obj(p)
}

// ---- reading -----------------------------------------------------------------------------------

// chunkSize is TextIOWrapper's _CHUNK_SIZE: a text file is read, and decoded, 8192 bytes at a time.
const chunkSize = 8192

// firstMeta is _first_meta: the first session_meta's payload, which describes the file itself (the
// ones after it are replayed history), read line by line and stopping there. Lines end at "\n", "\r"
// or "\r\n" (universal newlines) and are not stripped. A file that cannot be opened has none.
//
// Python decodes the file in 8192-byte chunks as it reads them, so a byte that is not UTF-8 in any
// chunk it reads before reaching the meta line raises (spec §6 D2); ok false means that happened, the
// D1 warning (with the chunk decoder's position) is out, and the file is skipped.
func firstMeta(path string, w *logparse.Warner) (*pyjson.Object, bool) {
	f, err := os.Open(path)
	if err != nil {
		return nil, true
	}
	defer f.Close()
	var text, pending []byte // decoded text not yet split into lines; bytes held for the next chunk
	buf := make([]byte, chunkSize)
	eof := false
	for {
		for {
			i := 0
			for i < len(text) && text[i] != '\n' && text[i] != '\r' {
				i++
			}
			if i == len(text) && !eof {
				break // the line is not complete yet
			}
			if i < len(text) && text[i] == '\r' && i == len(text)-1 && !eof {
				break // a "\r" may be the first half of "\r\n"
			}
			if i == len(text) && len(text) == 0 {
				return nil, true
			}
			line := text[:i]
			next := i + 1
			if i < len(text) && text[i] == '\r' && next < len(text) && text[next] == '\n' {
				next++
			}
			text = text[min(next, len(text)):]
			if m, found := metaOf(line, path, w); found {
				return m, true
			}
		}
		n, err := io.ReadFull(f, buf)
		if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, true // an OSError: `except OSError: pass`
		}
		chunk := append(pending, buf[:n]...)
		if n == 0 {
			eof = true
		}
		valid, e := logparse.UTF8Scan(chunk, eof)
		if e != "" {
			w.Unreadable(path, e)
			return nil, false
		}
		text = append(text, chunk[:valid]...)
		pending = append([]byte(nil), chunk[valid:]...)
	}
}

// metaOf is one _first_meta line: the payload when it is a session_meta record.
func metaOf(line []byte, path string, w *logparse.Warner) (*pyjson.Object, bool) {
	v, err := pyjson.Decode(line)
	if err != nil {
		return nil, false
	}
	record := logparse.Obj(v)
	if record == nil || logparse.Get(record, "type") != "session_meta" {
		return nil, false
	}
	// `record.get("payload") or {}`: a truthy non-object raises in _fork_parent (D17).
	return payload(record, path, w), true
}

// rglob is sorted(base.rglob("*.jsonl")) under flavour f.
func rglob(base string, f pypath.Flavour) []string {
	var out []string
	for _, x := range logparse.Rglob(base, f) {
		out = append(out, x.Path)
	}
	sort.SliceStable(out, func(i, j int) bool { return f.Less(out[i], out[j]) })
	return out
}

func mtime(path string) (float64, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return pytime.MtimeFloat(fi), nil
}

// ---- patches -----------------------------------------------------------------------------------

// runes is s as Python code points: a lone surrogate in its 3-byte WTF-8 form (as pyjson.Decode
// keeps "\ud800") is one code point, as in Python.
func runes(s string) []rune {
	var out []rune
	for i := 0; i < len(s); {
		if len(s)-i >= 3 && s[i] == 0xed && s[i+1] >= 0xa0 && s[i+1] <= 0xbf && s[i+2] >= 0x80 && s[i+2] <= 0xbf {
			out = append(out, 0xd000|rune(s[i+1]&0x3f)<<6|rune(s[i+2]&0x3f))
			i += 3
			continue
		}
		r, n := utf8.DecodeRuneInString(s[i:])
		out = append(out, r)
		i += n
	}
	return out
}

// intSpace is the whitespace int() skips around a literal: ASCII " \t\n\v\f\r" (not \x1c-\x1f) and,
// above ASCII, Python's str.isspace().
func intSpace(r rune) bool {
	if r < 0x80 {
		return strings.ContainsRune(" \t\n\v\f\r", r)
	}
	return unicode.Is(unicode.White_Space, r)
}

// decimal is Py_UNICODE_TO_DECIMAL: the value of a Unicode decimal digit (Nd). Every Nd run is ten
// consecutive code points from its zero, and a merged table range starts at a zero.
func decimal(r rune) (rune, bool) {
	for _, rg := range unicode.Nd.R16 {
		if r >= rune(rg.Lo) && r <= rune(rg.Hi) && (r-rune(rg.Lo))%rune(rg.Stride) == 0 {
			return (r - rune(rg.Lo)) % 10, true
		}
	}
	for _, rg := range unicode.Nd.R32 {
		if r >= rune(rg.Lo) && r <= rune(rg.Hi) && (r-rune(rg.Lo))%rune(rg.Stride) == 0 {
			return (r - rune(rg.Lo)) % 10, true
		}
	}
	return 0, false
}

// hexInt is int(s, 16) on a code point slice: whitespace around it, an optional sign, an optional
// "0x"/"0X" (an underscore may follow it), hex digits (any Unicode decimal digit among them) with
// single underscores between them. false when Python raises ValueError or the value leaves int64.
func hexInt(s []rune) (int64, bool) {
	// _PyUnicode_TransformDecimalAndSpaceToASCII: non-ASCII spaces → ' ', decimal digits → ASCII.
	t := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r < 127:
			t = append(t, r)
		case intSpace(r):
			t = append(t, ' ')
		default:
			d, ok := decimal(r)
			if !ok {
				return 0, false
			}
			t = append(t, '0'+d)
		}
	}
	for len(t) > 0 && intSpace(t[0]) {
		t = t[1:]
	}
	for len(t) > 0 && intSpace(t[len(t)-1]) {
		t = t[:len(t)-1]
	}
	neg := false
	if len(t) > 0 && (t[0] == '+' || t[0] == '-') {
		neg = t[0] == '-'
		t = t[1:]
	}
	if len(t) >= 2 && t[0] == '0' && (t[1] == 'x' || t[1] == 'X') {
		t = t[2:]
		if len(t) > 0 && t[0] == '_' {
			t = t[1:]
		}
	}
	if len(t) == 0 || t[0] == '_' || t[len(t)-1] == '_' {
		return 0, false
	}
	var n uint64
	prevUnderscore := false
	for _, r := range t {
		if r == '_' {
			if prevUnderscore {
				return 0, false
			}
			prevUnderscore = true
			continue
		}
		prevUnderscore = false
		var d uint64
		switch {
		case r >= '0' && r <= '9':
			d = uint64(r - '0')
		case r >= 'a' && r <= 'f':
			d = uint64(r-'a') + 10
		case r >= 'A' && r <= 'F':
			d = uint64(r-'A') + 10
		default:
			return 0, false
		}
		if n > (math.MaxUint64-d)/16 {
			return 0, false
		}
		n = n*16 + d
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

// decodeJSLiteral is _decode_js_literal: the JS string literal whose content begins body, closed by
// quote, decoded. Indices are code points, as in Python.
func decodeJSLiteral(body string, quote rune) string {
	b := runes(body)
	var out []rune
	for i := 0; i < len(b); {
		ch := b[i]
		if ch == quote {
			break
		}
		if ch != '\\' || i+1 >= len(b) {
			out = append(out, ch)
			i++
			continue
		}
		esc := b[i+1]
		i += 2
		var digits []rune
		var next int
		switch {
		case esc == 'u' && i < len(b) && b[i] == '{':
			end := -1
			for k := i; k < len(b); k++ {
				if b[k] == '}' {
					end = k
					break
				}
			}
			if end != -1 {
				digits, next = b[i+1:end], end+1
			} else {
				digits, next = nil, i
			}
		case esc == 'u' || esc == 'x':
			width := 4
			if esc == 'x' {
				width = 2
			}
			digits, next = b[i:min(i+width, len(b))], i+width
		default:
			if r, ok := jsEscapes[esc]; ok {
				out = append(out, r)
			} else if esc != '\n' { // an escaped newline continues the line
				out = append(out, esc)
			}
			continue
		}
		// chr(int(digits, 16)); a ValueError leaves the escape's letter, and the digits as text.
		if n, ok := hexInt(digits); ok && n >= 0 && n <= unicode.MaxRune {
			out = append(out, rune(n))
			i = next
		} else {
			out = append(out, esc)
		}
	}
	// .encode("utf-16", "surrogatepass").decode("utf-16", "replace"): 😀 decodes to two
	// surrogates, which join into the one character they spell; an unpaired one is U+FFFD.
	var sb strings.Builder
	for i := 0; i < len(out); i++ {
		r := out[i]
		switch {
		case r >= 0xd800 && r <= 0xdbff && i+1 < len(out) && out[i+1] >= 0xdc00 && out[i+1] <= 0xdfff:
			sb.WriteRune(0x10000 + (r-0xd800)<<10 + (out[i+1] - 0xdc00))
			i++
		case r >= 0xd800 && r <= 0xdfff:
			sb.WriteRune(utf8.RuneError)
		default:
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// patches is _patches: every patch in body, raw when "*** Begin Patch" starts a line (after spaces
// or tabs), decoded when a JS quote opens right before it.
func patches(body string) []string {
	var found []string
	i := strings.Index(body, patchStart)
	for i != -1 {
		j := i - 1
		for j >= 0 && (body[j] == ' ' || body[j] == '\t') {
			j--
		}
		if j < 0 || body[j] == '\n' {
			// On a line of its own: a bare patch, or one fed to a command as a heredoc. Its text is
			// the patch as written, so nothing is decoded.
			if end := strings.Index(body[i:], patchEnd); end == -1 {
				found = append(found, body[i:])
			} else {
				found = append(found, body[i:i+end])
			}
		} else if (body[j] == '"' || body[j] == '\'' || body[j] == '`') && j == i-1 {
			// A JS literal that opens with the patch. A script merely mentioning a header is not one.
			found = append(found, decodeJSLiteral(body[i:], rune(body[j])))
		}
		k := strings.Index(body[i+len(patchStart):], patchStart)
		if k == -1 {
			break
		}
		i += len(patchStart) + k
	}
	return found
}

// stringValues is _string_values: every string in a decoded function_call argument, lists flattened
// (a command may be an argv).
func stringValues(v pyjson.Value) []string {
	switch x := v.(type) {
	case string:
		return []string{x}
	case []pyjson.Value:
		var out []string
		for _, e := range x {
			out = append(out, stringValues(e)...)
		}
		return out
	}
	return nil
}

// patchedPaths is _patched_paths: the files a response_item's apply_patch calls add, update or move.
func patchedPaths(payload *pyjson.Object, path string, w *logparse.Warner) []string {
	kind := logparse.Get(payload, "type")
	if _, ok := logparse.HashKey(kind); !ok {
		// `{...}.get(kind)` raises TypeError.
		w.ShapeError(path, "a response_item whose type is a list or an object")
		return nil
	}
	var body pyjson.Value
	switch kind {
	case "custom_tool_call":
		body = logparse.Get(payload, "input")
	case "function_call":
		body = logparse.Get(payload, "arguments")
	}
	s, ok := body.(string)
	if !ok {
		return nil
	}
	bodies := []string{s}
	if kind == "function_call" {
		// arguments is JSON of its own; the patch (or script) is among its string values.
		v, err := pyjson.Decode([]byte(s))
		if err != nil {
			return nil
		}
		bodies = nil
		if args := logparse.Obj(v); args != nil {
			for _, k := range args.Keys() {
				arg, _ := args.Get(k)
				for _, sv := range stringValues(arg) {
					if strings.Contains(sv, patchStart) {
						bodies = append(bodies, sv)
					}
				}
			}
		}
	}
	var paths []string
	for _, text := range bodies {
		for _, patch := range patches(text) {
			for _, m := range patchHeader.FindAllStringSubmatchIndex(patch, -1) {
				p := strings.TrimRight(patch[m[4]:m[5]], "\r")
				if m[2] >= 0 && len(paths) > 0 {
					paths[len(paths)-1] = p
				} else {
					paths = append(paths, p)
				}
			}
		}
	}
	return paths
}

// ---- content -----------------------------------------------------------------------------------

// extractText is _extract_text: the input_text/output_text blocks of a content list joined. A block
// whose "text" is present but not a string is skipped (D17; "".join raises).
func extractText(content pyjson.Value, path string, w *logparse.Warner) string {
	list, _ := content.([]pyjson.Value)
	var b strings.Builder
	for _, block := range list {
		o := logparse.Obj(block)
		if o == nil {
			continue
		}
		if t := logparse.Get(o, "type"); t != "input_text" && t != "output_text" {
			continue
		}
		v, has := o.Get("text")
		s, ok := v.(string)
		if has && !ok {
			w.ShapeError(path, "a text block whose text is not a string")
		}
		b.WriteString(s)
	}
	return b.String()
}

func isSkippableUserText(text string) bool {
	return text == "" || strings.HasPrefix(text, "<") ||
		strings.Contains(text, "# AGENTS.md") || strings.Contains(text, "<environment_context>")
}

// isSubagentFork is _is_subagent_fork. A forked rollout belongs to a Codex subagent: it carries the
// PARENT's session_id and replays the parent's history, so harvesting it double-counts work and
// collides with the parent's record.
func isSubagentFork(payload *pyjson.Object) bool {
	if logparse.Truthy(logparse.Get(payload, "forked_from_id")) {
		return true
	}
	source := logparse.Obj(logparse.Get(payload, "source"))
	if source == nil {
		return false
	}
	_, has := source.Get("subagent")
	return has
}

// ---- token usage -------------------------------------------------------------------------------

// usage is _Usage: token usage from a rollout's token_count events, per model.
//
// Each event carries total_token_usage (running since the thread started) and last_token_usage (the
// request just made). Each request is counted from last_token_usage under the model of the latest
// turn_context; an event repeating the previous total is a re-emission, not a new request. OpenAI's
// input_tokens includes cached_input_tokens; the uncached input is the difference.
type usage struct {
	tally     *tokens.Tally
	model     string
	badModel  bool // the latest turn_context named a model that is not a string (D17)
	seenAny   bool
	lastTotal *pyjson.Object
}

func newUsage() *usage { return &usage{tally: tokens.NewTally(), model: "unknown"} }

func (u *usage) feed(record *pyjson.Object, path string, w *logparse.Warner) {
	typ := logparse.Get(record, "type")
	if typ != "turn_context" && typ != "event_msg" {
		return
	}
	payload := payload(record, path, w)
	if typ == "turn_context" {
		// `payload.get("model") or self.model`. Python keeps a non-string model, which a later
		// request is counted under; it fails there (a list) or in harvest (normalize_model), so the
		// previous model is used instead and the D17 warning goes out with that request.
		m := logparse.Get(payload, "model")
		if s, ok := m.(string); ok && s != "" {
			u.model, u.badModel = s, false
		} else if logparse.Truthy(m) {
			u.badModel = true
		}
		return
	}
	if logparse.Get(payload, "type") != "token_count" {
		return
	}
	info := logparse.Obj(logparse.Get(payload, "info"))
	if info == nil {
		return
	}
	total := logparse.Obj(logparse.Get(info, "total_token_usage"))
	last := logparse.Obj(logparse.Get(info, "last_token_usage"))
	if total == nil || last == nil || (u.lastTotal != nil && pyEqual(total, u.lastTotal)) {
		return
	}
	u.lastTotal = total
	u.seenAny = true
	cached := w.ToInt(logparse.Get(last, "cached_input_tokens"), path)
	input := w.ToInt(logparse.Get(last, "input_tokens"), path)
	output := w.ToInt(logparse.Get(last, "output_tokens"), path)
	// An arbitrary bucket: OpenAI's cache writes have no 5m/1h tiers.
	write := w.ToInt(logparse.Get(last, "cache_write_input_tokens"), path)
	reasoning := w.ToInt(logparse.Get(last, "reasoning_output_tokens"), path)
	if u.badModel {
		w.ShapeError(path, "a turn_context whose model is not a string")
	}
	u.tally.Add(u.model, tokens.Usage{max(0, input-cached), output, cached, write, 0, reasoning}, false)
}

// value is as_dict(): nil when the rollout had no token_count at all (older Codex): unknown, not 0.
func (u *usage) value() *tokens.Tally {
	if !u.seenAny {
		return nil
	}
	return u.tally
}

// forkUsage is _fork_usage: the tokens a forked subagent rollout used. Its token_count starts from
// zero rather than from the parent's total, so it adds to the parent session without counting
// anything twice.
func forkUsage(path string, w *logparse.Warner) *usage {
	u := newUsage()
	recs, _ := logparse.Records(path, w)
	for _, record := range recs {
		u.feed(record, path, w)
	}
	return u
}

// ---- sessions ----------------------------------------------------------------------------------

// metaString is `payload.get(key) or current` for session_id and cwd: a truthy value that is not a
// string is skipped (D17), since Python keeps it and harvest fails on it later.
func metaString(payload *pyjson.Object, key, current, path string, w *logparse.Warner) string {
	v := logparse.Get(payload, key)
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	if logparse.Truthy(v) {
		w.ShapeError(path, "a session_meta whose "+key+" is not a string")
	}
	return current
}

// parseRollout is the readRollout ParseFile and IterSessionsFiltered call (a test seam).
var parseRollout = readRollout

// readRollout is _parse: the rollout's session (nil when there is none) and its usage.
func readRollout(path string, w *logparse.Warner, env *rt.Env) (*session.RawSession, *usage) {
	u := newUsage()
	if _, err := os.Stat(path); err != nil {
		return nil, u
	}
	recs, ok := logparse.Records(path, w)
	if !ok {
		return nil, u
	}
	var sessionID, cwd string
	messages := []session.Message{}
	var written []string
	seenMeta := false

	for _, record := range recs {
		u.feed(record, path, w)
		typ := logparse.Get(record, "type")

		if typ == "session_meta" {
			payload := payload(record, path, w)
			if !seenMeta {
				seenMeta = true
				if isSubagentFork(payload) {
					return nil, u
				}
			}
			sessionID = metaString(payload, "session_id", sessionID, path, w)
			cwd = metaString(payload, "cwd", cwd, path, w)
			continue
		}

		if typ != "response_item" {
			continue
		}
		payload := payload(record, path, w)
		// Before the message filter below: file edits live in tool calls, never in messages.
		written = append(written, patchedPaths(payload, path, w)...)
		if logparse.Get(payload, "type") != "message" {
			continue
		}
		role, _ := logparse.Get(payload, "role").(string)
		if role != "user" && role != "assistant" {
			continue
		}
		text := extractText(logparse.Get(payload, "content"), path, w)
		if role == "user" && isSkippableUserText(text) {
			continue
		}
		if text == "" {
			continue
		}
		ts, ok := w.Timestamp(logparse.Get(record, "timestamp"), path)
		if !ok {
			continue
		}
		messages = append(messages, session.Message{Role: role, Text: text, TS: ts})
	}

	if sessionID == "" {
		return nil, u
	}
	m, _ := mtime(path)
	if logparse.Mixed(messages) {
		w.MixedOffsets(path)
	}
	return &session.RawSession{
		Agent:        agentName,
		SessionID:    sessionID,
		Cwd:          cwd,
		Messages:     messages,
		Path:         path,
		Mtime:        m,
		FilesWritten: session.CleanPaths(written, cwd, env.Home),
		Tokens:       u.value(),
		Artifacts:    []model.Artifact{}, // Codex has no Artifact tool
	}, u
}

// ParseFile is parse_file: the session in one rollout, or nil when the file does not exist, has no
// session_meta naming a session, is a forked subagent's rollout, or is skipped (D1). Its tokens are
// the rollout's own (IterSessions adds its forks'). The error result is always nil; problems are
// warnings (see the package comment).
func ParseFile(path string, env *rt.Env) (*session.RawSession, error) {
	s, _ := parseRollout(path, logparse.NewWarner(env), env)
	return s, nil
}

// forkSet holds one session's forks by their own id, in the order first found.
type forkSet struct {
	byID  map[string]bool
	paths []string
}

// IterSessions is iter_sessions: the sessions under root and its sibling archived_sessions/, each
// base in sorted(rglob("*.jsonl")) order of the host's path flavour. With since (epoch seconds), a
// session whose combined mtime is older is skipped before its rollout is parsed.
//
// Archiving a chat in the Codex app moves its rollout from sessions/ to archived_sessions/ with its
// mtime intact; a session found in both is yielded once (sessions/ wins). A forked subagent rollout
// is never a session of its own: its tokens are its parent session's subagent usage, and its mtime
// counts as the parent's. Other subagent rollouts (Codex's own memory consolidation, which names
// only itself) belong to no session and are dropped.
func IterSessions(root string, since *float64, env *rt.Env, yield func(*session.RawSession)) {
	IterSessionsFiltered(root, since, Filter{}, env, yield)
}

// Filter lets a caller decide, from a session's combined mtime alone, whether its rollout is parsed
// at all. Every mtime it is given is the value RawSession.Mtime would carry. A zero Filter is
// IterSessions.
type Filter struct {
	Keep  func(path string, mtime float64) bool           // nil = keep all
	Empty func(path string, mtime float64)                // a kept rollout that yielded no session (nil = ignore)
	Skip  func(path string, mtime float64, metaID string) // a rollout Keep rejected, with its meta session id
}

// IterSessionsFiltered is IterSessions with f applied after the forks' mtimes are folded in and the
// since check, just before the rollout is parsed. The head of every rollout is still read (a D2
// warning still prints); a rollout Keep rejects is otherwise never opened. Its meta session id is
// marked seen, so an archived_sessions/ copy is not yielded in its place.
func IterSessionsFiltered(root string, since *float64, f Filter, env *rt.Env, yield func(*session.RawSession)) {
	w := logparse.NewWarner(env)
	flavour := pypath.HostFlavour(env.GOOS)
	root = filepath.Clean(root)

	type rollout struct {
		path string
		meta *pyjson.Object
	}
	var rollouts []rollout
	forks := map[string]*forkSet{}
	for _, base := range []string{root, filepath.Join(filepath.Dir(root), "archived_sessions")} {
		if _, err := os.Stat(base); err != nil {
			continue
		}
		for _, path := range rglob(base, flavour) {
			meta, ok := firstMeta(path, w)
			if !ok {
				continue
			}
			parent := logparse.Get(meta, "session_id")
			// _fork_parent: a fork carries its root session's id as session_id and its own as id.
			if !isSubagentFork(meta) || !logparse.Truthy(parent) || pyEqual(parent, logparse.Get(meta, "id")) {
				rollouts = append(rollouts, rollout{path, meta})
				continue
			}
			pk, ok := logparse.HashKey(parent)
			if !ok {
				w.ShapeError(path, "a fork whose session_id is a list or an object")
				continue
			}
			// Keyed by the fork's own id: one found in both sessions/ and archived_sessions/ counts once.
			// str(path). Like Python's dict, an id string equal to a fork's path collides with that
			// fork's path key on purpose: both are the same str key there.
			fk := "s:" + path
			if id := logparse.Get(meta, "id"); logparse.Truthy(id) {
				if k, ok := logparse.HashKey(id); ok {
					fk = k
				} else {
					w.ShapeError(path, "a fork whose id is a list or an object")
				}
			}
			set := forks[pk]
			if set == nil {
				set = &forkSet{byID: map[string]bool{}}
				forks[pk] = set
			}
			if !set.byID[fk] {
				set.byID[fk] = true
				set.paths = append(set.paths, path)
			}
		}
	}

	seen := map[string]bool{}
	for _, r := range rollouts {
		// `meta.get("session_id") or meta.get("id") or ""`
		key, field := logparse.Get(r.meta, "session_id"), "session_id"
		if !logparse.Truthy(key) {
			key, field = logparse.Get(r.meta, "id"), "id"
		}
		if !logparse.Truthy(key) {
			key = ""
		}
		var subagents []string
		if k, ok := logparse.HashKey(key); !ok {
			w.ShapeError(r.path, "a session_meta whose "+field+" is a list or an object")
		} else if set := forks[k]; set != nil {
			subagents = set.paths
		}
		m, err := mtime(r.path)
		if err != nil {
			w.Unreadable(r.path, err.Error())
			continue
		}
		var live []string
		for _, sub := range subagents {
			sm, err := mtime(sub)
			if err != nil {
				w.Unreadable(sub, err.Error())
				continue
			}
			m = max(m, sm)
			live = append(live, sub)
		}
		if since != nil && m < *since {
			continue
		}
		if f.Keep != nil && !f.Keep(r.path, m) {
			metaID, _ := key.(string)
			if metaID != "" {
				seen[metaID] = true
			}
			if f.Skip != nil {
				f.Skip(r.path, m, metaID)
			}
			continue
		}
		s, u := parseRollout(r.path, w, env)
		if s == nil {
			if f.Empty != nil {
				f.Empty(r.path, m)
			}
			continue
		}
		if seen[s.SessionID] {
			// An archived_sessions/ copy of a session already yielded: kept, parsed, and nothing came of it.
			if f.Empty != nil {
				f.Empty(r.path, m)
			}
			continue
		}
		seen[s.SessionID] = true
		for _, sub := range live {
			su := forkUsage(sub, w)
			u.tally.AddSubagent(su.tally)
			u.seenAny = u.seenAny || su.seenAny
		}
		s.Tokens = u.value()
		s.Mtime = m
		yield(s)
	}
}
