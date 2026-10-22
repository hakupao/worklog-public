package cli

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/harvest"
	"github.com/hakupao/worklog/collector/internal/planjudge"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/review"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/summarize"
)

// pathArg is Path(s) for a root: Path("") is ".".
func pathArg(s string) string {
	if s == "" {
		return "."
	}
	return s
}

func runHarvest(env *rt.Env, p *parsed) int {
	var since *int
	if s, ok := p.last("--since"); ok {
		n, uerr := intOpt("wl harvest", "--since", s)
		if uerr != nil {
			return usage(env, uerr, false)
		}
		since = &n
	}
	tiered := p.flags["--tiered"]
	if tiered && p.flags["--refresh-meta"] {
		return usage(env, &usageError{"wl harvest", "--tiered cannot be combined with --refresh-meta"}, false)
	}
	cfg, c, code := setup(env)
	if code != 0 {
		return code
	}
	store := api.NewStore(c, cfg.Machine)

	// The lock comes before the flush, so two runs never replay one outbox, and is released on every
	// path out, a panic included (spec §5.9). Any other failure to take it only costs the protection.
	release, holder, lerr := acquireLock(cfg.LockPath(), env.Now(), lockStaleAfter, harvest.PidAlive)
	defer release()
	switch {
	case errors.Is(lerr, harvest.ErrLocked):
		env.Warnf("worklog: another harvest is running (%s, lock %s); skipped", holder, cfg.LockPath())
		if tiered {
			return 0
		}
		return 2
	case lerr != nil:
		env.Warnf("worklog: could not take the harvest lock %s (%v); running without it", cfg.LockPath(), lerr)
	}

	if sent, remaining := c.Flush(); sent != 0 || remaining != 0 {
		env.Warnf("outbox: sent=%d remaining=%d", sent, remaining)
	}

	// Only the roots given: one root alone drops the other agent; neither means the defaults.
	var roots []harvest.Root
	if s, ok := p.last("--claude-root"); ok {
		roots = append(roots, harvest.Root{Agent: "claude-code", Dir: pathArg(s)})
	}
	if s, ok := p.last("--codex-root"); ok {
		roots = append(roots, harvest.Root{Agent: "codex", Dir: pathArg(s)})
	}

	if p.flags["--refresh-meta"] {
		// No default window of its own: its point is sessions harvested before the metadata existed.
		sent, updated, outcome := harvest.RefreshMeta(cfg, c, roots, since, env)
		if outcome != api.OK {
			// Nothing was queued either way (the update is never parked), so a re-run is the fix.
			reason := "the server refused the update (is it deployed with migration 0004?)"
			if outcome == api.Retry {
				reason = "the server was unreachable"
			}
			env.Warnf("worklog: %s; nothing was queued, re-running it is safe", reason)
			return 2
		}
		out(env, "meta: sent=%d updated=%d", sent, updated)
		return 0
	}

	if since == nil {
		days := 14
		since = &days
	}
	runner := newRunner(env)
	sum := func(raw *session.RawSession, model string) (string, string) {
		return summarize.Summarize(runner, raw, model)
	}
	// Both modes keep the collector state; only tiered mode decides from it (spec §5.1).
	now := env.Now()
	cs := harvest.LoadCollectorState(cfg.CollectorStatePath())
	due := harvest.AllDue()
	var (
		tlog func(*pyjson.Object)
		tr   harvest.TieredResult
		res  harvest.Result
		err  error
	)
	if tiered {
		due = harvest.DueJobs(cs, now)
		tlog = harvest.NewTiersLog(cfg, env)
		tr, err = harvest.RunTiered(cfg, store, roots, sum, since, harvestWorkers, cs,
			harvest.TieredOpts{Now: now, Rescan: due.Rescan}, tlog, env)
		res = tr.Result
	} else {
		res, err = harvest.Run(cfg, store, roots, sum, since, harvestWorkers, cs, env)
	}
	if errors.Is(err, api.ErrUnavailable) {
		env.Warnf("worklog: api unreachable, harvest skipped (outbox will be flushed next run)")
		return 2
	}
	if err != nil {
		// The state file could not be written: Python's write_text raises (traceback, exit 1).
		crash(env, err)
		return 1
	}

	if tiered && due.Rescan { // the pass completed (spec §5.3)
		harvest.Record(cs, now, "rescan", "done")
	}

	// After a run that reached the server; never on --refresh-meta (returned above) or exit 2 (returned above).
	if beat := c.Heartbeat(cfg.Machine, res.New, res.Updated); beat != api.OK {
		env.Warnf("worklog: heartbeat not sent (%s)", beat)
	}

	// rejected and lost mean data did not survive; they are shown only when non-zero so the
	// everyday line keeps the shape the runbook checks against.
	trouble := ""
	if res.Rejected != 0 {
		trouble += " rejected=" + strconv.Itoa(res.Rejected)
	}
	if res.Lost != 0 {
		trouble += " lost=" + strconv.Itoa(res.Lost)
	}
	tail := ""
	if !tiered || due.Hour { // tiered: the week's count once an hour (O6)
		if n, ok := store.UnassignedThisWeek(env.Now()); ok {
			tail = ", unassigned=" + strconv.Itoa(n)
		}
	}
	out(env, "new=%d updated=%d parked=%d skipped=%d fallback=%d%s%s",
		res.New, res.Updated, res.Parked, res.Skipped, res.Fallback, trouble, tail)

	// The side jobs: whatever happens to them, harvest's own result above stands. Each records its
	// bucket (spec §5.3); tiered mode also logs its result.
	var jobs []string
	harvest.SideJobs(cfg, c, runner, env, due, func(job, result string) {
		harvest.Record(cs, now, job, result)
		if tiered {
			jobs = append(jobs, job+":"+result)
			l := pyjson.NewObject()
			l.Set("ts", pyjson.Float(float64(now.UnixNano())/1e9))
			l.Set("job", job)
			l.Set("result", result)
			tlog(l)
		}
	})
	harvest.Record(cs, now, "hour", "done")
	if err := harvest.SaveCollectorState(cfg.CollectorStatePath(), cs); err != nil {
		env.Warnf("worklog: could not save %s (%v); the next harvest re-summarizes what it cannot trust.", cfg.CollectorStatePath(), err)
	}
	if tiered {
		tiers := "15m"
		if due.Hour || due.PlanToday || due.Deliverables {
			tiers += ",1h"
		}
		if due.PlanYesterday || due.Rescan {
			tiers += ",day"
		}
		if due.Review {
			tiers += ",week"
		}
		env.Warnf("tiers: due=%s parsed=%d new=%d bootstrap=%d reused=%d refreshed=%d failed=%d adopted=%d jobs=%s",
			tiers, tr.Parsed, tr.NewSummaries, tr.Bootstrap, tr.Reused, tr.Refreshed, tr.Failed, tr.Adopted, strings.Join(jobs, ","))
	}
	return 0
}

// lockStaleAfter is the age past which a held lock is replaced whatever its pid (spec §5.9).
const lockStaleAfter = 60 * time.Minute

var weekShape = regexp.MustCompile(`^[0-9]{4}-W[0-9]{2}$`)

func runReview(env *rt.Env, p *parsed) int {
	const bad = "worklog: --week must look like 2026-W39"
	week, given := p.last("--week")
	// The shape is checked before the config is loaded, the ISO week after (cli.py:370-380).
	if given && !weekShape.MatchString(week) {
		env.Warnf(bad)
		return 2
	}
	cfg, c, code := setup(env)
	if code != 0 {
		return code
	}
	if given {
		if _, _, err := review.WeekBounds(week); err != nil {
			env.Warnf(bad)
			return 2
		}
	} else {
		week, _, _ = review.PreviousWeek(env.Now())
	}
	outcome := review.Run(cfg, c, week, p.flags["--force"], newRunner(env), env.Now())
	out(env, "review: %s %s", week, outcome)
	switch outcome {
	case "unreachable", "llm-failed", "rejected":
		review.Warn(env, outcome, week)
		return 2
	}
	return 0
}

func runPlanJudge(env *rt.Env, p *parsed) int {
	var day pytime.Date
	if s, _ := p.last("--date"); s != "" {
		d, err := pytime.ParseDate(s)
		if err != nil {
			env.Warnf("worklog: --date must look like 2026-10-02")
			return 2
		}
		day = d
	} else {
		day = planjudge.DaysToJudge(env.Now())[0]
	}
	cfg, c, code := setup(env)
	if code != 0 {
		return code
	}
	// Always forced: re-judge even when the fingerprint is unchanged.
	outcome := planjudge.Run(cfg, c, day, true, newRunner(env))
	out(env, "plan: %s %s", day, outcome)
	switch outcome {
	case "unreachable", "llm-failed", "bad-output", "rejected":
		planjudge.Warn(env, outcome, day)
		return 2
	}
	return 0
}
