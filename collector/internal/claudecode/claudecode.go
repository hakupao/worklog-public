// Package claudecode is harvest/claude_code.py: the sessions in Claude Code's logs (spec §4.6).
//
// Where Python raises on a malformed log and aborts the whole harvest, this package warns once per
// file through env.Warnf (internal/logparse's Warner and wording) and skips only the offending part
// (spec §6):
//   - D1  a file that is not valid UTF-8 (or cannot be read): the file is skipped;
//   - D3  timestamps with and without a UTC offset in one session: the naive ones are taken as UTC;
//   - D4  a token count int() rejects: it counts 0;
//   - D11 a timestamp fromisoformat rejects (D15, an offset with a fraction of a second, included),
//     D12 a truthy timestamp that is not a string: that message (or Artifact publish) is dropped;
//   - D17 a record part whose shape Python's parser cannot handle (see the ShapeError calls): that
//     part is ignored.
package claudecode

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/hakupao/worklog/collector/internal/logparse"
	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/tokens"
)

const agentName = "claude-code"

// syntheticModel is Claude Code's own placeholder for a turn no model produced (an interrupted or
// failed request): its usage is always zero, and it is not a model anyone pays for.
const syntheticModel = "<synthetic>"

// fastSuffix marks a fast-mode request, counted under "<model>:fast" (tokens.FAST_SUFFIX).
const fastSuffix = ":fast"

// fileTools maps each file tool to the input key that names the file it writes.
var fileTools = map[string]string{"Write": "file_path", "Edit": "file_path", "MultiEdit": "file_path", "NotebookEdit": "notebook_path"}

// DefaultRoot is DEFAULT_ROOT: ~/.claude/projects.
func DefaultRoot(home string) string { return filepath.Join(home, ".claude", "projects") }

// ---- Python values -----------------------------------------------------------------------------

// ---- warnings ----------------------------------------------------------------------------------

// ---- reading -----------------------------------------------------------------------------------

// sessionDir is path.with_suffix(""): the log's path without its last suffix.
func sessionDir(path string) string {
	dir, name := filepath.Split(path)
	if i := strings.LastIndexByte(name, '.'); i > 0 {
		name = name[:i]
	}
	return dir + name
}

// subagentLogs is _subagent_logs: every subagent transcript of the session, <session>/subagents/
// agent-*.jsonl and those of workflow runs one level deeper.
func subagentLogs(path string, f pypath.Flavour) []string {
	dir := filepath.Join(sessionDir(path), "subagents")
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		return nil
	}
	var out []string
	for _, x := range logparse.Rglob(dir, f) {
		out = append(out, x.Path)
	}
	return out
}

func mtime(path string) (float64, bool) {
	fi, err := os.Stat(path)
	if err != nil {
		return 0, false
	}
	return pytime.MtimeFloat(fi), true
}

// combinedMtime is _mtime: when the session last changed, its own log or any of its subagents' logs,
// whichever is later. A background subagent can go on writing long after the parent's log was last
// touched, and the harvest bookmark and the `since` window must both see that.
func combinedMtime(path string, f pypath.Flavour) (float64, bool) {
	m, ok := mtime(path)
	if !ok {
		return 0, false
	}
	for _, sub := range subagentLogs(path, f) {
		if s, ok := mtime(sub); ok && s > m {
			m = s
		}
	}
	return m, true
}

// ---- content -----------------------------------------------------------------------------------

// extractText is _extract_text: a string content, or the text blocks of a list joined. A text block
// whose "text" is present but not a string is skipped (D17; "".join raises).
func extractText(content pyjson.Value, path string, w *logparse.Warner) string {
	switch c := content.(type) {
	case string:
		return c
	case []pyjson.Value:
		var b strings.Builder
		for _, block := range c {
			o := logparse.Obj(block)
			if o != nil && logparse.Get(o, "type") == "text" {
				v, has := o.Get("text")
				s, ok := v.(string)
				if has && !ok {
					w.ShapeError(path, "a text block whose text is not a string")
				}
				b.WriteString(s)
			}
		}
		return b.String()
	}
	return ""
}

// writtenPaths is _written_paths: the files an assistant message's file tool calls write.
func writtenPaths(content pyjson.Value, path string, w *logparse.Warner) []string {
	list, _ := content.([]pyjson.Value)
	var out []string
	for _, block := range list {
		o := logparse.Obj(block)
		if o == nil || logparse.Get(o, "type") != "tool_use" {
			continue
		}
		if _, hashable := logparse.HashKey(logparse.Get(o, "name")); !hashable {
			w.ShapeError(path, "a tool_use whose name is a list or an object")
			continue
		}
		name, _ := logparse.Get(o, "name").(string)
		key, ok := fileTools[name]
		if !ok {
			continue
		}
		input := logparse.Get(o, "input")
		if logparse.Truthy(input) && logparse.Obj(input) == nil {
			w.ShapeError(path, "a file tool_use whose input is not an object")
			continue
		}
		if p, ok := logparse.Get(logparse.Obj(input), key).(string); ok {
			out = append(out, p)
		}
	}
	return out
}

// ---- Artifacts ---------------------------------------------------------------------------------

type artEntry struct {
	a  model.Artifact
	at pytime.Instant
}

// artifacts is _Artifacts: the Artifact pages a session published, one per url.
//
// A publish is an Artifact tool_use (see isPublish) whose tool_result is not an error; the page's url
// and title are in that result record's toolUseResult. Both url spellings are kept:
// claude.ai/artifact/<id> and the older claude.ai/code/artifact/<uuid>. A page published again keeps
// its latest title and time.
type artifacts struct {
	publishes    map[string]bool
	byURL        map[string]*artEntry
	order        []string // insertion order of byURL
	aware, naive bool     // offsets seen among the publish times (D3)
}

func newArtifacts() *artifacts {
	return &artifacts{publishes: map[string]bool{}, byURL: map[string]*artEntry{}}
}

// isPublish is _is_publish: the default action (a file_path, or a type_url to start from) or an
// explicit "publish"; not quickstart / read / list / delete / open / pin, and not an asset upload.
func isPublish(input *pyjson.Object) bool {
	action := logparse.Get(input, "action")
	return (action == nil || action == "publish") && !logparse.Truthy(logparse.Get(input, "asset"))
}

func (t *artifacts) add(record *pyjson.Object, path string, w *logparse.Warner) {
	message := logparse.Get(record, "message")
	if logparse.Truthy(message) && logparse.Obj(message) == nil {
		// `(record.get("message") or {}).get(...)` raises on every user/assistant record.
		w.ShapeError(path, "a message that is not an object")
		return
	}
	content, _ := logparse.Get(logparse.Obj(message), "content").([]pyjson.Value)
	for _, block := range content {
		b := logparse.Obj(block)
		if b == nil {
			continue
		}
		if logparse.Get(b, "type") == "tool_use" && logparse.Get(b, "name") == "Artifact" {
			if in := logparse.Obj(logparse.Get(b, "input")); in != nil && isPublish(in) {
				if k, ok := logparse.HashKey(logparse.Get(b, "id")); ok {
					t.publishes[k] = true
				} else {
					w.ShapeError(path, "an Artifact tool_use whose id is a list or an object")
				}
			}
		} else if logparse.Get(b, "type") == "tool_result" {
			k, ok := logparse.HashKey(logparse.Get(b, "tool_use_id"))
			if !ok {
				w.ShapeError(path, "a tool_result whose tool_use_id is a list or an object")
				continue
			}
			if t.publishes[k] && !logparse.Truthy(logparse.Get(b, "is_error")) {
				t.published(record, path, w)
			}
		}
	}
}

// firstTruthy is `a or b` on optional strings: a when it is a non-empty string, else b.
func firstTruthy(a, b *string) *string {
	if a != nil && *a != "" {
		return a
	}
	return b
}

func optString(v pyjson.Value) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}

func (t *artifacts) published(record *pyjson.Object, path string, w *logparse.Warner) {
	result := logparse.Obj(logparse.Get(record, "toolUseResult"))
	ts, ok := logparse.Get(record, "timestamp").(string)
	if result == nil || !ok {
		return
	}
	url, ok := logparse.Get(result, "url").(string)
	if !ok || !strings.Contains(url, "/artifact/") {
		return
	}
	title := optString(logparse.Get(result, "title"))
	artifactID := optString(logparse.Get(result, "artifact_id"))
	at, ok := w.ParseTS(ts, path)
	if !ok {
		return
	}
	if at.Aware {
		t.aware = true
	} else {
		t.naive = true
	}
	seen := t.byURL[url]
	if seen != nil && at.Before(seen.at) {
		// An older publish read later (a subagent's transcript): it only fills what the newer one lacks.
		seen.a.Title = firstTruthy(seen.a.Title, title)
		seen.a.ArtifactID = firstTruthy(seen.a.ArtifactID, artifactID)
		return
	}
	e := &artEntry{a: model.Artifact{URL: url, TS: ts}, at: at}
	var seenTitle, seenID *string
	if seen != nil {
		seenTitle, seenID = seen.a.Title, seen.a.ArtifactID
	} else {
		t.order = append(t.order, url)
	}
	// `title or (seen and seen["title"]) or None`: an empty title becomes None here.
	e.a.Title = firstTruthy(title, firstTruthy(seenTitle, nil))
	e.a.ArtifactID = firstTruthy(artifactID, firstTruthy(seenID, nil))
	t.byURL[url] = e
}

// list is as_list: the pages sorted by publish time (stable, so equal times keep insertion order).
func (t *artifacts) list() []model.Artifact {
	entries := make([]*artEntry, 0, len(t.order))
	for _, u := range t.order {
		entries = append(entries, t.byURL[u])
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].at.Before(entries[j].at) })
	out := []model.Artifact{}
	for _, e := range entries {
		out = append(out, e.a)
	}
	return out
}

// ---- token usage -------------------------------------------------------------------------------

// usageFields is _usage_fields: one request's usage in tokens.Fields terms. Claude's input_tokens
// already excludes cache reads and writes. The 5m/1h split of cache writes is in cache_creation;
// older logs have no split, and a few give one that covers less than the total, so whatever it does
// not name as 1h is counted at the 5m (default TTL) rate.
func usageFields(u *pyjson.Object, path string, w *logparse.Warner) tokens.Usage {
	split := logparse.Obj(logparse.Get(u, "cache_creation"))
	written := w.ToInt(logparse.Get(u, "cache_creation_input_tokens"), path)
	write1h := min(w.ToInt(logparse.Get(split, "ephemeral_1h_input_tokens"), path), written)
	details := logparse.Obj(logparse.Get(u, "output_tokens_details"))
	return tokens.Usage{
		w.ToInt(logparse.Get(u, "input_tokens"), path),
		w.ToInt(logparse.Get(u, "output_tokens"), path),
		w.ToInt(logparse.Get(u, "cache_read_input_tokens"), path),
		written - write1h,
		write1h,
		w.ToInt(logparse.Get(details, "thinking_tokens"), path),
	}
}

type modelUsage struct {
	model string
	usage tokens.Usage
}

// requestUsage is _request_usage: (model, usage) for every model call billed for one assistant
// message.
//
// When usage carries `iterations`, the top-level figures are the sum of its "message" iterations
// only, while other iterations (an advisor call) ran on their own model and appear nowhere else, so
// the iterations are the ones counted. A fast-mode request is counted under "<model>:fast".
func requestUsage(message *pyjson.Object, path string, w *logparse.Warner) []modelUsage {
	usage := logparse.Obj(logparse.Get(message, "usage"))
	model, ok := logparse.Get(message, "model").(string)
	if usage == nil || !ok || model == syntheticModel {
		return nil
	}
	main := model
	if logparse.Get(usage, "speed") == "fast" {
		main = model + fastSuffix
	}
	// `usage.get("iterations") or []`, keeping the dicts: a string or an object iterates to no dicts;
	// a truthy number or true is not iterable (D17).
	var iterations []*pyjson.Object
	switch v := logparse.Get(usage, "iterations").(type) {
	case pyjson.Int, pyjson.BigInt, pyjson.Float, bool:
		if logparse.Truthy(v) {
			w.ShapeError(path, "usage iterations that are a number")
		}
	}
	if list, ok := logparse.Get(usage, "iterations").([]pyjson.Value); ok {
		for _, it := range list {
			if o := logparse.Obj(it); o != nil {
				iterations = append(iterations, o)
			}
		}
	}
	if len(iterations) == 0 {
		return []modelUsage{{main, usageFields(usage, path, w)}}
	}
	out := make([]modelUsage, 0, len(iterations))
	for _, it := range iterations {
		m := main
		if logparse.Get(it, "type") != "message" {
			// `it.get("model") or model`
			m = model
			if s, ok := logparse.Get(it, "model").(string); ok && s != "" {
				m = s
			} else if logparse.Truthy(logparse.Get(it, "model")) {
				w.ShapeError(path, "an iteration whose model is not a string")
			}
		}
		out = append(out, modelUsage{m, usageFields(it, path, w)})
	}
	// Only the top level reports thinking tokens; they belong to the message's own model.
	reasoning := usageFields(usage, path, w)[5]
	for i := range out {
		if out[i].model == main {
			out[i].usage[5] = reasoning
			break
		}
	}
	return out
}

type response struct {
	message  *pyjson.Object
	subagent bool
	path     string // the log it came from, for warnings
}

// responses is _Responses: each API response's usage, counted once.
//
// Claude Code writes one record per content block of a response, each repeating the response's usage
// under the same message.id. In a subagent's transcript the earlier ones are written mid-stream with
// output_tokens still growing, and a resumed subagent's transcript replays another transcript's
// history, mid-stream snapshots included, so the same id can appear in two files in either order.
// The record with the largest output_tokens (the latest one on a tie) is the finished response, and
// is kept whole, so its iterations stay consistent with its totals. A replaced response keeps its
// first position.
type responses struct {
	index map[string]int // message id → position in byID
	byID  []response
	noID  []response
}

func (r *responses) output(x response, w *logparse.Warner) int64 {
	return w.ToInt(logparse.Get(logparse.Obj(logparse.Get(x.message, "usage")), "output_tokens"), x.path)
}

func (r *responses) add(message *pyjson.Object, subagent bool, path string, w *logparse.Warner) {
	if logparse.Obj(logparse.Get(message, "usage")) == nil {
		return
	}
	x := response{message, subagent, path}
	id := logparse.Get(message, "id")
	key, hashable := logparse.HashKey(id)
	if logparse.Truthy(id) && !hashable {
		w.ShapeError(path, "a message id that is a list or an object")
	}
	if !logparse.Truthy(id) || !hashable {
		r.noID = append(r.noID, x)
		return
	}
	if r.index == nil {
		r.index = map[string]int{}
	}
	i, stored := r.index[key]
	if !stored {
		r.index[key] = len(r.byID)
		r.byID = append(r.byID, x)
		return
	}
	if r.output(x, w) >= r.output(r.byID[i], w) {
		r.byID[i] = x
	}
}

func (r *responses) tally(w *logparse.Warner) *tokens.Tally {
	t := tokens.NewTally()
	for _, x := range append(append([]response(nil), r.byID...), r.noID...) {
		for _, mu := range requestUsage(x.message, x.path, w) {
			t.Add(mu.model, mu.usage, x.subagent)
		}
	}
	return t
}

// ---- sessions ----------------------------------------------------------------------------------

// readSubagents is _read_subagents: the files the session's subagents wrote; their responses go into
// resp as subagent usage, and the pages they published into arts. Each transcript is read in
// (mtime, name) order, every record marked isSidechain.
func readSubagents(path string, f pypath.Flavour, resp *responses, arts *artifacts, w *logparse.Warner) []string {
	type sub struct {
		path  string
		mtime float64
	}
	var subs []sub
	for _, p := range subagentLogs(path, f) {
		fi, err := os.Stat(p)
		if err != nil {
			w.Unreadable(p, err.Error())
			continue
		}
		subs = append(subs, sub{p, pytime.MtimeFloat(fi)})
	}
	sort.SliceStable(subs, func(i, j int) bool {
		if subs[i].mtime != subs[j].mtime {
			return subs[i].mtime < subs[j].mtime
		}
		return filepath.Base(subs[i].path) < filepath.Base(subs[j].path)
	})
	var paths []string
	for _, s := range subs {
		recs, ok := logparse.Records(s.path, w)
		if !ok {
			continue
		}
		for _, record := range recs {
			typ := logparse.Get(record, "type")
			if typ == "user" || typ == "assistant" {
				arts.add(record, s.path, w)
			}
			if typ == "assistant" {
				message := logparse.Obj(logparse.Get(record, "message"))
				paths = append(paths, writtenPaths(logparse.Get(message, "content"), s.path, w)...)
				resp.add(message, true, s.path, w)
			}
		}
	}
	return paths
}

// ParseFile is parse_file: the session in one log, or nil when the file does not exist, has no
// session id (a subagent transcript never has one: every record is a sidechain) or is skipped (D1).
// The error result is always nil; problems are warnings (see the package comment).
func ParseFile(path string, env *rt.Env) (*session.RawSession, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, nil
	}
	w := logparse.NewWarner(env)
	recs, ok := logparse.Records(path, w)
	if !ok {
		return nil, nil
	}
	flavour := pypath.HostFlavour(env.GOOS)

	var sessionID, cwd string
	messages := []session.Message{}
	var written []string
	resp := &responses{}
	arts := newArtifacts()

	for _, record := range recs {
		role, _ := logparse.Get(record, "type").(string)
		if role != "user" && role != "assistant" {
			continue
		}
		message := logparse.Obj(logparse.Get(record, "message"))
		arts.add(record, path, w)
		// Before every filter below: a turn that only calls tools carries no text at all, and a file
		// a subagent wrote is the session's work too, even though its conversation is not. Token
		// usage likewise: an inline sidechain record is a subagent's request.
		if role == "assistant" {
			written = append(written, writtenPaths(logparse.Get(message, "content"), path, w)...)
			resp.add(message, logparse.Truthy(logparse.Get(record, "isSidechain")), path, w)
		}

		if logparse.Truthy(logparse.Get(record, "isSidechain")) {
			continue
		}

		// Python keeps the first truthy value of any type; a non-string one is ignored here (D17).
		if v := logparse.Get(record, "sessionId"); sessionID == "" {
			if s, ok := v.(string); ok {
				sessionID = s
			} else if logparse.Truthy(v) {
				w.ShapeError(path, "a sessionId that is not a string")
			}
		}
		if v := logparse.Get(record, "cwd"); cwd == "" {
			if s, ok := v.(string); ok {
				cwd = s
			} else if logparse.Truthy(v) {
				w.ShapeError(path, "a cwd that is not a string")
			}
		}

		text := extractText(logparse.Get(message, "content"), path, w)
		if role == "user" && strings.HasPrefix(text, "<") {
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
		return nil, nil
	}

	m, _ := combinedMtime(path, flavour)
	sub := readSubagents(path, flavour, resp, arts, w)
	s := &session.RawSession{
		Agent:        agentName,
		SessionID:    sessionID,
		Cwd:          cwd,
		Messages:     messages,
		Path:         path,
		Mtime:        m,
		FilesWritten: session.CleanPaths(append(written, sub...), cwd, env.Home),
		Tokens:       resp.tally(w),
		Artifacts:    arts.list(),
	}
	if logparse.Mixed(messages) || (arts.aware && arts.naive) {
		w.MixedOffsets(path)
	}
	return s, nil
}

// parseFile is the ParseFile IterSessions calls (a test seam).
var parseFile = ParseFile

// IterSessions is iter_sessions: every session under root, in sorted(root.rglob("*.jsonl")) order
// of the host's path flavour. With since (epoch seconds), a log whose combined mtime is older is
// skipped before it is read.
func IterSessions(root string, since *float64, env *rt.Env, yield func(*session.RawSession)) {
	IterSessionsFiltered(root, since, Filter{}, env, yield)
}

// Filter lets a caller decide, from a log's combined mtime alone, whether it is parsed at all. Every
// mtime it is given is the value RawSession.Mtime would carry. A zero Filter is IterSessions.
type Filter struct {
	Keep  func(path string, mtime float64) bool           // nil = keep all
	Empty func(path string, mtime float64)                // a kept log that yielded no session (nil = ignore)
	Skip  func(path string, mtime float64, metaID string) // a log Keep rejected; metaID is always "" here
}

// IterSessionsFiltered is IterSessions with f applied after the since check: a log Keep rejects is
// never opened, so it prints no parse warning.
func IterSessionsFiltered(root string, since *float64, f Filter, env *rt.Env, yield func(*session.RawSession)) {
	if _, err := os.Stat(root); err != nil {
		return
	}
	flavour := pypath.HostFlavour(env.GOOS)
	files := logparse.Rglob(filepath.Clean(root), flavour)
	sort.SliceStable(files, func(i, j int) bool { return flavour.Less(files[i].Path, files[j].Path) })
	for _, file := range files {
		// A subagent transcript (workflow runs' ones included) is part of its parent session, read by
		// ParseFile on the parent's file; on its own it never yields a session.
		if containsSubagents(file.Rel[:len(file.Rel)-1]) {
			continue
		}
		var m float64
		if since != nil || f.Keep != nil || f.Empty != nil {
			var ok bool
			m, ok = combinedMtime(file.Path, flavour)
			if !ok {
				// _mtime raises on a dangling symlink; parse_file alone would only return None.
				if _, err := os.Stat(file.Path); err != nil {
					env.Warnf("worklog: skipped unreadable log %s (%s)", file.Path, err)
				}
				continue
			}
			if since != nil && m < *since {
				continue
			}
		}
		if f.Keep != nil && !f.Keep(file.Path, m) {
			if f.Skip != nil {
				f.Skip(file.Path, m, "")
			}
			continue
		}
		if s, _ := parseFile(file.Path, env); s != nil {
			yield(s)
		} else if f.Empty != nil {
			f.Empty(file.Path, m)
		}
	}
}

func containsSubagents(dirs []string) bool {
	for _, d := range dirs {
		if d == "subagents" {
			return true
		}
	}
	return false
}
