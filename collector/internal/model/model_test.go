package model

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

func decode(t *testing.T, s string) pyjson.Value {
	t.Helper()
	v, err := pyjson.Decode([]byte(s))
	if err != nil {
		t.Fatalf("decode %q: %v", s, err)
	}
	return v
}

func str(s string) *string { return &s }

func mustISO(t *testing.T, s string) pytime.Instant {
	t.Helper()
	i, err := pytime.FromISO(s)
	if err != nil {
		t.Fatal(err)
	}
	return i
}

// TestTasksValidateGolden replays golden/tasks_validate.json: Task.model_validate(row) of pydantic's
// lax mode, and model_dump_json of each accepted row.
func TestTasksValidateGolden(t *testing.T) {
	var raw []byte
	testkit.Golden(t, "tasks_validate", &raw)
	root, err := pyjson.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	casesV, _ := root.(*pyjson.Object).Get("cases")
	for _, cv := range casesV.([]pyjson.Value) {
		c := cv.(*pyjson.Object)
		name, _ := c.Get("name")
		row, _ := c.Get("row")
		ok, _ := c.Get("ok")
		t.Run(name.(string), func(t *testing.T) {
			task, err := DecodeTask(row)
			if (err == nil) != ok.(bool) {
				t.Fatalf("DecodeTask ok=%v, Python ok=%v (err %v)", err == nil, ok, err)
			}
			if err != nil {
				return
			}
			got, err := task.MarshalJSON()
			if err != nil {
				t.Fatal(err)
			}
			want, _ := c.Get("dump_json")
			if !pyjson.Equal(decode(t, string(got)), decode(t, want.(string))) {
				t.Fatalf("dump\n got %s\nwant %s", got, want)
			}
			// The simple values here spell the same in pydantic and in pyjson.Compact.
			if string(got) != want.(string) {
				t.Errorf("dump bytes\n got %s\nwant %s", got, want)
			}
		})
	}
}

func TestNoteAndSessionDumpsGolden(t *testing.T) {
	var raw []byte
	testkit.Golden(t, "tasks_validate", &raw)
	root, _ := pyjson.Decode(raw)
	o := root.(*pyjson.Object)
	noteDumps, _ := o.Get("note_dumps")
	sessDump, _ := o.Get("session_defaults_dump")

	// FixedDateTime.now() = 2026-10-13T12:00:00.123456 naive.
	now := pytime.Naive(time.Date(2026, 10, 13, 12, 0, 0, 123456000, time.UTC))
	minutes := 30
	notes := []Note{
		{ID: "N20261013-120000-abcd", TS: now, Machine: "mac", SchemaVersion: 1, Text: "メモ 😀", TaskID: str("T1"), Minutes: &minutes},
		{ID: "N2", TS: pytime.Naive(time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)), Machine: "mac", SchemaVersion: 1},
	}
	for i, n := range notes {
		got, err := n.MarshalJSON()
		if err != nil {
			t.Fatal(err)
		}
		want := noteDumps.([]pyjson.Value)[i].(string)
		if !pyjson.Equal(decode(t, string(got)), decode(t, want)) || string(got) != want {
			t.Errorf("note %d\n got %s\nwant %s", i, got, want)
		}
	}

	s := Session{
		ID: "Sabcd1234", TS: now, Machine: "mac", SchemaVersion: 1, Agent: "claude-code",
		SessionID: "abcd1234-x", Cwd: "/w",
		StartedAt:     mustISO(t, "2026-09-18T09:00:00+00:00"),
		EndedAt:       mustISO(t, "2026-09-18T18:00:00.500000+09:00"),
		ActiveMinutes: 1, Turns: 1, Summary: "s", SummarySource: "fallback", LinkMethod: "none",
	}
	got, err := s.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if !pyjson.Equal(decode(t, string(got)), decode(t, sessDump.(string))) || string(got) != sessDump.(string) {
		t.Errorf("session\n got %s\nwant %s", got, sessDump)
	}
}

func makeSession() Session {
	return Session{
		ID: "Sabcd1234", Agent: "claude-code", SessionID: "abcd1234-x", Cwd: "/w",
		StartedAt:     pytime.Naive(time.Date(2026, 9, 18, 9, 0, 0, 0, time.UTC)),
		EndedAt:       pytime.Naive(time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC)),
		ActiveMinutes: 60, Turns: 5, Summary: "s",
		TS: pytime.Naive(time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC)), Machine: "mac",
		SchemaVersion: 1, SummarySource: "fallback", LinkMethod: "none",
	}
}

func field(t *testing.T, rec interface{ MarshalJSON() ([]byte, error) }, k string) pyjson.Value {
	t.Helper()
	b, err := rec.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	v, ok := decode(t, string(b)).(*pyjson.Object).Get(k)
	if !ok {
		t.Fatalf("no %q in %s", k, b)
	}
	return v
}

// test_api_client.py:518 test_session_carries_files_written
func TestSessionCarriesFilesWritten(t *testing.T) {
	v := field(t, makeSession(), "files_written")
	if l, ok := v.([]pyjson.Value); !ok || len(l) != 0 {
		t.Fatalf("files_written = %#v, want []", v)
	}
}

// test_api_client.py:522 test_session_sends_tokens_as_null_when_unknown
func TestSessionSendsTokensAsNullWhenUnknown(t *testing.T) {
	if v := field(t, makeSession(), "tokens"); v != nil {
		t.Fatalf("tokens = %#v, want null", v)
	}
}

// test_api_client.py:554 test_session_sends_active_intervals_as_nested_iso_pairs
func TestSessionSendsActiveIntervalsAsNestedISOPairs(t *testing.T) {
	s := makeSession()
	s.ActiveIntervals = []Interval{{mustISO(t, "2026-09-18T09:00:00+00:00"), mustISO(t, "2026-09-18T09:30:00.500000+00:00")}}
	want := decode(t, `[["2026-09-18T09:00:00Z", "2026-09-18T09:30:00.500000Z"]]`)
	if got := field(t, s, "active_intervals"); !pyjson.Equal(got, want) {
		t.Fatalf("active_intervals = %#v", got)
	}
	if got := field(t, makeSession(), "active_intervals"); got != nil {
		t.Fatalf("nil intervals = %#v, want null", got)
	}
}

func TestSessionArtifactsNullVersusEmptyAndOrder(t *testing.T) {
	s := makeSession()
	if got := field(t, s, "artifacts"); got != nil {
		t.Fatalf("nil artifacts = %#v, want null", got)
	}
	s.Artifacts = []Artifact{}
	if got := field(t, s, "artifacts"); !pyjson.Equal(got, []pyjson.Value{}) {
		t.Fatalf("empty artifacts = %#v, want []", got)
	}
	s.Artifacts = []Artifact{{URL: "https://claude.ai/a/1", Title: str("題"), TS: "2026-09-18T09:00:00.123Z"}}
	b, _ := s.MarshalJSON()
	want := `[{"url":"https://claude.ai/a/1","title":"題","artifact_id":null,"ts":"2026-09-18T09:00:00.123Z"}]`
	got := field(t, s, "artifacts")
	if string(pyjson.Compact(got)) != want {
		t.Fatalf("artifacts = %s (in %s)", pyjson.Compact(got), b)
	}
}

func TestSessionFullFieldOrderAndTokensKeepTheirOrder(t *testing.T) {
	s := makeSession()
	s.TaskID = str("T1")
	s.LinkMethod = "auto-dir"
	s.SummarySource = "llm"
	s.FilesWritten = []string{"/w/b.md", "/w/a.md"}
	tok := decode(t, `{"by_model": {"zeta": {"input": 1}, "alpha": {"input": 2}}, "cost_usd": 0.5}`).(*pyjson.Object)
	s.Tokens = tok
	b, _ := s.MarshalJSON()
	o := decode(t, string(b)).(*pyjson.Object)
	wantKeys := []string{"id", "ts", "machine", "schema_version", "kind", "agent", "session_id", "cwd", "started_at",
		"ended_at", "active_minutes", "turns", "summary", "summary_source", "task_id", "link_method", "files_written",
		"tokens", "active_intervals", "artifacts"}
	if got := o.Keys(); len(got) != len(wantKeys) {
		t.Fatalf("keys %v", got)
	}
	for i, k := range o.Keys() {
		if k != wantKeys[i] {
			t.Fatalf("key %d = %s, want %s (%v)", i, k, wantKeys[i], o.Keys())
		}
	}
	got, _ := o.Get("tokens")
	if !pyjson.Equal(got, tok) {
		t.Fatalf("tokens %s", pyjson.Compact(got))
	}
	fw, _ := o.Get("files_written")
	if !pyjson.Equal(fw, []pyjson.Value{"/w/b.md", "/w/a.md"}) {
		t.Fatalf("files_written %v", fw)
	}
}

// Review Focus 14: a ts formatted from env.NowLocal() carries the clock cut to microseconds.
func TestNowLocalTruncationShowsInTS(t *testing.T) {
	env := &rt.Env{Now: func() time.Time { return time.Date(2026, 10, 13, 12, 0, 0, 123456789, time.Local) }}
	n := Note{ID: "N1", TS: pytime.Naive(env.NowLocal()), Machine: "mac", SchemaVersion: 1, Text: "x"}
	if got := field(t, n, "ts"); got != "2026-10-13T12:00:00.123456" {
		t.Fatalf("ts = %v", got)
	}
}

func TestTaskHoursManualNonFiniteDumpsNull(t *testing.T) {
	h := math.NaN()
	task := Task{ID: "T1", Machine: "m", SchemaVersion: 1, Requester: "r", Title: "t", Status: "open", HoursManual: &h,
		TS: pytime.Naive(time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)), ReceivedAt: pytime.Date{Y: 2026, M: 10, D: 1}}
	if got := field(t, task, "hours_manual"); got != nil {
		t.Fatalf("hours_manual = %#v, want null", got)
	}
}

// TestDecodeTaskLax pins pydantic 2.13.5's lax mode on the rows the golden does not carry. Every
// expectation was read from the venv (Task.model_validate + model_dump_json, 2026-10-13).
func TestDecodeTaskLax(t *testing.T) {
	const errS = "ERR"
	cases := []struct {
		key, val string // val is JSON
		want     string // the dumped field as JSON, or ERR
	}{
		{"ts", `"1790000000"`, `"2026-09-21T14:13:20Z"`},
		{"ts", `"1790000000.5"`, `"2026-09-21T14:13:20.500000Z"`},
		{"ts", `1790000000.5`, `"2026-09-21T14:13:20.500000Z"`},
		{"ts", `"1790000000.1234567"`, `"2026-09-21T14:13:20.123457Z"`},
		{"ts", `17900000000000`, `"2537-03-24T22:13:20Z"`},
		{"ts", `"20000000001"`, `"1970-08-20T11:33:20.001000Z"`},
		{"ts", `20000000000`, `"2603-10-11T11:33:20Z"`},
		{"ts", `-20000000001`, `"1969-05-14T12:26:39.999000Z"`},
		{"ts", `-1`, `"1969-12-31T23:59:59Z"`},
		{"ts", `"-1.5"`, `"1969-12-31T23:59:58.500000Z"`},
		{"ts", `"+1790000000"`, `"2026-09-21T14:13:20Z"`},
		{"ts", `0`, `"1970-01-01T00:00:00Z"`},
		{"ts", `"0"`, `"1970-01-01T00:00:00Z"`},
		{"ts", `true`, errS},
		{"ts", `"1e9"`, errS},
		{"ts", `" 1790000000"`, errS},
		{"ts", `"2026-10-01 09:00:00"`, `"2026-10-01T09:00:00"`},
		{"ts", `"2026-10-01_09:00:00"`, `"2026-10-01T09:00:00"`},
		{"ts", `"2026-10-01t09:00:00z"`, `"2026-10-01T09:00:00Z"`},
		{"ts", `"2026-10-01T09:00"`, `"2026-10-01T09:00:00"`},
		{"ts", `"2026-10-01T09:00Z"`, `"2026-10-01T09:00:00Z"`},
		{"ts", `"2026-10-01T09:00:00,5"`, `"2026-10-01T09:00:00.500000"`},
		{"ts", `"2026-10-01T09:00:00.1234567"`, `"2026-10-01T09:00:00.123456"`},
		{"ts", `"2026-10-01T09:00:00.9999999"`, `"2026-10-01T09:00:00.999999"`},
		{"ts", `"2026-10-01T23:59:59.999999999"`, `"2026-10-01T23:59:59.999999"`},
		{"ts", `"2026-10-01T09:00:00+0900"`, `"2026-10-01T09:00:00+09:00"`},
		{"ts", `"2026-10-01T09:00:00-00:00"`, `"2026-10-01T09:00:00Z"`},
		{"ts", `"2026-10-01T09:00:00+23:59"`, `"2026-10-01T09:00:00+23:59"`},
		{"ts", `"2026-10-01T09:00:00-09:30"`, `"2026-10-01T09:00:00-09:30"`},
		{"ts", `"2026-10-01T09:00:00+24:00"`, errS},
		{"ts", `"2026-10-01T09:00:00+09"`, errS},
		{"ts", `"2026-10-01T09:00:00+09:00:00"`, errS},
		{"ts", `"2026-10-01T09"`, errS},
		{"ts", `"2026-10-01T"`, errS},
		{"ts", `"2026-10-01T9:00:00"`, errS},
		{"ts", `"20261001T090000"`, errS},
		{"ts", `"2026-10-01T24:00:00"`, errS},
		{"ts", `"2026-10-01T09:00:60"`, errS},
		{"ts", `"2026-10-01T09:00:00."`, errS},
		{"ts", `"2026-10-01T09:00:00Zx"`, errS},
		{"ts", `"2026-10-01T09:00:00 "`, errS},
		{"ts", `" 2026-10-01T09:00:00"`, errS},
		{"ts", `"0000-01-01T00:00:00"`, errS},
		{"ts", `"2026-02-29T00:00:00"`, errS},
		{"ts", `""`, errS},
		{"received_at", `"2026-10-01T00:00:00Z"`, `"2026-10-01"`},
		{"received_at", `"2026-10-01T00:00:00+09:00"`, `"2026-10-01"`},
		{"received_at", `"2026-10-01T00:00:00-05:00"`, `"2026-10-01"`},
		{"received_at", `"2026-10-01 00:00"`, `"2026-10-01"`},
		{"received_at", `"2026-10-01T00:00"`, `"2026-10-01"`},
		{"received_at", `"2026-10-01T00:00:00.000"`, `"2026-10-01"`},
		{"received_at", `"2026-10-01T00:00:00.000001"`, errS},
		{"received_at", `1790035200`, `"2026-09-22"`},
		{"received_at", `"1790035200"`, `"2026-09-22"`},
		{"received_at", `1790035200.0`, `"2026-09-22"`},
		{"received_at", `1790035200.5`, errS},
		{"received_at", `0`, `"1970-01-01"`},
		{"received_at", `-86400`, `"1969-12-31"`},
		{"received_at", `20000000000000`, errS},
		{"received_at", `true`, errS},
		{"received_at", `"2026-1-01"`, errS},
		{"received_at", `"2026-10-01 "`, errS},
		{"received_at", `"2026-10-01T"`, errS},
		{"schema_version", `"2.0"`, `2`},
		{"schema_version", `"2.00"`, `2`},
		{"schema_version", `" 2 "`, `2`},
		{"schema_version", `"\t3\n"`, `3`},
		{"schema_version", `"+2"`, `2`},
		// pydantic gives 0 for these; Object() writes the zero value as the default 1 (lead's ruling,
		// fix round 1: Go cannot tell a decoded 0 from an unset field). The server always writes 1.
		{"schema_version", `"-0"`, `1`},
		{"schema_version", `"2_0"`, `20`},
		{"schema_version", `false`, `1`},
		{"schema_version", `null`, errS},
		{"schema_version", `1e20`, errS},
		{"schema_version", `"1e2"`, errS},
		{"schema_version", `"2."`, errS},
		{"schema_version", `".0"`, errS},
		{"schema_version", `"0x10"`, errS},
		{"schema_version", `"1_"`, errS},
		{"schema_version", `"1__0"`, errS},
		{"schema_version", `"٣"`, errS},
		{"schema_version", `"2.5"`, errS},
		{"schema_version", `NaN`, errS},
		{"schema_version", `[]`, errS},
		{"hours_manual", `"1e2"`, `100.0`},
		{"hours_manual", `" 1.5 "`, `1.5`},
		{"hours_manual", `"+1.5"`, `1.5`},
		{"hours_manual", `".5"`, `0.5`},
		{"hours_manual", `"5."`, `5.0`},
		{"hours_manual", `"1_000"`, `1000.0`},
		{"hours_manual", `true`, `1.0`},
		{"hours_manual", `"nan"`, `null`},
		{"hours_manual", `"inf"`, `null`},
		{"hours_manual", `"Infinity"`, `null`},
		{"hours_manual", `"-inf"`, `null`},
		{"hours_manual", `"1e400"`, `null`},
		{"hours_manual", `""`, errS},
		{"hours_manual", `"0x10"`, errS},
		{"hours_manual", `"1.5e"`, errS},
		{"hours_manual", `"1__0"`, errS},
		{"hours_manual", `"_1"`, errS},
		{"hours_manual", `"١"`, errS},
		{"hours_manual", `[]`, errS},
		// Integers beyond int64 (pyjson.BigInt, Task 12 A1): a float field takes float(n); an int
		// beyond the float range, a datetime and a date refuse it, as pydantic does. pydantic
		// accepts one as schema_version; Go refuses it (spec §6 D4).
		{"hours_manual", `12345678901234567890`, `1.2345678901234567e19`},
		{"hours_manual", `1` + strings.Repeat("0", 400), errS},
		{"ts", `12345678901234567890`, errS},
		{"received_at", `12345678901234567890`, errS},
		{"schema_version", `12345678901234567890`, errS},
		{"status", `null`, errS},
		{"status", `"Open"`, errS},
		{"deliverables", `null`, errS},
		{"deliverables", `{"a": 1}`, errS},
		{"deliverables", `[null]`, errS},
		{"deliverables", `[]`, `[]`},
		{"thinking", `null`, errS},
		{"done_at", `null`, `null`},
		{"done_at", `""`, errS},
		{"kind", `null`, errS},
		{"kind", `"task"`, `"task"`},
		{"id", `""`, `""`},
		{"title", `true`, errS},
	}
	for _, c := range cases {
		row := decode(t, `{"id":"T1","machine":"m","requester":"r","title":"t","received_at":"2026-10-01","ts":"2026-10-01T09:00:00Z"}`).(*pyjson.Object)
		row.Set(c.key, decode(t, c.val))
		task, err := DecodeTask(row)
		if c.want == errS {
			if err == nil {
				b, _ := task.MarshalJSON()
				t.Errorf("%s=%s: accepted (%s), pydantic rejects it", c.key, c.val, b)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s=%s: %v, pydantic accepts it", c.key, c.val, err)
			continue
		}
		if got := field(t, task, c.key); !pyjson.Equal(got, decode(t, c.want)) {
			t.Errorf("%s=%s: dumped %s, want %s", c.key, c.val, pyjson.Compact(got), c.want)
		}
	}
}

// A record built with only its required fields serializes as pydantic's model with its defaults
// (schema_version 1, status open, summary_source fallback, link_method none, [] lists). Expected
// bytes are the venv's model_dump_json of the same minimal models (pydantic 2.13.5, 2026-10-13).
func TestZeroValueRecordsGetPydanticDefaults(t *testing.T) {
	ts := pytime.Naive(time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC))
	cases := []struct {
		rec  interface{ MarshalJSON() ([]byte, error) }
		want string
	}{
		{Task{ID: "T1", TS: ts, Machine: "m", Requester: "r", Title: "t", ReceivedAt: pytime.Date{Y: 2026, M: 10, D: 1}},
			`{"id":"T1","ts":"2026-10-01T09:00:00","machine":"m","schema_version":1,"kind":"task","requester":"r","project":"","title":"t","status":"open","received_at":"2026-10-01","done_at":null,"thinking":"","deliverables":[],"hours_manual":null}`},
		{NewTask("T1", ts, "m", "r", "t", pytime.Date{Y: 2026, M: 10, D: 1}),
			`{"id":"T1","ts":"2026-10-01T09:00:00","machine":"m","schema_version":1,"kind":"task","requester":"r","project":"","title":"t","status":"open","received_at":"2026-10-01","done_at":null,"thinking":"","deliverables":[],"hours_manual":null}`},
		{Session{ID: "S1", TS: ts, Machine: "m", Agent: "codex", SessionID: "x", Cwd: "/w",
			StartedAt: pytime.Naive(time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)), EndedAt: ts},
			`{"id":"S1","ts":"2026-10-01T09:00:00","machine":"m","schema_version":1,"kind":"session","agent":"codex","session_id":"x","cwd":"/w","started_at":"2026-10-01T08:00:00","ended_at":"2026-10-01T09:00:00","active_minutes":0,"turns":0,"summary":"","summary_source":"fallback","task_id":null,"link_method":"none","files_written":[],"tokens":null,"active_intervals":null,"artifacts":null}`},
		{NewSession("S1", ts, "m", "codex", "x", "/w", pytime.Naive(time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)), ts, 0, 0, ""),
			`{"id":"S1","ts":"2026-10-01T09:00:00","machine":"m","schema_version":1,"kind":"session","agent":"codex","session_id":"x","cwd":"/w","started_at":"2026-10-01T08:00:00","ended_at":"2026-10-01T09:00:00","active_minutes":0,"turns":0,"summary":"","summary_source":"fallback","task_id":null,"link_method":"none","files_written":[],"tokens":null,"active_intervals":null,"artifacts":null}`},
		{Note{ID: "N1", TS: ts, Machine: "m"},
			`{"id":"N1","ts":"2026-10-01T09:00:00","machine":"m","schema_version":1,"kind":"note","text":"","task_id":null,"minutes":null}`},
		{NewNote("N1", ts, "m", ""),
			`{"id":"N1","ts":"2026-10-01T09:00:00","machine":"m","schema_version":1,"kind":"note","text":"","task_id":null,"minutes":null}`},
	}
	for i, c := range cases {
		got, _ := c.rec.MarshalJSON()
		if !pyjson.Equal(decode(t, string(got)), decode(t, c.want)) || string(got) != c.want {
			t.Errorf("case %d\n got %s\nwant %s", i, got, c.want)
		}
	}
	// A set value is never replaced.
	s := NewSession("S1", ts, "m", "codex", "x", "/w", ts, ts, 1, 1, "s")
	s.SchemaVersion, s.SummarySource, s.LinkMethod = 2, "llm", "auto-dir"
	if v := field(t, s, "summary_source"); v != "llm" || field(t, s, "link_method") != "auto-dir" ||
		!pyjson.Equal(field(t, s, "schema_version"), pyjson.Int(2)) {
		t.Fatalf("set values replaced: %v", v)
	}
}
