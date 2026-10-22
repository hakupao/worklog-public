package link

import (
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

func date(t *testing.T, s string) pytime.Date {
	t.Helper()
	d, err := pytime.ParseDate(s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func instant(t *testing.T, s *string) *pytime.Instant {
	t.Helper()
	if s == nil {
		return nil
	}
	i, err := pytime.FromISO(*s)
	if err != nil {
		t.Fatal(err)
	}
	return &i
}

func show(id *string, method string) string {
	if id == nil {
		return "(nil, " + method + ")"
	}
	return "(" + *id + ", " + method + ")"
}

// Every golden case under both flavours: PurePosixPath is the Mac, PureWindowsPath Win11.
func TestDecideGolden(t *testing.T) {
	var g struct {
		Tasks    map[string][][5]*string
		Projects map[string][][2]string
		Cases    []struct {
			Name, Cwd       string
			Start, End      *string
			Tasks, Projects string
			Posix, Windows  [2]*string
		}
	}
	testkit.Golden(t, "link", &g)
	if len(g.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range g.Cases {
		var cands []Candidate
		for _, r := range g.Tasks[c.Tasks] {
			cand := Candidate{ID: *r[0], Project: *r[1], Status: *r[2], ReceivedAt: date(t, *r[3])}
			if r[4] != nil {
				d := date(t, *r[4])
				cand.DoneAt = &d
			}
			cands = append(cands, cand)
		}
		var projects []config.Project
		for _, p := range g.Projects[c.Projects] {
			projects = append(projects, config.Project{Dir: p[0], Name: p[1]})
		}
		for _, fl := range []struct {
			name string
			f    pypath.Flavour
			want [2]*string
		}{{"posix", pypath.Posix, c.Posix}, {"windows", pypath.Windows, c.Windows}} {
			id, method := Decide(c.Cwd, instant(t, c.Start), instant(t, c.End), cands, projects, fl.f)
			if got, want := show(id, method), show(fl.want[0], *fl.want[1]); got != want {
				t.Errorf("%s/%s: Decide = %s, want %s", c.Name, fl.name, got, want)
			}
		}
	}
}

// mk_raw / mk_task of test_link.py: a session from started to ended, naive local times.
func span(start, end time.Time) (*pytime.Instant, *pytime.Instant) {
	s, e := pytime.Naive(start), pytime.Naive(end)
	return &s, &e
}

func sep(day, hour int) time.Time { return time.Date(2026, 9, day, hour, 0, 0, 0, time.UTC) }

func task(id, project string, receivedDay int) Candidate {
	return Candidate{ID: id, Project: project, Status: "open", ReceivedAt: pytime.Date{Y: 2026, M: 9, D: receivedDay}}
}

func check(t *testing.T, id *string, method, wantID, wantMethod string) {
	t.Helper()
	var wantPtr *string // "" = None
	if wantID != "" {
		wantPtr = &wantID
	}
	if got, want := show(id, method), show(wantPtr, wantMethod); got != want {
		t.Errorf("Decide = %s, want %s", got, want)
	}
}

var projA = []config.Project{{Dir: "/work/proj-a", Name: "ProjA"}}

// test_dir_match_single_open_task_returns_auto_dir
func TestDirMatchSingleOpenTaskReturnsAutoDir(t *testing.T) {
	s, e := span(sep(18, 9), sep(18, 10))
	id, m := Decide("/work/proj-a/sub", s, e, []Candidate{task("T1", "ProjA", 10)}, projA, pypath.Posix)
	check(t, id, m, "T1", "auto-dir")
}

// test_dir_match_respects_received_date
func TestDirMatchRespectsReceivedDate(t *testing.T) {
	s, e := span(sep(18, 9), sep(18, 10))
	tasks := []Candidate{task("T1", "ProjA", 10), task("T2", "ProjA", 20)}
	id, m := Decide("/work/proj-a", s, e, tasks, projA, pypath.Posix)
	check(t, id, m, "T1", "auto-dir")
}

// test_known_dir_but_ambiguous_does_not_fall_back_to_time
func TestKnownDirButAmbiguousDoesNotFallBackToTime(t *testing.T) {
	s, e := span(sep(18, 9), sep(18, 10))
	tasks := []Candidate{task("T1", "ProjA", 10), task("T2", "ProjA", 11), task("T3", "Other", 12)}
	id, m := Decide("/work/proj-a", s, e, tasks, projA, pypath.Posix)
	check(t, id, m, "", "none")
}

// test_session_before_task_received_is_not_linked_by_dir
func TestSessionBeforeTaskReceivedIsNotLinkedByDir(t *testing.T) {
	s, e := span(sep(14, 9), sep(14, 10))
	id, m := Decide("/work/proj-a", s, e, []Candidate{task("T1", "ProjA", 16)}, projA, pypath.Posix)
	check(t, id, m, "", "none")
}

// test_time_match_when_no_dir_or_project_unknown
func TestTimeMatchWhenNoDirOrProjectUnknown(t *testing.T) {
	s, e := span(sep(18, 9), sep(18, 10))
	id, m := Decide("/other/place", s, e, []Candidate{task("T1", "", 10)}, nil, pypath.Posix)
	check(t, id, m, "T1", "auto-time")
}

// test_no_match_returns_none
func TestNoMatchReturnsNone(t *testing.T) {
	s, e := span(sep(18, 9), sep(18, 10))
	id, m := Decide("/other/place", s, e, []Candidate{task("T1", "", 20)}, nil, pypath.Posix)
	check(t, id, m, "", "none")
}
