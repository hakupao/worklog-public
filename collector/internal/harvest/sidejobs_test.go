package harvest

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// sideClient answers the three side jobs. A non-nil panic field makes that call panic, as the
// Python code raises.
type sideClient struct {
	dashboard                *pyjson.Object
	judgeInput               *pyjson.Object
	judgePanic, pendingPanic error
	pending                  []*pyjson.Object
	calls                    []string
}

func (c *sideClient) Review(week string) (*pyjson.Object, api.Lookup) {
	c.calls = append(c.calls, "review "+week)
	return nil, api.Missing
}

func (c *sideClient) Dashboard(a, b pytime.Date) (*pyjson.Object, bool) {
	c.calls = append(c.calls, "dashboard")
	return c.dashboard, c.dashboard != nil
}

func (c *sideClient) PutReview(*pyjson.Object) (bool, api.Outcome) {
	c.calls = append(c.calls, "put_review")
	return true, api.OK
}

func (c *sideClient) JudgeInput(day pytime.Date) (*pyjson.Object, api.Lookup) {
	c.calls = append(c.calls, "judge_input "+day.String())
	if c.judgePanic != nil && day.D == 13 {
		panic(c.judgePanic)
	}
	if c.judgeInput == nil {
		return nil, api.Unavailable
	}
	return c.judgeInput, api.Found
}

func (c *sideClient) PostJudgement(pytime.Date, *pyjson.Object) api.Outcome {
	c.calls = append(c.calls, "post_judgement")
	return api.OK
}

func (c *sideClient) DeliverablePending(string, int) (*pyjson.Object, bool) {
	c.calls = append(c.calls, "pending")
	if c.pendingPanic != nil {
		panic(c.pendingPanic)
	}
	o := pyjson.NewObject()
	items := []pyjson.Value{}
	for _, it := range c.pending {
		items = append(items, it)
	}
	c.pending = nil
	o.Set("items", items)
	return o, true
}

func (c *sideClient) PostDeliverableVerdicts(v []*pyjson.Object) (int, api.Outcome) {
	c.calls = append(c.calls, "post_verdicts")
	return len(v), api.OK
}

type cannedRunner struct{ out string }

func (r cannedRunner) Run(context.Context, []string, []byte, time.Duration) (llm.Result, error) {
	return llm.Result{Stdout: []byte(r.out)}, nil
}

func obj(kv ...any) *pyjson.Object {
	o := pyjson.NewObject()
	for i := 0; i < len(kv); i += 2 {
		o.Set(kv[i].(string), kv[i+1])
	}
	return o
}

// A heatmap whose one cell is NaN: digest_rhythm's round() raises ValueError in Python.
func nanHeatmap() []pyjson.Value {
	rows := make([]pyjson.Value, 7)
	for d := range rows {
		row := make([]pyjson.Value, 24)
		for h := range row {
			row[h] = pyjson.Int(0)
		}
		rows[d] = row
	}
	rows[2].([]pyjson.Value)[5] = pyjson.Float(math.NaN())
	return rows
}

// Side jobs never fail harvest (cli.py:325-359): a panic in any of them prints Python's
// "worklog: … skipped: {exc}" line and the next job still runs; the plan judge goes on to the next day.
func TestSideJobsRecoverEveryPanic(t *testing.T) {
	c := &sideClient{
		dashboard:    obj("overview", obj("sessions", pyjson.Int(1)), "rhythm", obj("heatmap", nanHeatmap())),
		judgePanic:   errors.New("'items'"),
		pendingPanic: errors.New("argument should be a str or an os.PathLike object, not 'int'"),
	}
	env, stderr := testEnv(t, func() time.Time { return goldenNow })
	SideJobs(&config.Config{Machine: "m", SummarizeModel: "haiku"}, c, cannedRunner{"x"}, env, AllDue(), nil)
	want := "worklog: weekly review 2026-W41 skipped: cannot convert float NaN to integer\n" +
		"worklog: plan judge 2026-10-13 skipped: 'items'\n" +
		"worklog: plan judge 2026-10-12 skipped: the server could not be reached (or is not deployed with migration 0007); the next harvest retries\n" +
		"worklog: deliverable judge skipped: argument should be a str or an os.PathLike object, not 'int'\n"
	if got := stderr.String(); got != want {
		t.Fatalf("stderr\n%s\nwant\n%s", got, want)
	}
	if len(c.calls) != 5 || c.calls[4] != "pending" {
		t.Fatalf("calls %v", c.calls)
	}
}

// A shape panic in review.Run itself, and a Go runtime panic, are reported the same way.
func TestSideJobsRecoverARuntimePanic(t *testing.T) {
	c := &sideClient{dashboard: obj("overview", "x")} // review: 'str' object has no attribute 'get'
	env, stderr := testEnv(t, func() time.Time { return goldenNow })
	var nilCfg *config.Config
	func() {
		defer func() {
			if p := recover(); p != nil {
				t.Fatalf("SideJobs panicked: %v", p)
			}
		}()
		SideJobs(nilCfg, c, cannedRunner{"x"}, env, AllDue(), nil)
	}()
	// The nil config makes the deliverable judge dereference nil: a Go runtime panic, recovered too.
	want := "worklog: weekly review 2026-W41 skipped: 'str' object has no attribute 'get'\n" +
		"worklog: plan judge 2026-10-13 skipped: the server could not be reached (or is not deployed with migration 0007); the next harvest retries\n" +
		"worklog: plan judge 2026-10-12 skipped: the server could not be reached (or is not deployed with migration 0007); the next harvest retries\n" +
		"worklog: deliverable judge skipped: runtime error: invalid memory address or nil pointer dereference\n"
	if got := stderr.String(); got != want {
		t.Fatalf("stderr\n%s\nwant\n%s", got, want)
	}
}

// The lines a successful run prints, in cli.py's order.
func TestSideJobsReportWhatTheyStored(t *testing.T) {
	c := &sideClient{
		dashboard: obj("overview", obj("sessions", pyjson.Int(3))),
		judgeInput: obj("date", "2026-10-13", "fingerprint", "fp1", "judged_fingerprint", nil, "items", []pyjson.Value{obj("id", "i1", "title", "t")},
			"sessions", []pyjson.Value{}, "notes", []pyjson.Value{}),
		pending: []*pyjson.Object{obj("key", "/w/a.md", "task_title", "t", "project", "p")},
	}
	env, stderr := testEnv(t, func() time.Time { return goldenNow })
	SideJobs(&config.Config{Machine: "m", SummarizeModel: "haiku"}, c,
		cannedRunner{`[{"id": "i1", "status": "done"}, {"id": "F1", "verdict": "in"}]`}, env, AllDue(), nil)
	want := "review: 2026-W41 generated\nplan: 2026-10-13 judged\nplan: 2026-10-12 judged\ndeliverables: judged\n"
	if got := stderr.String(); got != want {
		t.Fatalf("stderr\n%s\nwant\n%s", got, want)
	}
}
