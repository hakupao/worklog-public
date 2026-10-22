package api

import (
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// httpx behaviour the Python tests reach through MockTransport and Go has to rebuild at the
// transport (spec §4.3, §5.8; Review Focus 5).

// silent holds the answer back for d (or until the client gives up), then sends it.
func silent(d time.Duration, then func(http.ResponseWriter, *http.Request)) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(d):
		}
		then(w, r)
	}
}

// stalledBody sends the headers at once, then nothing for d, then the body.
func stalledBody(d time.Duration, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
			return
		case <-time.After(d):
		}
		io.WriteString(w, body)
	}
}

// trickle sends the headers, then body one byte every gap: a slow but steady response.
func trickle(gap time.Duration, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		for i := 0; i < len(body); i++ {
			if i > 0 {
				select {
				case <-r.Context().Done():
					return
				case <-time.After(gap):
				}
			}
			w.Write([]byte{body[i]})
			w.(http.Flusher).Flush()
		}
	}
}

// An interactive GET that hears nothing for 5 s gives up at 4 s: unavailable, and the timeout is a
// transport error, so the breaker opens.
func TestInteractiveGetSilentFor5sIsUnavailableAndOpensTheBreaker(t *testing.T) {
	t.Parallel()
	for name, h := range map[string]func(http.ResponseWriter, *http.Request){
		"no headers": silent(5*time.Second, reply(200, `[]`)),
		"no body":    stalledBody(5*time.Second, `[]`),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newFixture(t, h)
			start := time.Now()
			if _, ok := f.c.ListTasks(); ok {
				t.Fatal("ListTasks ok")
			}
			if el := time.Since(start); el < 3500*time.Millisecond || el > 4900*time.Millisecond {
				t.Fatalf("gave up after %v, want about 4 s", el)
			}
			if _, ok := f.c.WeekTimeline("2026-W42"); ok || f.rec.n() != 1 {
				t.Fatalf("breaker did not open: requests = %d", f.rec.n())
			}
		})
	}
}

// test_list_tasks_and_create_task_use_a_short_interactive_timeout: create_task too gives up at 4 s.
func TestCreateTaskUsesTheShortInteractiveTimeout(t *testing.T) {
	t.Parallel()
	f := newFixture(t, silent(5*time.Second, reply(201, `{"id": "T1"}`)))
	start := time.Now()
	if _, ok := f.c.CreateTask("r", "t", "", pytime.Date{Y: 2026, M: 9, D: 22}, "mac"); ok {
		t.Fatal("CreateTask ok")
	}
	if el := time.Since(start); el > 4900*time.Millisecond {
		t.Fatalf("gave up after %v", el)
	}
}

// test_put_task_still_uses_the_client_default_timeout: a write waits 10 s, so a 5 s pause lands.
func TestPutTaskStillUsesTheDefaultTimeout(t *testing.T) {
	t.Parallel()
	f := newFixture(t, silent(5*time.Second, reply(200, `{"id": "x"}`)))
	if got := f.c.PutTask(makeTask(), true); got != OK {
		t.Fatalf("PutTask = %q", got)
	}
	f2 := newFixture(t, stalledBody(5*time.Second, `{"id": "x"}`))
	if got := f2.c.PutTask(makeTask(), true); got != OK {
		t.Fatalf("PutTask (stalled body) = %q", got)
	}
}

// httpx's timeouts are per phase, not a deadline for the request: a body streaming one byte every
// 3 s for about 20 s completes, even under the 4 s interactive timeout.
func TestASlowButSteadyBodyCompletes(t *testing.T) {
	t.Parallel()
	body := "[      ]" // 8 bytes, 7 gaps of 3 s = 21 s
	f := newFixture(t, trickle(3*time.Second, body))
	start := time.Now()
	tasks, ok := f.c.ListTasks()
	if !ok || len(tasks) != 0 {
		t.Fatalf("ListTasks = %v %v", tasks, ok)
	}
	if el := time.Since(start); el < 20*time.Second {
		t.Fatalf("finished after %v; the body did not trickle", el)
	}
}

// No redirect is followed (httpx's default): a 302, such as an Access login redirect, is retry for a
// write and "cannot be had" for a read, and the target is never asked.
func TestA302IsNotFollowed(t *testing.T) {
	var f *fixture
	f = newFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			reply(200, `[]`)(w, r)
			return
		}
		http.Redirect(w, r, f.srv.URL+"/login", http.StatusFound)
	})
	if got := f.c.PutTask(makeTask(), true); got != Retry {
		t.Fatalf("PutTask = %q", got)
	}
	if n := len(jsonFiles(t, f.outbox())); n != 1 {
		t.Fatalf("outbox files = %d", n)
	}
	if _, ok := f.c.ListTasks(); ok {
		t.Fatal("ListTasks ok")
	}
	if _, ok := f.c.WeekTimeline("2026-W42"); ok {
		t.Fatal("WeekTimeline ok")
	}
	for _, r := range f.rec.all() {
		if r.Path == "/login" {
			t.Fatal("the redirect was followed")
		}
	}
	// An HTTP status never opens the breaker.
	if f.rec.n() != 3 {
		t.Fatalf("requests = %d", f.rec.n())
	}
}

// A 200 HTML page (Access's login page) is unavailable for a read; the breaker stays closed.
func TestHTML200IsUnavailableForReads(t *testing.T) {
	f := newFixture(t, replyType(200, "text/html", "<html>access login</html>"))
	if _, ok := f.c.ListTasks(); ok {
		t.Fatal("ListTasks ok")
	}
	if _, ok := f.c.GetTask("T1"); ok {
		t.Fatal("GetTask ok")
	}
	if _, ok := f.c.Dashboard(pytime.Date{Y: 2026, M: 10, D: 5}, pytime.Date{Y: 2026, M: 10, D: 11}); ok {
		t.Fatal("Dashboard ok")
	}
	if f.rec.n() != 3 {
		t.Fatalf("requests = %d", f.rec.n())
	}
}

// _get_json reads the body whatever its Content-Type says (raise_for_status, then r.json()).
func TestReadsParseJSONWhateverTheContentType(t *testing.T) {
	f := newFixture(t, replyType(200, "text/plain", `{"unassigned": 1}`))
	if _, ok := f.c.WeekTimeline("2026-W42"); !ok {
		t.Fatal("WeekTimeline unavailable")
	}
}
