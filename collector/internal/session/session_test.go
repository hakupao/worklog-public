package session

import (
	"reflect"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// goldenHome is HOME when the goldens were generated (gen_golden.py), so base._HOME's noise prefixes.
const goldenHome = "/home/wl"

func ts(t *testing.T, s string) pytime.Instant {
	t.Helper()
	i, err := pytime.FromISO(s)
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func isoPairs(ivs []model.Interval, spell func(pytime.Instant) string) [][2]string {
	out := [][2]string{}
	for _, iv := range ivs {
		out = append(out, [2]string{spell(iv[0]), spell(iv[1])})
	}
	return out
}

func iso(i pytime.Instant) string      { return i.ISOFormat() }
func pydantic(i pytime.Instant) string { return i.Pydantic() }

func TestIntervalsGolden(t *testing.T) {
	var g struct {
		GapMinutes int `json:"gap_minutes"`
		Cases      []struct {
			Name     string
			Messages []struct{ Role, TS string }
			Turns    int
			Started  *string     `json:"started_at"`
			Ended    *string     `json:"ended_at"`
			IVs      [][2]string `json:"active_intervals"`
			IVsJSON  [][2]string `json:"active_intervals_json"`
			Minutes  int         `json:"active_minutes"`
		}
	}
	testkit.Golden(t, "intervals", &g)
	if len(g.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range g.Cases {
		var ms []Message
		for _, m := range c.Messages {
			ms = append(ms, Message{Role: m.Role, Text: "x", TS: ts(t, m.TS)})
		}
		if got := Turns(ms); got != c.Turns {
			t.Errorf("%s: Turns = %d, want %d", c.Name, got, c.Turns)
		}
		for _, end := range []struct {
			name string
			fn   func([]Message) (pytime.Instant, bool)
			want *string
		}{{"StartedAt", StartedAt, c.Started}, {"EndedAt", EndedAt, c.Ended}} {
			got, ok := end.fn(ms)
			if ok != (end.want != nil) || ok && got.ISOFormat() != *end.want {
				t.Errorf("%s: %s = %s, %v; want %v", c.Name, end.name, got.ISOFormat(), ok, end.want)
			}
		}
		ivs := ActiveIntervals(ms, g.GapMinutes)
		if got := isoPairs(ivs, iso); !reflect.DeepEqual(got, c.IVs) {
			t.Errorf("%s: ActiveIntervals = %v, want %v", c.Name, got, c.IVs)
		}
		if got := isoPairs(ivs, pydantic); !reflect.DeepEqual(got, c.IVsJSON) {
			t.Errorf("%s: ActiveIntervals (pydantic) = %v, want %v", c.Name, got, c.IVsJSON)
		}
		if got := ActiveMinutes(ms, g.GapMinutes); got != c.Minutes {
			t.Errorf("%s: ActiveMinutes = %d, want %d", c.Name, got, c.Minutes)
		}
	}
}

// _msgs of test_parsers.py: user messages at UTC (day, hh, mm) in September 2026.
func msgs(hhmm ...[3]int) []Message {
	var out []Message
	for _, p := range hhmm {
		out = append(out, Message{Role: "user", Text: "x",
			TS: pytime.Instant{T: time.Date(2026, 9, p[0], p[1], p[2], 0, 0, time.UTC), Aware: true}})
	}
	return out
}

func at(day, hh, mm int) pytime.Instant {
	return pytime.Instant{T: time.Date(2026, 9, day, hh, mm, 0, 0, time.UTC), Aware: true}
}

func sameIntervals(a, b []model.Interval) bool {
	return reflect.DeepEqual(isoPairs(a, iso), isoPairs(b, iso))
}

// test_active_intervals_splits_on_gaps_over_thirty_minutes
func TestActiveIntervalsSplitsOnGapsOverThirtyMinutes(t *testing.T) {
	ms := msgs([3]int{29, 23, 30}, [3]int{29, 23, 50}, [3]int{30, 0, 21}, [3]int{30, 0, 30})
	want := []model.Interval{{at(29, 23, 30), at(29, 23, 50)}, {at(30, 0, 21), at(30, 0, 30)}}
	if got := ActiveIntervals(ms, 30); !sameIntervals(got, want) {
		t.Errorf("ActiveIntervals = %v", isoPairs(got, iso))
	}
	if got := ActiveMinutes(ms, 30); got != 29 {
		t.Errorf("ActiveMinutes = %d", got)
	}
}

// test_active_intervals_keeps_a_cluster_that_crosses_midnight_whole
func TestActiveIntervalsKeepsAClusterThatCrossesMidnightWhole(t *testing.T) {
	ms := msgs([3]int{29, 23, 30}, [3]int{29, 23, 55}, [3]int{30, 0, 20}, [3]int{30, 0, 30})
	if got := ActiveIntervals(ms, 30); len(got) != 1 {
		t.Errorf("ActiveIntervals = %v", isoPairs(got, iso))
	}
	if got := ActiveMinutes(ms, 30); got != 60 {
		t.Errorf("ActiveMinutes = %d", got)
	}
}

// test_active_intervals_single_message_and_empty
func TestActiveIntervalsSingleMessageAndEmpty(t *testing.T) {
	ms := msgs([3]int{29, 23, 30})
	if got := ActiveIntervals(ms, 30); !sameIntervals(got, []model.Interval{{ms[0].TS, ms[0].TS}}) {
		t.Errorf("single: %v", isoPairs(got, iso))
	}
	if got := ActiveIntervals(nil, 30); got == nil || len(got) != 0 {
		t.Errorf("empty: %#v, want an empty non-nil list", got)
	}
	if got := ActiveMinutes(ms, 30); got != 0 {
		t.Errorf("ActiveMinutes = %d", got)
	}
}

// test_active_intervals_orders_unsorted_messages
func TestActiveIntervalsOrdersUnsortedMessages(t *testing.T) {
	ab := msgs([3]int{29, 23, 30}, [3]int{29, 23, 40})
	got := ActiveIntervals([]Message{ab[1], ab[0]}, 30)
	if !sameIntervals(got, []model.Interval{{ab[0].TS, ab[1].TS}}) {
		t.Errorf("ActiveIntervals = %v", isoPairs(got, iso))
	}
}

// Spec §6 D3: naive and aware timestamps mixed in one session (Python: TypeError) — the naive ones
// are taken as UTC, and each keeps its own spelling.
func TestMixedNaiveAndAwareAreComparedAsUTC(t *testing.T) {
	ms := []Message{
		{Role: "user", TS: ts(t, "2026-09-18T18:10:00+09:00")},
		{Role: "assistant", TS: ts(t, "2026-09-18T09:00:00")},
		{Role: "user", TS: ts(t, "2026-09-18T09:20:00Z")},
	}
	if s, _ := StartedAt(ms); s.ISOFormat() != "2026-09-18T09:00:00" {
		t.Errorf("StartedAt = %s", s.ISOFormat())
	}
	if e, _ := EndedAt(ms); e.ISOFormat() != "2026-09-18T09:20:00+00:00" {
		t.Errorf("EndedAt = %s", e.ISOFormat())
	}
	want := [][2]string{{"2026-09-18T09:00:00", "2026-09-18T09:20:00+00:00"}}
	if got := isoPairs(ActiveIntervals(ms, 30), iso); !reflect.DeepEqual(got, want) {
		t.Errorf("ActiveIntervals = %v", got)
	}
	if got := ActiveMinutes(ms, 30); got != 20 {
		t.Errorf("ActiveMinutes = %d", got)
	}
}

type cleanCase struct {
	Paths []string
	Cwd   string
	Out   []string
}

func TestCleanPathsGolden(t *testing.T) {
	var g struct {
		Home       string
		CleanPaths []cleanCase `json:"clean_paths"`
		IsNoise    []struct {
			In  string
			Out bool
		} `json:"is_noise"`
	}
	testkit.Golden(t, "pypath", &g)
	if g.Home != goldenHome || len(g.CleanPaths) == 0 || len(g.IsNoise) == 0 {
		t.Fatalf("golden home %q, %d clean_paths, %d is_noise", g.Home, len(g.CleanPaths), len(g.IsNoise))
	}
	for _, c := range g.CleanPaths {
		if got := CleanPaths(c.Paths, c.Cwd, g.Home); !reflect.DeepEqual(got, c.Out) {
			t.Errorf("CleanPaths(%q, %q) = %q, want %q", c.Paths, c.Cwd, got, c.Out)
		}
	}
	for _, c := range g.IsNoise {
		if got := isNoise(c.In, noiseKey(g.Home)); got != c.Out {
			t.Errorf("isNoise(%q) = %v, want %v", c.In, got, c.Out)
		}
	}
}

// test_noise_is_matched_after_normalising
func TestNoiseIsMatchedAfterNormalising(t *testing.T) {
	got := CleanPaths([]string{
		goldenHome + "/.worklog/credentials.toml",
		`C:\Users\Me\AppData\Local\Temp\x.txt`,
		"c:/users/me/appdata/local/temp/y.txt",
		"/work/keep.md",
	}, "/work", goldenHome)
	if !reflect.DeepEqual(got, []string{"/work/keep.md"}) {
		t.Errorf("CleanPaths = %q", got)
	}
}

// test_clean_paths_normalises_absolute_paths_and_drops_worktree_copies
func TestCleanPathsNormalisesAbsolutePathsAndDropsWorktreeCopies(t *testing.T) {
	got := CleanPaths([]string{
		"/work/proj/backend/../evidence/x.md",
		"/work/proj/evidence/x.md",
		"/work/proj/.claude/worktrees/agent-1/docs/a.md",
		`C:\Work\Proj\.claude\worktrees\w\b.md`,
		`C:\Work\Proj\src\..\docs\c.md`,
	}, "/work/proj", goldenHome)
	if want := []string{"/work/proj/evidence/x.md", `C:\Work\Proj\docs\c.md`}; !reflect.DeepEqual(got, want) {
		t.Errorf("CleanPaths = %q", got)
	}
}

// The home is this machine's (Win11: C:\Users\Me), noise-keyed: forward slashes, case-folded.
func TestCleanPathsWindowsHome(t *testing.T) {
	got := CleanPaths([]string{
		`C:\Users\ME\.claude\projects\x.jsonl`,
		"c:/users/me/.WORKLOG/outbox/a.json",
		`C:\Users\Me\.codexx\keep.md`,
		"/c:/users/me/.claude/keep.md",
	}, `C:\Users\Me`, `C:\Users\Me`)
	if want := []string{`C:\Users\Me\.codexx\keep.md`, "/c:/users/me/.claude/keep.md"}; !reflect.DeepEqual(got, want) {
		t.Errorf("CleanPaths = %q", got)
	}
}

func TestToIntGolden(t *testing.T) {
	var g struct {
		ToInt []struct {
			Input string
			Value *int64
			Error string
		} `json:"to_int"`
	}
	testkit.Golden(t, "tokens", &g)
	if len(g.ToInt) == 0 {
		t.Fatal("no to_int cases")
	}
	for _, c := range g.ToInt {
		v, err := pyjson.Decode([]byte(c.Input))
		if err != nil {
			t.Fatalf("%s: %v", c.Input, err)
		}
		got, ok := ToInt(v)
		if c.Error != "" {
			if ok {
				t.Errorf("ToInt(%s) = %d, want an error (%s)", c.Input, got, c.Error)
			}
			continue
		}
		if !ok || got != *c.Value {
			t.Errorf("ToInt(%s) = %d, %v; want %d", c.Input, got, ok, *c.Value)
		}
	}
}

// An int beyond int64 is D4 in Go (Python's int() takes it): not an integer.
func TestToIntBigInt(t *testing.T) {
	for _, v := range []pyjson.Value{pyjson.BigInt("9223372036854775808"), pyjson.BigInt("-12345678901234567890")} {
		if got, ok := ToInt(v); ok {
			t.Errorf("ToInt(%v) = %d, want not an integer", v, got)
		}
	}
}

// int() string forms beyond the golden: underscores only between digits, sign directly before the
// digits, Unicode whitespace around, no fraction or base prefix.
func TestToIntStrings(t *testing.T) {
	for in, want := range map[string]int64{
		"007": 7, "1_2_3": 123, "\u3000-4\u2028": -4, "-0": 0, "𝟗": 9, "٠١": 1, "\u00855": 5, "\u00a05": 5, "\v5\f": 5, "0_0": 0,
	} {
		if got, ok := ToInt(in); !ok || got != want {
			t.Errorf("ToInt(%q) = %d, %v; want %d", in, got, ok, want)
		}
	}
	for _, in := range []string{"_1", "1_", "1__0", "+", "-", "- 3", "+-3", "1 2", "1.", "1e3", "１.５", "a1", "²", "\x1c5", "5\x1f", "5\x00", "-_1"} {
		if got, ok := ToInt(in); ok {
			t.Errorf("ToInt(%q) = %d, want an error", in, got)
		}
	}
}
