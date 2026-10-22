package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// Ports of tests/test_api_client.py at 4f16c89 against an httptest.Server. Each test names the
// Python test it carries.

// test_put_task_sends_auth_and_json
func TestPutTaskSendsAuthAndJSON(t *testing.T) {
	f := newFixture(t, reply(200, `{"id": "x"}`))
	if got := f.c.PutTask(makeTask(), true); got != OK {
		t.Fatalf("PutTask = %q", got)
	}
	req := f.rec.all()[0]
	if req.Method != "PUT" || req.Path != "/api/tasks/T20260918-01" {
		t.Fatalf("%s %s", req.Method, req.Path)
	}
	if req.Header.Get("Authorization") != "Bearer tok" {
		t.Fatalf("auth %q", req.Header.Get("Authorization"))
	}
	if req.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("content-type %q", req.Header.Get("Content-Type"))
	}
	body := dec(t, req.Body).(*pyjson.Object)
	if get(body, "title") != "帳票修正" || get(body, "received_at") != "2026-09-18" {
		t.Fatalf("body %s", req.Body)
	}
	// The whole body is the record's model_dump_json, in pydantic's order.
	if !pyjson.Equal(body, makeTask().Object()) {
		t.Fatalf("body %s", req.Body)
	}
	noOutboxFiles(t, f)
}

// test_ingest_wraps_sessions_and_returns_the_server_counts
func TestIngestWrapsSessionsAndReturnsTheServerCounts(t *testing.T) {
	f := newFixture(t, reply(200, `{"inserted": 1, "updated": 2}`))
	res, out := f.c.Ingest("mac", makeSession(), true)
	if out != OK || res == nil || *res != (IngestResult{Inserted: 1, Updated: 2}) {
		t.Fatalf("Ingest = %v %q", res, out)
	}
	req := f.rec.all()[0]
	body := dec(t, req.Body).(*pyjson.Object)
	if req.Path != "/api/ingest/sessions" || get(body, "machine") != "mac" {
		t.Fatalf("%s %s", req.Path, req.Body)
	}
	sessions := get(body, "sessions").([]pyjson.Value)
	if len(sessions) != 1 || get(sessions[0].(*pyjson.Object), "id") != "Sabcd1234" {
		t.Fatalf("sessions %s", req.Body)
	}
	if strings.Join(body.Keys(), ",") != "machine,sessions" {
		t.Fatalf("keys %v", body.Keys())
	}
}

// test_ingest_reports_zero_counts_when_the_body_is_unreadable
func TestIngestReportsZeroCountsWhenTheBodyIsUnreadable(t *testing.T) {
	for _, body := range []string{`{"inserted": "one", "updated": 0}`, `{}`, `[1, 2]`,
		`{"inserted": null, "updated": 2}`, `not json`} {
		f := newFixture(t, reply(200, body))
		res, out := f.c.Ingest("mac", makeSession(), true)
		if out != OK || res == nil || *res != (IngestResult{}) {
			t.Errorf("%s: Ingest = %v %q", body, res, out)
		}
		noOutboxFiles(t, f)
	}
	// int() semantics: a numeric string passes, a float is truncated.
	f := newFixture(t, reply(200, `{"inserted": "3", "updated": 2.7}`))
	if res, out := f.c.Ingest("mac", makeSession(), true); out != OK || *res != (IngestResult{3, 2}) {
		t.Fatalf("Ingest = %v %q", res, out)
	}
}

// test_a_2xx_that_is_not_json_parks_instead_of_counting_as_written
func TestA2xxThatIsNotJSONParksInsteadOfCountingAsWritten(t *testing.T) {
	for _, h := range []func(http.ResponseWriter, *http.Request){
		replyType(200, "text/plain; charset=utf-8", "<html>access login</html>"),
		replyType(200, "text/html", "<html>"),
		replyType(200, "", ""),
	} {
		f := newFixture(t, h)
		if got := f.c.PutTask(makeTask(), true); got != Retry {
			t.Fatalf("PutTask = %q", got)
		}
		if n := len(jsonFiles(t, f.outbox())); n != 1 {
			t.Fatalf("outbox files = %d", n)
		}
		if n := len(jsonFiles(t, filepath.Join(f.outbox(), "rejected"))); n != 0 {
			t.Fatalf("rejected files = %d", n)
		}
	}
}

// test_ingest_parks_when_access_answers_2xx_with_its_login_page
func TestIngestParksWhenAccessAnswers2xxWithItsLoginPage(t *testing.T) {
	f := newFixture(t, replyType(200, "text/html", "<html>access login</html>"))
	if res, out := f.c.Ingest("mac", makeSession(), true); out != Retry || res != nil {
		t.Fatalf("Ingest = %v %q", res, out)
	}
	if n := len(jsonFiles(t, f.outbox())); n != 1 {
		t.Fatalf("outbox files = %d", n)
	}
}

// test_flush_keeps_a_record_whose_reply_is_an_html_login_page
func TestFlushKeepsARecordWhoseReplyIsAnHTMLLoginPage(t *testing.T) {
	f := newFixture(t, replyType(200, "text/html", "<html>access login</html>"))
	os.MkdirAll(f.outbox(), 0o755)
	os.WriteFile(filepath.Join(f.outbox(), "1.json"), []byte(`{"method": "PUT", "path": "/api/tasks/T1", "body": {}}`), 0o644)
	if sent, rem := f.c.Flush(); sent != 0 || rem != 1 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	if n := len(jsonFiles(t, f.outbox())); n != 1 {
		t.Fatalf("outbox files = %d", n)
	}
}

// test_ingest_reports_retry_and_parks_when_the_server_is_down
func TestIngestReportsRetryAndParksWhenTheServerIsDown(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	if _, out := f.c.Ingest("mac", makeSession(), true); out != Retry {
		t.Fatalf("Ingest = %q", out)
	}
	files := jsonFiles(t, f.outbox())
	if len(files) != 1 {
		t.Fatalf("outbox files = %d", len(files))
	}
	parked := readJSON(t, files[0])
	want := pyjson.NewObject()
	want.Set("method", "POST")
	want.Set("path", "/api/ingest/sessions")
	body := pyjson.NewObject()
	body.Set("machine", "mac")
	body.Set("sessions", []pyjson.Value{makeSession().Object()})
	want.Set("body", body)
	if !pyjson.Equal(parked, want) {
		t.Fatalf("parked %s", pyjson.Compact(parked))
	}
}

const detailRow = `{"id": "T20260922-01", "requester": "r", "project": "", "title": "web made", "status": "open",
	"received_at": "2026-09-22", "done_at": null, "thinking": "", "deliverables": ["a.xlsx"],
	"hours_manual": null, "machine": "web", "ts": "2026-09-22T10:00:00"}`

// test_get_task_unwraps_the_detail_payload (the 4 s timeout it also asserts is
// TestInteractiveCallsUseTheShortTimeout's).
func TestGetTaskUnwrapsTheDetailPayload(t *testing.T) {
	f := newFixture(t, reply(200, `{"task": `+detailRow+`, "sessions": [], "notes": [], "total_minutes": 0}`))
	task, ok := f.c.GetTask("T20260922-01")
	req := f.rec.all()[0]
	if req.Method != "GET" || req.Path != "/api/tasks/T20260922-01" {
		t.Fatalf("%s %s", req.Method, req.Path)
	}
	if !ok || task.Title != "web made" || strings.Join(task.Deliverables, ",") != "a.xlsx" {
		t.Fatalf("GetTask = %+v %v", task, ok)
	}
}

// test_get_task_returns_none_on_any_failure
func TestGetTaskReturnsNoneOnAnyFailure(t *testing.T) {
	for _, h := range []func(http.ResponseWriter, *http.Request){
		reply(404, `{"error": "not found"}`),
		reply(503, ""),
		replyType(200, "text/html", "<html>access login</html>"),
		reply(200, `{"task": {"id": "broken"}}`),
		reply(200, `{"sessions": []}`),
		reply(200, `[{"id": "x"}]`),
	} {
		f := newFixture(t, h)
		if _, ok := f.c.GetTask("T20260922-01"); ok {
			t.Fatal("GetTask ok")
		}
	}
}

// test_get_task_returns_none_on_network_error
func TestGetTaskReturnsNoneOnNetworkError(t *testing.T) {
	f := newFixture(t, boom)
	if _, ok := f.c.GetTask("T1"); ok {
		t.Fatal("GetTask ok")
	}
}

// test_week_timeline_returns_the_parsed_body
func TestWeekTimelineReturnsTheParsedBody(t *testing.T) {
	f := newFixture(t, reply(200, `{"week": "2026-W39", "unassigned": 3}`))
	got, ok := f.c.WeekTimeline("2026-W39")
	if !ok || !pyjson.Equal(got, obj(t, `{"week": "2026-W39", "unassigned": 3}`)) {
		t.Fatalf("WeekTimeline = %v %v", got, ok)
	}
	if p := f.rec.all()[0].Path; p != "/api/weeks/2026-W39/timeline" {
		t.Fatal(p)
	}
}

// test_week_timeline_returns_none_on_any_failure
func TestWeekTimelineReturnsNoneOnAnyFailure(t *testing.T) {
	for _, h := range []func(http.ResponseWriter, *http.Request){
		reply(400, `{"error": "invalid week"}`), reply(503, ""), reply(200, `[1, 2]`),
	} {
		f := newFixture(t, h)
		if got, ok := f.c.WeekTimeline("2026-W39"); ok || got != nil {
			t.Fatalf("WeekTimeline = %v %v", got, ok)
		}
	}
}

// test_put_note_path
func TestPutNotePath(t *testing.T) {
	f := newFixture(t, reply(200, `{}`))
	n := model.Note{ID: "N20260918-101500", Text: "memo", TS: naive(2026, 9, 18, 10, 15), Machine: "mac", SchemaVersion: 1}
	if got := f.c.PutNote(n, true); got != OK {
		t.Fatalf("PutNote = %q", got)
	}
	req := f.rec.all()[0]
	if req.Path != "/api/notes/N20260918-101500" || !pyjson.Equal(dec(t, req.Body), n.Object()) {
		t.Fatalf("%s %s", req.Path, req.Body)
	}
}

// test_network_error_parks_in_outbox
func TestNetworkErrorParksInOutbox(t *testing.T) {
	f := newFixture(t, boom)
	if got := f.c.PutTask(makeTask(), true); got != Retry {
		t.Fatalf("PutTask = %q", got)
	}
	files := jsonFiles(t, f.outbox())
	if len(files) != 1 {
		t.Fatalf("outbox files = %d", len(files))
	}
	parked := readJSON(t, files[0])
	if get(parked, "method") != "PUT" || get(parked, "path") != "/api/tasks/T20260918-01" {
		t.Fatalf("parked %s", pyjson.Compact(parked))
	}
	if strings.Join(parked.Keys(), ",") != "method,path,body" || !pyjson.Equal(get(parked, "body"), makeTask().Object()) {
		t.Fatalf("parked %s", pyjson.Compact(parked))
	}
}

// test_retryable_statuses_park
func TestRetryableStatusesPark(t *testing.T) {
	for _, status := range []int{500, 503, 401, 403, 429, 408} {
		f := newFixture(t, reply(status, `{}`))
		if got := f.c.PutTask(makeTask(), true); got != Retry {
			t.Fatalf("%d: PutTask = %q", status, got)
		}
		if n := len(jsonFiles(t, f.outbox())); n != 1 {
			t.Fatalf("%d: outbox files = %d", status, n)
		}
	}
}

// test_400_goes_to_rejected
func Test400GoesToRejected(t *testing.T) {
	f := newFixture(t, reply(400, `{"error": "invalid"}`))
	if got := f.c.PutTask(makeTask(), true); got != Rejected {
		t.Fatalf("PutTask = %q", got)
	}
	noOutboxFiles(t, f)
	if n := len(jsonFiles(t, filepath.Join(f.outbox(), "rejected"))); n != 1 {
		t.Fatalf("rejected files = %d", n)
	}
}

// test_park_false_leaves_no_files
func TestParkFalseLeavesNoFiles(t *testing.T) {
	f := newFixture(t, reply(500, ``))
	if got := f.c.PutTask(makeTask(), false); got != Retry {
		t.Fatalf("PutTask = %q", got)
	}
	if _, err := os.Stat(f.outbox()); !os.IsNotExist(err) {
		t.Fatalf("outbox exists: %v", err)
	}
}

// switchable answers 503 until up is set, then hands the request to ok.
type switchable struct {
	up   bool
	seen []string
	ok   func(w http.ResponseWriter, r *http.Request)
}

func (s *switchable) handle(w http.ResponseWriter, r *http.Request) {
	if !s.up {
		reply(503, "")(w, r)
		return
	}
	s.seen = append(s.seen, r.URL.Path)
	if s.ok != nil {
		s.ok(w, r)
		return
	}
	reply(200, `{}`)(w, r)
}

func send(t *testing.T, c *Client, path string, body string) Outcome {
	t.Helper()
	return c.send("PUT", path, dec(t, []byte(body)), true)
}

// test_flush_replays_in_order_and_clears
func TestFlushReplaysInOrderAndClears(t *testing.T) {
	s := &switchable{}
	f := newFixture(t, s.handle)
	send(t, f.c, "/api/tasks/A", `{"n": 1}`)
	send(t, f.c, "/api/tasks/B", `{"n": 2}`)
	s.up = true
	if sent, rem := f.c.Flush(); sent != 2 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	if strings.Join(s.seen, ",") != "/api/tasks/A,/api/tasks/B" {
		t.Fatalf("seen %v", s.seen)
	}
	noOutboxFiles(t, f)
}

// frozenNS is a clock too coarse to separate two writes (Windows ticks about every 15 ms).
const frozenNS = 1_790_000_000_000_000_000

func freeze(c *Client) {
	c.env.Now = func() time.Time { return time.Unix(0, frozenNS) }
}

// test_two_writes_in_one_clock_tick_get_their_own_outbox_files
func TestTwoWritesInOneClockTickGetTheirOwnOutboxFiles(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	freeze(f.c)
	send(t, f.c, "/api/tasks/A", `{"n": 1}`)
	send(t, f.c, "/api/tasks/B", `{"n": 2}`)
	files := jsonFiles(t, f.outbox())
	if len(files) != 2 {
		t.Fatalf("outbox files = %d", len(files))
	}
	if get(readJSON(t, files[0]), "path") != "/api/tasks/A" || get(readJSON(t, files[1]), "path") != "/api/tasks/B" {
		t.Fatalf("order %v", files)
	}
	// {stamp:019d}-{6 hex}.json, the stamp forced upwards past the frozen clock.
	if b := filepath.Base(files[0]); !strings.HasPrefix(b, "1790000000000000000-") {
		t.Fatalf("name %s", b)
	}
	if b := filepath.Base(files[1]); !strings.HasPrefix(b, "1790000000000000001-") {
		t.Fatalf("name %s", b)
	}
}

// test_flush_replays_in_write_order_under_a_frozen_clock
func TestFlushReplaysInWriteOrderUnderAFrozenClock(t *testing.T) {
	s := &switchable{}
	f := newFixture(t, s.handle)
	freeze(f.c)
	for _, name := range []string{"A", "B", "C"} {
		send(t, f.c, "/api/tasks/"+name, `{}`)
	}
	s.up = true
	if sent, rem := f.c.Flush(); sent != 3 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	if strings.Join(s.seen, ",") != "/api/tasks/A,/api/tasks/B,/api/tasks/C" {
		t.Fatalf("seen %v", s.seen)
	}
}

// test_flush_stops_at_first_retryable_failure
func TestFlushStopsAtFirstRetryableFailure(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	send(t, f.c, "/api/tasks/A", `{}`)
	send(t, f.c, "/api/tasks/B", `{}`)
	if sent, rem := f.c.Flush(); sent != 0 || rem != 2 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
}

// test_flush_moves_rejected_aside_and_continues
func TestFlushMovesRejectedAsideAndContinues(t *testing.T) {
	s := &switchable{ok: func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/A") {
			reply(400, `{}`)(w, r)
			return
		}
		reply(200, `{}`)(w, r)
	}}
	f := newFixture(t, s.handle)
	send(t, f.c, "/api/tasks/A", `{}`)
	send(t, f.c, "/api/tasks/B", `{}`)
	s.up = true
	if sent, rem := f.c.Flush(); sent != 1 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	if n := len(jsonFiles(t, filepath.Join(f.outbox(), "rejected"))); n != 1 {
		t.Fatalf("rejected files = %d", n)
	}
}

// test_flush_on_missing_outbox
func TestFlushOnMissingOutbox(t *testing.T) {
	f := newFixture(t, reply(200, ""))
	if sent, rem := f.c.Flush(); sent != 0 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
}

// outboxIsAFile stands in for a full or read-only disk: a regular file where the outbox should be.
func outboxIsAFile(t *testing.T, f *fixture) {
	t.Helper()
	if err := os.WriteFile(f.outbox(), []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// test_a_write_that_cannot_even_be_parked_reports_lost_not_retry
func TestAWriteThatCannotEvenBeParkedReportsLostNotRetry(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	outboxIsAFile(t, f)
	if got := f.c.PutTask(makeTask(), true); got != Lost {
		t.Fatalf("PutTask = %q", got)
	}
	line := f.stderr.String()
	if !strings.HasPrefix(line, "worklog: could not write outbox (") || !strings.HasSuffix(line, "); record not queued\n") {
		t.Fatalf("stderr %q", line)
	}
	if strings.Count(line, "\n") != 1 {
		t.Fatalf("stderr %q", line)
	}
}

// test_a_rejected_write_that_cannot_be_parked_is_also_lost
func TestARejectedWriteThatCannotBeParkedIsAlsoLost(t *testing.T) {
	f := newFixture(t, reply(400, `{"error": "invalid"}`))
	outboxIsAFile(t, f)
	if got := f.c.PutTask(makeTask(), true); got != Lost {
		t.Fatalf("PutTask = %q", got)
	}
}

// test_ingest_reports_lost_when_parking_fails
func TestIngestReportsLostWhenParkingFails(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	outboxIsAFile(t, f)
	if res, out := f.c.Ingest("mac", makeSession(), true); out != Lost || res != nil {
		t.Fatalf("Ingest = %v %q", res, out)
	}
}

// test_flush_sets_aside_corrupt_file_and_continues
func TestFlushSetsAsideCorruptFileAndContinues(t *testing.T) {
	code := 503
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) { reply(code, `{}`)(w, r) })
	os.MkdirAll(f.outbox(), 0o755)
	os.WriteFile(filepath.Join(f.outbox(), "0000000000000000001.json"), []byte("not json"), 0o644)
	send(t, f.c, "/api/tasks/B", `{}`)
	code = 200
	if sent, rem := f.c.Flush(); sent != 1 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	noOutboxFiles(t, f)
	if n := len(jsonFiles(t, filepath.Join(f.outbox(), "rejected"))); n != 1 {
		t.Fatalf("rejected files = %d", n)
	}
}

// test_flush_warns_when_sent_file_cannot_be_removed
func TestFlushWarnsWhenSentFileCannotBeRemoved(t *testing.T) {
	code := 503
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) { reply(code, `{}`)(w, r) })
	send(t, f.c, "/api/tasks/A", `{}`)
	code = 200
	f.c.remove = func(string) error { return errors.New("denied") }
	name := filepath.Base(jsonFiles(t, f.outbox())[0])
	if sent, rem := f.c.Flush(); sent != 1 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	want := "worklog: sent " + name + " but could not remove it from the outbox (denied); it will be re-sent\n"
	if f.stderr.String() != want {
		t.Fatalf("stderr %q", f.stderr.String())
	}
}

func TestFlushWarnsWhenARejectedOrCorruptFileCannotBeMoved(t *testing.T) {
	f := newFixture(t, reply(400, `{}`))
	os.MkdirAll(f.outbox(), 0o755)
	os.WriteFile(filepath.Join(f.outbox(), "1.json"), []byte("not json"), 0o644)
	os.WriteFile(filepath.Join(f.outbox(), "2.json"), []byte(`{"method": "PUT", "path": "/api/tasks/A", "body": {}}`), 0o644)
	f.c.rename = func(string, string) error { return errors.New("busy") }
	if sent, rem := f.c.Flush(); sent != 0 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	want := "worklog: could not set aside unreadable outbox file 1.json (busy)\n" +
		"worklog: could not move rejected 2.json out of the outbox (busy); it will be retried\n"
	if f.stderr.String() != want {
		t.Fatalf("stderr %q", f.stderr.String())
	}
}

// test_sends_explicit_user_agent
func TestSendsExplicitUserAgent(t *testing.T) {
	f := newFixture(t, reply(200, `{}`))
	f.c.PutTask(makeTask(), true)
	if ua := f.rec.all()[0].Header.Get("User-Agent"); ua != "worklog-cli/1.2.3 (go)" {
		t.Fatalf("UA %q", ua)
	}
}

// httpx sends "Accept: */*" on every request (its default headers); so does the Go client, so a
// Cloudflare rule that looks at Accept sees the same request. Found by the parity harness's header
// comparison (Task 12 M5).
func TestSendsHTTPXAcceptHeader(t *testing.T) {
	f := newFixture(t, reply(200, `{}`))
	f.c.PutTask(makeTask(), true)
	f.c.GetTask("T1")
	for _, r := range f.rec.all() {
		if got := r.Header.Values("Accept"); len(got) != 1 || got[0] != "*/*" {
			t.Fatalf("%s %s: Accept %q", r.Method, r.Path, got)
		}
	}
}

const listRow = `{"id": "T20260922-01", "requester": "r", "project": "", "title": "web made", "status": "open",
	"received_at": "2026-09-22", "done_at": null, "thinking": "", "deliverables": ["a.xlsx"],
	"hours_manual": null, "machine": "web", "ts": "2026-09-22T10:00:00",
	"updated_at": "2026-09-22T01:00:00.000Z"}`

// test_list_tasks_parses_server_rows
func TestListTasksParsesServerRows(t *testing.T) {
	f := newFixture(t, reply(200, `[`+listRow+`]`))
	tasks, ok := f.c.ListTasks()
	req := f.rec.all()[0]
	if req.Method != "GET" || req.Path != "/api/tasks" {
		t.Fatalf("%s %s", req.Method, req.Path)
	}
	if !ok || len(tasks) != 1 || tasks[0].ID != "T20260922-01" || tasks[0].Title != "web made" ||
		strings.Join(tasks[0].Deliverables, ",") != "a.xlsx" {
		t.Fatalf("ListTasks = %+v %v", tasks, ok)
	}
}

func TestListTasksKeepsServerOrderAndADuplicateIDKeepsItsFirstPlace(t *testing.T) {
	row := func(id, title string) string {
		return `{"id": "` + id + `", "ts": "2026-10-01T09:00:00Z", "machine": "m", "requester": "r", "title": "` +
			title + `", "received_at": "2026-10-01"}`
	}
	f := newFixture(t, reply(200, `[`+row("T3", "a")+`,`+row("T1", "b")+`,`+row("T3", "c")+`,`+row("T2", "d")+`]`))
	tasks, ok := f.c.ListTasks()
	var got []string
	for _, t := range tasks {
		got = append(got, t.ID+"="+t.Title)
	}
	// {t.id: t} keeps the first position of a key and the last value.
	if !ok || strings.Join(got, ",") != "T3=c,T1=b,T2=d" {
		t.Fatalf("ListTasks = %v %v", got, ok)
	}
}

// An integer beyond int64 in a row is a Python int: an unknown key with one is dropped and
// hours_manual takes float(n), so the list stays available (pydantic 2.13.5).
func TestListTasksReadsIntegersBeyondInt64(t *testing.T) {
	row := strings.Replace(listRow, `"hours_manual": null`, `"hours_manual": 12345678901234567890, "extra": [-18446744073709551616]`, 1)
	f := newFixture(t, reply(200, `[`+row+`]`))
	tasks, ok := f.c.ListTasks()
	if !ok || len(tasks) != 1 || tasks[0].HoursManual == nil || *tasks[0].HoursManual != 1.2345678901234567e19 {
		t.Fatalf("ListTasks = %+v %v", tasks, ok)
	}
}

// test_list_tasks_returns_none_on_any_failure
func TestListTasksReturnsNoneOnAnyFailure(t *testing.T) {
	for _, h := range []func(http.ResponseWriter, *http.Request){
		reply(503, ""),
		replyType(200, "text/plain", "<html>access login</html>"),
		reply(200, `[{"id": "broken"}]`),
		reply(200, `null`),
		reply(200, `42`),
		reply(200, `{"id": "x"}`),
		// One bad row among good ones still makes the whole list unavailable (Review Focus 6).
		reply(200, `[`+listRow+`, {"id": "T2"}]`),
	} {
		f := newFixture(t, h)
		if got, ok := f.c.ListTasks(); ok || got != nil {
			t.Fatalf("ListTasks = %v %v", got, ok)
		}
	}
}

// test_list_tasks_returns_none_on_network_error
func TestListTasksReturnsNoneOnNetworkError(t *testing.T) {
	f := newFixture(t, boom)
	if _, ok := f.c.ListTasks(); ok {
		t.Fatal("ListTasks ok")
	}
}

// test_create_task_returns_server_id
func TestCreateTaskReturnsServerID(t *testing.T) {
	f := newFixture(t, reply(201, `{"id": "T20260922-03"}`))
	id, ok := f.c.CreateTask("田中さん", "帳票修正", "order", pytime.Date{Y: 2026, M: 9, D: 22}, "mac")
	if !ok || id != "T20260922-03" {
		t.Fatalf("CreateTask = %q %v", id, ok)
	}
	req := f.rec.all()[0]
	if req.Method != "POST" || req.Path != "/api/tasks" {
		t.Fatalf("%s %s", req.Method, req.Path)
	}
	want := obj(t, `{"requester": "田中さん", "title": "帳票修正", "project": "order", "received_at": "2026-09-22", "machine": "mac"}`)
	if !pyjson.Equal(dec(t, req.Body), want) {
		t.Fatalf("body %s", req.Body)
	}
}

func TestCreateTaskNeedsANonEmptyStringID(t *testing.T) {
	for _, body := range []string{`{"id": ""}`, `{"id": 5}`, `{}`, `["T1"]`, `"T1"`, `nope`} {
		f := newFixture(t, reply(201, body))
		if id, ok := f.c.CreateTask("r", "t", "", pytime.Date{Y: 2026, M: 9, D: 22}, "mac"); ok {
			t.Fatalf("%s: CreateTask = %q", body, id)
		}
	}
}

// test_create_task_returns_none_on_failure_and_parks_nothing
func TestCreateTaskReturnsNoneOnFailureAndParksNothing(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	if _, ok := f.c.CreateTask("r", "t", "", pytime.Date{Y: 2026, M: 9, D: 22}, "mac"); ok {
		t.Fatal("CreateTask ok")
	}
	if _, err := os.Stat(f.outbox()); !os.IsNotExist(err) {
		t.Fatalf("outbox exists: %v", err)
	}
}

// test_transport_error_opens_breaker_for_rest_of_process
func TestTransportErrorOpensBreakerForRestOfProcess(t *testing.T) {
	f := newFixture(t, boom)
	if got := f.c.PutTask(makeTask(), true); got != Retry {
		t.Fatalf("PutTask = %q", got)
	}
	if f.rec.n() != 1 {
		t.Fatalf("requests = %d", f.rec.n())
	}
	second := makeTask()
	second.ID = "T20260918-02"
	if got := f.c.PutTask(second, true); got != Retry {
		t.Fatalf("PutTask = %q", got)
	}
	if f.rec.n() != 1 {
		t.Fatalf("breaker open, yet requests = %d", f.rec.n())
	}
	if n := len(jsonFiles(t, f.outbox())); n != 2 {
		t.Fatalf("outbox files = %d", n)
	}
}

// test_breaker_opened_by_create_task_short_circuits_list_tasks
func TestBreakerOpenedByCreateTaskShortCircuitsListTasks(t *testing.T) {
	f := newFixture(t, boom)
	if _, ok := f.c.CreateTask("r", "t", "", pytime.Date{Y: 2026, M: 9, D: 22}, "mac"); ok {
		t.Fatal("CreateTask ok")
	}
	if f.rec.n() != 1 {
		t.Fatalf("requests = %d", f.rec.n())
	}
	if _, ok := f.c.ListTasks(); ok {
		t.Fatal("ListTasks ok")
	}
	if f.rec.n() != 1 {
		t.Fatalf("still offline, yet requests = %d", f.rec.n())
	}
}

// test_http_status_error_does_not_open_breaker
func TestHTTPStatusErrorDoesNotOpenBreaker(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	f.c.PutTask(makeTask(), true)
	f.c.PutTask(makeTask(), true)
	if f.rec.n() != 2 {
		t.Fatalf("requests = %d", f.rec.n())
	}
}

// test_flush_returns_immediately_when_breaker_is_open
func TestFlushReturnsImmediatelyWhenBreakerIsOpen(t *testing.T) {
	f := newFixture(t, boom)
	send(t, f.c, "/api/tasks/A", `{"n": 1}`)
	send(t, f.c, "/api/tasks/B", `{"n": 2}`)
	if f.rec.n() != 1 {
		t.Fatalf("requests = %d", f.rec.n())
	}
	if sent, rem := f.c.Flush(); sent != 0 || rem != 2 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	if f.rec.n() != 1 {
		t.Fatalf("flush hit the network: requests = %d", f.rec.n())
	}
}

// test_access_headers_only_when_both_configured
func TestAccessHeadersOnlyWhenBothConfigured(t *testing.T) {
	f := newFixture(t, reply(200, `{}`), func(cc *ClientConfig) { cc.AccessID, cc.AccessSecret = "id.access", "s3cret" })
	f.c.PutTask(makeTask(), true)
	h := f.rec.all()[0].Header
	if h.Get("CF-Access-Client-Id") != "id.access" || h.Get("CF-Access-Client-Secret") != "s3cret" ||
		h.Get("Authorization") != "Bearer tok" {
		t.Fatalf("headers %v", h)
	}
	f2 := newFixture(t, reply(200, `{}`), func(cc *ClientConfig) { cc.AccessID = "id.access" })
	f2.c.PutTask(makeTask(), true)
	if _, ok := f2.rec.all()[0].Header["Cf-Access-Client-Id"]; ok {
		t.Fatal("CF-Access-Client-Id sent with only one half configured")
	}
}

// test_put_session_meta_posts_paths_and_tokens_and_returns_the_count
func TestPutSessionMetaPostsPathsAndTokensAndReturnsTheCount(t *testing.T) {
	f := newFixture(t, reply(200, `{"updated": 2}`))
	item := obj(t, `{"agent": "codex", "session_id": "x", "files_written": ["/a.md"], "tokens": null}`)
	n, out := f.c.PutSessionMeta([]*pyjson.Object{item})
	if out != OK || n != 2 {
		t.Fatalf("PutSessionMeta = %d %q", n, out)
	}
	req := f.rec.all()[0]
	if req.Method != "POST" || req.Path != "/api/ingest/session-meta" {
		t.Fatalf("%s %s", req.Method, req.Path)
	}
	want := pyjson.NewObject()
	want.Set("sessions", []pyjson.Value{item})
	if !pyjson.Equal(dec(t, req.Body), want) {
		t.Fatalf("body %s", req.Body)
	}
}

// test_put_session_meta_never_parks
func TestPutSessionMetaNeverParks(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	item := obj(t, `{"agent": "codex", "session_id": "x", "files_written": ["/a.md"], "tokens": null}`)
	if _, out := f.c.PutSessionMeta([]*pyjson.Object{item}); out != Retry {
		t.Fatalf("PutSessionMeta = %q", out)
	}
	noOutboxFiles(t, f)
}

// test_put_session_meta_reports_a_refusal
func TestPutSessionMetaReportsARefusal(t *testing.T) {
	f := newFixture(t, reply(404, `{"error": "not found"}`))
	if _, out := f.c.PutSessionMeta(nil); out != Rejected {
		t.Fatalf("PutSessionMeta = %q", out)
	}
	if _, err := os.Stat(f.outbox()); !os.IsNotExist(err) {
		t.Fatalf("outbox exists: %v", err)
	}
	if b := f.rec.all()[0].Body; string(b) != `{"sessions":[]}` {
		t.Fatalf("body %s", b)
	}
}

// test_review_distinguishes_missing_from_unknown_route_and_login_page
func TestReviewDistinguishesMissingFromUnknownRouteAndLoginPage(t *testing.T) {
	f := newFixture(t, reply(404, `{"error": "no review"}`))
	if _, l := f.c.Review("2026-W39"); l != Missing {
		t.Fatalf("Review = %v", l)
	}
	if p := f.rec.all()[0].Path; p != "/api/reviews/2026-W39" {
		t.Fatal(p)
	}
	for _, h := range []func(http.ResponseWriter, *http.Request){
		reply(404, `{"error": "not found"}`),
		replyType(404, "text/html; charset=utf-8", "<h1>nope</h1>"),
		reply(404, `["no review"]`),
		reply(500, `{"error": "no review"}`),
		reply(200, `[1]`),
	} {
		f := newFixture(t, h)
		if v, l := f.c.Review("2026-W39"); l != Unavailable || v != nil {
			t.Fatalf("Review = %v %v", v, l)
		}
	}
	f = newFixture(t, reply(200, `{"week": "2026-W39", "text": "t"}`))
	if v, l := f.c.Review("2026-W39"); l != Found || !pyjson.Equal(v, obj(t, `{"week": "2026-W39", "text": "t"}`)) {
		t.Fatalf("Review = %v %v", v, l)
	}
}

// test_put_review_reports_stored_kept_and_rejected
func TestPutReviewReportsStoredKeptAndRejected(t *testing.T) {
	body := obj(t, `{"week": "2026-W39", "text": "t", "model": "m", "stats_json": "{}", "machine": "mac", "force": false}`)
	cases := []struct {
		h      func(http.ResponseWriter, *http.Request)
		stored bool
		out    Outcome
	}{
		{reply(200, `{"stored": true}`), true, OK},
		{reply(200, `{"stored": false}`), false, OK},
		{reply(200, `{"stored": 1}`), true, OK},
		{reply(200, `{"stored": ""}`), false, OK},
		{reply(200, `{}`), false, OK},
		{reply(400, `{"error": "bad"}`), false, Rejected},
		{reply(503, ``), false, Retry},
		{reply(200, `not json`), false, Retry},
		// Python raises AttributeError on a JSON body that is not an object (a crash it does not
		// catch); Go reports it as not landed.
		{reply(200, `[true]`), false, Retry},
	}
	for i, c := range cases {
		f := newFixture(t, c.h)
		stored, out := f.c.PutReview(body)
		if stored != c.stored || out != c.out {
			t.Errorf("case %d: PutReview = %v %q", i, stored, out)
		}
		if i == 0 {
			req := f.rec.all()[0]
			if req.Method != "POST" || req.Path != "/api/reviews" || !pyjson.Equal(dec(t, req.Body), body) {
				t.Fatalf("%s %s %s", req.Method, req.Path, req.Body)
			}
		}
		noOutboxFiles(t, f)
	}
}

// test_dashboard_sends_the_inclusive_range
func TestDashboardSendsTheInclusiveRange(t *testing.T) {
	f := newFixture(t, reply(200, `{"overview": {}}`))
	got, ok := f.c.Dashboard(pytime.Date{Y: 2026, M: 9, D: 21}, pytime.Date{Y: 2026, M: 9, D: 27})
	if !ok || !pyjson.Equal(got, obj(t, `{"overview": {}}`)) {
		t.Fatalf("Dashboard = %v %v", got, ok)
	}
	req := f.rec.all()[0]
	if req.Path != "/api/dashboard" || req.RawQuery != "from=2026-09-21&to=2026-09-27" {
		t.Fatalf("%s ? %s", req.Path, req.RawQuery)
	}
}

// test_deliverable_pending_asks_for_this_machine
func TestDeliverablePendingAsksForThisMachine(t *testing.T) {
	body := `{"items": [{"key": "/p/docs/a.md", "task_id": "T1", "task_title": "設計", "project": "P"}], "total": 1}`
	f := newFixture(t, reply(200, body))
	got, ok := f.c.DeliverablePending("mac mini", 40)
	if !ok || !pyjson.Equal(got, obj(t, body)) {
		t.Fatalf("DeliverablePending = %v %v", got, ok)
	}
	req := f.rec.all()[0]
	if req.Path != "/api/ingest/deliverables/pending" || req.RawQuery != "machine=mac%20mini&limit=40" {
		t.Fatalf("%s ? %s", req.Path, req.RawQuery)
	}
}

// The machine goes through urllib.parse.quote: space → %20, "/" and "~" kept, UTF-8 percent-encoded
// in upper case (url.QueryEscape would write "+" and "%2F").
func TestDeliverablePendingQuotesTheMachineAsPythonDoes(t *testing.T) {
	f := newFixture(t, reply(200, `{"items": [], "total": 0}`))
	f.c.DeliverablePending("mac mini/~開発", 7)
	if q := f.rec.all()[0].RawQuery; q != "machine=mac%20mini/~%E9%96%8B%E7%99%BA&limit=7" {
		t.Fatalf("query %s", q)
	}
}

// test_deliverable_pending_is_none_when_it_cannot_be_asked
func TestDeliverablePendingIsNoneWhenItCannotBeAsked(t *testing.T) {
	f := newFixture(t, reply(404, `{"error": "not found"}`))
	if got, ok := f.c.DeliverablePending("mac", 40); ok || got != nil {
		t.Fatalf("DeliverablePending = %v %v", got, ok)
	}
}

// test_post_deliverable_verdicts_returns_the_count_and_never_parks
func TestPostDeliverableVerdictsReturnsTheCountAndNeverParks(t *testing.T) {
	verdicts := []*pyjson.Object{
		obj(t, `{"key": "/a.md", "verdict": "in", "reason": "r"}`),
		obj(t, `{"key": "/b.md", "verdict": "out", "reason": ""}`),
	}
	f := newFixture(t, reply(200, `{"inserted": 2}`))
	if n, out := f.c.PostDeliverableVerdicts(verdicts); n != 2 || out != OK {
		t.Fatalf("PostDeliverableVerdicts = %d %q", n, out)
	}
	req := f.rec.all()[0]
	want := pyjson.NewObject()
	want.Set("verdicts", []pyjson.Value{verdicts[0], verdicts[1]})
	if req.Path != "/api/ingest/deliverables/verdicts" || !pyjson.Equal(dec(t, req.Body), want) {
		t.Fatalf("%s %s", req.Path, req.Body)
	}

	f2 := newFixture(t, reply(503, ""))
	if _, out := f2.c.PostDeliverableVerdicts(verdicts); out != Retry {
		t.Fatalf("PostDeliverableVerdicts = %q", out)
	}
	noOutboxFiles(t, f2)
	f3 := newFixture(t, reply(400, `{"error": "invalid"}`))
	if _, out := f3.c.PostDeliverableVerdicts(verdicts); out != Rejected {
		t.Fatalf("PostDeliverableVerdicts = %q", out)
	}
	f4 := newFixture(t, reply(200, `{"inserted": "x"}`))
	if n, out := f4.c.PostDeliverableVerdicts(verdicts); n != 0 || out != OK {
		t.Fatalf("PostDeliverableVerdicts = %d %q", n, out)
	}
}

func TestJudgeInputMissingFoundAndUnavailable(t *testing.T) {
	day := pytime.Date{Y: 2026, M: 10, D: 13}
	f := newFixture(t, reply(404, `{"error": "no plan"}`))
	if _, l := f.c.JudgeInput(day); l != Missing {
		t.Fatalf("JudgeInput = %v", l)
	}
	if p := f.rec.all()[0].Path; p != "/api/day-plans/2026-10-13/judge-input" {
		t.Fatal(p)
	}
	f = newFixture(t, reply(200, `{"items": []}`))
	if v, l := f.c.JudgeInput(day); l != Found || !pyjson.Equal(v, obj(t, `{"items": []}`)) {
		t.Fatalf("JudgeInput = %v %v", v, l)
	}
	for _, h := range []func(http.ResponseWriter, *http.Request){
		reply(404, `{"error": "not found"}`), reply(404, `[]`), replyType(404, "text/html", "<h1>"),
		reply(200, `[]`), reply(201, `{"items": []}`), reply(500, `{}`), reply(200, `nope`), boom,
	} {
		f := newFixture(t, h)
		if v, l := f.c.JudgeInput(day); l != Unavailable || v != nil {
			t.Fatalf("JudgeInput = %v %v", v, l)
		}
	}
}

func TestPostJudgementOutcomes(t *testing.T) {
	day := pytime.Date{Y: 2026, M: 10, D: 13}
	body := obj(t, `{"verdicts": [], "plan_updated_at": "x"}`)
	cases := []struct {
		h   func(http.ResponseWriter, *http.Request)
		out Outcome
	}{
		{reply(200, `{}`), OK},
		{reply(201, `{}`), Retry},
		{reply(409, `{"error": "stale"}`), Stale},
		{reply(400, `{}`), Rejected},
		{reply(404, `{}`), Rejected},
		{reply(401, `{}`), Retry},
		{reply(429, `{}`), Retry},
		{reply(503, `{}`), Retry},
		{replyType(200, "text/html", "<html>"), Retry},
		{replyType(409, "text/html", "<html>"), Retry},
		{boom, Retry},
	}
	for i, c := range cases {
		f := newFixture(t, c.h)
		if out := f.c.PostJudgement(day, body); out != c.out {
			t.Errorf("case %d: PostJudgement = %q, want %q", i, out, c.out)
		}
		req := f.rec.all()[0]
		if req.Method != "POST" || req.Path != "/api/day-plans/2026-10-13/judgement" || !pyjson.Equal(dec(t, req.Body), body) {
			t.Fatalf("%s %s %s", req.Method, req.Path, req.Body)
		}
		noOutboxFiles(t, f)
	}
}

// test_heartbeat_posts_machine_and_counts
func TestHeartbeatPostsMachineAndCounts(t *testing.T) {
	f := newFixture(t, reply(200, `{"ok": true}`))
	if out := f.c.Heartbeat("win11", 2, 1); out != OK {
		t.Fatalf("Heartbeat = %q", out)
	}
	req := f.rec.all()[0]
	if req.Method != "POST" || req.Path != "/api/ingest/heartbeat" {
		t.Fatalf("%s %s", req.Method, req.Path)
	}
	if b := string(req.Body); b != `{"machine":"win11","new":2,"updated":1}` {
		t.Fatalf("body %s", b)
	}
}

// test_heartbeat_is_never_parked
func TestHeartbeatIsNeverParked(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	if out := f.c.Heartbeat("win11", 0, 0); out != Retry {
		t.Fatalf("Heartbeat = %q", out)
	}
	noOutboxFiles(t, f)
}

func TestOutboxDir(t *testing.T) {
	f := newFixture(t, reply(200, `{}`))
	if f.c.OutboxDir() != f.outbox() {
		t.Fatal(f.c.OutboxDir())
	}
}
