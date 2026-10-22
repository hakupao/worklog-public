// Package planjudge is plan_judge.py: after a harvest, `claude -p` judges which of the day's plan
// items the day's sessions and notes fulfil, and the judgement is posted (spec §4.14).
package planjudge

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// Result is run_judge's outcome: "no-plan" "no-items" "unchanged" "stored" "stale" "llm-failed"
// "bad-output" "unreachable" "rejected".
type Result string

// Client is the part of the API client the judge uses.
type Client interface {
	JudgeInput(pytime.Date) (*pyjson.Object, api.Lookup)
	PostJudgement(pytime.Date, *pyjson.Object) api.Outcome
}

// Copied byte-for-byte from plan_judge.py (golden prompts.json checks argv and stdin).
const (
	systemPrompt = "你在帮一名工程师核对今天的工作安排完成了没有。只根据给你的 session 和补记判断，不编造。只输出 JSON，不要任何别的文字。"
	instruction  = "对 <items> 里的每一条，判断它今天的完成情况，输出一个 JSON 数组，每条一个对象：\n{\"id\": 条目id, \"status\": \"done\" | \"partial\" | \"none\", \"progress\": \"短进度，如 2/2 轮、约 1.5h / 2h\", \"evidence\": [支撑判断的 session id], \"note\": \"一句理由\"}\n规则：\n- detail 是今天的目标，按 detail 判断；text 是条目标题，多是长期方向或背景，只用来理解 detail 指的是哪件事，不要求今天完成。detail 为空时才按 text 判断。例：text「X：上线验证」、detail「小修小改」，今天在 X 上做了些小修改就是 done。\n- detail 里写了量化要求（轮数、时长、某个 agent）的，逐项对照 sessions 的 turns / minutes / agent，写进 progress；全部满足才是 done，有一项不够就是 partial。\n- 没写量化要求的：今天的 session 或补记里有与 detail 对应的工作，就是 done。summary 很短，只写做了什么，不会写「目标已完成」；内容合理对应即可，「summary 没写明完成」不是判 partial 的理由。只有证据里明确写着没做完、卡住、只做了一部分时才是 partial。\n- 条目挂了案件（task_ids / task_titles）时，优先看这些案件中任一案件的 session；没挂的按 project 和 summary 对应。\n- turns_estimated 为 true 的轮数是估算值，progress 里写「约」。\n- evidence 只能填 <sessions> 里出现的 id；找不到相关 session 就是 none，evidence 为空。\n- 只输出 JSON。"
)

const timeout = 180 * time.Second

var statuses = map[string]bool{"done": true, "partial": true, "none": true}

var jst = time.FixedZone("JST", 9*3600)

// DaysToJudge is today and yesterday in Tokyo: sessions harvested after midnight still count for
// yesterday's plan.
func DaysToJudge(now time.Time) []pytime.Date {
	t := now.In(jst)
	today := pytime.Date{Y: t.Year(), M: t.Month(), D: t.Day()}
	return []pytime.Date{today, today.AddDays(-1)}
}

// must is a Python expression that raises: the side job panics with Python's message (harvest
// reports a side job's panic as Python reports its exception).
func must(v pyjson.Value, err error) pyjson.Value {
	if err != nil {
		panic(err)
	}
	return v
}

func get(o *pyjson.Object, k string) pyjson.Value {
	v, _ := o.Get(k)
	return v
}

// BuildPrompt is build_prompt: the date, then items, sessions and notes as indent=1 JSON blocks.
func BuildPrompt(inp *pyjson.Object) string {
	block := func(tag string) string {
		return fmt.Sprintf("<%s>\n%s\n</%s>", tag, pyjson.Dumps(must(pyjson.Subscript(inp, tag)), pyjson.Indented(1)), tag)
	}
	date := "<date>" + pyjson.Str(must(pyjson.Subscript(inp, "date"))) + "</date>"
	return strings.Join([]string{date, block("items"), block("sessions"), block("notes"), instruction}, "\n")
}

var arrayRe = regexp.MustCompile(`(?s)\[.*\]`)

// strOr is str(v or "").
func strOr(v pyjson.Value) string {
	if !pyjson.Truthy(v) {
		return ""
	}
	return pyjson.Str(v)
}

// ParseOutput is parse_output: the model's rows for known items, or false when the answer is not
// a usable JSON array (no array, invalid JSON, a known item with a bad status, no known rows).
func ParseOutput(text string, itemIDs map[string]bool) ([]*pyjson.Object, bool) {
	m := arrayRe.FindString(text)
	if m == "" {
		return nil, false
	}
	v, err := pyjson.Decode([]byte(m))
	if err != nil {
		return nil, false
	}
	rows, ok := v.([]pyjson.Value)
	if !ok {
		return nil, false
	}
	var out []*pyjson.Object
	for _, rv := range rows {
		row, ok := rv.(*pyjson.Object)
		if !ok {
			continue
		}
		id, ok := get(row, "id").(string)
		if !ok || !itemIDs[id] {
			continue
		}
		status, ok := get(row, "status").(string)
		if !ok || !statuses[status] {
			return nil, false
		}
		evidence := []pyjson.Value{}
		if ev, ok := get(row, "evidence").([]pyjson.Value); ok {
			for _, e := range ev {
				if s, ok := e.(string); ok && len(evidence) < 50 {
					evidence = append(evidence, s)
				}
			}
		}
		o := pyjson.NewObject()
		o.Set("id", id)
		o.Set("status", status)
		o.Set("progress", pystr.Head(strOr(get(row, "progress")), 200))
		o.Set("evidence", evidence)
		o.Set("note", pystr.Head(strOr(get(row, "note")), 500))
		out = append(out, o)
	}
	return out, len(out) > 0
}

// itemIDs is {i["id"] for i in inp["items"]}; only str ids can match a row's id.
func itemIDs(items pyjson.Value) map[string]bool {
	ids := map[string]bool{}
	for _, it := range must(pyjson.Iter(items)).([]pyjson.Value) {
		switch id := must(pyjson.Subscript(it, "id")).(type) {
		case string:
			ids[id] = true
		case []pyjson.Value, *pyjson.Object:
			panic(fmt.Errorf("unhashable type: '%s'", pyjson.TypeName(id)))
		}
	}
	return ids
}

// Run is run_judge for one day. Network and LLM failures are results; an input shape Python's code
// raises on (a missing key, items that are not dicts) panics with Python's message.
func Run(cfg *config.Config, c Client, day pytime.Date, force bool, r llm.Runner) Result {
	inp, lk := c.JudgeInput(day)
	switch lk {
	case api.Unavailable:
		return "unreachable"
	case api.Missing:
		return "no-plan"
	}
	if !pyjson.Truthy(get(inp, "items")) {
		return "no-items"
	}
	// Python compares with ==, where dicts ignore key order and True == 1; pyjson.Equal is the
	// ordered comparison. Both fingerprints are strings from the server, where the two agree
	// (followups.md, Task 12).
	if !force && pyjson.Equal(get(inp, "judged_fingerprint"), get(inp, "fingerprint")) {
		return "unchanged"
	}
	text, ok := llm.Generate(r, BuildPrompt(inp), cfg.SummarizeModel, systemPrompt, timeout)
	if !ok {
		return "llm-failed"
	}
	rows, ok := ParseOutput(text, itemIDs(must(pyjson.Subscript(inp, "items"))))
	if !ok {
		return "bad-output"
	}
	items := make([]pyjson.Value, len(rows))
	for i, row := range rows {
		items[i] = row
	}
	body := pyjson.NewObject()
	body.Set("fingerprint", must(pyjson.Subscript(inp, "fingerprint")))
	body.Set("model", cfg.SummarizeModel)
	body.Set("machine", cfg.Machine)
	body.Set("items", items)
	switch c.PostJudgement(day, body) {
	case api.OK:
		return "stored"
	case api.Stale:
		return "stale"
	case api.Rejected:
		return "rejected"
	}
	return "unreachable"
}

var messages = map[Result]string{
	"unreachable": "the server could not be reached (or is not deployed with migration 0007)",
	"llm-failed":  "claude -p failed",
	"bad-output":  "the model did not answer with usable JSON",
	"rejected":    "the server refused the judgement",
}

// Warn is warn: one stderr line for the results the next harvest retries.
func Warn(env *rt.Env, res Result, day pytime.Date) {
	if m, ok := messages[res]; ok {
		env.Warnf("worklog: plan judge %s skipped: %s; the next harvest retries", day, m)
	}
}
