package review

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
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

func obj(t *testing.T, s string) *pyjson.Object {
	t.Helper()
	v, err := pyjson.Decode([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return v.(*pyjson.Object)
}

func at(o *pyjson.Object, keys ...string) pyjson.Value {
	var v pyjson.Value = o
	for _, k := range keys {
		v, _ = v.(*pyjson.Object).Get(k)
	}
	return v
}

func day(t *testing.T, s string) pytime.Date {
	t.Helper()
	d, err := pytime.ParseDate(s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// runner answers (code, stdout) or fails, and records each call.
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

var okRunner = func() *runner { return &runner{stdout: "## 本周概况\n- 工作 5h\n"} }

// client is test_review.py's Client: review(week) looks the week up in existing (absent =
// missing) unless existing is unreachable; dashboard answers stats; put_review answers put.
type client struct {
	existing    map[string]*pyjson.Object
	unreachable bool
	stats       *pyjson.Object
	stored      bool
	out         api.Outcome
	posted      []*pyjson.Object
}

func (c *client) Review(week string) (*pyjson.Object, api.Lookup) {
	if c.unreachable {
		return nil, api.Unavailable
	}
	if o, ok := c.existing[week]; ok {
		return o, api.Found
	}
	return nil, api.Missing
}

func (c *client) Dashboard(from, to pytime.Date) (*pyjson.Object, bool) {
	return c.stats, c.stats != nil
}

func (c *client) PutReview(body *pyjson.Object) (bool, api.Outcome) {
	c.posted = append(c.posted, body)
	return c.stored, c.out
}

var cfg = &config.Config{Machine: "macmini", SummarizeModel: "haiku"}

const stats = `{"overview": {"minutes": 300, "sessions": 4}, "hints": []}`

func newClient(t *testing.T, existing map[string]string, s string) *client {
	c := &client{existing: map[string]*pyjson.Object{}, stored: true, out: api.OK}
	for k, v := range existing {
		c.existing[k] = obj(t, v)
	}
	if s != "" {
		c.stats = obj(t, s)
	}
	return c
}

var now = time.Date(2026, 10, 13, 12, 0, 0, 0, jst)

func TestPreviousWeekIsTheTokyoISOWeekBeforeThisOne(t *testing.T) {
	for _, c := range []struct {
		now            time.Time
		week, mon, sun string
	}{
		{time.Date(2026, 9, 29, 12, 0, 0, 0, jst), "2026-W39", "2026-09-21", "2026-09-27"},
		// Monday 00:30 JST is still Sunday in UTC; Tokyo decides.
		{time.Date(2026, 9, 27, 15, 30, 0, 0, time.UTC), "2026-W39", "2026-09-21", "2026-09-27"},
		{time.Date(2027, 1, 5, 0, 0, 0, 0, jst), "2026-W53", "2026-12-28", "2027-01-03"},
	} {
		w, m, s := PreviousWeek(c.now)
		if w != c.week || m.String() != c.mon || s.String() != c.sun {
			t.Errorf("%v: %s %s %s", c.now, w, m, s)
		}
	}
}

func TestWeekBoundsRoundTrips(t *testing.T) {
	m, s, err := WeekBounds("2026-W39")
	if err != nil || m.String() != "2026-09-21" || s.String() != "2026-09-27" {
		t.Fatalf("%s %s %v", m, s, err)
	}
	m, _, err = WeekBounds("2026-W53")
	if err != nil || m.String() != "2026-12-28" {
		t.Fatalf("W53: %s %v", m, err)
	}
	m, _, err = WeekBounds("02027-W1")
	if err != nil || m.String() != "2027-01-04" {
		t.Fatalf("leading zero / one digit: %s %v", m, err)
	}
	// fromisocalendar's range checks, and D6: only ASCII digits around "-W".
	for _, bad := range []string{"2027-W53", "2026-W00", "2026-W54", "0000-W01", "10000-W01", "2026W39", "2026-W39-1",
		"2026-W-1", "+2026-W39", " 2026-W39", "２０２６-W39", "2026-Wx", "", "-W"} {
		if _, _, err := WeekBounds(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestPromptCarriesStatsAndLastReviewButNoTranscripts(t *testing.T) {
	prev := "上周建议：减少深夜工作"
	p := BuildPrompt("2026-W39", obj(t, `{"overview": {"minutes": 600}, "hints": [{"text": "3 个会话未关联案件"}]}`), &prev)
	if !strings.Contains(p, "2026-W39") || !strings.Contains(p, `"minutes": 600`) || !strings.Contains(p, "减少深夜工作") ||
		strings.Contains(p, "<transcript>") {
		t.Fatal(p)
	}
}

func TestSkipsAWeekThatAlreadyHasAReview(t *testing.T) {
	c := newClient(t, map[string]string{"2026-W39": `{"text": "x"}`}, stats)
	if r := Run(cfg, c, "2026-W39", false, okRunner(), now); r != "exists" || len(c.posted) != 0 {
		t.Fatalf("%s %d", r, len(c.posted))
	}
}

func TestGeneratesAndStoresWithTheStatsItUsed(t *testing.T) {
	c := newClient(t, nil, stats)
	if r := Run(cfg, c, "2026-W39", false, okRunner(), now); r != "stored" {
		t.Fatal(r)
	}
	b := c.posted[0]
	if at(b, "week") != "2026-W39" || at(b, "model") != "haiku" || at(b, "machine") != "macmini" || at(b, "force") != false {
		t.Fatalf("%s", pyjson.Compact(b))
	}
	sj, _ := pyjson.Decode([]byte(at(b, "stats_json").(string)))
	if !pyjson.Equal(sj, obj(t, stats)) || !strings.HasPrefix(at(b, "text").(string), "## 本周概况") {
		t.Fatalf("%s", pyjson.Compact(b))
	}
}

func TestHintParamsAreDroppedBeforeThePromptAndStatsJSON(t *testing.T) {
	s := `{"overview": {"minutes": 300, "sessions": 4}, "hints": [{"id": "unlinked", "level": "warn", "text": "3 个会话未关联案件", "links": [], "params": {"n": 3, "hours": 1.5}}]}`
	c := newClient(t, nil, s)
	r := okRunner()
	if res := Run(cfg, c, "2026-W39", false, r, now); res != "stored" {
		t.Fatal(res)
	}
	in := at(r.calls[0].(*pyjson.Object), "input").(string)
	if strings.Contains(in, `"params"`) || !strings.Contains(in, "3 个会话未关联案件") {
		t.Fatal(in)
	}
	sent, _ := pyjson.Decode([]byte(at(c.posted[0], "stats_json").(string)))
	want := obj(t, `{"x": [{"id": "unlinked", "level": "warn", "text": "3 个会话未关联案件", "links": []}]}`)
	if !pyjson.Equal(at(sent.(*pyjson.Object), "hints"), at(want, "x")) {
		t.Fatalf("%s", pyjson.Compact(sent))
	}
	if h := at(c.stats, "hints").([]pyjson.Value)[0].(*pyjson.Object); at(h, "params") == nil {
		t.Fatal("the caller's stats lost params")
	}
}

func TestForceRegeneratesAnExistingWeek(t *testing.T) {
	c := newClient(t, map[string]string{"2026-W39": `{"text": "old"}`}, stats)
	c.stored = false // the server keeps nothing new, but force asked for it
	if r := Run(cfg, c, "2026-W39", true, okRunner(), now); r != "stored" || at(c.posted[0], "force") != true {
		t.Fatalf("%s", r)
	}
}

func TestAnEmptyWeekIsNotReviewed(t *testing.T) {
	c := newClient(t, nil, `{"overview": {"minutes": 0, "sessions": 0}, "hints": []}`)
	if r := Run(cfg, c, "2026-W39", false, okRunner(), now); r != "no-data" {
		t.Fatal(r)
	}
}

func TestFailuresAreReportedNotRaised(t *testing.T) {
	unreach := newClient(t, nil, stats)
	unreach.unreachable = true
	bad := &runner{code: 1}
	raising := &runner{err: errors.New("claude: executable file not found")}
	rejecting := newClient(t, nil, stats)
	rejecting.stored, rejecting.out = false, api.Rejected
	for _, c := range []struct {
		c    *client
		r    *runner
		want Result
	}{
		{unreach, okRunner(), "unreachable"},
		{newClient(t, nil, ""), okRunner(), "unreachable"},
		{newClient(t, nil, stats), bad, "llm-failed"},
		{newClient(t, nil, stats), raising, "llm-failed"},
		{rejecting, okRunner(), "rejected"},
	} {
		if r := Run(cfg, c.c, "2026-W39", false, c.r, now); r != c.want {
			t.Errorf("got %s, want %s", r, c.want)
		}
	}
}

func heat(cells map[[2]int]int) string {
	g := make([][]int, 7)
	for d := range g {
		g[d] = make([]int, 24)
	}
	for k, m := range cells {
		g[k[0]][k[1]] = m
	}
	b, _ := json.Marshal(g)
	return string(b)
}

func TestDigestLabelsHoursWeekdaysAndDatesAndDropsTheMatrix(t *testing.T) {
	rhythm := obj(t, `{"heatmap": `+heat(map[[2]int]int{{4, 9}: 100, {4, 10}: 200, {4, 11}: 50, {6, 23}: 150})+`, "late_night_share": 0.3}`)
	out := DigestRhythm(rhythm, day(t, "2026-09-21"))
	if _, has := out.Get("heatmap"); has || at(out, "late_night_share") != pyjson.Float(0.3) {
		t.Fatalf("%s", pyjson.Compact(out))
	}
	tod := at(out, "time_of_day").(*pyjson.Object)
	peaks := at(tod, "peak_hours").([]pyjson.Value)
	if !pyjson.Equal(peaks[0], obj(t, `{"hour": "10:00-11:00", "minutes": 200}`)) {
		t.Errorf("peak %s", pyjson.Compact(peaks[0]))
	}
	var hours []string
	for _, p := range peaks {
		hours = append(hours, at(p.(*pyjson.Object), "hour").(string))
	}
	if strings.Join(hours, ",") != "10:00-11:00,23:00-24:00,09:00-10:00" {
		t.Errorf("peaks %v", hours)
	}
	share := at(tod, "share_by_period").(*pyjson.Object)
	if at(share, "09:00-12:00") != pyjson.Float(70) || at(share, "22:00-24:00") != pyjson.Float(30) || at(share, "00:00-05:00") != pyjson.Float(0) {
		t.Errorf("share %s", pyjson.Compact(share))
	}
	by := map[string]*pyjson.Object{}
	for _, d := range at(tod, "by_day").([]pyjson.Value) {
		by[at(d.(*pyjson.Object), "date").(string)] = d.(*pyjson.Object)
	}
	for date, want := range map[string]string{
		"2026-09-25": `{"date": "2026-09-25", "weekday": "周五", "session_minutes": 350, "work_ranges": ["09:00-12:00"]}`,
		"2026-09-27": `{"date": "2026-09-27", "weekday": "周日", "session_minutes": 150, "work_ranges": ["23:00-24:00"]}`,
		"2026-09-21": `{"date": "2026-09-21", "weekday": "周一", "session_minutes": 0, "work_ranges": []}`,
	} {
		if !pyjson.Equal(by[date], obj(t, want)) {
			t.Errorf("%s: %s", date, pyjson.Compact(by[date]))
		}
	}
	if len(by) != 7 || !strings.Contains(at(tod, "note").(string), "并行") {
		t.Error("by_day / note")
	}
}

func TestDigestWorkRangesMergeConsecutiveHoursOnly(t *testing.T) {
	out := DigestRhythm(obj(t, `{"heatmap": `+heat(map[[2]int]int{{0, 1}: 5, {0, 2}: 9, {0, 5}: 1, {0, 23}: 3})+`}`), day(t, "2026-09-21"))
	d0 := at(at(out, "time_of_day").(*pyjson.Object), "by_day").([]pyjson.Value)[0].(*pyjson.Object)
	if got := string(pyjson.Compact(at(d0, "work_ranges"))); got != `["01:00-03:00","05:00-06:00","23:00-24:00"]` {
		t.Fatal(got)
	}
}

func TestDigestSurvivesAMissingOrMalformedHeatmap(t *testing.T) {
	mon := day(t, "2026-09-21")
	if got := DigestRhythm(obj(t, `{"late_night_share": 0.1}`), mon); string(pyjson.Compact(got)) != `{"late_night_share":0.1}` {
		t.Error(string(pyjson.Compact(got)))
	}
	if got := DigestRhythm(obj(t, `{"heatmap": [[1, 2]], "x": 1}`), mon); string(pyjson.Compact(got)) != `{"x":1}` {
		t.Error(string(pyjson.Compact(got)))
	}
	empty := DigestRhythm(obj(t, `{"heatmap": `+heat(nil)+`}`), mon)
	if p := at(at(empty, "time_of_day").(*pyjson.Object), "peak_hours").([]pyjson.Value); len(p) != 0 {
		t.Error(p)
	}
}

func TestRunReviewSendsTheDigestInsteadOfTheHeatmapInPromptAndStatsJSON(t *testing.T) {
	c := newClient(t, nil, `{"overview": {"minutes": 300, "sessions": 4}, "hints": [], "rhythm": {"heatmap": `+
		heat(map[[2]int]int{{4, 9}: 300})+`, "avg_start": "09:00"}}`)
	r := okRunner()
	if res := Run(cfg, c, "2026-W39", false, r, now); res != "stored" {
		t.Fatal(res)
	}
	in := at(r.calls[0].(*pyjson.Object), "input").(string)
	if strings.Contains(in, `"heatmap"`) || !strings.Contains(in, "09:00-10:00") || !strings.Contains(in, "2026-09-25") {
		t.Fatal(in)
	}
	sent, _ := pyjson.Decode([]byte(at(c.posted[0], "stats_json").(string)))
	if _, has := at(sent.(*pyjson.Object), "rhythm").(*pyjson.Object).Get("heatmap"); has {
		t.Fatal("heatmap in stats_json")
	}
	if _, has := at(c.stats, "rhythm").(*pyjson.Object).Get("heatmap"); !has {
		t.Fatal("the caller's dict was changed")
	}
}

func TestInstructionPinsHowToTalkAboutTimeOfDay(t *testing.T) {
	p := BuildPrompt("2026-W39", pyjson.NewObject(), nil)
	if !strings.Contains(p, "time_of_day") || !strings.Contains(p, "不要自己推算") {
		t.Fatal(p)
	}
}

// Python's sum(): ints exactly, then from the first float on Neumaier-compensated over every item,
// ints included (CPython 3.14). Expected values printed by CPython 3.14.4.
func TestPySumIsPythons(t *testing.T) {
	i := func(v int64) num { return num{i: v} }
	f := func(v float64) num { return num{isFloat: true, f: v} }
	b := func(v bool) num {
		if v {
			return i(1)
		}
		return i(0)
	}
	for _, c := range []struct {
		in   []num
		want string
	}{
		{[]num{i(1), f(0.1), f(0.2), i(3), f(0.3)}, "4.6"},
		{[]num{f(.1), f(.1), f(.1), f(.1), f(.1), f(.1), f(.1), f(.1), f(.1), f(.1)}, "1.0"},
		{[]num{f(1e16), f(1.0), f(-1e16)}, "1.0"},
		{[]num{b(true), i(2), f(0.5)}, "3.5"},
		{[]num{i(3), b(true), b(false)}, "4"},
		{[]num{f(0.1), f(0.2), i(7), f(0.3), f(1e-17), i(5)}, "12.6"},
		{[]num{i(1 << 62), i(1<<62 - 1), f(0.5)}, "9.223372036854776e+18"},
		{[]num{f(1e308), f(1e308)}, "inf"},
		{[]num{f(0.1), f(0.7), f(0.1), f(0.1)}, "1.0"},
		{[]num{f(1e16), i(1), i(1)}, "1.0000000000000002e+16"},
		{[]num{i(1), f(1e16), i(1), i(1)}, "1.0000000000000002e+16"},
		{nil, "0"},
	} {
		if got := pyjson.Str(pySum(c.in).value()); got != c.want {
			t.Errorf("sum(%v) = %s, want %s", c.in, got, c.want)
		}
	}
}

func TestDigestRhythmGolden(t *testing.T) {
	g := loadGolden(t, "digest_rhythm")
	cases := at(g, "cases").([]pyjson.Value)
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, cv := range cases {
		c := cv.(*pyjson.Object)
		name := at(c, "name").(string)
		in := at(c, "rhythm").(*pyjson.Object)
		before := string(pyjson.Compact(in))
		out := DigestRhythm(in, day(t, at(c, "monday").(string)))
		if got := string(pyjson.Dumps(out, pyjson.Indented(1))); got != at(c, "out_text").(string) {
			t.Errorf("%s:\n%s\nwant\n%s", name, got, at(c, "out_text"))
		}
		if !pyjson.Equal(out, at(c, "out")) {
			t.Errorf("%s: value differs", name)
		}
		if string(pyjson.Compact(in)) != before {
			t.Errorf("%s: input changed", name)
		}
	}
	for _, rv := range at(g, "round_half_even").([]pyjson.Value) {
		r := rv.(*pyjson.Object)
		if got := pytime.RoundHalfEven(toFloat(at(r, "x"))); pyjson.Int(got) != at(r, "round") {
			t.Errorf("round(%v) = %d", at(r, "x"), got)
		}
	}
	for _, key := range []string{"round1", "round6"} {
		n := map[string]int{"round1": 1, "round6": 6}[key]
		for _, rv := range at(g, key).([]pyjson.Value) {
			r := rv.(*pyjson.Object)
			if got := pytime.Round(toFloat(at(r, "x")), n); got != toFloat(at(r, "round")) {
				t.Errorf("round(%v, %d) = %v", at(r, "x"), n, got)
			}
		}
	}
}

func toFloat(v pyjson.Value) float64 {
	switch x := v.(type) {
	case pyjson.Int:
		return float64(x)
	case pyjson.Float:
		return float64(x)
	}
	return math.NaN()
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

// goldenClient is gen_side_jobs's ReviewClient: the first review() answers existing, later ones
// previous; every call is recorded as gen_golden records it.
type goldenClient struct {
	existing, previous pyjson.Value
	stats              pyjson.Value
	put                pyjson.Value
	calls              []pyjson.Value
}

func lookup(v pyjson.Value) (*pyjson.Object, api.Lookup) {
	switch x := v.(type) {
	case nil:
		return nil, api.Unavailable
	case string: // "missing"
		return nil, api.Missing
	case *pyjson.Object:
		return x, api.Found
	}
	panic(v)
}

func (c *goldenClient) Review(week string) (*pyjson.Object, api.Lookup) {
	c.calls = append(c.calls, []pyjson.Value{"review", week})
	if len(c.calls) == 1 {
		return lookup(c.existing)
	}
	return lookup(c.previous)
}

func (c *goldenClient) Dashboard(a, b pytime.Date) (*pyjson.Object, bool) {
	c.calls = append(c.calls, []pyjson.Value{"dashboard", a.String(), b.String()})
	o, ok := c.stats.(*pyjson.Object)
	return o, ok
}

func (c *goldenClient) PutReview(body *pyjson.Object) (bool, api.Outcome) {
	c.calls = append(c.calls, []pyjson.Value{"put_review", body})
	switch c.put {
	case true:
		return true, api.OK
	case false:
		return false, api.OK
	}
	return false, api.Outcome(c.put.(string))
}

// golden prompts.json review: 13 runs with Python's results, client calls (bodies and stats_json
// byte-for-byte) and claude calls (argv, stdin, timeout).
func TestRunGolden(t *testing.T) {
	g := loadGolden(t, "prompts")
	gcfg := &config.Config{Machine: "mac mini 開発", SummarizeModel: "sonnet"}
	gnow := time.Date(2026, 10, 13, 12, 0, 0, 123456000, jst)
	cases := at(g, "review").([]pyjson.Value)
	if len(cases) != 13 {
		t.Fatalf("%d cases", len(cases))
	}
	for _, cv := range cases {
		c := cv.(*pyjson.Object)
		name := at(c, "name").(string)
		gc := &goldenClient{existing: at(c, "existing"), previous: at(c, "previous"), stats: at(c, "stats"), put: at(c, "put_answer")}
		llmAns := at(c, "llm").([]pyjson.Value)
		r := &runner{code: int(llmAns[0].(pyjson.Int)), stdout: llmAns[1].(string)}
		week, _ := at(c, "week").(string)
		before := string(pyjson.Compact(at(c, "stats")))
		res := Run(gcfg, gc, week, at(c, "force").(bool), r, gnow)
		if string(res) != at(c, "result") {
			t.Errorf("%s: result %s, want %s", name, res, at(c, "result"))
		}
		if !pyjson.Equal(gc.calls, at(c, "client_calls")) {
			t.Errorf("%s: client calls\n%s\nwant\n%s", name, pyjson.Compact(gc.calls), pyjson.Compact(at(c, "client_calls")))
		}
		checkClaudeCalls(t, name, r.calls, at(c, "claude_calls").([]pyjson.Value))
		if string(pyjson.Compact(at(c, "stats"))) != before {
			t.Errorf("%s: the dashboard object was changed", name)
		}
	}
	for _, pv := range at(g, "review_build_prompt").([]pyjson.Value) {
		p := pv.(*pyjson.Object)
		var prev *string
		if s, ok := at(p, "previous").(string); ok {
			prev = &s
		}
		if got := BuildPrompt(at(p, "week").(string), at(p, "stats").(*pyjson.Object), prev); got != at(p, "prompt") {
			t.Errorf("build_prompt(previous=%v):\n%s", at(p, "previous"), got)
		}
	}
}

func checkClaudeCalls(t *testing.T, name string, got []pyjson.Value, want []pyjson.Value) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s: %d claude calls, want %d", name, len(got), len(want))
		return
	}
	for i := range want {
		g, w := got[i].(*pyjson.Object), want[i].(*pyjson.Object)
		if !pyjson.Equal(at(g, "argv"), at(w, "argv")) || at(g, "input") != at(w, "input") ||
			at(g, "timeout") != at(w, "kwargs", "timeout") {
			t.Errorf("%s: claude call %d\n%s\nwant\n%s", name, i, pyjson.Compact(g), pyjson.Compact(w))
		}
	}
}

func TestWarnGolden(t *testing.T) {
	g := loadGolden(t, "prompts")
	n := 0
	for _, wv := range at(g, "warn").([]pyjson.Value) {
		w := wv.(*pyjson.Object)
		if at(w, "job") != "review" {
			continue
		}
		var buf bytes.Buffer
		Warn(&rt.Env{Stderr: &buf}, Result(at(w, "result").(string)), "2026-W41")
		if buf.String() != at(w, "stderr") {
			t.Errorf("%s: %q", at(w, "result"), buf.String())
		}
		n++
	}
	if n != 6 {
		t.Fatalf("%d warn rows", n)
	}
}
