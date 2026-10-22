package model

import (
	"math"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// Task is models.Task. Its kind is always "task" and is not stored.
type Task struct {
	ID            string
	TS            pytime.Instant
	Machine       string
	SchemaVersion int
	Requester     string
	Project       string
	Title         string
	Status        string // open | done | hold
	ReceivedAt    pytime.Date
	DoneAt        *pytime.Date
	Thinking      string
	Deliverables  []string
	HoursManual   *float64
}

// Session is models.Session. Its kind is always "session".
type Session struct {
	ID              string
	TS              pytime.Instant
	Machine         string
	SchemaVersion   int
	Agent           string // claude-code | codex
	SessionID       string
	Cwd             string
	StartedAt       pytime.Instant
	EndedAt         pytime.Instant
	ActiveMinutes   int
	Turns           int
	Summary         string
	SummarySource   string // llm | fallback
	TaskID          *string
	LinkMethod      string // auto-dir | auto-time | manual | none
	FilesWritten    []string
	Tokens          *pyjson.Object // nil → null
	ActiveIntervals []Interval     // nil → null
	Artifacts       []Artifact     // nil → null, empty → []
}

// Note is models.Note. Its kind is always "note".
type Note struct {
	ID            string
	TS            pytime.Instant
	Machine       string
	SchemaVersion int
	Text          string
	TaskID        *string
	Minutes       *int
}

// NewTask is Task(...) with only the required fields; the rest take pydantic's defaults.
func NewTask(id string, ts pytime.Instant, machine, requester, title string, received pytime.Date) Task {
	return Task{ID: id, TS: ts, Machine: machine, SchemaVersion: 1, Requester: requester, Title: title,
		Status: "open", ReceivedAt: received, Deliverables: []string{}}
}

// NewSession is Session(...) with only the required fields; the rest take pydantic's defaults.
func NewSession(id string, ts pytime.Instant, machine, agent, sessionID, cwd string, started, ended pytime.Instant,
	activeMinutes, turns int, summary string) Session {
	return Session{ID: id, TS: ts, Machine: machine, SchemaVersion: 1, Agent: agent, SessionID: sessionID, Cwd: cwd,
		StartedAt: started, EndedAt: ended, ActiveMinutes: activeMinutes, Turns: turns, Summary: summary,
		SummarySource: "fallback", LinkMethod: "none", FilesWritten: []string{}}
}

// NewNote is Note(...) with only the required fields.
func NewNote(id string, ts pytime.Instant, machine, text string) Note {
	return Note{ID: id, TS: ts, Machine: machine, SchemaVersion: 1, Text: text}
}

// or is v, or the pydantic default def when v holds the Go zero value, which no caller means
// (schema_version 0, an empty Literal): a record built without them serializes as pydantic would.
func or[T comparable](v, def T) T {
	var zero T
	if v == zero {
		return def
	}
	return v
}

// base is _Base's fields, then kind, in pydantic's order.
func base(id string, ts pytime.Instant, machine string, schemaVersion int, kind string) *pyjson.Object {
	o := pyjson.NewObject()
	o.Set("id", id)
	o.Set("ts", ts.Pydantic())
	o.Set("machine", machine)
	o.Set("schema_version", or(schemaVersion, 1))
	o.Set("kind", kind)
	return o
}

func optStr(s *string) pyjson.Value {
	if s == nil {
		return nil
	}
	return *s
}

func strList(l []string) []pyjson.Value {
	out := make([]pyjson.Value, len(l))
	for i, s := range l {
		out[i] = s
	}
	return out
}

// Object is the body json.loads(task.model_dump_json()) gives: every field, pydantic's order,
// None as null. A field left at its Go zero value where pydantic has a default (schema_version,
// status, deliverables) gets that default.
func (t Task) Object() *pyjson.Object {
	o := base(t.ID, t.TS, t.Machine, t.SchemaVersion, "task")
	o.Set("requester", t.Requester)
	o.Set("project", t.Project)
	o.Set("title", t.Title)
	o.Set("status", or(t.Status, "open"))
	o.Set("received_at", t.ReceivedAt.String())
	if t.DoneAt == nil {
		o.Set("done_at", nil)
	} else {
		o.Set("done_at", t.DoneAt.String())
	}
	o.Set("thinking", t.Thinking)
	o.Set("deliverables", strList(t.Deliverables))
	// pydantic writes inf and nan as null (ser_json_inf_nan='null').
	if h := t.HoursManual; h == nil || math.IsNaN(*h) || math.IsInf(*h, 0) {
		o.Set("hours_manual", nil)
	} else {
		o.Set("hours_manual", pyjson.Float(*h))
	}
	return o
}

// Object is json.loads(session.model_dump_json()).
func (s Session) Object() *pyjson.Object {
	o := base(s.ID, s.TS, s.Machine, s.SchemaVersion, "session")
	o.Set("agent", s.Agent)
	o.Set("session_id", s.SessionID)
	o.Set("cwd", s.Cwd)
	o.Set("started_at", s.StartedAt.Pydantic())
	o.Set("ended_at", s.EndedAt.Pydantic())
	o.Set("active_minutes", s.ActiveMinutes)
	o.Set("turns", s.Turns)
	o.Set("summary", s.Summary)
	o.Set("summary_source", or(s.SummarySource, "fallback"))
	o.Set("task_id", optStr(s.TaskID))
	o.Set("link_method", or(s.LinkMethod, "none"))
	o.Set("files_written", strList(s.FilesWritten))
	if s.Tokens == nil {
		o.Set("tokens", nil)
	} else {
		o.Set("tokens", s.Tokens)
	}
	if s.ActiveIntervals == nil {
		o.Set("active_intervals", nil)
	} else {
		iv := make([]pyjson.Value, len(s.ActiveIntervals))
		for i, p := range s.ActiveIntervals {
			iv[i] = []pyjson.Value{p[0].Pydantic(), p[1].Pydantic()}
		}
		o.Set("active_intervals", iv)
	}
	if s.Artifacts == nil {
		o.Set("artifacts", nil)
	} else {
		arts := make([]pyjson.Value, len(s.Artifacts))
		for i, a := range s.Artifacts {
			ao := pyjson.NewObject()
			ao.Set("url", a.URL)
			ao.Set("title", optStr(a.Title))
			ao.Set("artifact_id", optStr(a.ArtifactID))
			ao.Set("ts", a.TS)
			arts[i] = ao
		}
		o.Set("artifacts", arts)
	}
	return o
}

// Object is json.loads(note.model_dump_json()).
func (n Note) Object() *pyjson.Object {
	o := base(n.ID, n.TS, n.Machine, n.SchemaVersion, "note")
	o.Set("text", n.Text)
	o.Set("task_id", optStr(n.TaskID))
	if n.Minutes == nil {
		o.Set("minutes", nil)
	} else {
		o.Set("minutes", *n.Minutes)
	}
	return o
}

// MarshalJSON is model_dump_json(): compact, raw UTF-8, pydantic's field order and nulls.
func (t Task) MarshalJSON() ([]byte, error) { return pyjson.Compact(t.Object()), nil }

// MarshalJSON is model_dump_json().
func (s Session) MarshalJSON() ([]byte, error) { return pyjson.Compact(s.Object()), nil }

// MarshalJSON is model_dump_json().
func (n Note) MarshalJSON() ([]byte, error) { return pyjson.Compact(n.Object()), nil }
