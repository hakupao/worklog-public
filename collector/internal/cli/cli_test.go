package cli

// Ports of tests/test_cli.py: the commands driven against a stub server, so the real api.Client is
// exercised and every command is asserted by the HTTP requests it makes.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
)

var commands = []string{"done", "harvest", "hold", "ls", "new", "note", "plan", "review"}

// taskRow is test_cli.OPEN_TASK with overrides, as server JSON.
func taskRow(over map[string]any) map[string]any {
	row := map[string]any{
		"id": "T20260918-01", "requester": "田中さん（営業部）", "project": "order", "title": "帳票修正",
		"status": "open", "received_at": "2026-09-18", "done_at": nil, "thinking": "",
		"deliverables": []any{}, "hours_manual": nil, "machine": "mac", "ts": "2026-09-18T10:00:00",
	}
	for k, v := range over {
		row[k] = v
	}
	return row
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// server is test_cli.server: a Worker that serves tasks and accepts writes. putStatus 503 is a
// retryable failure (the record parks), 400 a refusal (outbox/rejected, never replayed).
func server(tasks []map[string]any, putStatus, getStatus, postStatus int) func(seen) reply {
	if tasks == nil {
		tasks = []map[string]any{taskRow(nil)}
	}
	return func(q seen) reply {
		path := strings.SplitN(q.URI, "?", 2)[0]
		switch {
		case q.Method == "GET" && path == "/api/tasks":
			return jsonReply(getStatus, mustJSON(tasks))
		case q.Method == "GET" && strings.HasPrefix(path, "/api/tasks/"):
			id := strings.TrimPrefix(path, "/api/tasks/")
			for _, row := range tasks {
				if row["id"] == id {
					return jsonReply(getStatus, mustJSON(map[string]any{"task": row, "sessions": []any{}, "notes": []any{}, "total_minutes": 0}))
				}
			}
			return jsonReply(404, `{"error": "not found"}`)
		case q.Method == "POST" && path == "/api/tasks":
			if postStatus >= 300 {
				return jsonReply(postStatus, `{"error": "invalid"}`)
			}
			return jsonReply(postStatus, mustJSON(taskRow(map[string]any{"id": "T20260922-07"})))
		case q.Method == "PUT":
			return jsonReply(putStatus, mustJSON(map[string]any{"id": path[strings.LastIndex(path, "/")+1:]}))
		}
		return jsonReply(404, `{"error": "not found"}`)
	}
}

func okServer() func(seen) reply { return server(nil, 200, 200, 201) }

func str(t *testing.T, o *pyjson.Object, k string) string {
	t.Helper()
	s, ok := get(t, o, k).(string)
	if !ok {
		t.Fatalf("%s is not a string in %s", k, pyjson.Compact(o))
	}
	return s
}

// --- the command set -------------------------------------------------------------------------

func TestTheCLIExposesExactlyTheKeptCommands(t *testing.T) {
	var names []string
	for _, c := range table {
		names = append(names, c.name)
	}
	slices.Sort(names)
	if !slices.Equal(names, commands) {
		t.Fatalf("commands = %v, want %v", names, commands)
	}
}

func TestHelpListsEveryKeptCommand(t *testing.T) {
	w := cliWorld(t, "")
	code, out, _ := w.run("--help")
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
	for _, name := range commands {
		if !contains(out, name) {
			t.Errorf("--help does not list %s:\n%s", name, out)
		}
	}
}

func TestTheRetiredCommandsAreNoLongerInvocable(t *testing.T) {
	for _, gone := range []string{"link", "unlink", "relink", "show", "report", "api-import"} {
		s := newFnStub(t, okServer())
		w := cliWorld(t, s.srv.URL)
		if code, _, _ := w.run(gone, "T20260918-01"); code == 0 {
			t.Errorf("%s: exit 0", gone)
		}
		if len(s.requests()) != 0 {
			t.Errorf("%s: requests %v", gone, s.calls())
		}
	}
}

func TestEveryCommandRequiresAnAPIURLAndToken(t *testing.T) {
	for _, argv := range [][]string{
		{"new", "田中", "x"}, {"note", "-", "x"}, {"done", "T20260918-01"},
		{"hold", "T20260918-01"}, {"ls"}, {"harvest"}, {"review"}, {"plan", "judge"},
	} {
		w := newWorld(t, "", "machine=\"mac\"\n", "")
		code, out, errOut := w.run(argv...)
		if code != 1 || out != "" || errOut != "error: api_url (config.toml) and api_token (~/.worklog/credentials.toml) are required\n" {
			t.Errorf("%v: exit %d, stdout %q, stderr %q", argv, code, out, errOut)
		}
	}
}

// --- wl new ---------------------------------------------------------------------------------

func TestNewPostsTheCaseAndPrintsTheIDTheServerAllocated(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	code, out, errOut := w.run("new", "田中", "帳票修正", "--project", "order", "--received", "2026-09-22")
	if code != 0 || out != "T20260922-07\n" || errOut != "" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
	if got := s.calls(); !slices.Equal(got, []string{"POST /api/tasks"}) {
		t.Fatalf("calls %v", got)
	}
	want, _ := pyjson.Decode([]byte(`{"requester": "田中さん（営業部）", "title": "帳票修正", "project": "order", "received_at": "2026-09-22", "machine": "mac"}`))
	if got := s.bodies(t, "POST")[0]; !pyjson.Equal(got, want) {
		t.Fatalf("body %s", pyjson.Compact(got))
	}
}

func TestNewDefaultsReceivedAtToToday(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	// date.today() is the local date: 23:30 UTC on the 12th is the 12th in UTC and the 13th in Tokyo.
	w.env.Now = func() time.Time { return time.Date(2026, 10, 12, 23, 30, 0, 0, time.UTC) }
	if code, _, _ := w.run("new", "田中", "x"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if got := str(t, s.bodies(t, "POST")[0], "received_at"); got != "2026-10-12" {
		t.Fatalf("received_at %s", got)
	}
}

func TestNewKeepsAnUnknownRequesterAsTypedAndWarns(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	code, _, errOut := w.run("new", "佐藤", "x")
	if code != 0 || str(t, s.bodies(t, "POST")[0], "requester") != "佐藤" {
		t.Fatalf("exit %d", code)
	}
	if errOut != "warning: unknown requester alias '佐藤', saving as-is\n" {
		t.Fatalf("stderr %q", errOut)
	}
}

func TestNewResolvesEachOfSeveralRequesters(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	code, _, errOut := w.run("new", "田中、佐藤", "x")
	if code != 0 || str(t, s.bodies(t, "POST")[0], "requester") != "田中さん（営業部）、佐藤" {
		t.Fatalf("exit %d, body %s", code, pyjson.Compact(s.bodies(t, "POST")[0]))
	}
	if !contains(errOut, "unknown requester alias '佐藤'") {
		t.Fatalf("stderr %q", errOut)
	}
}

func TestNewExits1WhenTheServerCannotBeReached(t *testing.T) {
	w := cliWorld(t, deadURL(t))
	code, _, errOut := w.run("new", "田中", "x")
	if code != 1 || !contains(errOut, "not created") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
	// A create needs a server-allocated id, so there is nothing to park.
	if f := jsonFiles(t, w.outbox()); len(f) != 0 {
		t.Fatalf("parked %v", f)
	}
}

// --- wl note --------------------------------------------------------------------------------

var noteIDShape = regexp.MustCompile(`^N\d{8}-\d{6}-[0-9a-f]{4}$`)

func TestNotePutsANoteCarryingTheTextMinutesAndCase(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	if code, _, errOut := w.run("note", "T20260918-01", "原因を調査した", "--minutes", "15"); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	var puts []seen
	for _, q := range s.requests() {
		if q.Method == "PUT" && strings.HasPrefix(q.URI, "/api/notes/") {
			puts = append(puts, q)
		}
	}
	if len(puts) != 1 {
		t.Fatalf("note puts %v", s.calls())
	}
	body := puts[0].JSON(t)
	if str(t, body, "text") != "原因を調査した" || str(t, body, "task_id") != "T20260918-01" ||
		get(t, body, "minutes") != pyjson.Int(15) || str(t, body, "machine") != "mac" {
		t.Fatalf("body %s", pyjson.Compact(body))
	}
	if puts[0].URI != "/api/notes/"+str(t, body, "id") {
		t.Fatalf("uri %s", puts[0].URI)
	}
}

func TestNoteWithADashRecordsNoCaseAndTouchesNoTask(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("note", "-", "案件なしのメモ"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	body := s.bodies(t, "PUT")[0]
	if got := s.calls(); !slices.Equal(got, []string{"PUT /api/notes/" + str(t, body, "id")}) {
		t.Fatalf("calls %v", got)
	}
	if get(t, body, "task_id") != nil {
		t.Fatalf("task_id %v", get(t, body, "task_id"))
	}
}

func TestNoteAppendsTheTextToTheCaseThinking(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	if code, _, errOut := w.run("note", "T20260918-01", "原因を調査した"); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	bodies := s.bodies(t, "PUT")
	want := []string{"GET /api/tasks/T20260918-01", "PUT /api/notes/" + str(t, bodies[0], "id"), "PUT /api/tasks/T20260918-01"}
	if got := s.calls(); !slices.Equal(got, want) {
		t.Fatalf("calls %v", got)
	}
	task := bodies[1]
	if str(t, task, "thinking") != "- 原因を調査した" || str(t, task, "machine") != "mac" ||
		str(t, task, "status") != "open" || str(t, task, "title") != "帳票修正" {
		t.Fatalf("task %s", pyjson.Compact(task))
	}
}

func TestNoteAppendsOnANewLineBelowWhatIsAlreadyThere(t *testing.T) {
	s := newFnStub(t, server([]map[string]any{taskRow(map[string]any{"thinking": "- 先に書いたメモ"})}, 200, 200, 201))
	w := cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("note", "T20260918-01", "二件目"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if got := str(t, s.bodies(t, "PUT")[1], "thinking"); got != "- 先に書いたメモ\n- 二件目" {
		t.Fatalf("thinking %q", got)
	}
}

func TestNoteSkipsTheThinkingUpdateWhenTheCaseCannotBeRead(t *testing.T) {
	w := cliWorld(t, deadURL(t))
	code, _, errOut := w.run("note", "T20260918-01", "オフラインのメモ")
	if code != 0 || !contains(errOut, "備考") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
	// The note itself still reached durable storage; only the 備考 append was given up on.
	files := jsonFiles(t, w.outbox())
	if len(files) != 1 {
		t.Fatalf("parked %v", files)
	}
	if item := readJSON(t, files[0]); !strings.HasPrefix(str(t, item, "path"), "/api/notes/") {
		t.Fatalf("parked %s", pyjson.Compact(item))
	}
}

func TestNoteRejectedByTheServerExits1AndSaysItWillNotBeResent(t *testing.T) {
	s := newFnStub(t, server(nil, 400, 200, 201))
	w := cliWorld(t, s.srv.URL)
	code, _, errOut := w.run("note", "-", "x")
	if code != 1 || !contains(errOut, "rejected") || !contains(errOut, "will not be sent again") || contains(errOut, "wl harvest") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
	if n := len(jsonFiles(t, filepath.Join(w.outbox(), "rejected"))); n != 1 {
		t.Fatalf("rejected files %d", n)
	}
	if f := jsonFiles(t, w.outbox()); len(f) != 0 {
		t.Fatalf("queued %v", f)
	}
}

func TestAFailedThinkingUpdateParksNothingAndDoesNotFailTheNote(t *testing.T) {
	// PUT /api/tasks/:id replaces the whole row with no version check: a parked copy would roll
	// back whatever happened in between when a later flush replayed it.
	for _, status := range []int{503, 400} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			s := newFnStub(t, func(q seen) reply {
				if q.Method == "GET" {
					return jsonReply(200, mustJSON(map[string]any{"task": taskRow(nil), "sessions": []any{}, "notes": []any{}, "total_minutes": 0}))
				}
				if strings.HasPrefix(q.URI, "/api/notes/") {
					return jsonReply(200, `{"id": "n"}`)
				}
				return jsonReply(status, `{"error": "nope"}`)
			})
			w := cliWorld(t, s.srv.URL)
			code, _, errOut := w.run("note", "T20260918-01", "x")
			if code != 0 || !contains(errOut, "備考 was not written") || !contains(errOut, "rather than re-running") || contains(errOut, "is queued in") {
				t.Fatalf("exit %d, stderr %q", code, errOut)
			}
			if f := append(jsonFiles(t, w.outbox()), jsonFiles(t, filepath.Join(w.outbox(), "rejected"))...); len(f) != 0 {
				t.Fatalf("kept %v", f)
			}
		})
	}
}

func TestNewDoesNotBlameTheNetworkForARefusedCreate(t *testing.T) {
	s := newFnStub(t, server(nil, 200, 200, 400))
	w := cliWorld(t, s.srv.URL)
	code, _, errOut := w.run("new", "田中", "x")
	if code != 1 || !contains(errOut, "did not answer or refused") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
	if f := jsonFiles(t, w.outbox()); len(f) != 0 {
		t.Fatalf("parked %v", f)
	}
}

func TestNoteReportsAWriteItCouldNotEvenPark(t *testing.T) {
	w := cliWorld(t, deadURL(t))
	writeFile(t, w.outbox(), "not a directory")
	code, _, errOut := w.run("note", "-", "x")
	if code != 1 || !contains(errOut, "NOT saved anywhere") || contains(errOut, "is queued in") || contains(errOut, "wl harvest") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
}

func TestNoteIDCarriesARandomTailSoIDsAreUnique(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("note", "-", "x"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if id := str(t, s.bodies(t, "PUT")[0], "id"); !noteIDShape.MatchString(id) {
		t.Fatalf("id %q", id)
	}
}

func TestTwoNotesInTheSameSecondDoNotCollide(t *testing.T) {
	// Real data produced two notes sharing N20260918-120250, and the second overwrote the first.
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	w.env.Now = func() time.Time { return time.Date(2026, 9, 18, 12, 2, 50, 0, time.Local) }
	for _, text := range []string{"one", "two"} {
		if code, _, _ := w.run("note", "-", text); code != 0 {
			t.Fatalf("exit %d", code)
		}
	}
	var ids []string
	for _, b := range s.bodies(t, "PUT") {
		ids = append(ids, str(t, b, "id"))
	}
	if len(ids) != 2 || ids[0] == ids[1] || !strings.HasPrefix(ids[0], "N20260918-120250-") || !strings.HasPrefix(ids[1], "N20260918-120250-") {
		t.Fatalf("ids %v", ids)
	}
}

func TestNoteParksInTheOutboxWhenTheServerIsUnreachable(t *testing.T) {
	w := cliWorld(t, deadURL(t))
	code, _, errOut := w.run("note", "-", "オフラインのメモ")
	if code != 0 || !contains(errOut, "outbox") {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
	files := jsonFiles(t, w.outbox())
	if len(files) != 1 {
		t.Fatalf("parked %v", files)
	}
	item := readJSON(t, files[0])
	body := get(t, item, "body").(*pyjson.Object)
	if str(t, item, "method") != "PUT" || !strings.HasPrefix(str(t, item, "path"), "/api/notes/") || str(t, body, "text") != "オフラインのメモ" {
		t.Fatalf("parked %s", pyjson.Compact(item))
	}
}

func TestNoteRefusesAnUnknownCaseWhileTheServerIsReachable(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	code, _, errOut := w.run("note", "T19990101-99", "x")
	if code != 1 || errOut != "error: unknown task id 'T19990101-99'\n" {
		t.Fatalf("exit %d, stderr %q", code, errOut)
	}
	for _, q := range s.requests() {
		if q.Method == "PUT" {
			t.Fatalf("wrote %s", q.URI)
		}
	}
}

// --- wl done / wl hold ----------------------------------------------------------------------

func TestDoneReadsTheCaseFromTheServerAndWritesItBack(t *testing.T) {
	s := newFnStub(t, server([]map[string]any{taskRow(map[string]any{"title": "fixed on the web"})}, 200, 200, 201))
	w := cliWorld(t, s.srv.URL)
	if code, _, errOut := w.run("done", "T20260918-01", "--deliverable", "a.xlsx", "--hours", "2"); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	if got := s.calls(); !slices.Equal(got, []string{"GET /api/tasks/T20260918-01", "PUT /api/tasks/T20260918-01"}) {
		t.Fatalf("calls %v", got)
	}
	body := s.bodies(t, "PUT")[0]
	want, _ := pyjson.Decode([]byte(`["a.xlsx"]`))
	if str(t, body, "status") != "done" || str(t, body, "done_at") != "2026-10-13" ||
		!pyjson.Equal(get(t, body, "deliverables"), want) || !pyjson.Equal(get(t, body, "hours_manual"), pyjson.Int(2)) ||
		str(t, body, "machine") != "mac" || str(t, body, "title") != "fixed on the web" {
		t.Fatalf("body %s", pyjson.Compact(body))
	}
}

func TestDoneAppendsToTheDeliverablesAlreadyOnTheServer(t *testing.T) {
	s := newFnStub(t, server([]map[string]any{taskRow(map[string]any{"deliverables": []any{"old.xlsx"}})}, 200, 200, 201))
	w := cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("done", "T20260918-01", "--deliverable", "new.xlsx"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	want, _ := pyjson.Decode([]byte(`["old.xlsx", "new.xlsx"]`))
	if got := get(t, s.bodies(t, "PUT")[0], "deliverables"); !pyjson.Equal(got, want) {
		t.Fatalf("deliverables %s", pyjson.Compact(got))
	}
}

func TestDoneWithoutHoursLeavesTheRecordedHoursAlone(t *testing.T) {
	s := newFnStub(t, server([]map[string]any{taskRow(map[string]any{"hours_manual": 3.5})}, 200, 200, 201))
	w := cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("done", "T20260918-01"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if got := get(t, s.bodies(t, "PUT")[0], "hours_manual"); !pyjson.Equal(got, pyjson.Float(3.5)) {
		t.Fatalf("hours_manual %v", got)
	}
}

func TestDoneRefusesNegativeHoursBeforeTouchingTheServer(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	// Checked before the config is read, as click's FloatRange(min=0) is.
	if err := os.Remove(filepath.Join(w.root, "config.toml")); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := w.run("done", "T20260918-01", "--hours", "-1"); code != 2 {
		t.Fatalf("exit %d", code)
	}
	if len(s.requests()) != 0 {
		t.Fatalf("calls %v", s.calls())
	}
}

func TestDoneAcceptsZeroHoursAsAnOverride(t *testing.T) {
	s := newFnStub(t, server([]map[string]any{taskRow(map[string]any{"hours_manual": 3.5})}, 200, 200, 201))
	w := cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("done", "T20260918-01", "--hours", "0"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if got := get(t, s.bodies(t, "PUT")[0], "hours_manual"); !pyjson.Equal(got, pyjson.Int(0)) {
		t.Fatalf("hours_manual %v", got)
	}
}

func TestHoldWritesTheCaseBackOnHold(t *testing.T) {
	s := newFnStub(t, okServer())
	w := cliWorld(t, s.srv.URL)
	if code, _, _ := w.run("hold", "T20260918-01"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if got := s.calls(); !slices.Equal(got, []string{"GET /api/tasks/T20260918-01", "PUT /api/tasks/T20260918-01"}) {
		t.Fatalf("calls %v", got)
	}
	body := s.bodies(t, "PUT")[0]
	if str(t, body, "status") != "hold" || get(t, body, "done_at") != nil {
		t.Fatalf("body %s", pyjson.Compact(body))
	}
}

func TestAnUnknownCaseExits1WithoutWriting(t *testing.T) {
	for _, command := range []string{"done", "hold"} {
		s := newFnStub(t, okServer())
		w := cliWorld(t, s.srv.URL)
		code, _, errOut := w.run(command, "T19990101-99")
		if code != 1 || errOut != "error: unknown task id 'T19990101-99' (or the server could not be reached)\n" {
			t.Fatalf("%s: exit %d, stderr %q", command, code, errOut)
		}
		for _, q := range s.requests() {
			if q.Method == "PUT" {
				t.Fatalf("%s wrote %s", command, q.URI)
			}
		}
	}
}

func TestAnUnreachableServerExits1WithoutWriting(t *testing.T) {
	for _, command := range []string{"done", "hold"} {
		w := cliWorld(t, deadURL(t))
		if code, _, _ := w.run(command, "T20260918-01"); code != 1 {
			t.Fatalf("%s: exit %d", command, code)
		}
		if f := jsonFiles(t, w.outbox()); len(f) != 0 {
			t.Fatalf("%s parked %v", command, f)
		}
	}
}

func TestAFailedWriteBackExits1AndQueuesNothing(t *testing.T) {
	// park=False on the edit path: exit 1 has to mean the case really is untouched.
	for _, command := range []string{"done", "hold"} {
		for _, status := range []int{503, 400} {
			s := newFnStub(t, server(nil, status, 200, 201))
			w := cliWorld(t, s.srv.URL)
			code, _, errOut := w.run(command, "T20260918-01")
			if code != 1 || errOut != "error: the server did not accept the update to 'T20260918-01'\n" {
				t.Fatalf("%s %d: exit %d, stderr %q", command, status, code, errOut)
			}
			if !slices.Contains(s.calls(), "PUT /api/tasks/T20260918-01") {
				t.Fatalf("%s %d: calls %v", command, status, s.calls())
			}
			if f := append(jsonFiles(t, w.outbox()), jsonFiles(t, filepath.Join(w.outbox(), "rejected"))...); len(f) != 0 {
				t.Fatalf("%s %d: kept %v", command, status, f)
			}
		}
	}
}

// --- wl ls ----------------------------------------------------------------------------------

var lsRows = []map[string]any{
	taskRow(map[string]any{"id": "T20260918-01", "title": "帳票修正", "status": "open"}),
	taskRow(map[string]any{"id": "T20260918-02", "title": "保留の件", "status": "hold"}),
	taskRow(map[string]any{"id": "T20260918-03", "title": "完了の件", "status": "done", "done_at": "2026-09-19"}),
}

const lsHeader = "id | 依頼元 | project | 状態 | 受領日 | 案件名"

func TestLsShowsOpenAndHoldCasesFromTheServer(t *testing.T) {
	s := newFnStub(t, server(lsRows, 200, 200, 201))
	w := cliWorld(t, s.srv.URL)
	code, out, _ := w.run("ls")
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
	if got := s.calls(); !slices.Equal(got, []string{"GET /api/tasks"}) {
		t.Fatalf("calls %v", got)
	}
	want := lsHeader + "\n" +
		"T20260918-01 | 田中さん（営業部） | order | open | 2026-09-18 | 帳票修正\n" +
		"T20260918-02 | 田中さん（営業部） | order | hold | 2026-09-18 | 保留の件\n"
	if out != want {
		t.Fatalf("stdout %q", out)
	}
}

func TestLsAllIncludesTheDoneCases(t *testing.T) {
	s := newFnStub(t, server(lsRows, 200, 200, 201))
	w := cliWorld(t, s.srv.URL)
	code, out, _ := w.run("ls", "--all")
	if code != 0 || !contains(out, "完了の件") || !contains(out, "帳票修正") {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
}

func TestLsExits1WhenTheCasesCannotBeRead(t *testing.T) {
	w := cliWorld(t, deadURL(t))
	code, out, errOut := w.run("ls")
	if code != 1 || contains(out, lsHeader) || errOut != "error: could not read the cases from the server\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", code, out, errOut)
	}
}

func readJSON(t *testing.T, path string) *pyjson.Object {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	v, err := pyjson.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return v.(*pyjson.Object)
}
