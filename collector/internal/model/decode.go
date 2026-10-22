package model

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// DecodeTask is Task.model_validate(row) in pydantic's lax mode (models.py:13-23), which is what
// list_tasks and get_task run on every server row: exactly as strict, so one row pydantic refuses
// makes ListTasks unavailable here too (Review Focus 6). Unknown keys are dropped.
//
// The datetime and date grammar is pydantic's (speedate), not datetime.fromisoformat: a space, "_"
// or lowercase "t" may separate date and time, seconds are optional, "+0900" is an offset, 7+
// fraction digits are cut, and a number (or a string of one) is a Unix time, in milliseconds above
// 2e10. An int beyond int64 (pyjson.BigInt) is float(n) for hours_manual and an error for the
// datetime and date fields, as in pydantic; as schema_version, which pydantic accepts, it is an
// error here (spec §6 D4). pydantic's own error texts are not ported.
func DecodeTask(v pyjson.Value) (Task, error) {
	row, ok := v.(*pyjson.Object)
	if !ok || row == nil {
		return Task{}, errors.New("Input should be a valid dictionary or instance of Task")
	}
	var t Task
	var errs []string
	fail := func(k string, err error) { errs = append(errs, k+": "+err.Error()) }
	get := func(k string, required bool) (pyjson.Value, bool) {
		x, ok := row.Get(k)
		if !ok && required {
			fail(k, errors.New("Field required"))
		}
		return x, ok
	}
	str := func(k string, required bool, dst *string) {
		if x, ok := get(k, required); ok {
			s, isStr := x.(string)
			if !isStr {
				fail(k, errors.New("Input should be a valid string"))
				return
			}
			*dst = s
		}
	}

	str("id", true, &t.ID)
	if x, ok := get("ts", true); ok {
		ts, err := laxDateTime(x)
		if err != nil {
			fail("ts", err)
		}
		t.TS = ts
	}
	str("machine", true, &t.Machine)
	t.SchemaVersion = 1
	if x, ok := get("schema_version", false); ok {
		n, err := laxInt(x)
		if err != nil {
			fail("schema_version", err)
		}
		t.SchemaVersion = int(n)
	}
	if x, ok := get("kind", false); ok && x != "task" {
		fail("kind", errors.New("Input should be 'task'"))
	}
	str("requester", true, &t.Requester)
	str("project", false, &t.Project)
	str("title", true, &t.Title)
	t.Status = "open"
	if x, ok := get("status", false); ok {
		switch x {
		case "open", "done", "hold":
			t.Status = x.(string)
		default:
			fail("status", errors.New("Input should be 'open', 'done' or 'hold'"))
		}
	}
	if x, ok := get("received_at", true); ok {
		d, err := laxDate(x)
		if err != nil {
			fail("received_at", err)
		}
		t.ReceivedAt = d
	}
	if x, ok := get("done_at", false); ok && x != nil {
		d, err := laxDate(x)
		if err != nil {
			fail("done_at", err)
		}
		t.DoneAt = &d
	}
	str("thinking", false, &t.Thinking)
	t.Deliverables = []string{}
	if x, ok := get("deliverables", false); ok {
		l, isList := x.([]pyjson.Value)
		if !isList {
			fail("deliverables", errors.New("Input should be a valid list"))
		}
		for i, e := range l {
			s, isStr := e.(string)
			if !isStr {
				fail(fmt.Sprintf("deliverables.%d", i), errors.New("Input should be a valid string"))
				continue
			}
			t.Deliverables = append(t.Deliverables, s)
		}
	}
	if x, ok := get("hours_manual", false); ok && x != nil {
		f, err := laxFloat(x)
		if err != nil {
			fail("hours_manual", err)
		}
		t.HoursManual = &f
	}
	if errs != nil {
		return Task{}, fmt.Errorf("%d validation error(s) for Task: %s", len(errs), strings.Join(errs, "; "))
	}
	return t, nil
}

var (
	reIntStr   = regexp.MustCompile(`^[+-]?[0-9](_?[0-9])*(\.0+)?$`)
	reFloatStr = regexp.MustCompile(`^[+-]?([0-9](_?[0-9])*(\.([0-9](_?[0-9])*)?)?|\.[0-9](_?[0-9])*)([eE][+-]?[0-9](_?[0-9])*)?$`)
	reNonFin   = regexp.MustCompile(`^(?i)[+-]?(inf|infinity|nan)$`)
	reEpochStr = regexp.MustCompile(`^[+-]?[0-9]+(\.[0-9]+)?$`)
)

func stripSpace(s string) string { return strings.TrimFunc(s, unicode.IsSpace) }

// laxInt is pydantic's lax int: bool, an integral finite float, or a string of an integer (padded
// with whitespace, "_" between digits, an all-zero fraction allowed). Nothing beyond int64 (a
// BigInt, a float, a string) is an int here (spec §6 D4).
func laxInt(v pyjson.Value) (int64, error) {
	bad := errors.New("Input should be a valid integer")
	switch x := v.(type) {
	case bool:
		if x {
			return 1, nil
		}
		return 0, nil
	case pyjson.Int:
		return int64(x), nil
	case pyjson.Float:
		f := float64(x)
		if math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) || f >= math.MaxInt64 || f < math.MinInt64 {
			return 0, bad
		}
		return int64(f), nil
	case string:
		s := stripSpace(x)
		if !reIntStr.MatchString(s) {
			return 0, bad
		}
		if i := strings.IndexByte(s, '.'); i >= 0 {
			s = s[:i]
		}
		n, err := strconv.ParseInt(strings.ReplaceAll(s, "_", ""), 10, 64)
		if err != nil {
			return 0, bad
		}
		return n, nil
	}
	return 0, bad
}

// laxFloat is pydantic's lax float: bool, int, float, or a string of a decimal number or of
// inf/infinity/nan. A value beyond the float range is ±inf, as Python's float("1e400").
func laxFloat(v pyjson.Value) (float64, error) {
	bad := errors.New("Input should be a valid number")
	switch x := v.(type) {
	case bool:
		if x {
			return 1, nil
		}
		return 0, nil
	case pyjson.Int:
		return float64(x), nil
	case pyjson.BigInt:
		f, err := strconv.ParseFloat(string(x), 64) // float(n), correctly rounded
		if err != nil {
			return 0, bad // beyond the float range: OverflowError
		}
		return f, nil
	case pyjson.Float:
		return float64(x), nil
	case string:
		s := stripSpace(x)
		if reNonFin.MatchString(s) {
			f, _ := strconv.ParseFloat(s, 64)
			return f, nil
		}
		if !reFloatStr.MatchString(s) {
			return 0, bad
		}
		f, err := strconv.ParseFloat(strings.ReplaceAll(s, "_", ""), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return 0, bad
		}
		return f, nil
	}
	return 0, bad
}

var errDateTime = errors.New("Input should be a valid datetime")

// laxDateTime is pydantic's lax datetime: a speedate string or a Unix time (number or string).
func laxDateTime(v pyjson.Value) (pytime.Instant, error) {
	switch x := v.(type) {
	case pyjson.Int, pyjson.Float:
		return epoch(x)
	case string:
		if reEpochStr.MatchString(x) {
			return epochStr(x)
		}
		dt, err := parseSpeedate(x)
		if err != nil {
			return pytime.Instant{}, err
		}
		return dt, nil
	}
	return pytime.Instant{}, errDateTime
}

func epochStr(s string) (pytime.Instant, error) {
	if !strings.Contains(s, ".") {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return pytime.Instant{}, errDateTime
		}
		return epoch(pyjson.Int(n))
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return pytime.Instant{}, errDateTime
	}
	return epoch(pyjson.Float(f))
}

// epoch is speedate's Unix time: seconds, or milliseconds when |v| > 2e10; the fraction rounded to
// microseconds; aware UTC.
func epoch(v pyjson.Value) (pytime.Instant, error) {
	const msAbove = 20_000_000_000
	var sec, usec int64
	switch x := v.(type) {
	case pyjson.Int:
		n := int64(x)
		if n > msAbove || n < -msAbove {
			sec, usec = floorDiv(n, 1000), (n-floorDiv(n, 1000)*1000)*1000
		} else {
			sec = n
		}
	case pyjson.Float:
		f := float64(x)
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return pytime.Instant{}, errDateTime
		}
		if f > msAbove || f < -msAbove {
			f /= 1000
		}
		fl := math.Floor(f)
		sec, usec = int64(fl), int64(math.Round((f-fl)*1e6))
		if usec == 1_000_000 {
			sec, usec = sec+1, 0
		}
	}
	t := time.Unix(sec, usec*1000).UTC()
	if y := t.Year(); y < 1 || y > 9999 {
		return pytime.Instant{}, errDateTime
	}
	return pytime.Instant{T: t, Aware: true}, nil
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// parseSpeedate reads YYYY-MM-DD[(T|t| |_)HH:MM[:SS[(.|,)F+]][Z|z|±HH[:]MM]]. A date alone is
// midnight, naive.
func parseSpeedate(s string) (pytime.Instant, error) {
	b := []byte(s)
	num := func(p, n int) (int, bool) {
		if p+n > len(b) {
			return 0, false
		}
		v := 0
		for _, c := range b[p : p+n] {
			if c < '0' || c > '9' {
				return 0, false
			}
			v = v*10 + int(c-'0')
		}
		return v, true
	}
	y, ok1 := num(0, 4)
	mo, ok2 := num(5, 2)
	d, ok3 := num(8, 2)
	if !ok1 || !ok2 || !ok3 || b[4] != '-' || b[7] != '-' {
		return pytime.Instant{}, errDateTime
	}
	if y < 1 || mo < 1 || mo > 12 || d < 1 || d > time.Date(y, time.Month(mo)+1, 0, 0, 0, 0, 0, time.UTC).Day() {
		return pytime.Instant{}, errDateTime
	}
	if len(b) == 10 {
		return pytime.Instant{T: time.Date(y, time.Month(mo), d, 0, 0, 0, 0, time.UTC)}, nil
	}
	if !strings.ContainsRune("Tt _", rune(b[10])) {
		return pytime.Instant{}, errDateTime
	}
	p := 11
	h, okH := num(p, 2)
	if !okH || p+2 >= len(b) || b[p+2] != ':' {
		return pytime.Instant{}, errDateTime
	}
	mi, okM := num(p+3, 2)
	if !okM || h > 23 || mi > 59 {
		return pytime.Instant{}, errDateTime
	}
	p += 5
	sec, usec := 0, 0
	if p < len(b) && b[p] == ':' {
		var okS bool
		if sec, okS = num(p+1, 2); !okS || sec > 59 {
			return pytime.Instant{}, errDateTime
		}
		p += 3
		if p < len(b) && (b[p] == '.' || b[p] == ',') {
			p++
			start := p
			for p < len(b) && b[p] >= '0' && b[p] <= '9' {
				if p-start < 6 {
					usec = usec*10 + int(b[p]-'0')
				}
				p++
			}
			if p == start {
				return pytime.Instant{}, errDateTime
			}
			for n := p - start; n < 6; n++ {
				usec *= 10
			}
		}
	}
	wall := func(loc *time.Location) time.Time {
		return time.Date(y, time.Month(mo), d, h, mi, sec, usec*1000, loc)
	}
	if p == len(b) {
		return pytime.Instant{T: wall(time.UTC)}, nil
	}
	switch b[p] {
	case 'Z', 'z':
		if p+1 != len(b) {
			return pytime.Instant{}, errDateTime
		}
		return pytime.Instant{T: wall(time.UTC), Aware: true}, nil
	case '+', '-':
		sign := 1
		if b[p] == '-' {
			sign = -1
		}
		oh, okOH := num(p+1, 2)
		q := p + 3
		if q < len(b) && b[q] == ':' {
			q++
		}
		om, okOM := num(q, 2)
		if !okOH || !okOM || q+2 != len(b) || oh > 23 || om > 59 {
			return pytime.Instant{}, errDateTime
		}
		off := sign * (oh*3600 + om*60)
		loc := time.UTC
		if off != 0 {
			loc = time.FixedZone("", off)
		}
		return pytime.Instant{T: wall(loc), Aware: true}, nil
	}
	return pytime.Instant{}, errDateTime
}

// laxDate is pydantic's lax date: YYYY-MM-DD, or a datetime (string or Unix time) whose time is
// exactly midnight; the offset is ignored.
func laxDate(v pyjson.Value) (pytime.Date, error) {
	if _, isBool := v.(bool); isBool {
		return pytime.Date{}, errors.New("Input should be a valid date")
	}
	dt, err := laxDateTime(v)
	if err != nil {
		return pytime.Date{}, errors.New("Input should be a valid date or datetime")
	}
	t := dt.T
	if t.Hour() != 0 || t.Minute() != 0 || t.Second() != 0 || t.Nanosecond() != 0 {
		return pytime.Date{}, errors.New("Datetimes provided to dates should have zero time")
	}
	return pytime.Date{Y: t.Year(), M: t.Month(), D: t.Day()}, nil
}
