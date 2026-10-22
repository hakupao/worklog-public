package deliverable

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
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

func at(o *pyjson.Object, keys ...string) pyjson.Value {
	var v pyjson.Value = o
	for _, k := range keys {
		v, _ = v.(*pyjson.Object).Get(k)
	}
	return v
}

func list(rows []*pyjson.Object) pyjson.Value {
	if rows == nil {
		return nil
	}
	l := []pyjson.Value{}
	for _, r := range rows {
		l = append(l, r)
	}
	return l
}

var cfg = &config.Config{Machine: "macmini", SummarizeModel: "haiku"}

func item(key string, title ...string) *pyjson.Object {
	o := pyjson.NewObject()
	o.Set("key", key)
	o.Set("task_id", "T1")
	if len(title) > 0 {
		o.Set("task_title", title[0])
	} else {
		o.Set("task_title", "LEDGER 設計書")
	}
	o.Set("project", "LEDGER")
	return o
}

func page(total int, items ...*pyjson.Object) *pyjson.Object {
	o := pyjson.NewObject()
	o.Set("items", list(items))
	o.Set("total", pyjson.Int(total))
	return o
}

// client is test_deliverable_judge.py's Client: it serves pages in turn ({"items": []} when they
// run out; a nil page is an unreachable server) and answers each post with post (nil = the number
// of verdicts).
type client struct {
	pages  []*pyjson.Object
	post   any
	posted [][]*pyjson.Object
	asked  []string
}

func (c *client) DeliverablePending(machine string, limit int) (*pyjson.Object, bool) {
	c.asked = append(c.asked, fmt.Sprintf("%s/%d", machine, limit))
	if len(c.pages) == 0 {
		return page(0), true
	}
	p := c.pages[0]
	c.pages = c.pages[1:]
	return p, p != nil
}

func (c *client) PostDeliverableVerdicts(v []*pyjson.Object) (int, api.Outcome) {
	c.posted = append(c.posted, v)
	switch p := c.post.(type) {
	case nil:
		return len(v), api.OK
	case int:
		return p, api.OK
	}
	return 0, c.post.(api.Outcome)
}

type runner struct {
	answer func(stdin string) (int, string)
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
	code, out := r.answer(string(stdin))
	return llm.Result{Stdout: []byte(out), ExitCode: code}, nil
}

func answer(rows string) *runner {
	return &runner{answer: func(string) (int, string) { return 0, rows }}
}

var failed = &runner{answer: func(string) (int, string) { return 1, "" }}

func TestExcerptReadsTheOpeningTextAndSkipsBinariesAndMissingFiles(t *testing.T) {
	dir := t.TempDir()
	md := filepath.Join(dir, "a.md")
	os.WriteFile(md, []byte("# 設計書\n"+strings.Repeat("x", 5000)), 0o644)
	os.WriteFile(filepath.Join(dir, "b.xlsx"), []byte("PK\x03\x04"), 0o644)
	if e := Excerpt(md); !strings.HasPrefix(e, "# 設計書") || utf8.RuneCountInString(e) != 1200 {
		t.Errorf("md: %d", utf8.RuneCountInString(e))
	}
	if Excerpt(filepath.Join(dir, "b.xlsx")) != "" || Excerpt(filepath.Join(dir, "gone.md")) != "" || Excerpt(dir) != "" {
		t.Error("binary / missing / directory not empty")
	}
}

func TestPromptCarriesIDsPathsTasksExcerptsAndTheLean(t *testing.T) {
	md := filepath.Join(t.TempDir(), "spec.md")
	os.WriteFile(md, []byte("# 保存接口规格"), 0o644)
	p := BuildPrompt([]*pyjson.Object{item(md), item("/nowhere/notes.md", "調査")})
	// The path reaches the prompt through json.dumps (deliverable_judge.py:54): a Windows path's
	// backslashes are escaped there.
	for _, s := range []string{`"F1"`, `"F2"`, strings.ReplaceAll(md, `\`, `\\`), "保存接口规格", "調査", "拿不准时判 in", "只输出 JSON"} {
		if !strings.Contains(p, s) {
			t.Errorf("missing %q", s)
		}
	}
}

func TestParseMapsIDsBackToPathsAndDropsBadRows(t *testing.T) {
	items := []*pyjson.Object{item("/p/a.md"), item("/p/b.md"), item("/p/c.md")}
	text := "結果：\n```json\n" + `[{"id": "F1", "verdict": "in", "reason": "设计书"}, {"id": "F2", "verdict": "maybe"},
		{"id": "F9", "verdict": "out"}, {"id": ["F3"], "verdict": "out"}, {"id": "F3", "verdict": "out", "reason": "` +
		strings.Repeat("x", 900) + `"}]` + "\n```"
	rows, ok := ParseOutput(text, items)
	want := decode(t, `[{"key": "/p/a.md", "verdict": "in", "reason": "设计书"}, {"key": "/p/c.md", "verdict": "out", "reason": "`+
		strings.Repeat("x", 500)+`"}]`)
	if !ok || !pyjson.Equal(list(rows), want) {
		t.Fatalf("%s", pyjson.Compact(list(rows)))
	}
	for _, bad := range []string{"no json here", "[{]", `[{"id": "F9", "verdict": "in"}]`} {
		if _, ok := ParseOutput(bad, items); ok {
			t.Errorf("%q accepted", bad)
		}
	}
}

var twoRows = `[{"id": "F1", "verdict": "in", "reason": ""}, {"id": "F2", "verdict": "out", "reason": ""}]`

func TestRunPostsOneBatchPerPageUpToTheCap(t *testing.T) {
	p := page(300, item("/p/a.md"), item("/p/b.md"))
	c := &client{pages: []*pyjson.Object{p, p, p}}
	if r := Run(cfg, c, HarvestBatches, answer(twoRows)); r != "stored" {
		t.Fatal(r)
	}
	if len(c.posted) != 2 || strings.Join(c.asked, " ") != "macmini/40 macmini/40" {
		t.Fatalf("%d %v", len(c.posted), c.asked)
	}
	want := decode(t, `[{"key": "/p/a.md", "verdict": "in", "reason": ""}, {"key": "/p/b.md", "verdict": "out", "reason": ""}]`)
	if !pyjson.Equal(list(c.posted[0]), want) {
		t.Fatalf("%s", pyjson.Compact(list(c.posted[0])))
	}
}

func TestRunUntilNoneLeftAndStopsWhenNothingNewIsStored(t *testing.T) {
	p := page(1, item("/p/a.md"))
	rows := `[{"id": "F1", "verdict": "in"}]`
	c := &client{pages: []*pyjson.Object{p, p, page(0)}}
	if r := Run(cfg, c, -1, answer(rows)); r != "stored" || len(c.posted) != 2 {
		t.Fatalf("%s %d", r, len(c.posted))
	}
	// The server keeps answering with files it then refuses to store (judged meanwhile): one call, not a loop.
	c2 := &client{pages: []*pyjson.Object{p, p, p, p, p}, post: 0}
	if r := Run(cfg, c2, -1, answer(rows)); r != "stored" || len(c2.posted) != 1 {
		t.Fatalf("%s %d", r, len(c2.posted))
	}
}

func TestRunReportsWhatWentWrong(t *testing.T) {
	p := func() *pyjson.Object { return page(1, item("/p/a.md")) }
	ok := `[{"id": "F1", "verdict": "in"}]`
	first := 0
	firstThenFailed := &runner{answer: func(string) (int, string) {
		first++
		if first == 1 {
			return 0, ok
		}
		return 1, ""
	}}
	for _, c := range []struct {
		c       *client
		batches int
		r       *runner
		want    Result
	}{
		{&client{}, 2, answer(ok), "nothing"},
		{&client{pages: []*pyjson.Object{nil}}, 2, answer(ok), "unreachable"},
		{&client{pages: []*pyjson.Object{p()}}, 2, failed, "llm-failed"},
		{&client{pages: []*pyjson.Object{p()}}, 2, answer(`{"not": "a list"}`), "bad-output"},
		{&client{pages: []*pyjson.Object{p()}, post: api.Rejected}, 2, answer(ok), "rejected"},
		{&client{pages: []*pyjson.Object{p()}, post: api.Retry}, 2, answer(ok), "unreachable"},
		// A later batch failing keeps what the first one stored.
		{&client{pages: []*pyjson.Object{p(), p()}}, 2, firstThenFailed, "partial"},
	} {
		if r := Run(cfg, c.c, c.batches, c.r); r != c.want {
			t.Errorf("got %s, want %s", r, c.want)
		}
	}
}

func TestAFileTheModelLeftOutGetsTheUnsureVerdictInsteadOfComingBackEveryHarvest(t *testing.T) {
	c := &client{pages: []*pyjson.Object{page(2, item("/p/a.md"), item("/p/b.md"))}}
	if r := Run(cfg, c, 1, answer(`[{"id": "F1", "verdict": "out", "reason": "笔记"}]`)); r != "stored" {
		t.Fatal(r)
	}
	want := decode(t, `[{"key": "/p/a.md", "verdict": "out", "reason": "笔记"}, {"key": "/p/b.md", "verdict": "in", "reason": "模型未作答，按拿不准处理"}]`)
	if !pyjson.Equal(list(c.posted[0]), want) {
		t.Fatalf("%s", pyjson.Compact(list(c.posted[0])))
	}
}

func TestParseKeepsTheGoodObjectsWhenOneBreaksTheJSON(t *testing.T) {
	text := "[\n{\"id\":\"F1\",\"verdict\":\"in\",\"reason\":\"设计书\"},\n{\"id\":\"F2\",\"verdict\":\"out\",\"reason\":\"标注\"v0.2\"取代\"}\n]"
	rows, ok := ParseOutput(text, []*pyjson.Object{item("/p/a.md"), item("/p/b.md")})
	if !ok || !pyjson.Equal(list(rows), decode(t, `[{"key": "/p/a.md", "verdict": "in", "reason": "设计书"}]`)) {
		t.Fatalf("%s", pyjson.Compact(list(rows)))
	}
}

func TestParseTakesABareNumberForItsFileID(t *testing.T) {
	text := `[{"id":1,"verdict":"in"},{"id":"2","verdict":"out"},{"id":true,"verdict":"in"}]`
	rows, ok := ParseOutput(text, []*pyjson.Object{item("/p/a.md"), item("/p/b.md"), item("/p/c.md")})
	want := decode(t, `[{"key": "/p/a.md", "verdict": "in", "reason": ""}, {"key": "/p/b.md", "verdict": "out", "reason": ""}]`)
	if !ok || !pyjson.Equal(list(rows), want) {
		t.Fatalf("%s", pyjson.Compact(list(rows)))
	}
}

// Python raises on these item shapes (KeyError / TypeError, in build_prompt's order); Go panics
// with the same message.
func TestItemShapesPythonRaisesOnPanicWithItsMessage(t *testing.T) {
	for _, c := range []struct{ items, msg string }{
		{`[{"key": "/a", "task_title": "t"}, "x"]`, "'project'"},
		{`[{"key": "/a", "task_title": "t", "project": "p"}, "x"]`, "string indices must be integers, not 'str'"},
		{`[{"task_title": "t", "project": "p"}]`, "'key'"},
		{`[{"key": 5, "task_title": "t", "project": "p"}]`, "argument should be a str or an os.PathLike object where __fspath__ returns a str, not 'int'"},
		{`{"k": 1}`, "string indices must be integers, not 'str'"},
		{`5`, "'int' object is not iterable"},
	} {
		func() {
			defer func() {
				r := recover()
				if err, ok := r.(error); !ok || err.Error() != c.msg {
					t.Errorf("%s: panic %v, want %q", c.items, r, c.msg)
				}
			}()
			p := pyjson.NewObject()
			p.Set("items", decode(t, c.items))
			Run(cfg, &client{pages: []*pyjson.Object{p}}, 1, answer("[]"))
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
	g := at(loadGolden(t, "parse_output"), "deliverable_judge").(*pyjson.Object)
	var items []*pyjson.Object
	for _, it := range at(g, "items").([]pyjson.Value) {
		items = append(items, it.(*pyjson.Object))
	}
	cases := at(g, "cases").([]pyjson.Value)
	if len(cases) != 11 {
		t.Fatalf("%d cases", len(cases))
	}
	for _, cv := range cases {
		c := cv.(*pyjson.Object)
		rows, _ := ParseOutput(at(c, "text").(string), items)
		if !pyjson.Equal(list(rows), at(c, "out")) {
			t.Errorf("%q:\n%s\nwant\n%s", at(c, "text"), pyjson.Compact(list(rows)), pyjson.Compact(at(c, "out")))
		}
	}
}

// The golden runs read their excerpts relative to collector/testdata, as gen_golden did.
func goldenItems(t *testing.T) []*pyjson.Object {
	var items []*pyjson.Object
	for _, n := range []string{"spec.md", "crlf.md", "invalid.txt", "astral.md", "report.pdf", "Upper.DOCX", "short.md", "missing.md"} {
		o := pyjson.NewObject()
		o.Set("key", "excerpts/"+n)
		o.Set("task_title", "設計 😀")
		o.Set("project", "P")
		items = append(items, o)
	}
	return items
}

func TestExcerptGolden(t *testing.T) {
	t.Chdir(testkit.TestdataDir(t))
	rows := at(loadGolden(t, "prompts"), "excerpt").([]pyjson.Value)
	if len(rows) != 8 {
		t.Fatalf("%d rows", len(rows))
	}
	for _, rv := range rows {
		r := rv.(*pyjson.Object)
		if got := Excerpt(at(r, "key").(string)); got != at(r, "excerpt") {
			t.Errorf("%s: %q", at(r, "key"), got)
		}
	}
}

// answerAll is gen_side_jobs's answer_all: a verdict for every file but the last.
func answerAll(stdin string) (int, string) {
	files := strings.SplitN(strings.SplitN(stdin, "<files>\n", 2)[1], "\n</files>", 2)[0]
	v, _ := pyjson.Decode([]byte(files))
	rows := []pyjson.Value{}
	fs := v.([]pyjson.Value)
	for n, f := range fs[:len(fs)-1] {
		id := at(f.(*pyjson.Object), "id").(string)
		r := pyjson.NewObject()
		r.Set("id", id)
		if n%2 == 0 {
			r.Set("verdict", "in")
		} else {
			r.Set("verdict", "out")
		}
		r.Set("reason", "理由 "+id)
		rows = append(rows, r)
	}
	return 0, string(pyjson.Dumps(rows, pyjson.Unicode()))
}

type goldenClient struct {
	pages []*pyjson.Object // nil entry = None
	posts []any            // int or "rejected"
	calls []pyjson.Value
}

func (c *goldenClient) DeliverablePending(machine string, limit int) (*pyjson.Object, bool) {
	c.calls = append(c.calls, []pyjson.Value{"pending", machine, pyjson.Int(limit)})
	if len(c.pages) == 0 {
		return page(0), true
	}
	p := c.pages[0]
	c.pages = c.pages[1:]
	return p, p != nil
}

func (c *goldenClient) PostDeliverableVerdicts(v []*pyjson.Object) (int, api.Outcome) {
	c.calls = append(c.calls, []pyjson.Value{"post", list(v)})
	if len(c.posts) == 0 {
		return 0, api.OK
	}
	p := c.posts[0]
	c.posts = c.posts[1:]
	if n, ok := p.(int); ok {
		return n, api.OK
	}
	return 0, api.Outcome(p.(string))
}

func TestRunGolden(t *testing.T) {
	t.Chdir(testkit.TestdataDir(t))
	g := loadGolden(t, "prompts")
	gcfg := &config.Config{Machine: "mac mini 開発", SummarizeModel: "sonnet"}
	items := goldenItems(t)
	full := func() *pyjson.Object { return page(len(items), items...) }
	all := func() *runner { return &runner{answer: answerAll} }
	fixed := func(code int, out string) *runner {
		return &runner{answer: func(string) (int, string) { return code, out }}
	}
	setup := map[string]struct {
		pages   []*pyjson.Object
		posts   []any
		batches int
		r       *runner
	}{
		"stored_two_batches": {[]*pyjson.Object{full(), page(2, items[:2]...)}, []any{7, 2}, 2, all()},
		"nothing":            {[]*pyjson.Object{page(0)}, nil, 2, all()},
		"unreachable":        {[]*pyjson.Object{nil}, nil, 2, all()},
		"llm_failed":         {[]*pyjson.Object{full()}, nil, 2, fixed(1, "")},
		"bad_output":         {[]*pyjson.Object{full()}, nil, 2, fixed(0, "none")},
		"rejected":           {[]*pyjson.Object{full()}, []any{"rejected"}, 2, all()},
		"zero_stops":         {[]*pyjson.Object{full(), full()}, []any{0}, 2, all()},
		"partial":            {[]*pyjson.Object{full(), nil}, []any{5}, 2, all()},
		"until_none":         {[]*pyjson.Object{full(), full(), full()}, []any{1, 1, 1}, -1, all()},
	}
	cases := at(g, "deliverable_judge").([]pyjson.Value)
	if len(cases) != len(setup) {
		t.Fatalf("%d cases", len(cases))
	}
	for _, cv := range cases {
		c := cv.(*pyjson.Object)
		name := at(c, "name").(string)
		s, ok := setup[name]
		if !ok {
			t.Fatalf("no setup for %s", name)
		}
		gc := &goldenClient{pages: s.pages, posts: s.posts}
		res := Run(gcfg, gc, s.batches, s.r)
		if string(res) != at(c, "result") {
			t.Errorf("%s: %s, want %s", name, res, at(c, "result"))
		}
		if !pyjson.Equal(gc.calls, at(c, "client_calls")) {
			t.Errorf("%s: client calls\n%s\nwant\n%s", name, pyjson.Compact(gc.calls), pyjson.Compact(at(c, "client_calls")))
		}
		want := at(c, "claude_calls").([]pyjson.Value)
		if len(s.r.calls) != len(want) {
			t.Errorf("%s: %d claude calls, want %d", name, len(s.r.calls), len(want))
			continue
		}
		for i := range want {
			gcall, w := s.r.calls[i].(*pyjson.Object), want[i].(*pyjson.Object)
			if !pyjson.Equal(at(gcall, "argv"), at(w, "argv")) || at(gcall, "input") != at(w, "input") ||
				at(gcall, "timeout") != at(w, "kwargs", "timeout") {
				t.Errorf("%s: claude call %d\n%s\nwant\n%s", name, i, at(gcall, "input"), at(w, "input"))
			}
		}
	}
}

func TestWarnGolden(t *testing.T) {
	n := 0
	for _, wv := range at(loadGolden(t, "prompts"), "warn").([]pyjson.Value) {
		w := wv.(*pyjson.Object)
		if at(w, "job") != "deliverable_judge" {
			continue
		}
		var buf bytes.Buffer
		Warn(&rt.Env{Stderr: &buf}, Result(at(w, "result").(string)))
		if buf.String() != at(w, "stderr") {
			t.Errorf("%s: %q", at(w, "result"), buf.String())
		}
		n++
	}
	if n != 7 {
		t.Fatalf("%d warn rows", n)
	}
}

// PurePosixPath(p).suffix / PureWindowsPath(p).suffix, printed by CPython 3.14.4.
func TestSuffixUnderBothFlavours(t *testing.T) {
	for _, c := range []struct{ p, posix, windows string }{
		{`x\.pdf`, ".pdf", ""}, {"..pdf", "", ""}, {"a.", ".", "."}, {"report.PDF/", ".PDF", ".PDF"},
		{`C:\d\a.b.xlsx`, ".xlsx", ".xlsx"}, {"", "", ""},
	} {
		if got := suffix(c.p, pypath.Posix); got != c.posix {
			t.Errorf("posix %q: %q", c.p, got)
		}
		if got := suffix(c.p, pypath.Windows); got != c.windows {
			t.Errorf("windows %q: %q", c.p, got)
		}
	}
}
