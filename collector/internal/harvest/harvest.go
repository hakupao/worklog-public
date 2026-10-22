// Package harvest is harvest/run.py: parse the agents' logs, skip what the server already has,
// summarize and send the rest one session per request, and remember what was sent in
// harvest_state.json (spec §4.5); and --refresh-meta (spec §4.12).
package harvest

import (
	"strings"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/claudecode"
	"github.com/hakupao/worklog/collector/internal/codex"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/link"
	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/tokens"
)

// Root is one agent's log root. Roots are scanned in order; an empty slice means the defaults.
type Root struct{ Agent, Dir string }

// Result is HarvestResult. Rejected sessions sit in outbox/rejected/, which is never replayed;
// lost ones could not even be written to disk. Neither is bookmarked, so the next run parses them
// again: that is the only thing keeping them.
type Result struct{ New, Updated, Skipped, Fallback, Parked, Rejected, Lost int }

// Summarizer is summarize.summarize with its runner bound.
type Summarizer func(raw *session.RawSession, model string) (summary, source string)

// Store is what harvest needs of api.Store.
type Store interface {
	Tasks() ([]model.Task, error)
	Append(model.Session) (*api.IngestResult, api.Outcome)
	OutboxDir() string
}

// MetaClient is what --refresh-meta needs of api.Client.
type MetaClient interface {
	PutSessionMeta([]*pyjson.Object) (int, api.Outcome)
}

// The real API types satisfy the interfaces harvest and its side jobs take.
var (
	_ Store         = (*api.Store)(nil)
	_ MetaClient    = (*api.Client)(nil)
	_ SideJobClient = (*api.Client)(nil)
)

// gapMinutes is base.active_intervals' default gap.
const gapMinutes = 30

type iterFunc func(root string, since *float64, env *rt.Env, yield func(*session.RawSession))

// parsers is _PARSERS; an agent not in it is skipped.
var parsers = map[string]iterFunc{"claude-code": claudecode.IterSessions, "codex": codex.IterSessions}

func defaultRoots(env *rt.Env) []Root {
	return []Root{{"claude-code", claudecode.DefaultRoot(env.Home)}, {"codex", codex.DefaultRoot(env.Home)}}
}

// sinceEpoch is time.time() - days * 86400.
func sinceEpoch(now time.Time, days int) float64 {
	return float64(now.Unix()) + float64(now.Nanosecond())*1e-9 - float64(days)*86400
}

// scan yields every session of every root in order, with its agent, only for logs modified within
// the last sinceDays days (nil = all).
func scan(roots []Root, sinceDays *int, env *rt.Env, yield func(agent string, raw *session.RawSession)) {
	if len(roots) == 0 { // roots or _default_roots()
		roots = defaultRoots(env)
	}
	var since *float64
	if sinceDays != nil {
		s := sinceEpoch(env.Now(), *sinceDays)
		since = &s
	}
	for _, r := range roots {
		parse, ok := parsers[r.Agent]
		if !ok {
			continue
		}
		parse(r.Dir, since, env, func(raw *session.RawSession) { yield(r.Agent, raw) })
	}
}

func isExcluded(cwd string, patterns []string) bool {
	for _, p := range patterns {
		if strings.Contains(cwd, p) {
			return true
		}
	}
	return false
}

// isTrivial: one prompt and no sustained activity, or a hook's prompt. Such a session is noise,
// skipped but bookmarked by mtime so it is not parsed again until it grows.
func isTrivial(raw *session.RawSession, cfg *config.Config) bool {
	n := session.Turns(raw.Messages)
	firstUser := ""
	for _, m := range raw.Messages {
		if m.Role == "user" {
			firstUser = m.Text
			break
		}
	}
	hook := false
	for _, p := range cfg.ExcludePromptPatterns {
		if strings.Contains(firstUser, p) {
			hook = true
			break
		}
	}
	return n == 0 || hook || n <= 1 && session.ActiveMinutes(raw.Messages, gapMinutes) < cfg.MinActiveMinutes
}

func candidates(tasks []model.Task) []link.Candidate {
	out := make([]link.Candidate, len(tasks))
	for i, t := range tasks {
		out[i] = link.Candidate{ID: t.ID, Project: t.Project, Status: t.Status, ReceivedAt: t.ReceivedAt, DoneAt: t.DoneAt}
	}
	return out
}

type candidate struct {
	agent, key string
	raw        *session.RawSession
	taskID     *string
	linkMethod string
	fp         string
}

type summarized struct {
	c               candidate
	summary, source string
	panicked        any // what the summarizer panicked with, re-raised on the caller's goroutine
}

// summarizeOne runs the summarizer and turns a panic into a result, so it reaches the goroutine
// that called Run (where a recover can see it) instead of killing the process from a worker.
func summarizeOne(sum Summarizer, c candidate, model string) (r summarized) {
	r.c = c
	defer func() {
		if p := recover(); p != nil {
			r.panicked = p
		}
	}()
	r.summary, r.source = sum(c.raw, model)
	return r
}

// Run is harvest(). The task list is read before anything is parsed, summarized or written: without
// it every session would be linked to nothing, so an unreachable server (api.ErrUnavailable) means
// "do not harvest", not "harvest badly". A state file that cannot be written ends the run with
// that error, as Python's write_text raising does.
//
// Phase 1 parses, filters, links and fingerprints sequentially, then saves the state. Phase 2
// summarizes on workers goroutines (at least one); this goroutine takes the results in completion
// order and does every send and bookmark (with workers=1 that is candidate order).
//
// A non-nil cs records the summary cache on every bookmark write (spec §5.1, §5.2) and is saved
// after harvest_state.json at each of its save points; nothing is decided from it.
func Run(cfg *config.Config, st Store, roots []Root, sum Summarizer, sinceDays *int, workers int, cs *CollectorState, env *rt.Env) (Result, error) {
	var res Result
	tasks, err := st.Tasks()
	if err != nil {
		return res, err
	}
	known := candidates(tasks)
	flavour := pypath.HostFlavour(env.GOOS)
	statePath := cfg.StatePath()
	state := LoadState(statePath)
	now := epoch(env.Now())

	var todo []candidate
	scan(roots, sinceDays, env, func(agent string, raw *session.RawSession) {
		key := agent + ":" + raw.SessionID
		prev, hasPrev := state[key]
		if hasPrev && prev.Mtime == raw.Mtime {
			res.Skipped++
			return
		}
		if isExcluded(raw.Cwd, cfg.ExcludeCwdPatterns) {
			res.Skipped++
			return
		}
		if isTrivial(raw, cfg) {
			res.Skipped++
			putBookmark(state, cs, key, Bookmark{Mtime: raw.Mtime})
			return
		}
		// A manual link is preserved by the server's upsert, so the collector always sends its own
		// guess and never reads the session back.
		var start, end *pytime.Instant
		if s, ok := session.StartedAt(raw.Messages); ok {
			start = &s
		}
		if e, ok := session.EndedAt(raw.Messages); ok {
			end = &e
		}
		taskID, method := link.Decide(raw.Cwd, start, end, known, cfg.Projects, flavour)
		// The log moved but says nothing new: the server has this exact record, so only the
		// bookmark moves on.
		in := fingerprintInput(raw, taskID, method)
		if onFingerprint != nil {
			onFingerprint(in)
		}
		fp := digest(in)
		if hasPrev && prev.FP != nil && *prev.FP == fp {
			res.Skipped++
			if putBookmark(state, cs, key, Bookmark{Mtime: raw.Mtime, FP: &fp}) {
				cs.moved(key, raw, PromptDigest(raw), now)
			}
			return
		}
		todo = append(todo, candidate{agent, key, raw, taskID, method, fp})
	})
	if err := saveStates(cfg, state, cs, env); err != nil {
		return res, err
	}

	// Both channels hold every candidate, so a worker never blocks and an early return leaks none.
	jobs := make(chan candidate, len(todo))
	for _, c := range todo {
		jobs <- c
	}
	close(jobs)
	results := make(chan summarized, len(todo))
	for range max(workers, 1) {
		go func() {
			for c := range jobs {
				results <- summarizeOne(sum, c, cfg.SummarizeModel)
			}
		}()
	}
	for n := range todo {
		r := <-results
		if r.panicked != nil {
			// As fut.result() re-raises in Python: the sessions handled so far are bookmarked and
			// saved; the rest are left for the next run. Leaving the `with ThreadPoolExecutor` block
			// first waits for every submitted session (shutdown(wait=True) cancels none), so their
			// claude calls still happen; their results are dropped.
			for range len(todo) - n - 1 {
				<-results
			}
			panic(r.panicked)
		}
		if bm, ok := send(cfg, st, r, &res, true, env); ok {
			state[bm.key] = bm.b
			if cs != nil {
				cs.Sessions[bm.key] = summarizedEntry(r.c.raw, r.summary, r.source, PromptDigest(r.c.raw), now, &bm.b)
			}
			if err := saveStates(cfg, state, cs, env); err != nil {
				return res, err
			}
		}
	}
	return res, nil
}

type keyed struct {
	key string
	b   Bookmark
}

// send builds the Session for one summarized candidate, sends it, counts the outcome, and says
// which bookmark to write: only for a session that reached durable storage (the server, or the
// outbox on Retry). Rejected and Lost are never bookmarked, so the next run tries them again.
// countFallback is full mode's fallback= count; tiered mode counts at the summary attempt instead.
func send(cfg *config.Config, st Store, r summarized, res *Result, countFallback bool, env *rt.Env) (keyed, bool) {
	c, raw := r.c, r.c.raw
	if countFallback && r.source == "fallback" {
		res.Fallback++
	}
	started, _ := session.StartedAt(raw.Messages)
	ended, _ := session.EndedAt(raw.Messages)
	s := model.NewSession("S"+pystr.Head(raw.SessionID, 8), pytime.Naive(env.NowLocal()), cfg.Machine, c.agent,
		raw.SessionID, raw.Cwd, started, ended, session.ActiveMinutes(raw.Messages, gapMinutes),
		session.Turns(raw.Messages), r.summary)
	s.SummarySource = r.source
	s.TaskID, s.LinkMethod = c.taskID, c.linkMethod
	// The parser's lists are Python's default_factory=list: [] on the wire, never null.
	s.FilesWritten = orEmpty(raw.FilesWritten)
	s.ActiveIntervals = orEmpty(session.ActiveIntervals(raw.Messages, gapMinutes))
	s.Artifacts = orEmpty(raw.Artifacts)
	s.Tokens = tokens.WithCost(raw.Tokens, cfg.Pricing)

	ingested, out := st.Append(s)
	switch out {
	case api.OK:
		if ingested != nil {
			res.New += ingested.Inserted
			res.Updated += ingested.Updated
		}
	case api.Retry:
		// Parked in the outbox: it still reached durable storage, so do not re-parse it.
		res.Parked++
	case api.Rejected:
		// outbox/rejected/ is a record of a refusal, not a queue.
		res.Rejected++
		env.Warnf("worklog: the server refused session %s; it is in %s/rejected/ and will not be sent. "+
			"The next harvest will try it again.", s.ID, st.OutboxDir())
		return keyed{}, false
	default:
		// Lost: parking failed, so the record is nowhere. The client already said why.
		res.Lost++
		env.Warnf("worklog: session %s could not be saved anywhere; the next harvest will try it again.", s.ID)
		return keyed{}, false
	}
	// A fallback summary is not the record we want on the server: without the fingerprint, the
	// next time the log moves it is summarized again (and repaired once claude works).
	b := Bookmark{Mtime: raw.Mtime}
	if r.source != "fallback" {
		fp := c.fp
		b.FP = &fp
	}
	return keyed{c.key, b}, true
}

func orEmpty[T any](l []T) []T {
	if l == nil {
		return []T{}
	}
	return l
}
