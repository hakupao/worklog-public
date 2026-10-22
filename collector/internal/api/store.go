package api

import (
	"errors"
	"fmt"
	"time"

	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
)

// ErrUnavailable is api_store.ApiUnavailable: the server could not be read, and callers that need
// the case list must stop rather than guess.
var ErrUnavailable = errors.New("could not read the server's tasks")

var tokyo = time.FixedZone("JST", 9*3600)

// ThisWeek is the ISO week of now in the Asia/Tokyo calendar, as the /api/weeks routes spell it.
func ThisWeek(now time.Time) string {
	y, w := now.In(tokyo).ISOWeek()
	return fmt.Sprintf("%d-W%02d", y, w)
}

// Store is api_store.ApiStore: the Worker is the store, and every record goes over the API or into
// the outbox.
type Store struct {
	client  *Client
	machine string
}

func NewStore(c *Client, machine string) *Store { return &Store{client: c, machine: machine} }

func (s *Store) Tasks() ([]model.Task, error) {
	tasks, ok := s.client.ListTasks()
	if !ok {
		return nil, ErrUnavailable
	}
	return tasks, nil
}

// Append ingests one session under the store's machine name (the session's own machine field is
// not used for the wrapper). The caller must tell the failures apart: Retry is in the outbox and
// will be replayed; Rejected and Lost never will be.
func (s *Store) Append(sess model.Session) (*IngestResult, Outcome) {
	return s.client.Ingest(s.machine, sess, true)
}

// OutboxDir is where the client parks writes (run.client_outbox), for a message that has to tell
// the user where to look.
func (s *Store) OutboxDir() string { return s.client.OutboxDir() }

// UnassignedThisWeek is the number of sessions with no case in now's Tokyo week, or false if the
// server could not answer with an integer. A JSON true, which Python's isinstance(x, int) would
// pass through, is not a number here; the server never sends one.
func (s *Store) UnassignedThisWeek(now time.Time) (int, bool) {
	tl, ok := s.client.WeekTimeline(ThisWeek(now))
	if !ok {
		return 0, false
	}
	n, isInt := tl.Get("unassigned")
	i, isInt2 := n.(pyjson.Int)
	if !isInt || !isInt2 {
		return 0, false
	}
	return int(i), true
}
