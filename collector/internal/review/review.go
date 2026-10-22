// Package review is review.py: after a harvest, last week's dashboard statistics become a short
// review written by `claude -p` and stored on the server (spec §4.13).
package review

import (
	"fmt"
	"math"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// Result is run_review's outcome: "exists" "stored" "no-data" "unreachable" "llm-failed" "rejected".
type Result string

// Client is the part of the API client the review uses.
type Client interface {
	Review(string) (*pyjson.Object, api.Lookup)
	Dashboard(pytime.Date, pytime.Date) (*pyjson.Object, bool)
	PutReview(*pyjson.Object) (bool, api.Outcome)
}

// Copied byte-for-byte from review.py (golden prompts.json checks argv, stdin and stats_json).
const (
	systemPrompt = "你是一名帮助派遣工程师复盘工作的教练。只根据给你的统计数据说话，不编造数据里没有的事实。用中文 markdown 回答，不要寒暄。"
	instruction  = "请按下面的结构写这一周的复盘：\n## 本周概况\n（3 行以内：总工时、主要花在哪些案件/项目、AI 用量与费用）\n## 做得好的\n（1–2 点，引用具体数字）\n## 可以改进的\n（2–3 条具体、下周就能执行的建议，每条引用具体数字）\n## 对照上周\n（如果提供了上周的复盘：上周的建议这周有没有改善；没有提供就写「无上周复盘」）\n\n关于「几点工作 / 星期几工作」：只引用 rhythm.time_of_day 里已经标好的时段、日期和星期（均为东京时间），\n不要自己推算日期或星期；那里的分钟数是各会话分钟之和，并行会话会让同一小时超过 60，不能当作「可用容量」；\n没有给出的时段不要下结论。avg_end 超过 24:00 表示跨过了午夜。"
	todNote      = "全部为东京时间，一天按 00:00–24:00 计；分钟数是各会话分钟之和，并行会话会使同一小时超过 60，不是挂钟时长；hour 标签 09:00-10:00 指 9 点整到 10 点整；work_ranges 是当天有记录的连续整点段；session_minutes 只含会话分钟，不含手写备注的分钟（rhythm.daily 含备注，所以两者可以不同）。"
)

const timeout = 180 * time.Second

var jst = time.FixedZone("JST", 9*3600)

// Calendar-hour buckets of the day for share_by_period; hour h of a heatmap row is h:00-(h+1):00
// Tokyo time.
var periods = [][2]int{{0, 5}, {5, 9}, {9, 12}, {12, 18}, {18, 22}, {22, 24}}

var weekdays = []string{"一", "二", "三", "四", "五", "六", "日"}

// num is a Python int or float as arithmetic keeps them apart (a bool is the int 0/1).
type num struct {
	isFloat bool
	i       int64
	f       float64
}

func (n num) value() pyjson.Value {
	if n.isFloat {
		return pyjson.Float(n.f)
	}
	return pyjson.Int(n.i)
}

func (n num) truthy() bool {
	if n.isFloat {
		return n.f != 0
	}
	return n.i != 0
}

func (n num) float() float64 {
	if n.isFloat {
		return n.f
	}
	return float64(n.i)
}

// cell is isinstance(x, int | float) (bool included) and the number it is.
func cell(v pyjson.Value) (num, bool) {
	switch x := v.(type) {
	case pyjson.Int:
		return num{i: int64(x)}, true
	case pyjson.Float:
		return num{isFloat: true, f: float64(x)}, true
	case bool:
		if x {
			return num{i: 1}, true
		}
		return num{}, true
	}
	return num{}, false
}

// pySum is CPython's sum() from 0: ints exactly while there are only ints; the first float is added
// plainly, and from then on every item, an int (an int64, so float(i)) as much as a float, is added
// with Neumaier's compensation; the compensation is added at the end when it is finite and not 0.
func pySum(xs []num) num {
	var acc int64
	k := 0
	for ; k < len(xs) && !xs[k].isFloat; k++ {
		acc += xs[k].i
	}
	if k == len(xs) {
		return num{i: acc}
	}
	f := float64(acc) + xs[k].f
	c := 0.0
	for _, x := range xs[k+1:] {
		xf := x.f
		if !x.isFloat {
			xf = float64(x.i)
		}
		t := f + xf
		if math.Abs(f) >= math.Abs(xf) {
			c += (f - t) + xf
		} else {
			c += (xf - t) + f
		}
		f = t
	}
	if c != 0 && !math.IsInf(c, 0) && !math.IsNaN(c) {
		f += c
	}
	return num{isFloat: true, f: f}
}

// cmpNum compares exactly, as Python compares an int with a float (NaN compares as equal here;
// callers drop non-positive values first, which drops NaN).
func cmpNum(a, b num) int {
	switch {
	case !a.isFloat && !b.isFloat:
		return cmpInt(a.i, b.i)
	case a.isFloat && b.isFloat:
		if a.f < b.f {
			return -1
		} else if a.f > b.f {
			return 1
		}
		return 0
	}
	if math.IsNaN(a.float()) || math.IsNaN(b.float()) {
		return 0
	}
	return exact(a).Cmp(exact(b))
}

func cmpInt(a, b int64) int {
	if a < b {
		return -1
	} else if a > b {
		return 1
	}
	return 0
}

func exact(n num) *big.Float {
	if n.isFloat {
		return big.NewFloat(n.f)
	}
	return new(big.Float).SetInt64(n.i)
}

func positive(n num) bool { return cmpNum(n, num{}) > 0 && !(n.isFloat && math.IsNaN(n.f)) }

// roundInt is round(x): an int is itself, a float rounds half to even. Python raises on NaN and
// infinity; so does this, with Python's message (a side job's panic is reported by harvest).
func roundInt(n num) pyjson.Value {
	if !n.isFloat {
		return pyjson.Int(n.i)
	}
	if math.IsNaN(n.f) {
		panic(fmt.Errorf("cannot convert float NaN to integer"))
	}
	if math.IsInf(n.f, 0) {
		panic(fmt.Errorf("cannot convert float infinity to integer"))
	}
	return pyjson.Int(pytime.RoundHalfEven(n.f))
}

// share is round(100 * part / total, 1); total is non-zero. int * int stays int; / is true division.
func share(part, total num) pyjson.Value {
	var x num
	if part.isFloat {
		x = num{isFloat: true, f: 100 * part.f}
	} else {
		x = num{i: 100 * part.i}
	}
	return pyjson.Float(pytime.Round(x.float()/total.float(), 1))
}

func hourLabel(a, b int) string { return fmt.Sprintf("%02d:00-%02d:00", a, b) }

// grid is the heatmap when it is a list of 7 lists of 24 numbers (bool counts as a number).
func grid(v pyjson.Value) ([7][24]num, bool) {
	var g [7][24]num
	rows, ok := v.([]pyjson.Value)
	if !ok || len(rows) != 7 {
		return g, false
	}
	for d, rv := range rows {
		row, ok := rv.([]pyjson.Value)
		if !ok || len(row) != 24 {
			return g, false
		}
		for h, x := range row {
			if g[d][h], ok = cell(x); !ok {
				return g, false
			}
		}
	}
	return g, true
}

// DigestRhythm is digest_rhythm: rhythm without the raw 7x24 heatmap, with a labelled time_of_day
// digest set last (or in place, if rhythm already had one). A missing or malformed heatmap is just
// dropped. The input is not changed.
func DigestRhythm(rhythm *pyjson.Object, monday pytime.Date) *pyjson.Object {
	out := pyjson.NewObject()
	for _, k := range rhythm.Keys() {
		if k != "heatmap" {
			v, _ := rhythm.Get(k)
			out.Set(k, v)
		}
	}
	hv, _ := rhythm.Get("heatmap")
	g, ok := grid(hv)
	if !ok {
		return out
	}
	byHour := make([]num, 24)
	for h := range 24 {
		col := make([]num, 7)
		for d := range 7 {
			col[d] = g[d][h]
		}
		byHour[h] = pySum(col)
	}
	total := pySum(byHour)
	var peaks []int
	for h := range 24 {
		if positive(byHour[h]) {
			peaks = append(peaks, h)
		}
	}
	sort.SliceStable(peaks, func(a, b int) bool {
		if c := cmpNum(byHour[peaks[a]], byHour[peaks[b]]); c != 0 {
			return c > 0
		}
		return peaks[a] < peaks[b]
	})
	if len(peaks) > 3 {
		peaks = peaks[:3]
	}
	peakHours := []pyjson.Value{}
	for _, h := range peaks {
		p := pyjson.NewObject()
		p.Set("hour", hourLabel(h, h+1))
		p.Set("minutes", roundInt(byHour[h]))
		peakHours = append(peakHours, p)
	}
	shares := pyjson.NewObject()
	for _, p := range periods {
		if total.truthy() {
			shares.Set(hourLabel(p[0], p[1]), share(pySum(byHour[p[0]:p[1]]), total))
		} else {
			shares.Set(hourLabel(p[0], p[1]), pyjson.Float(0))
		}
	}
	byDay := []pyjson.Value{}
	for d := range 7 {
		var ranges [][2]int // first and last hour of each run of consecutive hours with any work
		for h := range 24 {
			if positive(g[d][h]) {
				if n := len(ranges); n > 0 && ranges[n-1][1] == h-1 {
					ranges[n-1][1] = h
				} else {
					ranges = append(ranges, [2]int{h, h})
				}
			}
		}
		labels := []pyjson.Value{}
		for _, r := range ranges {
			labels = append(labels, hourLabel(r[0], r[1]+1))
		}
		o := pyjson.NewObject()
		o.Set("date", monday.AddDays(d).String())
		o.Set("weekday", "周"+weekdays[d])
		o.Set("session_minutes", roundInt(pySum(g[d][:])))
		o.Set("work_ranges", labels)
		byDay = append(byDay, o)
	}
	tod := pyjson.NewObject()
	tod.Set("note", todNote)
	tod.Set("peak_hours", peakHours)
	tod.Set("share_by_period", shares)
	tod.Set("by_day", byDay)
	out.Set("time_of_day", tod)
	return out
}

func isoWeek(d pytime.Date) string {
	y, w := time.Date(d.Y, d.M, d.D, 0, 0, 0, 0, time.UTC).ISOWeek()
	return fmt.Sprintf("%d-W%02d", y, w)
}

func toDate(t time.Time) pytime.Date { return pytime.Date{Y: t.Year(), M: t.Month(), D: t.Day()} }

// PreviousWeek is the Tokyo ISO week before the one now falls in, with its Monday and Sunday.
func PreviousWeek(now time.Time) (week string, mon, sun pytime.Date) {
	today := now.In(jst)
	weekday := (int(today.Weekday()) + 6) % 7 // Monday = 0
	mon = toDate(today).AddDays(-(weekday + 7))
	return isoWeek(mon), mon, mon.AddDays(6)
}

var weekRe = regexp.MustCompile(`^([0-9]+)-W([0-9]+)$`)

// WeekBounds is week_bounds: the Monday and Sunday of "YYYY-Wnn" (date.fromisocalendar's checks).
// Only ASCII digits are accepted around "-W" (spec §6 D6).
func WeekBounds(week string) (mon, sun pytime.Date, err error) {
	m := weekRe.FindStringSubmatch(week)
	if m == nil {
		return mon, sun, fmt.Errorf("invalid ISO week %q", week)
	}
	year, err1 := strconv.Atoi(m[1])
	num, err2 := strconv.Atoi(m[2])
	if err1 != nil || year < 1 || year > 9999 {
		return mon, sun, fmt.Errorf("Year is out of range: %s", m[1])
	}
	if err2 != nil || num < 1 || num > 53 {
		return mon, sun, fmt.Errorf("Invalid week: %s", m[2])
	}
	jan4 := time.Date(year, 1, 4, 0, 0, 0, 0, time.UTC)
	first := toDate(jan4).AddDays(-((int(jan4.Weekday()) + 6) % 7))
	mon = first.AddDays((num - 1) * 7)
	if isoWeek(mon) != fmt.Sprintf("%d-W%02d", year, num) { // week 53 of a 52-week year
		return pytime.Date{}, sun, fmt.Errorf("Invalid week: %d", num)
	}
	return mon, mon.AddDays(6), nil
}

// BuildPrompt is build_prompt: the week, the statistics (indent=1, unescaped), last week's review
// when there is one, then the instruction.
func BuildPrompt(week string, stats *pyjson.Object, previous *string) string {
	parts := []string{"<week>" + week + "</week>", "<stats>", string(pyjson.Dumps(stats, pyjson.Indented(1))), "</stats>"}
	if previous != nil && *previous != "" {
		parts = append(parts, "<last_week_review>", *previous, "</last_week_review>")
	}
	parts = append(parts, instruction)
	return strings.Join(parts, "\n")
}

// with is {**o, k: v}: a copy of o with k set (in place when o has it).
func with(o *pyjson.Object, k string, v pyjson.Value) *pyjson.Object {
	c := pyjson.NewObject()
	for _, key := range o.Keys() {
		x, _ := o.Get(key)
		c.Set(key, x)
	}
	c.Set(k, v)
	return c
}

// prepare drops hints[].params (they only feed the web page's hint text) and swaps the heatmap
// for its digest, on copies: the model and stats_json see the same statistics.
func prepare(stats *pyjson.Object, monday pytime.Date) *pyjson.Object {
	if hints, ok := get(stats, "hints").([]pyjson.Value); ok {
		out := make([]pyjson.Value, len(hints))
		for i, h := range hints {
			out[i] = h
			if ho, ok := h.(*pyjson.Object); ok {
				c := pyjson.NewObject()
				for _, k := range ho.Keys() {
					if k != "params" {
						v, _ := ho.Get(k)
						c.Set(k, v)
					}
				}
				out[i] = c
			}
		}
		stats = with(stats, "hints", out)
	}
	if rhythm, ok := get(stats, "rhythm").(*pyjson.Object); ok {
		stats = with(stats, "rhythm", DigestRhythm(rhythm, monday))
	}
	return stats
}

func get(o *pyjson.Object, k string) pyjson.Value {
	v, _ := o.Get(k)
	return v
}

// Run is run_review for week ("" = the previous week). Network and LLM failures are results; the
// shapes Python's code raises on (a truthy non-dict overview, a truthy non-str last review text,
// a heatmap total that round() cannot take) panic with Python's message.
func Run(cfg *config.Config, c Client, week string, force bool, r llm.Runner, now time.Time) Result {
	var mon, sun pytime.Date
	if week == "" {
		week, mon, sun = PreviousWeek(now)
	} else {
		var err error
		if mon, sun, err = WeekBounds(week); err != nil {
			panic(err)
		}
	}
	if _, lk := c.Review(week); lk == api.Unavailable {
		return "unreachable"
	} else if lk == api.Found && !force {
		return "exists"
	}
	stats, ok := c.Dashboard(mon, sun)
	if !ok {
		return "unreachable"
	}
	stats = prepare(stats, mon)
	overview := pyjson.NewObject()
	if v := get(stats, "overview"); pyjson.Truthy(v) {
		o, ok := v.(*pyjson.Object)
		if !ok {
			panic(fmt.Errorf("'%s' object has no attribute 'get'", pyjson.TypeName(v)))
		}
		overview = o
	}
	if !pyjson.Truthy(get(overview, "sessions")) && !pyjson.Truthy(get(overview, "minutes")) {
		return "no-data"
	}
	var previous *string
	if prev, lk := c.Review(isoWeek(mon.AddDays(-7))); lk == api.Found {
		if v := get(prev, "text"); pyjson.Truthy(v) {
			s, ok := v.(string)
			if !ok {
				panic(fmt.Errorf("sequence item 5: expected str instance, %s found", pyjson.TypeName(v)))
			}
			previous = &s
		}
	}
	// The prompt is built from the statistics alone; session transcripts never leave the machine here.
	text, ok := llm.Generate(r, BuildPrompt(week, stats, previous), cfg.SummarizeModel, systemPrompt, timeout)
	if !ok {
		return "llm-failed"
	}
	body := pyjson.NewObject()
	body.Set("week", week)
	body.Set("text", text)
	body.Set("model", cfg.SummarizeModel)
	body.Set("stats_json", string(pyjson.Dumps(stats, pyjson.Unicode())))
	body.Set("machine", cfg.Machine)
	body.Set("force", force)
	switch stored, out := c.PutReview(body); out {
	case api.OK:
		if stored || force {
			return "stored"
		}
		return "exists"
	case api.Rejected:
		return "rejected"
	}
	return "unreachable"
}

var messages = map[Result]string{
	"unreachable": "the server could not be reached (or is not deployed with migration 0005)",
	"llm-failed":  "claude -p failed",
	"rejected":    "the server refused the review",
}

// Warn is warn: one stderr line for the results the next harvest retries.
func Warn(env *rt.Env, res Result, week string) {
	if m, ok := messages[res]; ok {
		env.Warnf("worklog: weekly review %s skipped: %s; the next harvest retries", week, m)
	}
}
