package planjudge

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

func decode(t *testing.T, s string) pyjson.Value {
	t.Helper()
	v, err := pyjson.Decode([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func obj(t *testing.T, s string) *pyjson.Object { return decode(t, s).(*pyjson.Object) }

func at(o *pyjson.Object, keys ...string) pyjson.Value {
	var v pyjson.Value = o
	for _, k := range keys {
		v, _ = v.(*pyjson.Object).Get(k)
	}
	return v
}

var d = pytime.Date{Y: 2026, M: 10, D: 2}
var cfg = &config.Config{Machine: "macmini", SummarizeModel: "haiku"}

const input = `{"date": "2026-10-02", "fingerprint": "ffff", "judged_fingerprint": null,
 "items": [{"id": "D1", "text": "worklog", "detail": "至少 2 轮", "task_ids": [], "task_titles": []}],
 "sessions": [{"id": "S1", "agent": "claude-code", "task_id": null, "task_title": null, "project": "worklog",
               "summary": "plan 功能", "minutes": 60, "turns": 6, "turns_estimated": false}],
 "notes": []}`

const row = `{"id": "D1", "status": "done", "progress": "6/2 轮", "evidence": ["S1"], "note": "达成"}`
const good = "[" + row + "]"

type client struct {
	inp    *pyjson.Object
	lk     api.Lookup
	post   api.Outcome
	posted []*pyjson.Object
}

func (c *client) JudgeInput(pytime.Date) (*pyjson.Object, api.Lookup) { return c.inp, c.lk }

func (c *client) PostJudgement(_ pytime.Date, body *pyjson.Object) api.Outcome {
	c.posted = append(c.posted, body)
	return c.post
}

func newClient(t *testing.T, inp string) *client {
	return &client{inp: obj(t, inp), lk: api.Found, post: api.OK}
}

type runner struct {
	code   int
	stdout string
	err    error
	calls  []pyjson.Value
}

func (r *runner) Run(_ context.Context, argv []string, stdin []byte, timeout time.Duration) (llm.Result, error) {
	a := []pyjson.Value{}
	for _, s := range argv {
		a = append(a, s)
	}
	c := pyjson.NewObject()
	c.Set("argv", a)
	c.Set("input", string(stdin))
	c.Set("timeout", pyjson.Int(timeout/time.Second))
	r.calls = append(r.calls, c)
	return llm.Result{Stdout: []byte(r.stdout), ExitCode: r.code}, r.err
}

func answer(s string) *runner { return &runner{stdout: s} }

func ids(rows []*pyjson.Object) string {
	var out []string
	for _, r := range rows {
		out = append(out, at(r, "id").(string))
	}
	return strings.Join(out, ",")
}

func TestDaysToJudgeIsTodayThenYesterdayInTokyo(t *testing.T) {
	// 2026-10-01 16:00 UTC is already 10/2 01:00 in Tokyo.
	got := DaysToJudge(time.Date(2026, 10, 1, 16, 0, 0, 0, time.UTC))
	if len(got) != 2 || got[0].String() != "2026-10-02" || got[1].String() != "2026-10-01" {
		t.Fatal(got)
	}
}

func TestPromptCarriesItemsSessionsAndTheRules(t *testing.T) {
	p := BuildPrompt(obj(t, input))
	for _, s := range []string{"至少 2 轮", `"S1"`, "plan 功能", "只输出 JSON", "task_titles", "这些案件中任一案件的 session"} {
		if !strings.Contains(p, s) {
			t.Errorf("missing %q", s)
		}
	}
	if strings.Contains(p, "task_id）") {
		t.Error("stale rule")
	}
}

func TestPromptJudgesAgainstTheDaysDetailNotTheTitle(t *testing.T) {
	p := BuildPrompt(obj(t, input))
	for _, s := range []string{"detail 是今天的目标", "不要求今天完成", "detail 为空时才按 text 判断", "「summary 没写明完成」不是判 partial 的理由", "全部满足才是 done"} {
		if !strings.Contains(p, s) {
			t.Errorf("missing %q", s)
		}
	}
	if strings.Contains(p, "做了一部分是 partial") {
		t.Error("stale rule")
	}
}

var d1 = map[string]bool{"D1": true}

func TestParseStripsFencesAndProseAndValidates(t *testing.T) {
	rows, ok := ParseOutput("好的：\n```json\n"+good+"\n```\n以上。", d1)
	if !ok || len(rows) != 1 || !pyjson.Equal(rows[0], obj(t, row)) {
		t.Fatalf("%v %v", rows, ok)
	}
}

func TestParseDropsUnknownItemsAndBadRowsButKeepsGoodOnes(t *testing.T) {
	rows, ok := ParseOutput(`[{"id": "D1", "status": "partial", "progress": "1/2 轮", "evidence": ["S1"], "note": ""},
		{"id": "D9", "status": "done", "progress": "", "evidence": [], "note": ""}]`, d1)
	if !ok || ids(rows) != "D1" {
		t.Fatal(rows)
	}
	for _, bad := range []string{`[{"id": "D1", "status": "完成"}]`, "not json", "{}"} {
		if _, ok := ParseOutput(bad, d1); ok {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestParseToleratesUnhashableIDAndStatus(t *testing.T) {
	rows, ok := ParseOutput(`[{"id": ["D1"], "status": "done"}, {"id": "D1", "status": "done", "progress": "", "evidence": [], "note": ""}]`, d1)
	if !ok || ids(rows) != "D1" {
		t.Fatal(rows)
	}
	if _, ok := ParseOutput(`[{"id": "D1", "status": {}}]`, d1); ok {
		t.Error("dict status accepted")
	}
}

func TestParseFillsMissingOptionalFieldsAndTruncates(t *testing.T) {
	rows, ok := ParseOutput(`[{"id": "D1", "status": "none", "progress": "`+strings.Repeat("x", 500)+`"}]`, d1)
	want := obj(t, `{"id": "D1", "status": "none", "progress": "`+strings.Repeat("x", 200)+`", "evidence": [], "note": ""}`)
	if !ok || len(rows) != 1 || !pyjson.Equal(rows[0], want) {
		t.Fatal(rows)
	}
}

func TestStoresAJudgementWithTheInputFingerprint(t *testing.T) {
	c := newClient(t, input)
	if r := Run(cfg, c, d, false, answer(good)); r != "stored" {
		t.Fatal(r)
	}
	b := c.posted[0]
	if at(b, "fingerprint") != "ffff" || at(b, "model") != "haiku" || at(b, "machine") != "macmini" ||
		at(at(b, "items").([]pyjson.Value)[0].(*pyjson.Object), "status") != "done" {
		t.Fatalf("%s", pyjson.Compact(b))
	}
}

func TestSkipsWhenNothingChangedUnlessForced(t *testing.T) {
	c := newClient(t, input)
	c.inp.Set("judged_fingerprint", "ffff")
	if r := Run(cfg, c, d, false, answer(good)); r != "unchanged" || len(c.posted) != 0 {
		t.Fatal(r)
	}
	if r := Run(cfg, c, d, true, answer(good)); r != "stored" {
		t.Fatal(r)
	}
}

func TestNoPlanNoItemsAndUnreachable(t *testing.T) {
	noItems := newClient(t, input)
	noItems.inp.Set("items", []pyjson.Value{})
	for _, c := range []struct {
		c    *client
		want Result
	}{
		{&client{lk: api.Missing}, "no-plan"},
		{noItems, "no-items"},
		{&client{lk: api.Unavailable}, "unreachable"},
	} {
		if r := Run(cfg, c.c, d, false, answer(good)); r != c.want {
			t.Errorf("got %s, want %s", r, c.want)
		}
	}
}

func TestLLMFailureAndBadOutputWriteNothing(t *testing.T) {
	c := newClient(t, input)
	if r := Run(cfg, c, d, false, &runner{code: 1}); r != "llm-failed" {
		t.Fatal(r)
	}
	if r := Run(cfg, c, d, false, answer("我觉得完成了")); r != "bad-output" {
		t.Fatal(r)
	}
	if len(c.posted) != 0 {
		t.Fatal("posted")
	}
}

func TestServerOutcomesPassThrough(t *testing.T) {
	for out, want := range map[api.Outcome]Result{api.Stale: "stale", api.Rejected: "rejected", api.Retry: "unreachable"} {
		c := newClient(t, input)
		c.post = out
		if r := Run(cfg, c, d, false, answer(good)); r != want {
			t.Errorf("%s: %s", out, r)
		}
	}
}

func TestRunnerExceptionIsLLMFailed(t *testing.T) {
	if r := Run(cfg, newClient(t, input), d, false, &runner{err: errors.New("claude not found")}); r != "llm-failed" {
		t.Fatal(r)
	}
}

// Python raises on these input shapes (KeyError / TypeError); Go panics with the same message.
func TestInputShapesPythonRaisesOnPanicWithItsMessage(t *testing.T) {
	for _, c := range []struct{ inp, msg string }{
		{`{"items": [{"id": "D1"}], "fingerprint": "f", "sessions": [], "notes": []}`, "'date'"},
		{`{"date": "d", "items": [{"x": 1}], "fingerprint": "f", "sessions": [], "notes": []}`, "'id'"},
		{`{"date": "d", "items": [{"id": ["D1"]}], "fingerprint": "f", "sessions": [], "notes": []}`, "unhashable type: 'list'"},
		{`{"date": "d", "items": ["D1"], "fingerprint": "f", "sessions": [], "notes": []}`, "string indices must be integers, not 'str'"},
	} {
		func() {
			defer func() {
				r := recover()
				if err, ok := r.(error); !ok || err.Error() != c.msg {
					t.Errorf("%s: panic %v, want %q", c.inp, r, c.msg)
				}
			}()
			Run(cfg, newClient(t, c.inp), d, false, answer(good))
		}()
	}
}

func loadGolden(t *testing.T, name string) *pyjson.Object {
	t.Helper()
	var raw []byte
	testkit.Golden(t, name, &raw)
	v, err := pyjson.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	return v.(*pyjson.Object)
}

func TestParseOutputGolden(t *testing.T) {
	g := at(loadGolden(t, "parse_output"), "plan_judge").(*pyjson.Object)
	itemIDs := map[string]bool{}
	for _, id := range at(g, "item_ids").([]pyjson.Value) {
		itemIDs[id.(string)] = true
	}
	cases := at(g, "cases").([]pyjson.Value)
	if len(cases) != 15 {
		t.Fatalf("%d cases", len(cases))
	}
	for _, cv := range cases {
		c := cv.(*pyjson.Object)
		rows, ok := ParseOutput(at(c, "text").(string), itemIDs)
		var got pyjson.Value
		if ok {
			l := []pyjson.Value{}
			for _, r := range rows {
				l = append(l, r)
			}
			got = l
		}
		if !pyjson.Equal(got, at(c, "out")) {
			t.Errorf("%q:\n%s\nwant\n%s", at(c, "text"), pyjson.Compact(got), pyjson.Compact(at(c, "out")))
		}
	}
}

// goldenClient is gen_side_jobs's JudgeClient; calls are recorded as gen_golden records them.
type goldenClient struct {
	inp   pyjson.Value
	post  string
	calls []pyjson.Value
}

func (c *goldenClient) JudgeInput(day pytime.Date) (*pyjson.Object, api.Lookup) {
	c.calls = append(c.calls, []pyjson.Value{"judge_input", day.String()})
	switch c.inp.(type) {
	case nil:
		return nil, api.Unavailable
	case string:
		return nil, api.Missing
	}
	return c.inp.(*pyjson.Object), api.Found
}

func (c *goldenClient) PostJudgement(day pytime.Date, body *pyjson.Object) api.Outcome {
	c.calls = append(c.calls, []pyjson.Value{"post_judgement", day.String(), body})
	return api.Outcome(c.post)
}

func TestRunGolden(t *testing.T) {
	g := loadGolden(t, "prompts")
	gcfg := &config.Config{Machine: "mac mini 開発", SummarizeModel: "sonnet"}
	cases := at(g, "plan_judge").([]pyjson.Value)
	if len(cases) != 11 {
		t.Fatalf("%d cases", len(cases))
	}
	for _, cv := range cases {
		c := cv.(*pyjson.Object)
		name := at(c, "name").(string)
		gc := &goldenClient{inp: at(c, "input"), post: at(c, "post_answer").(string)}
		ans := at(c, "llm").([]pyjson.Value)
		r := &runner{code: int(ans[0].(pyjson.Int)), stdout: ans[1].(string)}
		res := Run(gcfg, gc, pytime.Date{Y: 2026, M: 10, D: 13}, at(c, "force").(bool), r)
		if string(res) != at(c, "result") {
			t.Errorf("%s: %s, want %s", name, res, at(c, "result"))
		}
		if !pyjson.Equal(gc.calls, at(c, "client_calls")) {
			t.Errorf("%s: client calls\n%s\nwant\n%s", name, pyjson.Compact(gc.calls), pyjson.Compact(at(c, "client_calls")))
		}
		want := at(c, "claude_calls").([]pyjson.Value)
		if len(r.calls) != len(want) {
			t.Errorf("%s: %d claude calls, want %d", name, len(r.calls), len(want))
			continue
		}
		for i := range want {
			gcall, w := r.calls[i].(*pyjson.Object), want[i].(*pyjson.Object)
			if !pyjson.Equal(at(gcall, "argv"), at(w, "argv")) || at(gcall, "input") != at(w, "input") ||
				at(gcall, "timeout") != at(w, "kwargs", "timeout") {
				t.Errorf("%s: claude call\n%s\nwant\n%s", name, pyjson.Compact(gcall), pyjson.Compact(w))
			}
		}
	}
}

func TestWarnGolden(t *testing.T) {
	n := 0
	for _, wv := range at(loadGolden(t, "prompts"), "warn").([]pyjson.Value) {
		w := wv.(*pyjson.Object)
		if at(w, "job") != "plan_judge" {
			continue
		}
		var buf bytes.Buffer
		Warn(&rt.Env{Stderr: &buf}, Result(at(w, "result").(string)), pytime.Date{Y: 2026, M: 10, D: 13})
		if buf.String() != at(w, "stderr") {
			t.Errorf("%s: %q", at(w, "result"), buf.String())
		}
		n++
	}
	if n != 9 {
		t.Fatalf("%d warn rows", n)
	}
}
