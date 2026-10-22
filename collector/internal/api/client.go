// Package api is the collector's side of the Worker API (api_client.py, api_store.py): the HTTP
// client with its outbox and circuit breaker, and the store harvest writes sessions through.
package api

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
)

// Outcome is what became of one write (api_client.py:16-25).
//
//	ok        the server took it.
//	retry     it did not land. With park it is in the outbox and the next flush replays it;
//	          without, nothing was kept and the caller holds the data.
//	rejected  the server refused it. With park it is in outbox/rejected/, a record that is NEVER
//	          replayed.
//	lost      parking itself failed: the record exists nowhere. Never to be mistaken for retry.
//	stale     PostJudgement only: the plan changed under the judgement (409).
//
// Compare with the constants; an Outcome is never a boolean.
type Outcome string

const (
	OK       Outcome = "ok"
	Retry    Outcome = "retry"
	Rejected Outcome = "rejected"
	Lost     Outcome = "lost"
	Stale    Outcome = "stale"
)

// IngestResult is what one accepted ingest did on the server.
type IngestResult struct{ Inserted, Updated int }

// Lookup is the answer of a read that tells "the server has none" (a JSON 404) apart from "the
// server could not be asked".
type Lookup int

const (
	Found Lookup = iota
	Missing
	Unavailable
)

// ClientConfig is what NewClient needs from the config. Empty AccessID/AccessSecret mean None.
type ClientConfig struct{ URL, Token, AccessID, AccessSecret, OutboxDir, Version string }

// Client is api_client.ApiClient. It is safe for concurrent use: harvest writes from several
// workers, as Python's threads did.
type Client struct {
	base   string
	header http.Header
	outbox string
	env    *rt.Env
	long   *http.Client // 10 s phases
	short  *http.Client // 4 s phases

	mu sync.Mutex
	// offline is the per-process circuit breaker: the first transport-level failure (connect, DNS,
	// timeout, TLS, a dropped connection) proves the API unreachable, and every later call goes
	// straight to parking or the local fallback. An HTTP status, any status, never opens it.
	offline bool
	// lastPark is the highest outbox stamp this process has handed out; see parkName.
	lastPark int64

	// File operations of the outbox, replaceable by tests.
	remove func(string) error
	rename func(string, string) error
}

// retryable4xx are auth and throttling failures: configuration or transient problems, so the data
// is kept and retried (api_client.py:28).
func retryable4xx(status int) bool {
	return status == 401 || status == 403 || status == 408 || status == 429
}

func NewClient(cc ClientConfig, env *rt.Env) *Client {
	version := cc.Version
	if version == "" {
		version = "0"
	}
	h := http.Header{}
	h.Set("Authorization", "Bearer "+cc.Token)
	// Cloudflare answers default library user agents with error 1010.
	h.Set("User-Agent", "worklog-cli/"+version+" (go)")
	h.Set("Accept", "*/*") // httpx's default header; net/http sends none
	if cc.AccessID != "" && cc.AccessSecret != "" {
		h.Set("CF-Access-Client-Id", cc.AccessID)
		h.Set("CF-Access-Client-Secret", cc.AccessSecret)
	}
	proxy := envProxy(env)
	return &Client{
		base:   strings.TrimRight(cc.URL, "/"),
		header: h,
		outbox: cc.OutboxDir,
		env:    env,
		long:   newHTTP(defaultTimeout, proxy),
		short:  newHTTP(interactiveTimeout, proxy),
		remove: os.Remove,
		rename: os.Rename,
	}
}

func (c *Client) OutboxDir() string { return c.outbox }

func (c *Client) isOffline() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.offline
}

// response is an answer read in full, as httpx reads it inside request().
type response struct {
	status int
	ctype  string
	body   []byte
}

func (r *response) isJSON() bool { return strings.Contains(strings.ToLower(r.ctype), "json") }

func (r *response) decode() (pyjson.Value, bool) {
	v, err := pyjson.Decode(r.body)
	return v, err == nil
}

// noBody is the absent json= argument; a nil pyjson.Value is JSON null.
type noBody struct{}

// do sends one request and reads the whole answer. Any error, including one while reading the
// body, is a transport error: it opens the breaker and returns nil.
func (c *Client) do(method, path string, body pyjson.Value, interactive bool) *response {
	var rd io.Reader
	_, absent := body.(noBody)
	if !absent {
		rd = bytes.NewReader(pyjson.Compact(body))
	}
	req, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		c.trip()
		return nil
	}
	req.Header = c.header.Clone()
	if !absent {
		req.Header.Set("Content-Type", "application/json")
	}
	hc := c.long
	if interactive {
		hc = c.short
	}
	resp, err := hc.Do(req)
	if err != nil {
		c.trip()
		return nil
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		c.trip()
		return nil
	}
	return &response{status: resp.StatusCode, ctype: resp.Header.Get("Content-Type"), body: data}
}

func (c *Client) trip() {
	c.mu.Lock()
	c.offline = true
	c.mu.Unlock()
}

// try is _try: OK (with the response), Retry or Rejected. Never parks.
func (c *Client) try(method, path string, body pyjson.Value) (Outcome, *response) {
	if c.isOffline() {
		return Retry, nil
	}
	r := c.do(method, path, body, false)
	if r == nil {
		return Retry, nil
	}
	if r.status < 300 {
		// Cloudflare Access answers an unauthenticated request with 200 and its login page. Every
		// write endpoint replies in JSON, so anything else on a 2xx never reached the Worker.
		if !r.isJSON() {
			return Retry, nil
		}
		return OK, r
	}
	if r.status >= 400 && r.status < 500 && !retryable4xx(r.status) {
		return Rejected, nil
	}
	return Retry, nil
}

// sendR is _send: the outcome, plus the response on OK. Anything else is parked when park is set;
// a park that fails is Lost.
func (c *Client) sendR(method, path string, body pyjson.Value, park bool) (Outcome, *response) {
	out, r := c.try(method, path, body)
	if out != OK && park && !c.park(method, path, body, out == Rejected) {
		return Lost, nil
	}
	return out, r
}

func (c *Client) send(method, path string, body pyjson.Value, park bool) Outcome {
	out, _ := c.sendR(method, path, body, park)
	return out
}

// getJSON is _get_json: the parsed body of an interactive GET, or false if it cannot be had for
// ANY reason. Any non-2xx fails (raise_for_status); the Content-Type is not looked at.
func (c *Client) getJSON(path string) (pyjson.Value, bool) {
	if c.isOffline() {
		return nil, false
	}
	r := c.do("GET", path, noBody{}, true)
	if r == nil || r.status < 200 || r.status >= 300 {
		return nil, false
	}
	return r.decode()
}

func (c *Client) getObject(path string) (*pyjson.Object, bool) {
	v, ok := c.getJSON(path)
	o, isObj := v.(*pyjson.Object)
	if !ok || !isObj {
		return nil, false
	}
	return o, true
}

// pyInt is int(x) on a decoded JSON value; false where Python raises (None, "", a list, a dict,
// "1.5", NaN). An infinite float, where Python raises OverflowError, is false too.
func pyInt(v pyjson.Value) (int, bool) {
	switch x := v.(type) {
	case nil, []pyjson.Value, *pyjson.Object:
		return 0, false
	case string:
		if x == "" {
			return 0, false
		}
	}
	n, ok := session.ToInt(v)
	return int(n), ok
}

// countField is int(r.json()[key]); false when anything on the way fails.
func countField(r *response, key string) (int, bool) {
	v, ok := r.decode()
	o, isObj := v.(*pyjson.Object)
	if !ok || !isObj {
		return 0, false
	}
	x, has := o.Get(key)
	if !has {
		return 0, false
	}
	return pyInt(x)
}

// truthy is Python's bool(x) on a decoded JSON value.
func truthy(v pyjson.Value) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case pyjson.Int:
		return x != 0
	case pyjson.BigInt:
		return pyjson.Truthy(x)
	case pyjson.Float:
		return x != 0
	case string:
		return x != ""
	case []pyjson.Value:
		return len(x) > 0
	case *pyjson.Object:
		return x.Len() > 0
	}
	return true
}

func (c *Client) PutTask(t model.Task, park bool) Outcome {
	return c.send("PUT", "/api/tasks/"+t.ID, t.Object(), park)
}

func (c *Client) PutNote(n model.Note, park bool) Outcome {
	return c.send("PUT", "/api/notes/"+n.ID, n.Object(), park)
}

// Ingest posts one session (always exactly one per request, api_store.py:44). On OK the server's
// counts come back; counts it cannot read are (0, 0), because the session did land.
func (c *Client) Ingest(machine string, s model.Session, park bool) (*IngestResult, Outcome) {
	body := pyjson.NewObject()
	body.Set("machine", machine)
	body.Set("sessions", []pyjson.Value{s.Object()})
	out, r := c.sendR("POST", "/api/ingest/sessions", body, park)
	if out != OK {
		return nil, out
	}
	ins, ok1 := countField(r, "inserted")
	upd, ok2 := countField(r, "updated")
	if !ok1 || !ok2 {
		return &IngestResult{}, OK
	}
	return &IngestResult{Inserted: ins, Updated: upd}, OK
}

func objects(l []*pyjson.Object) []pyjson.Value {
	out := make([]pyjson.Value, len(l))
	for i, o := range l {
		out[i] = o
	}
	return out
}

// PutSessionMeta replaces files_written, tokens, active_intervals and artifacts on sessions the
// server has. Never parked: it is a re-runnable refresh. The count is 0 when unreadable.
func (c *Client) PutSessionMeta(items []*pyjson.Object) (int, Outcome) {
	body := pyjson.NewObject()
	body.Set("sessions", objects(items))
	out, r := c.sendR("POST", "/api/ingest/session-meta", body, false)
	if out != OK {
		return 0, out
	}
	n, _ := countField(r, "updated")
	return n, OK
}

// Heartbeat is heartbeat: tell the server this harvest ran. Never parked: a beat replayed later would
// light the wrong hour, and a missed hour should stay dark.
func (c *Client) Heartbeat(machine string, newN, updated int) Outcome {
	body := pyjson.NewObject()
	body.Set("machine", machine)
	body.Set("new", newN)
	body.Set("updated", updated)
	return c.send("POST", "/api/ingest/heartbeat", body, false)
}

// ListTasks is list_tasks: the server's tasks in its order, or false if they cannot be had for
// ANY reason, one row failing validation included. As in {t.id: t for t in ...}, a repeated id
// keeps its first place and its last row.
func (c *Client) ListTasks() ([]model.Task, bool) {
	v, ok := c.getJSON("/api/tasks")
	rows, isList := v.([]pyjson.Value)
	if !ok || !isList {
		return nil, false
	}
	out := make([]model.Task, 0, len(rows))
	at := map[string]int{}
	for _, row := range rows {
		t, err := model.DecodeTask(row)
		if err != nil {
			return nil, false
		}
		if i, seen := at[t.ID]; seen {
			out[i] = t
			continue
		}
		at[t.ID] = len(out)
		out = append(out, t)
	}
	return out, true
}

// GetTask is get_task: payload["task"] of GET /api/tasks/{id}.
func (c *Client) GetTask(id string) (model.Task, bool) {
	o, ok := c.getObject("/api/tasks/" + id)
	if !ok {
		return model.Task{}, false
	}
	row, has := o.Get("task")
	if !has {
		return model.Task{}, false
	}
	t, err := model.DecodeTask(row)
	if err != nil {
		return model.Task{}, false
	}
	return t, true
}

func (c *Client) WeekTimeline(week string) (*pyjson.Object, bool) {
	return c.getObject("/api/weeks/" + week + "/timeline")
}

// Dashboard is the statistics for an inclusive Tokyo date range.
func (c *Client) Dashboard(from, to pytime.Date) (*pyjson.Object, bool) {
	return c.getObject("/api/dashboard?from=" + from.String() + "&to=" + to.String())
}

// lookup is the shared body of review and judge_input: a JSON 404 whose error is missingErr is
// Missing; a 200 object is Found; anything else, including a non-JSON answer, is Unavailable.
func (c *Client) lookup(path, missingErr string) (*pyjson.Object, Lookup) {
	if c.isOffline() {
		return nil, Unavailable
	}
	r := c.do("GET", path, noBody{}, true)
	if r == nil || !r.isJSON() {
		return nil, Unavailable
	}
	v, ok := r.decode()
	o, isObj := v.(*pyjson.Object)
	if !ok {
		return nil, Unavailable
	}
	switch r.status {
	case 404:
		// Python's review() calls .get on whatever the 404 body is and crashes on a non-object;
		// that case is Unavailable here.
		if isObj {
			if e, _ := o.Get("error"); e == missingErr {
				return nil, Missing
			}
		}
	case 200:
		if isObj {
			return o, Found
		}
	}
	return nil, Unavailable
}

// Review is the stored review of a week. A 404 is Missing only in JSON: the HTML 404 of a Worker
// without the route, or Access's login page, must not look like "go ahead and write".
func (c *Client) Review(week string) (*pyjson.Object, Lookup) {
	return c.lookup("/api/reviews/"+week, "no review")
}

// PutReview posts a review; stored is false when the server kept an existing one. Never parked.
func (c *Client) PutReview(body *pyjson.Object) (stored bool, out Outcome) {
	out, r := c.sendR("POST", "/api/reviews", body, false)
	if out != OK {
		return false, out
	}
	v, ok := r.decode()
	o, isObj := v.(*pyjson.Object)
	if !ok || !isObj {
		// Python: an unreadable body is retry; a JSON body that is not an object raises
		// AttributeError (uncaught). Go reports both as not landed.
		return false, Retry
	}
	s, _ := o.Get("stored")
	return truthy(s), OK
}

// JudgeInput is the day's judge input; Missing when the day has no plan (JSON 404).
func (c *Client) JudgeInput(day pytime.Date) (*pyjson.Object, Lookup) {
	return c.lookup("/api/day-plans/"+day.String()+"/judge-input", "no plan")
}

// PostJudgement stores a day's judgement: OK on 200, Stale on 409, Rejected on another
// non-retryable 4xx, otherwise Retry. Never parked: the next harvest recomputes it.
func (c *Client) PostJudgement(day pytime.Date, body *pyjson.Object) Outcome {
	if c.isOffline() {
		return Retry
	}
	r := c.do("POST", "/api/day-plans/"+day.String()+"/judgement", body, false)
	if r == nil || !r.isJSON() {
		return Retry
	}
	switch {
	case r.status == 200:
		return OK
	case r.status == 409:
		return Stale
	case r.status >= 400 && r.status < 500 && !retryable4xx(r.status):
		return Rejected
	}
	return Retry
}

// DeliverablePending is this machine's files waiting for a 成果物 verdict ({items, total}). The
// machine is spelled as urllib.parse.quote spells it.
func (c *Client) DeliverablePending(machine string, limit int) (*pyjson.Object, bool) {
	return c.getObject("/api/ingest/deliverables/pending?machine=" + pypath.Quote(machine) + "&limit=" + strconv.Itoa(limit))
}

// PostDeliverableVerdicts returns how many verdicts were stored (0 when unreadable). Never parked.
func (c *Client) PostDeliverableVerdicts(v []*pyjson.Object) (int, Outcome) {
	body := pyjson.NewObject()
	body.Set("verdicts", objects(v))
	out, r := c.sendR("POST", "/api/ingest/deliverables/verdicts", body, false)
	if out != OK {
		return 0, out
	}
	n, _ := countField(r, "inserted")
	return n, OK
}

// CreateTask posts a new case under the interactive timeout and returns the id the server
// allocated, which must be a non-empty string. Never parked.
func (c *Client) CreateTask(requester, title, project string, received pytime.Date, machine string) (string, bool) {
	if c.isOffline() {
		return "", false
	}
	body := pyjson.NewObject()
	body.Set("requester", requester)
	body.Set("title", title)
	body.Set("project", project)
	body.Set("received_at", received.String())
	body.Set("machine", machine)
	r := c.do("POST", "/api/tasks", body, true)
	if r == nil || r.status < 200 || r.status >= 300 {
		return "", false
	}
	v, ok := r.decode()
	o, isObj := v.(*pyjson.Object)
	if !ok || !isObj {
		return "", false
	}
	id, _ := o.Get("id")
	s, isStr := id.(string)
	if !isStr || s == "" {
		return "", false
	}
	return s, true
}
