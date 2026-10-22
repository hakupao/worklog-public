package cli

import (
	"path/filepath"
	"regexp"
	"slices"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// today is date.today(): the local date of the clock.
func today(env *rt.Env) pytime.Date {
	t := env.NowLocal()
	return pytime.Date{Y: t.Year(), M: t.Month(), D: t.Day()}
}

// now is datetime.now(): naive local time, to the microsecond.
func now(env *rt.Env) pytime.Instant { return pytime.Naive(env.NowLocal()) }

var requesterSep = regexp.MustCompile(`[、,，]`)

// resolveRequester is _resolve_requester: several 依頼元 are one string joined by "、" (the server
// splits on 、 , ，), so each part is resolved on its own and the result re-joined.
func resolveRequester(cfg *config.Config, env *rt.Env, requester string) string {
	var names []string
	for _, part := range requesterSep.Split(requester, -1) {
		part = pystr.Strip(part)
		if part == "" {
			continue
		}
		if canon, ok := cfg.Requesters[part]; ok {
			part = canon
		} else {
			env.Warnf("warning: unknown requester alias '%s', saving as-is", part)
		}
		if !slices.Contains(names, part) {
			names = append(names, part)
		}
	}
	if len(names) == 0 {
		return requester
	}
	joined := names[0]
	for _, n := range names[1:] {
		joined += "、" + n
	}
	return joined
}

// requireTask is _require_task: the server's copy of the case, or exit 1. GetTask cannot tell a
// 404 from an unreachable server, and for an edit both mean there is nothing safe to build on.
func requireTask(c *api.Client, env *rt.Env, id string) (model.Task, bool) {
	t, ok := c.GetTask(id)
	if !ok {
		env.Warnf("error: unknown task id '%s' (or the server could not be reached)", id)
	}
	return t, ok
}

// saveTask is _save_task: write an edit, or fail without leaving one queued. park=false on purpose:
// a parked edit plus a non-zero exit would replay on the next harvest and undo what the user did
// on the strength of the error.
func saveTask(c *api.Client, env *rt.Env, t model.Task) int {
	if c.PutTask(t, false) != api.OK {
		env.Warnf("error: the server did not accept the update to '%s'", t.ID)
		return 1
	}
	return 0
}

func runNew(env *rt.Env, p *parsed) int {
	cfg, c, code := setup(env)
	if code != 0 {
		return code
	}
	canonical := resolveRequester(cfg, env, p.args[0])
	received := today(env)
	if s, _ := p.last("--received"); s != "" {
		d, err := pytime.ParseDate(s)
		if err != nil {
			// D13: Python raises here, after config and client setup (traceback, exit 1).
			env.Warnf("error: --received must look like 2026-10-02")
			return 1
		}
		received = d
	}
	project, _ := p.last("--project")
	id, ok := c.CreateTask(canonical, p.args[1], project, received, cfg.Machine)
	if !ok {
		// CreateTask never parks (an id can only come from the server), and it cannot tell an
		// unreachable server from a refused request, so the message claims neither.
		env.Warnf("error: the case was not created; the server did not answer or refused the request")
		return 1
	}
	out(env, "%s", id)
	return 0
}

func runDone(env *rt.Env, p *parsed) int {
	var hours *float64
	if s, ok := p.last("--hours"); ok {
		// min=0: checked before anything else, as click checks it while parsing.
		h, uerr := minZeroFloat("wl done", "--hours", s)
		if uerr != nil {
			return usage(env, uerr, false)
		}
		hours = &h
	}
	cfg, c, code := setup(env)
	if code != 0 {
		return code
	}
	task, ok := requireTask(c, env, p.args[0])
	if !ok {
		return 1
	}
	task.Status = "done"
	d := today(env)
	task.DoneAt = &d
	task.Deliverables = append(slices.Clone(task.Deliverables), p.vals["--deliverable"]...)
	if hours != nil {
		task.HoursManual = hours
	}
	task.TS = now(env)
	task.Machine = cfg.Machine
	return saveTask(c, env, task)
}

func runHold(env *rt.Env, p *parsed) int {
	cfg, c, code := setup(env)
	if code != 0 {
		return code
	}
	task, ok := requireTask(c, env, p.args[0])
	if !ok {
		return 1
	}
	task.Status = "hold"
	task.TS = now(env)
	task.Machine = cfg.Machine
	return saveTask(c, env, task)
}

// noteID is _note_id: two notes written in the same second collided on real data, so the id
// carries a random tail as well as the timestamp.
func noteID(env *rt.Env) string {
	return "N" + env.NowLocal().Format("20060102-150405") + "-" + noteTail()
}

func runNote(env *rt.Env, p *parsed) int {
	var minutes *int
	if s, ok := p.last("--minutes"); ok {
		m, uerr := intOpt("wl note", "--minutes", s)
		if uerr != nil {
			return usage(env, uerr, false)
		}
		minutes = &m
	}
	cfg, c, code := setup(env)
	if code != 0 {
		return code
	}
	var target *string
	if p.args[0] != "-" {
		target = &p.args[0]
	}
	text := p.args[1]

	// A note against a case is two writes: the note row, and the same text appended to the case's
	// thinking (備考 in the weekly report). The case is read first: one GET that both supplies the
	// copy to append to and validates the id, which PUT /api/notes does not.
	var task model.Task
	haveTask := false
	if target != nil {
		task, haveTask = c.GetTask(*target)
		// GetTask answers false for a missing case and an unreachable server alike; the list tells
		// them apart: if it comes back, the server is up and the id is simply wrong.
		if !haveTask {
			if _, up := c.ListTasks(); up {
				env.Warnf("error: unknown task id '%s'", *target)
				return 1
			}
		}
	}

	record := model.NewNote(noteID(env), now(env), cfg.Machine, text)
	record.TaskID = target
	record.Minutes = minutes
	outbox := filepath.Join(cfg.Home, "outbox")
	switch c.PutNote(record, true) {
	case api.Lost:
		env.Warnf("error: note %s could not be written to %s (disk full or read-only?); it was NOT saved anywhere", record.ID, outbox)
		return 1
	case api.Rejected:
		env.Warnf("error: the server rejected note %s; it was moved to %s and will not be sent again", record.ID, filepath.Join(outbox, "rejected"))
		return 1
	case api.Retry:
		env.Warnf("worklog: server unreachable; note %s is queued in %s and will be sent by the next wl harvest", record.ID, outbox)
	}

	if target == nil {
		return 0
	}
	if !haveTask {
		env.Warnf("worklog: could not read '%s', so its 備考 was not updated; the note itself is saved, and the text can be added on the web", *target)
		return 0
	}
	prefix := ""
	if task.Thinking != "" {
		prefix = "\n"
	}
	task.Thinking = task.Thinking + prefix + "- " + text
	task.TS = now(env)
	task.Machine = cfg.Machine
	// park=false: PUT /api/tasks/:id replaces the whole row with no version check, so a parked copy
	// replayed later would roll back anything done in between. Never "queued"; the note itself is
	// safe, so this is not a failure of the command.
	if c.PutTask(task, false) != api.OK {
		env.Warnf("worklog: 備考 was not written for %s; the note itself is saved, so add the text on the web rather than re-running wl note", *target)
	}
	return 0
}

func runLs(env *rt.Env, p *parsed) int {
	_, c, code := setup(env)
	if code != 0 {
		return code
	}
	tasks, ok := c.ListTasks()
	if !ok {
		env.Warnf("error: could not read the cases from the server")
		return 1
	}
	out(env, "id | 依頼元 | project | 状態 | 受領日 | 案件名")
	for _, t := range tasks {
		if !p.flags["--all"] && t.Status != "open" && t.Status != "hold" {
			continue
		}
		out(env, "%s | %s | %s | %s | %s | %s", t.ID, t.Requester, t.Project, t.Status, t.ReceivedAt, t.Title)
	}
	return 0
}
