package cli

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// fixedNow is the clock every CLI test runs on (the transcripts' 2026-10-13T12:00:00.123456+09:00).
var fixedNow = time.Date(2026, 10, 13, 12, 0, 0, 123456000, time.FixedZone("JST", 9*3600))

// lockedBuffer is a buffer the side jobs' goroutine-free writes and the harvest workers can share.
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// reply is one canned answer of the stub server.
type reply struct {
	status  int
	ctype   string
	body    string
	headers map[string]string
}

func jsonReply(status int, body string) reply {
	return reply{status: status, ctype: "application/json", body: body}
}

// route answers requests whose method matches and whose RequestURI the pattern finds (re.search,
// as gen_golden's stub). Replies are used in turn; the last one sticks.
type route struct {
	method  string
	pattern *regexp.Regexp
	replies []reply
}

func on(method, pattern string, replies ...reply) *route {
	return &route{method: method, pattern: regexp.MustCompile(pattern), replies: replies}
}

// seen is one request the stub received.
type seen struct {
	Method, URI string
	Header      http.Header
	Body        []byte
}

func (s seen) JSON(t *testing.T) *pyjson.Object {
	t.Helper()
	v, err := pyjson.Decode(s.Body)
	if err != nil {
		t.Fatalf("body of %s %s: %v (%q)", s.Method, s.URI, err, s.Body)
	}
	o, ok := v.(*pyjson.Object)
	if !ok {
		t.Fatalf("body of %s %s is not an object: %q", s.Method, s.URI, s.Body)
	}
	return o
}

type stub struct {
	srv    *httptest.Server
	mu     sync.Mutex
	routes []*route
	reqs   []seen
	// fn, when set, answers instead of the routes.
	fn func(q seen) reply
}

func newStub(t *testing.T, routes ...*route) *stub {
	s := &stub{routes: routes}
	s.srv = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *stub) serve(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	s.mu.Lock()
	s.reqs = append(s.reqs, seen{Method: r.Method, URI: r.RequestURI, Header: r.Header.Clone(), Body: body})
	var rep *reply
	if s.fn != nil {
		x := s.fn(s.reqs[len(s.reqs)-1])
		rep = &x
	}
	for _, ro := range s.routes {
		if rep != nil {
			break
		}
		if ro.method == r.Method && ro.pattern.MatchString(r.RequestURI) {
			x := ro.replies[0]
			if len(ro.replies) > 1 {
				ro.replies = ro.replies[1:]
			}
			rep = &x
			break
		}
	}
	s.mu.Unlock()
	if rep == nil {
		rep = &reply{status: 404, ctype: "text/plain", body: "no stub route"}
	}
	w.Header().Set("Content-Type", rep.ctype)
	for k, v := range rep.headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(rep.status)
	io.WriteString(w, rep.body)
}

// newFnStub answers every request with fn.
func newFnStub(t *testing.T, fn func(q seen) reply) *stub {
	s := newStub(t)
	s.fn = fn
	return s
}

func (s *stub) requests() []seen {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]seen(nil), s.reqs...)
}

// calls is "METHOD URI" of every request, in arrival order.
func (s *stub) calls() []string {
	var out []string
	for _, q := range s.requests() {
		out = append(out, q.Method+" "+q.URI)
	}
	return out
}

// bodies are the JSON bodies of the requests with this method.
func (s *stub) bodies(t *testing.T, method string) []*pyjson.Object {
	t.Helper()
	var out []*pyjson.Object
	for _, q := range s.requests() {
		if q.Method == method {
			out = append(out, q.JSON(t))
		}
	}
	return out
}

// deadURL is a URL nothing listens on: every request is "connection refused".
func deadURL(t *testing.T) string {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	return "http://" + addr + "/"
}

// fakeRunner stands in for claude: answer decides from the prompt, every call is recorded.
type fakeRunner struct {
	mu     sync.Mutex
	calls  []fakeCall
	answer func(stdin string) (string, int)
}

type fakeCall struct {
	Argv  []string
	Stdin string
}

func (f *fakeRunner) Run(_ context.Context, argv []string, stdin []byte, _ time.Duration) (llm.Result, error) {
	f.mu.Lock()
	f.calls = append(f.calls, fakeCall{Argv: append([]string(nil), argv...), Stdin: string(stdin)})
	f.mu.Unlock()
	out, code := "ok", 0
	if f.answer != nil {
		out, code = f.answer(string(stdin))
	}
	return llm.Result{Stdout: []byte(out), ExitCode: code}, nil
}

func (f *fakeRunner) recorded() []fakeCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]fakeCall(nil), f.calls...)
}

// useRunner makes every claude call of the command under test go to r.
func useRunner(t *testing.T, r llm.Runner) {
	old := newRunner
	newRunner = func(*rt.Env) llm.Runner { return r }
	t.Cleanup(func() { newRunner = old })
}

// world is one configured repo + wl home, as test_cli.setup builds it.
type world struct {
	t                 *testing.T
	work, root, home  string
	userHome          string
	vars              map[string]string
	stdout, stderr    *lockedBuffer
	env               *rt.Env
	runner            *fakeRunner
	configText, creds string
}

// newWorld writes config.toml (with api_url = url unless url is "") and credentials.toml (unless
// creds is ""), and gives an Env on the fixed clock whose claude is a fakeRunner answering "ok".
func newWorld(t *testing.T, url, config, creds string) *world {
	t.Helper()
	w := &world{t: t, work: t.TempDir()}
	w.root = filepath.Join(w.work, "root")
	w.home = filepath.Join(w.work, "home")
	w.userHome = filepath.Join(w.work, "userhome")
	for _, d := range []string{w.root, w.home, w.userHome} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	text := config
	if url != "" {
		text = "api_url = \"" + url + "\"\n" + text
	}
	writeFile(t, filepath.Join(w.root, "config.toml"), text)
	if creds != "" {
		writeFile(t, filepath.Join(w.home, "credentials.toml"), creds)
	}
	w.vars = map[string]string{"WORKLOG_ROOT": w.root, "WORKLOG_HOME": w.home}
	w.stdout, w.stderr = &lockedBuffer{}, &lockedBuffer{}
	w.env = &rt.Env{
		Stdout: w.stdout, Stderr: w.stderr,
		Now:    func() time.Time { return fixedNow },
		Getenv: func(k string) string { return w.vars[k] },
		Home:   w.userHome, GOOS: runtime.GOOS, Cwd: w.work,
	}
	w.runner = &fakeRunner{}
	useRunner(t, w.runner)
	old := harvestWorkers
	harvestWorkers = 1
	t.Cleanup(func() { harvestWorkers = old })
	return w
}

// cliWorld is test_cli.setup: machine "mac", the 田中 alias, token "tok".
func cliWorld(t *testing.T, url string) *world {
	return newWorld(t, url, "machine=\"mac\"\n[requesters]\n\"田中\"=\"田中さん（営業部）\"\n", "api_token=\"tok\"\n")
}

// run is one wl invocation; output collects from a fresh pair of buffers.
func (w *world) run(args ...string) (code int, stdout, stderr string) {
	w.stdout.mu.Lock()
	w.stdout.b.Reset()
	w.stdout.mu.Unlock()
	w.stderr.mu.Lock()
	w.stderr.b.Reset()
	w.stderr.mu.Unlock()
	code = Main(args, w.env)
	return code, w.stdout.String(), w.stderr.String()
}

func (w *world) outbox() string { return filepath.Join(w.home, "outbox") }

func writeFile(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

// jsonFiles are the *.json files directly in dir.
func jsonFiles(t *testing.T, dir string) []string {
	t.Helper()
	m, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func get(t *testing.T, o *pyjson.Object, k string) pyjson.Value {
	t.Helper()
	v, ok := o.Get(k)
	if !ok {
		t.Fatalf("no %q in %s", k, pyjson.Compact(o))
	}
	return v
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
