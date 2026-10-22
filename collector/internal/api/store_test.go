package api

import (
	"errors"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
)

// Ports of tests/test_api_store.py. Python's FakeClient stands in for ApiClient; here the real
// Client talks to an httptest.Server.

// test_append_session_ingests_under_the_store_machine
func TestAppendSessionIngestsUnderTheStoreMachine(t *testing.T) {
	f := newFixture(t, reply(200, `{"inserted": 0, "updated": 1}`))
	st := NewStore(f.c, "mac")
	s := makeSession()
	s.Machine = "win11" // the session's own machine field is ignored: the store sends its own name
	res, out := st.Append(s)
	if out != OK || *res != (IngestResult{Inserted: 0, Updated: 1}) {
		t.Fatalf("Append = %v %q", res, out)
	}
	reqs := f.rec.all()
	if len(reqs) != 1 || reqs[0].Path != "/api/ingest/sessions" {
		t.Fatalf("requests %v", reqs)
	}
	body := dec(t, reqs[0].Body).(*pyjson.Object)
	sessions := get(body, "sessions").([]pyjson.Value)
	if get(body, "machine") != "mac" || len(sessions) != 1 || get(sessions[0].(*pyjson.Object), "id") != "Sabcd1234" {
		t.Fatalf("body %s", reqs[0].Body)
	}
}

// test_append_hands_the_ingest_outcome_back_untouched
func TestAppendHandsTheIngestOutcomeBackUntouched(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	if res, out := NewStore(f.c, "mac").Append(makeSession()); out != Retry || res != nil {
		t.Fatalf("Append = %v %q", res, out)
	}
	f = newFixture(t, reply(400, `{}`))
	if res, out := NewStore(f.c, "mac").Append(makeSession()); out != Rejected || res != nil {
		t.Fatalf("Append = %v %q", res, out)
	}
	f = newFixture(t, reply(503, ""))
	outboxIsAFile(t, f)
	if res, out := NewStore(f.c, "mac").Append(makeSession()); out != Lost || res != nil {
		t.Fatalf("Append = %v %q", res, out)
	}
}

// test_tasks_returns_the_server_rows
func TestTasksReturnsTheServerRows(t *testing.T) {
	f := newFixture(t, reply(200, `[{"id": "T20260918-01", "requester": "r", "title": "t", "received_at": "2026-09-18",
		"ts": "2026-09-18T00:00:00", "machine": "mac"}]`))
	tasks, err := NewStore(f.c, "mac").Tasks()
	if err != nil || len(tasks) != 1 || tasks[0].ID != "T20260918-01" || tasks[0].Title != "t" {
		t.Fatalf("Tasks = %+v %v", tasks, err)
	}
}

// test_tasks_raises_when_the_api_is_unreachable
func TestTasksRaisesWhenTheAPIIsUnreachable(t *testing.T) {
	f := newFixture(t, boom)
	if _, err := NewStore(f.c, "mac").Tasks(); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Tasks err = %v", err)
	}
	if ErrUnavailable.Error() != "could not read the server's tasks" {
		t.Fatal(ErrUnavailable)
	}
}

// test_unassigned_this_week_reads_the_current_tokyo_week_timeline. Sunday 20:00 UTC is Monday
// 05:00 in Tokyo, a week later than the UTC calendar says.
func TestUnassignedThisWeekReadsTheCurrentTokyoWeekTimeline(t *testing.T) {
	f := newFixture(t, reply(200, `{"unassigned": 3, "hidden": 0}`))
	now := time.Date(2026, 10, 11, 20, 0, 0, 0, time.UTC)
	n, ok := NewStore(f.c, "mac").UnassignedThisWeek(now)
	if !ok || n != 3 {
		t.Fatalf("UnassignedThisWeek = %d %v", n, ok)
	}
	if p := f.rec.all()[0].Path; p != "/api/weeks/2026-W42/timeline" {
		t.Fatal(p)
	}
}

func TestThisWeek(t *testing.T) {
	for _, c := range []struct {
		now  time.Time
		want string
	}{
		{time.Date(2026, 10, 11, 14, 59, 59, 0, time.UTC), "2026-W41"},
		{time.Date(2026, 10, 11, 15, 0, 0, 0, time.UTC), "2026-W42"},
		{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "2026-W01"},
		{time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC), "2026-W53"},
		{time.Date(2026, 10, 13, 12, 0, 0, 0, time.FixedZone("", 9*3600)), "2026-W42"},
	} {
		if got := ThisWeek(c.now); got != c.want {
			t.Errorf("ThisWeek(%v) = %s, want %s", c.now, got, c.want)
		}
	}
}

// test_unassigned_this_week_is_none_when_the_call_gives_no_number
func TestUnassignedThisWeekIsNoneWhenTheCallGivesNoNumber(t *testing.T) {
	for _, body := range []string{"", `{}`, `{"unassigned": "many"}`, `{"unassigned": 3.0}`, `{"unassigned": null}`, `[3]`} {
		status := 200
		if body == "" {
			status = 503
		}
		f := newFixture(t, reply(status, body))
		if n, ok := NewStore(f.c, "mac").UnassignedThisWeek(time.Now()); ok {
			t.Errorf("%q: UnassignedThisWeek = %d", body, n)
		}
	}
}
