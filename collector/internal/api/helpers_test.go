package api

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// seen is one request as the server received it.
type seen struct {
	Method, Path, RawQuery string
	Header                 http.Header
	Body                   []byte
}

// recorder is httpx.MockTransport's Recorder: it keeps every request and answers with responder.
type recorder struct {
	mu        sync.Mutex
	requests  []seen
	responder func(w http.ResponseWriter, r *http.Request)
}

func (rc *recorder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	rc.mu.Lock()
	rc.requests = append(rc.requests, seen{r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Clone(), body})
	rc.mu.Unlock()
	rc.responder(w, r)
}

func (rc *recorder) all() []seen {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return append([]seen(nil), rc.requests...)
}

func (rc *recorder) n() int { return len(rc.all()) }

// reply answers with status and a JSON body (Content-Type application/json; an httptest handler that
// writes JSON without the header would be sniffed as text/plain).
func reply(status int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, body)
	}
}

// replyType answers with an explicit Content-Type ("" sends none at all).
func replyType(status int, ctype, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		if ctype == "" {
			w.Header()["Content-Type"] = nil
		} else {
			w.Header().Set("Content-Type", ctype)
		}
		w.WriteHeader(status)
		io.WriteString(w, body)
	}
}

// boom is httpx.ConnectError: the connection is dropped before any answer, a transport error.
func boom(w http.ResponseWriter, r *http.Request) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		panic("no hijacker")
	}
	conn, _, err := hj.Hijack()
	if err == nil {
		conn.Close()
	}
}

type fixture struct {
	c      *Client
	rec    *recorder
	srv    *httptest.Server
	dir    string // tmp_path
	stderr *bytes.Buffer
}

func (f *fixture) outbox() string { return filepath.Join(f.dir, "outbox") }

func testEnv(stderr io.Writer) *rt.Env {
	return &rt.Env{Stdout: io.Discard, Stderr: stderr, Now: time.Now, Getenv: func(string) string { return "" },
		GOOS: runtime.GOOS}
}

// newFixture is the Python tests' client(tmp_path, responder): base URL with a trailing slash,
// token "tok", outbox tmp_path/outbox.
func newFixture(t *testing.T, responder func(http.ResponseWriter, *http.Request), mod ...func(*ClientConfig)) *fixture {
	t.Helper()
	rec := &recorder{responder: responder}
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)
	dir := t.TempDir()
	stderr := &bytes.Buffer{}
	cc := ClientConfig{URL: srv.URL + "/", Token: "tok", OutboxDir: filepath.Join(dir, "outbox"), Version: "1.2.3"}
	for _, m := range mod {
		m(&cc)
	}
	return &fixture{c: NewClient(cc, testEnv(stderr)), rec: rec, srv: srv, dir: dir, stderr: stderr}
}

func jsonFiles(t *testing.T, dir string) []string {
	t.Helper()
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".json") {
			out = append(out, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(out)
	return out
}

func readJSON(t *testing.T, path string) *pyjson.Object {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	v, err := pyjson.Decode(b)
	if err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return v.(*pyjson.Object)
}

func dec(t *testing.T, b []byte) pyjson.Value {
	t.Helper()
	v, err := pyjson.Decode(b)
	if err != nil {
		t.Fatalf("decode %q: %v", b, err)
	}
	return v
}

func obj(t *testing.T, s string) *pyjson.Object {
	t.Helper()
	return dec(t, []byte(s)).(*pyjson.Object)
}

func get(o *pyjson.Object, k string) pyjson.Value {
	v, _ := o.Get(k)
	return v
}

func naive(y int, m time.Month, d, h, mi int) pytime.Instant {
	return pytime.Naive(time.Date(y, m, d, h, mi, 0, 0, time.UTC))
}

func makeTask() model.Task {
	return model.Task{ID: "T20260918-01", Requester: "田中さん", Title: "帳票修正", Status: "open", SchemaVersion: 1,
		ReceivedAt: pytime.Date{Y: 2026, M: 9, D: 18}, TS: naive(2026, 9, 18, 10, 0), Machine: "mac"}
}

func makeSession() model.Session {
	return model.Session{ID: "Sabcd1234", Agent: "claude-code", SessionID: "abcd1234-x", Cwd: "/w",
		StartedAt: naive(2026, 9, 18, 9, 0), EndedAt: naive(2026, 9, 18, 10, 0), ActiveMinutes: 60, Turns: 5,
		Summary: "s", TS: naive(2026, 9, 18, 10, 0), Machine: "mac", SchemaVersion: 1, SummarySource: "fallback",
		LinkMethod: "none"}
}

func noOutboxFiles(t *testing.T, f *fixture) {
	t.Helper()
	if fs := jsonFiles(t, f.outbox()); len(fs) != 0 {
		t.Fatalf("outbox has %v", fs)
	}
}
