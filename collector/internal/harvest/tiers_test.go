package harvest

import (
	"context"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

var jstZone = time.FixedZone("JST", 9*3600)

func jstAt(y int, m time.Month, d, h, min int) time.Time {
	return time.Date(y, m, d, h, min, 0, 0, jstZone)
}

func TestBucketsAreJST(t *testing.T) {
	for _, c := range []struct {
		name string
		f    func(time.Time) string
		at   time.Time
		want string
	}{
		{"hour 23:59", HourBucket, jstAt(2026, 10, 20, 23, 59), "2026-10-20T23"},
		{"hour 00:00", HourBucket, jstAt(2026, 10, 21, 0, 0), "2026-10-21T00"},
		{"hour from UTC", HourBucket, time.Date(2026, 10, 20, 15, 0, 0, 0, time.UTC), "2026-10-21T00"},
		{"day 04:59 is the previous day", DayBucket, jstAt(2026, 10, 21, 4, 59), "2026-10-20"},
		{"day 05:00 is today", DayBucket, jstAt(2026, 10, 21, 5, 0), "2026-10-21"},
		{"day from UTC", DayBucket, time.Date(2026, 10, 20, 20, 0, 0, 0, time.UTC), "2026-10-21"},
		{"week Sun 23:59", WeekBucket, jstAt(2026, 10, 25, 23, 59), "2026-W43"},
		{"week Mon 00:00", WeekBucket, jstAt(2026, 10, 26, 0, 0), "2026-W44"},
		{"week Mon 00:00 from UTC", WeekBucket, time.Date(2026, 10, 25, 15, 0, 0, 0, time.UTC), "2026-W44"},
		{"week 2026-W53 Thu", WeekBucket, jstAt(2026, 12, 31, 12, 0), "2026-W53"},
		{"week 2026-W53 Sun", WeekBucket, jstAt(2027, 1, 3, 23, 59), "2026-W53"},
		{"week 2027-W01 Mon", WeekBucket, jstAt(2027, 1, 4, 0, 0), "2027-W01"},
	} {
		if got := c.f(c.at); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

// recordAll records every job a run at now would record with result.
func recordAll(cs *CollectorState, now time.Time, result string) {
	for _, j := range []string{"review", "plan_today", "plan_yesterday", "deliverables", "rescan", "hour"} {
		Record(cs, now, j, result)
	}
}

func TestDueJobsAfterSleepFiresEachChangedBucketOnce(t *testing.T) {
	cs := emptyCollectorState()
	fri := jstAt(2026, 10, 16, 14, 10)
	recordAll(cs, fri, "stored")
	if d := DueJobs(cs, fri.Add(5*time.Minute)); d != (Due{}) {
		t.Fatalf("right after the run: %+v", d)
	}
	mon := jstAt(2026, 10, 19, 9, 20)
	if d, all := DueJobs(cs, mon), AllDue(); d != all {
		t.Fatalf("after sleep: %+v, want %+v", d, all)
	}
	recordAll(cs, mon, "stored")
	if d := DueJobs(cs, mon.Add(time.Second)); d != (Due{}) {
		t.Fatalf("immediate re-run: %+v", d)
	}
	// An empty state (first run) has everything due.
	if d := DueJobs(emptyCollectorState(), mon); d != AllDue() {
		t.Fatalf("empty state: %+v", d)
	}
}

// The §5.3 table, one word at a time.
func TestRecordTable(t *testing.T) {
	now := jstAt(2026, 10, 19, 4, 30) // day bucket 2026-10-18, week 2026-W43
	hour, day, week := "2026-10-19T04", "2026-10-18", "2026-W43"
	for _, c := range []struct {
		job, result string
		want        map[string]string
	}{
		{"plan_today", "unreachable", map[string]string{}},
		{"plan_today", "llm-failed", map[string]string{"plan_today": hour}},
		{"plan_today", "bad-output", map[string]string{"plan_today": hour}},
		{"plan_today", "stored", map[string]string{"plan_today": hour}},
		{"plan_today", ResultPanic, map[string]string{"plan_today": hour}},
		{"deliverables", "unreachable", map[string]string{}},
		{"deliverables", "partial", map[string]string{"deliverables": hour}},
		{"deliverables", "nothing", map[string]string{"deliverables": hour}},
		{"plan_yesterday", "unreachable", map[string]string{}},
		{"plan_yesterday", "no-plan", map[string]string{"plan_yesterday": day}},
		{"rescan", "unreachable", map[string]string{}},
		{"rescan", "done", map[string]string{"rescan": day}},
		{"review", "stored", map[string]string{"review": week}},
		{"review", "exists", map[string]string{"review": week}},
		{"review", "no-data", map[string]string{"review": week}},
		{"review", "rejected", map[string]string{"review": week}},
		{"review", "unreachable", map[string]string{"review_tried": hour}},
		{"review", "llm-failed", map[string]string{"review_tried": hour}},
		{"review", ResultPanic, map[string]string{"review_tried": hour}},
		{"hour", "done", map[string]string{"hour": hour}},
	} {
		cs := emptyCollectorState()
		Record(cs, now, c.job, c.result)
		if !maps.Equal(cs.Jobs, c.want) {
			t.Errorf("%s %s: jobs %v want %v", c.job, c.result, cs.Jobs, c.want)
		}
	}
}

// tierClient answers the side jobs as configured: one value per job decides its result.
type tierClient struct {
	reviewLookup api.Lookup
	dashboard    *pyjson.Object
	putReview    api.Outcome
	judgeLookup  api.Lookup
	judgeInput   *pyjson.Object
	judgePanic   bool
	pending      []*pyjson.Object // nil: the first pending call is unreachable
	pendingDown  bool             // after the first batch, the server goes away (partial)
	pendingCalls int
	calls        []string
}

func (c *tierClient) Review(week string) (*pyjson.Object, api.Lookup) {
	c.calls = append(c.calls, "review "+week)
	return obj("text", "x"), c.reviewLookup
}

func (c *tierClient) Dashboard(a, b pytime.Date) (*pyjson.Object, bool) {
	return c.dashboard, c.dashboard != nil
}

func (c *tierClient) PutReview(*pyjson.Object) (bool, api.Outcome) { return true, c.putReview }

func (c *tierClient) JudgeInput(day pytime.Date) (*pyjson.Object, api.Lookup) {
	c.calls = append(c.calls, "judge_input "+day.String())
	if c.judgePanic {
		panic("'items'")
	}
	return c.judgeInput, c.judgeLookup
}

func (c *tierClient) PostJudgement(pytime.Date, *pyjson.Object) api.Outcome { return api.OK }

func (c *tierClient) DeliverablePending(string, int) (*pyjson.Object, bool) {
	c.calls = append(c.calls, "pending")
	c.pendingCalls++
	if c.pending == nil || c.pendingDown && c.pendingCalls > 1 {
		return nil, false
	}
	items := []pyjson.Value{}
	for _, it := range c.pending {
		items = append(items, it)
	}
	return obj("items", items), true
}

func (c *tierClient) PostDeliverableVerdicts(v []*pyjson.Object) (int, api.Outcome) {
	return len(v), api.OK
}

type failingRunner struct{}

func (failingRunner) Run(context.Context, []string, []byte, time.Duration) (llm.Result, error) {
	return llm.Result{ExitCode: 1}, nil
}

var tierCfg = &config.Config{Machine: "m", SummarizeModel: "haiku"}

func planInput() *pyjson.Object {
	return obj("date", "2026-10-13", "fingerprint", "fp1", "judged_fingerprint", nil,
		"items", []pyjson.Value{obj("id", "i1", "title", "t")}, "sessions", []pyjson.Value{}, "notes", []pyjson.Value{})
}

func pendingItems() []*pyjson.Object {
	return []*pyjson.Object{obj("key", "/w/a.md", "task_title", "t", "project", "p")}
}

// runSideJobs runs SideJobs at goldenNow on a fresh state and returns the job:result words it
// recorded and the state they left.
func runSideJobs(t *testing.T, c SideJobClient, r llm.Runner, due Due) ([]string, *CollectorState, string) {
	t.Helper()
	env, stderr := testEnv(t, func() time.Time { return goldenNow })
	cs := emptyCollectorState()
	var words []string
	SideJobs(tierCfg, c, r, env, due, func(job, result string) {
		words = append(words, job+":"+result)
		Record(cs, goldenNow, job, result)
	})
	return words, cs, stderr.String()
}

// The §5.3 table driven through SideJobs: each job's real result word reaches record.
func TestRecordRulesPerResult(t *testing.T) {
	hour, day, week := HourBucket(goldenNow), DayBucket(goldenNow), WeekBucket(goldenNow)
	for _, c := range []struct {
		name   string
		client *tierClient
		runner llm.Runner
		words  []string
		jobs   map[string]string
	}{
		{
			name:   "all unreachable: only review_tried",
			client: &tierClient{reviewLookup: api.Unavailable, judgeLookup: api.Unavailable},
			runner: failingRunner{},
			words:  []string{"review:unreachable", "plan_today:unreachable", "plan_yesterday:unreachable", "deliverables:unreachable"},
			jobs:   map[string]string{"review_tried": hour},
		},
		{
			name: "llm-failed: hourly and daily record, review records review_tried",
			client: &tierClient{reviewLookup: api.Missing, dashboard: obj("overview", obj("sessions", pyjson.Int(1))),
				judgeLookup: api.Found, judgeInput: planInput(), pending: pendingItems()},
			runner: failingRunner{},
			words:  []string{"review:llm-failed", "plan_today:llm-failed", "plan_yesterday:llm-failed", "deliverables:llm-failed"},
			jobs:   map[string]string{"review_tried": hour, "plan_today": hour, "plan_yesterday": day, "deliverables": hour},
		},
		{
			name:   "exists, no-plan and a partial deliverables run all record",
			client: &tierClient{reviewLookup: api.Found, judgeLookup: api.Missing, pending: pendingItems(), pendingDown: true},
			runner: cannedRunner{`[{"id": "F1", "verdict": "in"}]`},
			words:  []string{"review:exists", "plan_today:no-plan", "plan_yesterday:no-plan", "deliverables:partial"},
			jobs:   map[string]string{"review": week, "plan_today": hour, "plan_yesterday": day, "deliverables": hour},
		},
		{
			name: "no-data, bad-output",
			client: &tierClient{reviewLookup: api.Missing, dashboard: obj("overview", obj("sessions", pyjson.Int(0))),
				judgeLookup: api.Found, judgeInput: planInput(), pending: []*pyjson.Object{}},
			runner: cannedRunner{"not json"},
			words:  []string{"review:no-data", "plan_today:bad-output", "plan_yesterday:bad-output", "deliverables:nothing"},
			jobs:   map[string]string{"review": week, "plan_today": hour, "plan_yesterday": day, "deliverables": hour},
		},
		{
			name: "rejected review",
			client: &tierClient{reviewLookup: api.Missing, dashboard: obj("overview", obj("sessions", pyjson.Int(1))),
				putReview: api.Rejected, judgeLookup: api.Unavailable},
			runner: cannedRunner{"text"},
			words:  []string{"review:rejected", "plan_today:unreachable", "plan_yesterday:unreachable", "deliverables:unreachable"},
			jobs:   map[string]string{"review": week},
		},
		{
			name:   "panics record as a failed attempt",
			client: &tierClient{reviewLookup: api.Missing, dashboard: obj("overview", "x"), judgePanic: true},
			runner: failingRunner{},
			words:  []string{"review:panic", "plan_today:panic", "plan_yesterday:panic", "deliverables:unreachable"},
			jobs:   map[string]string{"review_tried": hour, "plan_today": hour, "plan_yesterday": day},
		},
	} {
		words, cs, _ := runSideJobs(t, c.client, c.runner, AllDue())
		if !slices.Equal(words, c.words) {
			t.Errorf("%s: words %v want %v", c.name, words, c.words)
		}
		if !maps.Equal(cs.Jobs, c.jobs) {
			t.Errorf("%s: jobs %v want %v", c.name, cs.Jobs, c.jobs)
		}
	}
}

func TestReviewLlmFailedRetriesAtTheNextHourNotTheNextRun(t *testing.T) {
	for _, result := range []string{"llm-failed", "unreachable"} {
		cs := emptyCollectorState()
		at := jstAt(2026, 10, 19, 10, 5)
		Record(cs, at, "review", result)
		if DueJobs(cs, at.Add(15*time.Minute)).Review {
			t.Errorf("%s: review due again in the same hour", result)
		}
		if !DueJobs(cs, jstAt(2026, 10, 19, 11, 0)).Review {
			t.Errorf("%s: review not due at the next hour", result)
		}
		Record(cs, jstAt(2026, 10, 19, 11, 0), "review", "stored")
		if DueJobs(cs, jstAt(2026, 10, 19, 12, 0)).Review {
			t.Errorf("%s: review due after it was stored this week", result)
		}
	}
}

func TestSideJobsAllDuePrintsTodaysLinesInTodaysOrder(t *testing.T) {
	c := &sideClient{
		dashboard:  obj("overview", obj("sessions", pyjson.Int(3))),
		judgeInput: planInput(),
		pending:    pendingItems(),
	}
	words, _, stderr := runSideJobs(t, c, cannedRunner{`[{"id": "i1", "status": "done"}, {"id": "F1", "verdict": "in"}]`}, AllDue())
	want := "review: 2026-W41 generated\nplan: 2026-10-13 judged\nplan: 2026-10-12 judged\ndeliverables: judged\n"
	if stderr != want {
		t.Fatalf("stderr\n%s\nwant\n%s", stderr, want)
	}
	if w := []string{"review:stored", "plan_today:stored", "plan_yesterday:stored", "deliverables:stored"}; !slices.Equal(words, w) {
		t.Fatalf("words %v", words)
	}
	if w := []string{"review 2026-W41", "dashboard", "review 2026-W40", "put_review", "judge_input 2026-10-13", "post_judgement",
		"judge_input 2026-10-12", "post_judgement", "pending", "post_verdicts", "pending"}; !slices.Equal(c.calls, w) {
		t.Fatalf("calls %v", c.calls)
	}
}

// Tiered mode runs only the due jobs, still in today's order.
func TestSideJobsRunOnlyTheDueJobs(t *testing.T) {
	c := &tierClient{reviewLookup: api.Found, judgeLookup: api.Missing, pending: []*pyjson.Object{}}
	words, _, _ := runSideJobs(t, c, failingRunner{}, Due{PlanYesterday: true, Deliverables: true})
	if w := []string{"plan_yesterday:no-plan", "deliverables:nothing"}; !slices.Equal(words, w) {
		t.Fatalf("words %v", words)
	}
	if got := strings.Join(c.calls, ","); got != "judge_input 2026-10-12,pending" {
		t.Fatalf("calls %s", got)
	}
	words, _, _ = runSideJobs(t, &tierClient{reviewLookup: api.Found}, failingRunner{}, Due{})
	if len(words) != 0 {
		t.Fatalf("nothing due ran %v", words)
	}
}
