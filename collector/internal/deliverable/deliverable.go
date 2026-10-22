// Package deliverable is deliverable_judge.py: after a harvest, `claude -p` judges which of this
// machine's written files the rule left gray are 成果物 (spec §4.15). The server lists them; this
// machine reads each file's opening text, since only it has the files.
package deliverable

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// Result is run_judge's outcome: "nothing" "stored" "partial" "llm-failed" "bad-output"
// "unreachable" "rejected".
type Result string

// Client is the part of the API client the judge uses.
type Client interface {
	DeliverablePending(string, int) (*pyjson.Object, bool)
	PostDeliverableVerdicts([]*pyjson.Object) (int, api.Outcome)
}

// Copied byte-for-byte from deliverable_judge.py (golden prompts.json checks argv and stdin).
const (
	systemPrompt = "你在帮一名工程师整理每个案件的成果物。只根据给你的路径、案件和文件开头判断，不编造。只输出 JSON，不要任何别的文字。"
	instruction  = "对 <files> 里的每个文件，判断它是不是这个案件的成果物，输出一个 JSON 数组，每个文件一个对象：\n{\"id\": 文件id, \"verdict\": \"in\" | \"out\", \"reason\": \"一句理由\"}\n- in（成果物）：给人看、交出去或留作正式记录的文档：需求 / 设计书、规格、说明书、手册、报告、提案、汇报材料、会议纪要、决定记录、给人检查用的一览表或页面。\n- out（过程 / 中间产物）：agent 或工作流自己的东西：计划、任务拆分、进度、执行日志、调试记录、草稿和被后来版本取代的中间稿、给 agent 的指示或 prompt、工具或脚本目录里的 README、测试数据和输出、临时比较和调查笔记。\n- 案件标题说明这件工作要交付什么；路径里的目录名（docs、spec、notes、drafts……）和文件开头是主要线索。\n- excerpt 为空时只按路径和案件判断。\n- 明显是中间过程的才判 out；拿不准时判 in（用户可以再排除）。\n- 只输出 JSON。"
)

// Files per model call, and calls per harvest: a backlog drains over a few hourly harvests instead
// of holding one up.
const (
	batch          = 40
	HarvestBatches = 2
	excerptChars   = 1200
	timeout        = 300 * time.Second
	unsure         = "模型未作答，按拿不准处理"
)

// Kinds whose opening bytes say nothing to a model.
var binary = map[string]bool{".pdf": true, ".docx": true, ".doc": true, ".xlsx": true, ".xlsm": true, ".xls": true, ".pptx": true, ".ppt": true}

// hostFlavour is the pathlib flavour of the host whose files Excerpt reads.
var hostFlavour = map[bool]pypath.Flavour{false: pypath.Posix, true: pypath.Windows}[os.PathSeparator == '\\']

// suffix is PurePath.suffix (Python 3.14) under flavour f: the last "."-part of the name once its
// leading dots are stripped.
func suffix(path string, f pypath.Flavour) string {
	name := strings.TrimLeft(f.Name(path), ".")
	if i := strings.LastIndexByte(name, '.'); i >= 0 {
		return name[i:]
	}
	return ""
}

// Excerpt is the file's opening 1200 characters (text mode: UTF-8 with replacement, universal
// newlines), or "" when it cannot be read here or is a binary kind.
func Excerpt(path string) string {
	if binary[strings.ToLower(suffix(path, hostFlavour))] {
		return ""
	}
	s, err := pystr.ReadTextHead(path, excerptChars)
	if err != nil {
		return ""
	}
	return s
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

// key is it["key"] as Path() takes it: a str, or Python's TypeError.
func key(it *pyjson.Object) string {
	k := must(pyjson.Subscript(it, "key"))
	s, ok := k.(string)
	if !ok {
		panic(fmt.Errorf("argument should be a str or an os.PathLike object where __fspath__ returns a str, not '%s'", pyjson.TypeName(k)))
	}
	return s
}

// BuildPrompt is build_prompt: the files as F1..Fn with path, case title, project and excerpt.
func BuildPrompt(items []*pyjson.Object) string {
	files := []pyjson.Value{}
	for i, it := range items {
		f := pyjson.NewObject()
		f.Set("id", fmt.Sprintf("F%d", i+1))
		f.Set("path", must(pyjson.Subscript(it, "key")))
		f.Set("task", must(pyjson.Subscript(it, "task_title")))
		f.Set("project", must(pyjson.Subscript(it, "project")))
		f.Set("excerpt", Excerpt(key(it)))
		files = append(files, f)
	}
	return "<files>\n" + string(pyjson.Dumps(files, pyjson.Indented(1))) + "\n</files>\n" + instruction
}

var (
	arrayRe  = regexp.MustCompile(`(?s)\[.*\]`)
	objectRe = regexp.MustCompile(`\{[^{}]*\}`)
)

// isDigit is str.isdigit for the purpose here: only ASCII digits can make an id "F<n>" that names
// a file, so a string of other Unicode digits stays unmatched either way.
func isDigit(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// ParseOutput is parse_output: verdicts keyed by the files' paths (a later row for a file replaces
// an earlier one in its place), or false when the answer is not a usable JSON array. When the
// array is not valid JSON, its {...} objects are read one by one, so one bad object does not lose
// the batch. items are the ones BuildPrompt took (str keys).
func ParseOutput(text string, items []*pyjson.Object) ([]*pyjson.Object, bool) {
	m := arrayRe.FindString(text)
	if m == "" {
		return nil, false
	}
	var rows []pyjson.Value
	if v, err := pyjson.Decode([]byte(m)); err == nil {
		var ok bool
		if rows, ok = v.([]pyjson.Value); !ok {
			return nil, false
		}
	} else {
		for _, o := range objectRe.FindAllString(m, -1) {
			if v, err := pyjson.Decode([]byte(o)); err == nil {
				rows = append(rows, v)
			}
		}
	}
	byID := map[string]string{}
	for i, it := range items {
		byID[fmt.Sprintf("F%d", i+1)] = key(it)
	}
	out := pyjson.NewObject()
	for _, rv := range rows {
		row, ok := rv.(*pyjson.Object)
		if !ok {
			continue
		}
		// The model sometimes answers "F3" as 3 or "3".
		var rid string
		switch id := get(row, "id").(type) {
		case pyjson.Int:
			rid = fmt.Sprintf("F%d", id)
		case string:
			rid = id
			if isDigit(id) {
				rid = "F" + id
			}
		default:
			continue
		}
		path, known := byID[rid]
		verdict, _ := get(row, "verdict").(string)
		if !known || verdict != "in" && verdict != "out" {
			continue
		}
		v := pyjson.NewObject()
		v.Set("key", path)
		v.Set("verdict", verdict)
		reason := ""
		if r := get(row, "reason"); pyjson.Truthy(r) {
			reason = pyjson.Str(r)
		}
		v.Set("reason", pystr.Head(reason, 500))
		out.Set(path, v)
	}
	var verdicts []*pyjson.Object
	for _, k := range out.Keys() {
		verdicts = append(verdicts, get(out, k).(*pyjson.Object))
	}
	return verdicts, len(verdicts) > 0
}

// pendingItems is pending.get("items") or [] as build_prompt walks it: each item a dict with
// key, task_title and project, or Python's error for the first one that is not.
func pendingItems(v pyjson.Value) []*pyjson.Object {
	if !pyjson.Truthy(v) {
		return nil
	}
	var items []*pyjson.Object
	for _, e := range must(pyjson.Iter(v)).([]pyjson.Value) {
		for _, k := range []string{"key", "task_title", "project"} {
			must(pyjson.Subscript(e, k))
		}
		it := e.(*pyjson.Object)
		key(it)
		items = append(items, it)
	}
	return items
}

// Run is run_judge: up to batches batches (< 0 = until none are left) of this machine's pending
// files. Verdicts already posted stay posted; a later failure is "partial".
func Run(cfg *config.Config, c Client, batches int, r llm.Runner) Result {
	done := 0
	fail := func(first Result) Result {
		if done == 0 {
			return first
		}
		return "partial"
	}
	for batches < 0 || done < batches {
		pending, ok := c.DeliverablePending(cfg.Machine, batch)
		if !ok {
			return fail("unreachable")
		}
		items := pendingItems(get(pending, "items"))
		if len(items) == 0 {
			if done == 0 {
				return "nothing"
			}
			return "stored"
		}
		text, ok := llm.Generate(r, BuildPrompt(items), cfg.SummarizeModel, systemPrompt, timeout)
		if !ok {
			return fail("llm-failed")
		}
		verdicts, ok := ParseOutput(text, items)
		if !ok {
			return fail("bad-output")
		}
		// A file the model left out of an otherwise usable answer would come back first in every
		// harvest and be paid for each time: it gets the unsure verdict, in (the user can still
		// take it out).
		answered := map[string]bool{}
		for _, v := range verdicts {
			answered[get(v, "key").(string)] = true
		}
		for _, it := range items {
			if k := key(it); !answered[k] {
				v := pyjson.NewObject()
				v.Set("key", k)
				v.Set("verdict", "in")
				v.Set("reason", unsure)
				verdicts = append(verdicts, v)
			}
		}
		n, out := c.PostDeliverableVerdicts(verdicts)
		if out == api.Rejected {
			return "rejected"
		}
		if out != api.OK {
			return fail("unreachable")
		}
		done++
		// Nothing new stored (every file judged meanwhile, or the model skipped them all): the
		// same list would come back, so stop instead of paying for it again.
		if n == 0 {
			break
		}
	}
	return "stored"
}

var messages = map[Result]string{
	"unreachable": "the server could not be reached (or is not deployed with migration 0015)",
	"llm-failed":  "claude -p failed",
	"bad-output":  "the model did not answer with usable JSON",
	"rejected":    "the server refused the verdicts",
	"partial":     "it stopped part way",
}

// Warn is warn: one stderr line for the results the next harvest retries.
func Warn(env *rt.Env, res Result) {
	if m, ok := messages[res]; ok {
		env.Warnf("worklog: deliverable judge: %s; the next harvest retries", m)
	}
}
