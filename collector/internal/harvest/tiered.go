package harvest

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hakupao/worklog/collector/internal/claudecode"
	"github.com/hakupao/worklog/collector/internal/codex"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/link"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/summarize"
)

// TieredOpts are a tiered run's inputs beyond Run's. Now feeds only the cache's clocks (at, tried,
// seen), never the wire.
type TieredOpts struct {
	Now    time.Time
	Rescan bool
}

// TieredResult is Result plus the tiers: line's counts (spec §5.7). Parsed is the logs the parsers
// opened: Keep accepted them.
type TieredResult struct {
	Result
	Parsed, NewSummaries, Bootstrap, Reused, Refreshed, Failed, Adopted int
}

// NewTiersLog is the log callback that appends each line to <Home>/tiers.jsonl. A line that cannot
// be written is a warning, never a failed run.
func NewTiersLog(cfg *config.Config, env *rt.Env) func(*pyjson.Object) {
	return func(line *pyjson.Object) {
		f, err := os.OpenFile(cfg.TiersLogPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err == nil {
			_, err = f.Write(append(pyjson.Compact(line), '\n'))
			if cerr := f.Close(); err == nil {
				err = cerr
			}
		}
		if err != nil {
			env.Warnf("worklog: could not write %s (%v).", cfg.TiersLogPath(), err)
		}
	}
}

// tiersLogKeepDays is how much of tiers.jsonl the daily rescan keeps (spec §5.7).
const tiersLogKeepDays = 8

// rotateTiersLog drops the lines older than tiersLogKeepDays, and any line that is not a JSON object
// with a numeric ts. A missing file is nothing to rotate; a file that cannot be rewritten is left
// whole, to grow until the next rescan.
func rotateTiersLog(path string, now float64) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	cutoff := now - tiersLogKeepDays*86400
	var kept []byte
	for _, line := range bytes.Split(b, []byte("\n")) {
		v, err := pyjson.Decode(line)
		o, ok := v.(*pyjson.Object)
		if err != nil || !ok {
			continue
		}
		ts, _ := o.Get("ts")
		if t := number(ts); t >= cutoff {
			kept = append(append(kept, line...), '\n')
		}
	}
	if len(kept) == len(b) {
		return
	}
	tmp := filepath.Join(filepath.Dir(path), filepath.Base(path)+".tmp")
	if os.WriteFile(tmp, kept, 0o644) != nil || replaceFile(tmp, path) != nil {
		os.Remove(tmp)
	}
}

// PromptDigest is the digest of the exact summarizer input (spec §5.5 pfp), not the fingerprint.
func PromptDigest(raw *session.RawSession) string { return digest([]byte(summarize.Prompt(raw))) }

// saveCollectorState is SaveCollectorState (a test seam).
var saveCollectorState = SaveCollectorState

func epoch(t time.Time) float64 { return float64(t.Unix()) + float64(t.Nanosecond())*1e-9 }

// lastMsg is session.EndedAt as epoch seconds; a naive instant's T already holds its wall time as UTC.
func lastMsg(raw *session.RawSession) *float64 {
	e, ok := session.EndedAt(raw.Messages)
	if !ok {
		return nil
	}
	v := epoch(e.T)
	return &v
}

// saveStates saves harvest_state.json, then the collector state (spec §5.2 save order). Only the
// first can fail the run; a collector state that cannot be written is a warning, and its stale bm
// costs the next run an R1.
func saveStates(cfg *config.Config, state map[string]Bookmark, cs *CollectorState, env *rt.Env) error {
	if err := SaveState(cfg.StatePath(), state); err != nil {
		return err
	}
	saveCache(cfg, cs, env)
	return nil
}

func saveCache(cfg *config.Config, cs *CollectorState, env *rt.Env) {
	if cs == nil {
		return
	}
	if err := saveCollectorState(cfg.CollectorStatePath(), cs); err != nil {
		env.Warnf("worklog: could not save %s (%v); the next harvest re-summarizes what it cannot trust.", cfg.CollectorStatePath(), err)
	}
}

// putBookmark writes key's bookmark and keeps its cache entry's bm in step (spec §5.2): an entry
// that was valid follows the write; one that was not is dropped, so the write cannot revive a summary
// someone else's bookmark had invalidated. It says whether a valid entry followed.
func putBookmark(state map[string]Bookmark, cs *CollectorState, key string, b Bookmark) bool {
	valid := false
	if cs != nil {
		if e, ok := cs.Valid(key, state); ok {
			e.BM = &b
			cs.Sessions[key] = e
			valid = true
		} else {
			delete(cs.Sessions, key)
		}
	}
	state[key] = b
	return valid
}

// moved records a parse that only moved the bookmark (R0).
func (s *CollectorState) moved(key string, raw *session.RawSession, pfp string, now float64) {
	e := s.Sessions[key]
	e.CurPFP, e.LastMsg, e.Path, e.Seen = pfp, lastMsg(raw), raw.Path, now
	s.Sessions[key] = e
}

// summarizedEntry is the entry after a summarizer attempt made at now: a fallback starts its tries at 1.
func summarizedEntry(raw *session.RawSession, summary, source, pfp string, now float64, bm *Bookmark) SummaryEntry {
	tries := 0
	if source == "fallback" {
		tries = 1
	}
	return SummaryEntry{Summary: summary, Source: source, PFP: pfp, CurPFP: pfp, At: now, Tried: now, Tries: tries,
		LastMsg: lastMsg(raw), Path: raw.Path, Seen: now, BM: bm}
}

// Backoff is how long a session waits after tries consecutive failed attempts (spec §5.5, O5).
func Backoff(tries int) time.Duration {
	switch {
	case tries <= 0:
		return 0
	case tries >= 5:
		return 24 * time.Hour
	}
	return time.Hour << (tries - 1)
}

// allowed says whether a summarizer attempt on a valid entry may run at now.
func allowed(e SummaryEntry, now float64) bool {
	return e.Tries == 0 || now-e.Tried >= Backoff(e.Tries).Seconds()
}

// r3Due is R3's clock: the summary is an hour old, or the session stopped 30 min ago (O2).
func r3Due(e SummaryEntry, last *float64, now float64) bool {
	return now-e.At >= 3600 || last != nil && now-*last >= gapMinutes*60
}

// rule is a §5.5 summary rule.
type rule string

const (
	ruleR1 rule = "R1" // no valid entry: summarize
	ruleR2 rule = "R2" // the same prompt as the cached llm summary: re-send it, no call
	ruleR3 rule = "R3" // a stale llm summary that is due: summarize (R3f when that falls back)
	ruleR4 rule = "R4" // a stale llm summary not yet due: re-send it, no call
	ruleR5 rule = "R5" // a fallback that may be retried: summarize
	ruleR6 rule = "R6" // a fallback inside its backoff: re-send it, no call
)

// classify picks the rule for a parsed session that is past the stat skip and R0; last is the
// parse's last_msg.
func classify(e SummaryEntry, valid bool, pfp string, last *float64, now float64) rule {
	switch {
	case !valid:
		return ruleR1
	case e.Source == "llm" && e.PFP == pfp:
		return ruleR2
	case e.Source == "llm" && allowed(e, now) && r3Due(e, last, now):
		return ruleR3
	case e.Source == "llm":
		return ruleR4
	case allowed(e, now):
		return ruleR5
	}
	return ruleR6
}

// calls says whether the rule runs the summarizer.
func (r rule) calls() bool { return r == ruleR1 || r == ruleR3 || r == ruleR5 }

// refreshSet is the keys whose summary is due without their log moving, and those keys' paths
// (spec §5.5): a valid entry that may be attempted and is a fallback, or a stale llm summary R3
// is due for. A key whose log is gone is left alone; the next rescan finds the session. So is one
// whose log is older than since, which the parsers check before Keep: the prune or the rescan deals
// with it. The bookmark holds the combined mtime (subagent logs included) the last parse saw.
func refreshSet(cs *CollectorState, state map[string]Bookmark, now float64, since *float64) (keys, paths map[string]bool) {
	keys, paths = map[string]bool{}, map[string]bool{}
	for key := range cs.Sessions {
		e, ok := cs.Valid(key, state)
		if !ok || !allowed(e, now) || e.Source == "llm" && (e.CurPFP == e.PFP || !r3Due(e, e.LastMsg, now)) {
			continue
		}
		p, ok := cs.PathOf(key)
		if !ok {
			continue
		}
		fi, err := os.Stat(p)
		if err != nil || since != nil && max(pytime.MtimeFloat(fi), state[key].Mtime) < *since {
			continue
		}
		keys[key], paths[p] = true, true
	}
	return keys, paths
}

// fallbackText is what summarize.Summarize falls back to: the first user text, cut to 30. R7 caches
// it; R5 replaces it in the same run.
func fallbackText(raw *session.RawSession) string {
	for _, m := range raw.Messages {
		if m.Role == "user" {
			return pystr.Head(m.Text, 30)
		}
	}
	return ""
}

type tieredCandidate struct {
	candidate
	rule   rule
	cached SummaryEntry
	pfp    string
}

type filter struct {
	keep  func(path string, mtime float64) bool
	empty func(path string, mtime float64)
	skip  func(path string, mtime float64, metaID string)
}

// filtered is parsers with the stat-first seam.
var filtered = map[string]func(root string, since *float64, f filter, env *rt.Env, yield func(*session.RawSession)){
	"claude-code": func(root string, since *float64, f filter, env *rt.Env, yield func(*session.RawSession)) {
		claudecode.IterSessionsFiltered(root, since, claudecode.Filter{Keep: f.keep, Empty: f.empty, Skip: f.skip}, env, yield)
	},
	"codex": func(root string, since *float64, f filter, env *rt.Env, yield func(*session.RawSession)) {
		codex.IterSessionsFiltered(root, since, codex.Filter{Keep: f.keep, Empty: f.empty, Skip: f.skip}, env, yield)
	},
}

// agentOf is the agent of an index entry's key ("agent:sessionID"; a kind=none entry is "agent:").
func agentOf(key string) string {
	a, _, _ := strings.Cut(key, ":")
	return a
}

// RunTiered is the tiered pass (spec §5.4, §5.5). Phase 1 stats before parsing: Keep skips a log the
// index says is unchanged, then each parsed session is filtered, linked, fingerprinted and classified
// as Run does, with R0 and the summary rules on top; the bookmarks, the index and the cache are saved
// at its end. Phase 2 is Run's worker pool, where only the rules that need it call the summarizer.
//
// The index is read per agent: a path that two roots share (the test corpus nests Codex rollouts
// under the Claude root) has one entry, and an entry written by the other agent counts as absent.
func RunTiered(cfg *config.Config, st Store, roots []Root, sum Summarizer, sinceDays *int, workers int,
	cs *CollectorState, opts TieredOpts, log func(line *pyjson.Object), env *rt.Env) (TieredResult, error) {
	var res TieredResult
	tasks, err := st.Tasks()
	if err != nil {
		return res, err
	}
	known := candidates(tasks)
	flavour := pypath.HostFlavour(env.GOOS)
	state := LoadState(cfg.StatePath())
	now := epoch(opts.Now)
	if opts.Rescan {
		rotateTiersLog(cfg.TiersLogPath(), now)
	}
	// decided logs one session decision (spec §5.7): the rule and the cache entry it left, never text.
	decided := func(key, rule string, e SummaryEntry) {
		if log == nil {
			return
		}
		l := pyjson.NewObject()
		l.Set("ts", pyjson.Float(now))
		l.Set("key", key)
		l.Set("rule", rule)
		l.Set("source", e.Source)
		l.Set("pfp", e.PFP)
		l.Set("cur_pfp", e.CurPFP)
		l.Set("at", pyjson.Float(e.At))
		log(l)
	}
	var since *float64
	if sinceDays != nil {
		s := sinceEpoch(env.Now(), *sinceDays)
		since = &s
	}
	// The refresh set: keys and paths that bypass the stat skip and R0.
	refreshKeys, refreshPaths := refreshSet(cs, state, now, since)

	if len(roots) == 0 {
		roots = defaultRoots(env)
	}
	var todo []tieredCandidate
	for _, r := range roots {
		parse, ok := filtered[r.Agent]
		if !ok {
			continue
		}
		agent := r.Agent
		keep := func(path string, mtime float64) bool {
			// A rescan trusts no index: it parses everything the window holds (spec §5.4).
			if e, ok := cs.Files[path]; ok && !opts.Rescan && agentOf(e.Key) == agent && !refreshPaths[path] {
				switch e.Kind {
				case KindSession:
					// Run's mtime-equality check, made before the parse: against the bookmark, never e.Mtime.
					if b, has := state[e.Key]; has && b.Mtime == mtime && !refreshKeys[e.Key] {
						res.Skipped++
						return false
					}
				case KindExcluded:
					if e.Mtime == mtime {
						res.Skipped++
						return false
					}
				case KindNone:
					if e.Mtime == mtime {
						return false
					}
				}
			}
			res.Parsed++
			return true
		}
		empty := func(path string, mtime float64) {
			cs.Files[path] = FileEntry{Key: agent + ":", Kind: KindNone, Mtime: mtime, Seen: now}
		}
		parse(r.Dir, since, filter{keep: keep, empty: empty}, env, func(raw *session.RawSession) {
			key := agent + ":" + raw.SessionID
			index := func(kind FileKind) { cs.Files[raw.Path] = FileEntry{Key: key, Kind: kind, Mtime: raw.Mtime, Seen: now} }
			prev, hasPrev := state[key]
			adopt := false
			if hasPrev && prev.Mtime == raw.Mtime && !refreshKeys[key] {
				// R7: an fp-less bookmark with no valid entry is a fallback from before tiering.
				_, valid := cs.Valid(key, state)
				adopt = prev.FP == nil && !valid && !isExcluded(raw.Cwd, cfg.ExcludeCwdPatterns) && !isTrivial(raw, cfg)
				if !adopt {
					res.Skipped++
					index(KindSession)
					return
				}
			}
			// A refresh-set key that has become excluded or trivial leaves the cache, and so the refresh
			// set, instead of being re-parsed on every run until the prune (final review, finding 2).
			if isExcluded(raw.Cwd, cfg.ExcludeCwdPatterns) {
				res.Skipped++
				index(KindExcluded)
				if refreshKeys[key] {
					delete(cs.Sessions, key)
				}
				return
			}
			index(KindSession)
			if isTrivial(raw, cfg) {
				res.Skipped++
				putBookmark(state, cs, key, Bookmark{Mtime: raw.Mtime})
				if refreshKeys[key] {
					delete(cs.Sessions, key)
				}
				return
			}
			var start, end *pytime.Instant
			if s, ok := session.StartedAt(raw.Messages); ok {
				start = &s
			}
			if e, ok := session.EndedAt(raw.Messages); ok {
				end = &e
			}
			taskID, method := link.Decide(raw.Cwd, start, end, known, cfg.Projects, flavour)
			in := fingerprintInput(raw, taskID, method)
			if onFingerprint != nil {
				onFingerprint(in)
			}
			fp := digest(in)
			pfp := PromptDigest(raw)
			if hasPrev && prev.FP != nil && *prev.FP == fp && !refreshKeys[key] { // R0
				res.Skipped++
				if putBookmark(state, cs, key, Bookmark{Mtime: raw.Mtime, FP: &fp}) {
					cs.moved(key, raw, pfp, now)
				}
				decided(key, "R0", cs.Sessions[key])
				return
			}
			if adopt {
				bm := prev
				cs.Sessions[key] = SummaryEntry{Summary: fallbackText(raw), Source: "fallback", PFP: pfp, CurPFP: pfp,
					LastMsg: lastMsg(raw), Path: raw.Path, Seen: now, BM: &bm}
				res.Adopted++
				decided(key, "R7", cs.Sessions[key])
			}
			e, valid := cs.Valid(key, state)
			ru := classify(e, valid, pfp, lastMsg(raw), now)
			switch {
			case ru == ruleR1 && hasPrev:
				res.Bootstrap++
			case ru == ruleR1:
				res.NewSummaries++
			}
			todo = append(todo, tieredCandidate{candidate{agent, key, raw, taskID, method, fp}, ru, e, pfp})
		})
	}
	if opts.Rescan {
		window := 1 << 30 // no sinceDays: only a vanished path prunes a file
		if sinceDays != nil {
			window = *sinceDays
		}
		cs.Prune(now, window, func(p string) bool { _, err := os.Stat(p); return err == nil })
	}
	if err := saveStates(cfg, state, cs, env); err != nil {
		return res, err
	}

	type done struct {
		i int
		r summarized
	}
	jobs := make(chan int, len(todo))
	for i := range todo {
		jobs <- i
	}
	close(jobs)
	results := make(chan done, len(todo))
	for range max(workers, 1) {
		go func() {
			for i := range jobs {
				t := todo[i]
				if !t.rule.calls() {
					results <- done{i, summarized{c: t.candidate, summary: t.cached.Summary, source: t.cached.Source}}
					continue
				}
				results <- done{i, summarizeOne(sum, t.candidate, cfg.SummarizeModel)}
			}
		}()
	}
	for n := range todo {
		d := <-results
		if d.r.panicked != nil {
			for range len(todo) - n - 1 {
				<-results
			}
			panic(d.r.panicked)
		}
		t, raw := todo[d.i], d.r.c.raw
		// fallback= counts summarizer attempts that fell back (spec §5.7), not what send() sent.
		e, out := t.cached, d.r
		if t.rule.calls() {
			failed := d.r.source == "fallback"
			if failed {
				res.Fallback++
			}
			switch {
			case t.rule == ruleR3 && failed: // R3f: keep and send the cached llm summary (T8)
				e.Tries++
				e.Tried = now
				out = summarized{c: t.candidate, summary: t.cached.Summary, source: t.cached.Source}
			case t.rule == ruleR5 && failed:
				e = summarizedEntry(raw, d.r.summary, d.r.source, t.pfp, now, nil)
				e.Tries = t.cached.Tries + 1
			default:
				e = summarizedEntry(raw, d.r.summary, d.r.source, t.pfp, now, nil)
			}
			switch {
			case t.rule != ruleR1 && failed:
				res.Failed++
			case t.rule != ruleR1:
				res.Refreshed++
			}
		}
		e.CurPFP, e.LastMsg, e.Path, e.Seen = t.pfp, lastMsg(raw), raw.Path, now
		ruleName := string(t.rule)
		if t.rule == ruleR3 && d.r.source == "fallback" {
			ruleName = "R3f"
		}
		decided(t.key, ruleName, e)
		lost := res.Lost
		bm, ok := send(cfg, st, out, &res.Result, false, env)
		if b, has := state[t.key]; !ok && has && b.Mtime == raw.Mtime {
			// Rejected or lost, and the bookmark already matches the log (a refresh-set send or an R7
			// adoption): nothing re-parses it, so the entry stays as it was before this run, still due,
			// and the refresh set retries it (controller ruling on 3b concern 1). A rejection counts as
			// an attempt, so it is retried on the backoff (final-review ruling, finding 1).
			if res.Lost == lost {
				e = t.cached
				e.Tries++
				e.Tried = now
				cs.Sessions[t.key] = e
				saveCache(cfg, cs, env)
			}
			continue
		}
		if !ok {
			// Rejected or lost after the log moved: no bookmark, and bm stays what harvest_state holds,
			// so the entry is valid next run and the re-parse re-sends this summary (R2) instead of
			// making another.
			e.BM = nil
			if b, has := state[t.key]; has {
				e.BM = &b
			}
			cs.Sessions[t.key] = e
			saveCache(cfg, cs, env)
			continue
		}
		if !t.rule.calls() {
			// reused: every accepted or parked send of a cached summary that made no LLM call (R2, R4,
			// R6; controller ruling 10/21, counted at the outcome per final review finding 4). R3f is failed.
			res.Reused++
		}
		state[bm.key] = bm.b
		e.BM = &bm.b
		cs.Sessions[t.key] = e
		if err := saveStates(cfg, state, cs, env); err != nil {
			return res, err
		}
	}
	return res, nil
}
