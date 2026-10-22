package harvest

import (
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/deliverable"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/planjudge"
	"github.com/hakupao/worklog/collector/internal/review"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// SideJobClient is what the three side jobs need of api.Client.
type SideJobClient interface {
	review.Client
	planjudge.Client
	deliverable.Client
}

// guard runs job and returns what it panicked with, or nil. The side jobs panic where Python's code
// raises (with Python's str(exc) as the error text); a Go runtime error is caught the same way.
func guard(job func()) (panicked any) {
	defer func() { panicked = recover() }()
	job()
	return nil
}

// SideJobs is the tail of cli.harvest (cli.py:325-359): the weekly review of the previous Tokyo
// week, the plan judge for today and yesterday, and the deliverable judge. Whatever happens to
// them, harvest's own result stands: a panic prints "worklog: … skipped: {exc}" (where Python
// prints its exception) and the next job runs. Every line goes to stderr, in Python's order.
//
// Only the jobs due run, in that order (spec §5.6; full mode passes AllDue). Each one that ran is
// passed to record (nil: none) with its result word, ResultPanic for a panic; Record maps the word
// to the bucket written.
func SideJobs(cfg *config.Config, c SideJobClient, r llm.Runner, env *rt.Env, due Due, record func(job, result string)) {
	if record == nil {
		record = func(string, string) {}
	}
	now := env.Now()

	if due.Review {
		week, _, _ := review.PreviousWeek(now)
		var rv review.Result
		if p := guard(func() { rv = review.Run(cfg, c, "", false, r, now) }); p != nil {
			env.Warnf("worklog: weekly review %s skipped: %v", week, p)
			record("review", ResultPanic)
		} else {
			if rv == "stored" {
				env.Warnf("review: %s generated", week)
			}
			review.Warn(env, rv, week)
			record("review", string(rv))
		}
	}

	days := planjudge.DaysToJudge(now)
	for i, job := range []string{"plan_today", "plan_yesterday"} {
		if !(i == 0 && due.PlanToday || i == 1 && due.PlanYesterday) {
			continue
		}
		day := days[i]
		var pv planjudge.Result
		if p := guard(func() { pv = planjudge.Run(cfg, c, day, false, r) }); p != nil {
			env.Warnf("worklog: plan judge %s skipped: %v", day, p)
			record(job, ResultPanic)
			continue
		}
		if pv == "stored" {
			env.Warnf("plan: %s judged", day)
		}
		planjudge.Warn(env, pv, day)
		record(job, string(pv))
	}

	if !due.Deliverables {
		return
	}
	var dv deliverable.Result
	if p := guard(func() { dv = deliverable.Run(cfg, c, deliverable.HarvestBatches, r) }); p != nil {
		env.Warnf("worklog: deliverable judge skipped: %v", p)
		record("deliverables", ResultPanic)
		return
	}
	if dv == "stored" {
		env.Warnf("deliverables: judged")
	}
	deliverable.Warn(env, dv)
	record("deliverables", string(dv))
}
