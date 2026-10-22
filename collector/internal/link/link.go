// Package link is harvest/link.py: which task a session belongs to (spec §4.11).
package link

import (
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// Candidate is the part of a server task that linking reads.
type Candidate struct {
	ID, Project, Status string
	ReceivedAt          pytime.Date
	DoneAt              *pytime.Date
}

// notAfter is a <= b.
func notAfter(a, b pytime.Date) bool {
	if a.Y != b.Y {
		return a.Y < b.Y
	}
	if a.M != b.M {
		return a.M < b.M
	}
	return a.D <= b.D
}

// inWindow is _in_window: received on or before the session's first day, and not done more than a
// day before its last.
func inWindow(t Candidate, startDate, endDate pytime.Date) bool {
	return notAfter(t.ReceivedAt, startDate) && (t.DoneAt == nil || notAfter(endDate, t.DoneAt.AddDays(1)))
}

// unique is the ID of the only open/done candidate in the window that keep accepts, or nil.
func unique(tasks []Candidate, startDate, endDate pytime.Date, keep func(Candidate) bool) *string {
	var found *string
	n := 0
	for i := range tasks {
		t := &tasks[i]
		if (t.Status == "open" || t.Status == "done") && keep(*t) && inWindow(*t, startDate, endDate) {
			found = &t.ID
			n++
		}
	}
	if n != 1 {
		return nil
	}
	id := *found
	return &id
}

// Decide is decide_core. start/end are the session's first and last message (nil: no messages).
//
//   - auto-dir: cwd is under a [projects] dir (the deepest; on a tie the first in config.toml order)
//     and exactly one open/done task of that project has a window covering the session. A known dir
//     with no unique task is "none", never a guess by time.
//   - auto-time: cwd is under no project dir and exactly one open/done task, of any project, covers
//     the session.
//
// f is the host's path flavour (pypath.HostFlavour(env.GOOS)): Path.relative_to is component-wise,
// and on Windows case-insensitive with / and \ alike. Dates are Tokyo dates.
func Decide(cwd string, start, end *pytime.Instant, tasks []Candidate, projects []config.Project, f pypath.Flavour) (taskID *string, method string) {
	if start == nil || end == nil {
		return nil, "none"
	}
	startDate, endDate := pytime.JSTDate(*start), pytime.JSTDate(*end)

	longest, depth := -1, 0
	for i, p := range projects {
		if !f.RelativeTo(cwd, p.Dir) {
			continue
		}
		// max() keeps the first of equal depths.
		if d := len(f.Parts(p.Dir)); longest < 0 || d > depth {
			longest, depth = i, d
		}
	}
	if longest >= 0 {
		project := projects[longest].Name
		if id := unique(tasks, startDate, endDate, func(t Candidate) bool { return t.Project == project }); id != nil {
			return id, "auto-dir"
		}
		return nil, "none"
	}
	if id := unique(tasks, startDate, endDate, func(Candidate) bool { return true }); id != nil {
		return id, "auto-time"
	}
	return nil, "none"
}
