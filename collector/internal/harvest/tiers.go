package harvest

import (
	"fmt"
	"time"
)

// jst is Asia/Tokyo; every bucket is read on its clock (spec §5.3).
var jst = time.FixedZone("JST", 9*3600)

// HourBucket is the JST hour of t, "2026-10-20T14".
func HourBucket(t time.Time) string { return t.In(jst).Format("2006-01-02T15") }

// DayBucket is the JST date of t−5h: the day starts at 05:00 (O4b).
func DayBucket(t time.Time) string { return t.Add(-5 * time.Hour).In(jst).Format("2006-01-02") }

// WeekBucket is the ISO week of t's JST date, "2026-W43".
func WeekBucket(t time.Time) string {
	y, w := t.In(jst).ISOWeek()
	return fmt.Sprintf("%d-W%02d", y, w)
}

// Due is which tiers and side jobs a run does (spec §5.3).
type Due struct{ Hour, Review, PlanToday, PlanYesterday, Deliverables, Rescan bool }

// DueJobs compares each job's recorded bucket with now's. The review also waits out the hour of
// its last failed attempt (review_tried), so it is tried at most once an hour.
func DueJobs(cs *CollectorState, now time.Time) Due {
	hour, day := HourBucket(now), DayBucket(now)
	return Due{
		Hour:          hour != cs.Jobs["hour"],
		Review:        WeekBucket(now) != cs.Jobs["review"] && hour != cs.Jobs["review_tried"],
		PlanToday:     hour != cs.Jobs["plan_today"],
		PlanYesterday: day != cs.Jobs["plan_yesterday"],
		Deliverables:  hour != cs.Jobs["deliverables"],
		Rescan:        day != cs.Jobs["rescan"],
	}
}

// AllDue is full mode: every tier is due.
func AllDue() Due { return Due{true, true, true, true, true, true} }

// ResultPanic is the result word of a side job whose guard caught a panic (where Python raises). It
// is not a word any job returns; §5.3 has no row for it, so it counts as a failed attempt: the hourly
// and daily jobs record it, the review records review_tried.
const ResultPanic = "panic"

// Record applies the §5.3 table to one job result at now: unreachable records nothing, except that a
// review that did not finish records review_tried; every other result records the job's bucket.
func Record(cs *CollectorState, now time.Time, job, result string) {
	if job == "review" {
		switch result {
		case "stored", "exists", "no-data", "rejected":
			cs.Jobs["review"] = WeekBucket(now)
		default: // unreachable, llm-failed, panic
			cs.Jobs["review_tried"] = HourBucket(now)
		}
		return
	}
	if result == "unreachable" && job != "hour" {
		return
	}
	switch job {
	case "hour", "plan_today", "deliverables":
		cs.Jobs[job] = HourBucket(now)
	case "plan_yesterday", "rescan":
		cs.Jobs[job] = DayBucket(now)
	}
}
