// Package pytime reproduces the Python datetime, float and rounding behaviour that reaches the
// wire, the prompts and the fingerprint (spec §5.3–§5.5, §5.9).
package pytime

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Instant is a Python datetime at microsecond precision. An aware one keeps its UTC offset as T's
// fixed zone; a naive one (Aware false) keeps its wall time in UTC.
type Instant struct {
	T     time.Time
	Aware bool
}

// FromISO is claude_code._parse_timestamp: datetime.fromisoformat(s.replace("Z", "+00:00")) of
// CPython 3.14, ported from _datetimemodule.c, so the same strings are accepted, fractions of any
// length are truncated (not rounded) to microseconds, and errors carry Python's messages.
//
// One divergence (spec §6 D15): a UTC offset with a fraction of a second ("+09:00:00.5") is an
// error here, because a Go zone offset is whole seconds.
func FromISO(s string) (Instant, error) {
	s = strings.ReplaceAll(s, "Z", "+00:00")
	r, err := parseISO(s)
	if err != nil {
		return Instant{}, err
	}
	t := time.Date(r.year, time.Month(r.month), r.day, r.hour, r.minute, r.second, r.usec*1000, time.UTC)
	if !r.aware {
		return Instant{T: t}, nil
	}
	loc := time.UTC
	if r.tzoff != 0 {
		loc = time.FixedZone("", r.tzoff)
	}
	// The wall time was given in the offset's zone.
	return Instant{T: time.Date(r.year, time.Month(r.month), r.day, r.hour, r.minute, r.second, r.usec*1000, loc), Aware: true}, nil
}

// Naive is datetime.now() from a clock reading (rt.Env.NowLocal): the wall time, no offset, cut to µs.
func Naive(t time.Time) Instant {
	y, mo, d := t.Date()
	h, mi, s := t.Clock()
	return Instant{T: time.Date(y, mo, d, h, mi, s, t.Nanosecond()/1000*1000, time.UTC)}
}

// Before orders two instants. Aware ones compare as instants, naive ones by wall time; a naive one
// against an aware one is taken as UTC (spec §6 D3, where Python raises TypeError).
func (i Instant) Before(j Instant) bool { return i.T.Before(j.T) }

// ISOFormat is datetime.isoformat(): "+00:00" for UTC (never "Z"), seconds in the offset only when
// non-zero, a 6-digit fraction only when the microseconds are non-zero.
func (i Instant) ISOFormat() string {
	s := i.wall()
	if !i.Aware {
		return s
	}
	_, off := i.T.Zone()
	sign := byte('+')
	if off < 0 {
		sign, off = '-', -off
	}
	s += fmt.Sprintf("%c%02d:%02d", sign, off/3600, off/60%60)
	if off%60 != 0 {
		s += fmt.Sprintf(":%02d", off%60)
	}
	return s
}

// Pydantic is the spelling model_dump_json gives a datetime: "Z" for a zero offset, else ±HH:MM
// with any seconds of the offset dropped; naive has no offset.
func (i Instant) Pydantic() string {
	s := i.wall()
	if !i.Aware {
		return s
	}
	_, off := i.T.Zone()
	if off == 0 {
		return s + "Z"
	}
	sign := byte('+')
	if off < 0 {
		sign, off = '-', -off
	}
	return s + fmt.Sprintf("%c%02d:%02d", sign, off/3600, off/60%60)
}

func (i Instant) wall() string {
	t := i.T
	s := fmt.Sprintf("%04d-%02d-%02dT%02d:%02d:%02d", t.Year(), int(t.Month()), t.Day(), t.Hour(), t.Minute(), t.Second())
	if us := t.Nanosecond() / 1000; us != 0 {
		s += fmt.Sprintf(".%06d", us)
	}
	return s
}

type isoResult struct {
	year, month, day, hour, minute, second, usec int
	aware                                        bool
	tzoff                                        int // seconds
}

func invalidISO(s string) error {
	return errors.New("Invalid isoformat string: " + pyRepr(s))
}

// parseISO is datetime_fromisoformat. b carries a trailing NUL so the C code's reads past a
// field (which stop at the terminator) port one to one.
func parseISO(s string) (isoResult, error) {
	var r isoResult
	if utf8.RuneCountInString(s) < 7 || !utf8.ValidString(s) {
		return r, invalidISO(s)
	}
	n := len(s)
	b := append([]byte(s), 0)
	sep := findSeparator(b, n)
	if sep < 0 {
		return r, invalidISO(s)
	}
	rv := parseDate(b, sep, &r.year, &r.month, &r.day)
	if rv == 0 && n > sep {
		// The separator is any one character; skip its UTF-8 bytes.
		p := sep
		switch {
		case b[p]&0x80 == 0:
			p++
		case b[p]&0xf0 == 0xe0:
			p += 3
		case b[p]&0xf0 == 0xf0:
			p += 4
		default:
			p += 2
		}
		if p > n {
			return r, invalidISO(s)
		}
		var tzusec int
		rv = parseTime(b, p, n, &r, &tzusec)
		if rv == 1 {
			if tzusec != 0 {
				return r, errors.New("unsupported: a UTC offset with a fraction of a second: " + pyRepr(s))
			}
			if r.tzoff <= -86400 || r.tzoff >= 86400 {
				return r, fmt.Errorf("offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24), not %s", timedeltaRepr(r.tzoff))
			}
			r.aware = true
		}
	}
	if rv < 0 {
		return r, invalidISO(s)
	}
	if r.hour == 24 && r.month <= 12 {
		if dim := daysIn(r.year, r.month); r.day <= dim {
			if r.minute != 0 || r.second != 0 || r.usec != 0 {
				return r, errors.New("minute, second, and microsecond must be 0 when hour is 24")
			}
			r.hour = 0
			r.day++
			if r.day > dim {
				r.day = 1
				r.month++
				if r.month > 12 {
					r.month = 1
					r.year++
				}
			}
		}
	}
	if err := checkDate(r.year, r.month, r.day); err != nil {
		return r, err
	}
	if err := checkTime(r.hour, r.minute, r.second, r.usec); err != nil {
		return r, err
	}
	return r, nil
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// parseDigits is parse_digits: exactly k ASCII digits from b[p:], or ok false.
func parseDigits(b []byte, p int, v *int, k int) (int, bool) {
	for i := 0; i < k; i++ {
		c := b[p]
		p++
		if !isDigit(c) {
			return p, false
		}
		*v = *v*10 + int(c-'0')
	}
	return p, true
}

// findSeparator is _find_isoformat_datetime_separator.
func findSeparator(b []byte, n int) int {
	if n == 7 {
		return 7
	}
	if b[4] == '-' {
		if b[5] != 'W' {
			return 10 // YYYY-MM-DD
		}
		if n < 8 {
			return -1
		}
		if n > 8 && b[8] == '-' {
			if n == 9 {
				return -1
			}
			if n > 10 && isDigit(b[10]) {
				return 8
			}
			return 10
		}
		return 8
	}
	if b[4] == 'W' {
		idx := 7
		for ; idx < n; idx++ {
			if !isDigit(b[idx]) {
				break
			}
		}
		if idx < 9 {
			return idx
		}
		if idx%2 == 0 {
			return 7
		}
		return 8
	}
	return 8 // YYYYMMDD
}

// parseDate is parse_isoformat_date over b[:n] (n = the separator's position).
func parseDate(b []byte, n int, year, month, day *int) int {
	p, ok := parseDigits(b, 0, year, 4)
	if !ok {
		return -1
	}
	usesSep := b[p] == '-'
	if usesSep {
		p++
	}
	if b[p] == 'W' {
		p++
		week, wday := 0, 0
		if p, ok = parseDigits(b, p, &week, 2); !ok {
			return -3
		}
		if p < n {
			if usesSep {
				c := b[p]
				p++
				if c != '-' {
					return -2
				}
			}
			if _, ok = parseDigits(b, p, &wday, 1); !ok {
				return -4
			}
		} else {
			wday = 1
		}
		if rv := isoToYMD(*year, week, wday, year, month, day); rv != 0 {
			return -3 + rv
		}
		return 0
	}
	if p, ok = parseDigits(b, p, month, 2); !ok {
		return -1
	}
	if usesSep {
		c := b[p]
		p++
		if c != '-' {
			return -2
		}
	}
	if _, ok = parseDigits(b, p, day, 2); !ok {
		return -1
	}
	return 0
}

// isoToYMD is iso_to_ymd.
func isoToYMD(isoYear, week, wday int, year, month, day *int) int {
	if isoYear < 1 || isoYear > 9999 {
		return -4
	}
	jan1 := time.Date(isoYear, time.January, 1, 0, 0, 0, 0, time.UTC)
	firstWeekday := (int(jan1.Weekday()) + 6) % 7 // Monday = 0
	if week <= 0 || week >= 53 {
		leap := daysIn(isoYear, 2) == 29
		if !(week == 53 && (firstWeekday == 3 || (firstWeekday == 2 && leap))) {
			return -2
		}
	}
	if wday <= 0 || wday >= 8 {
		return -3
	}
	off := -firstWeekday
	if firstWeekday > 3 {
		off += 7
	}
	t := jan1.AddDate(0, 0, off+(week-1)*7+wday-1)
	*year, *month, *day = t.Year(), int(t.Month()), t.Day()
	return 0
}

// parseHMSF is parse_hh_mm_ss_ff over b[p:end].
func parseHMSF(b []byte, p, end int, hour, minute, second, usec *int) int {
	*hour, *minute, *second, *usec = 0, 0, 0, 0
	vals := [3]*int{hour, minute, second}
	hasSep := true
	for i := 0; i < 3; i++ {
		var ok bool
		if p, ok = parseDigits(b, p, vals[i], 2); !ok {
			return -3
		}
		c := b[p]
		p++
		if i == 0 {
			hasSep = c == ':'
		}
		if p >= end {
			if c != 0 {
				return 1
			}
			return 0
		} else if hasSep && c == ':' {
			if i == 2 {
				return -4
			}
			continue
		} else if c == '.' || c == ',' {
			if i < 2 {
				return -3
			}
			break
		} else if !hasSep {
			p--
		} else {
			return -4
		}
	}
	toParse := end - p
	if toParse >= 6 {
		toParse = 6
	}
	var ok bool
	if p, ok = parseDigits(b, p, usec, toParse); !ok {
		return -3
	}
	if toParse < 6 {
		*usec *= [5]int{100000, 10000, 1000, 100, 10}[toParse-1]
	}
	for isDigit(b[p]) {
		p++
	}
	if b[p] != 0 {
		return 1
	}
	return 0
}

// parseTime is parse_isoformat_time over b[p:end].
func parseTime(b []byte, p, end int, r *isoResult, tzusec *int) int {
	tz := p
	for {
		if c := b[tz]; c == 'Z' || c == '+' || c == '-' {
			break
		}
		tz++
		if tz >= end {
			break
		}
	}
	rv := parseHMSF(b, p, tz, &r.hour, &r.minute, &r.second, &r.usec)
	if rv < 0 {
		return rv
	} else if tz == end {
		if rv == 1 {
			return -5
		}
		return 0
	}
	if b[tz] == 'Z' {
		if b[tz+1] != 0 {
			return -5
		}
		return 1
	}
	sign := 1
	if b[tz] == '-' {
		sign = -1
	}
	var h, m, s int
	rv = parseHMSF(b, tz+1, end, &h, &m, &s, tzusec)
	r.tzoff = sign * (h*3600 + m*60 + s)
	*tzusec *= sign
	if rv != 0 {
		return -5
	}
	return 1
}

// checkTime is CPython's check_time_args.
func checkTime(h, m, s, us int) error {
	switch {
	case h < 0 || h > 23:
		return fmt.Errorf("hour must be in 0..23, not %d", h)
	case m < 0 || m > 59:
		return fmt.Errorf("minute must be in 0..59, not %d", m)
	case s < 0 || s > 59:
		return fmt.Errorf("second must be in 0..59, not %d", s)
	case us < 0 || us > 999999:
		return fmt.Errorf("microsecond must be in 0..999999, not %d", us)
	}
	return nil
}

// timedeltaRepr is repr(timedelta(seconds=secs)).
func timedeltaRepr(secs int) string {
	days := secs / 86400
	rest := secs % 86400
	if rest < 0 {
		days--
		rest += 86400
	}
	var parts []string
	if days != 0 {
		parts = append(parts, fmt.Sprintf("days=%d", days))
	}
	if rest != 0 {
		parts = append(parts, fmt.Sprintf("seconds=%d", rest))
	}
	if len(parts) == 0 {
		return "datetime.timedelta(0)"
	}
	return "datetime.timedelta(" + strings.Join(parts, ", ") + ")"
}

// pyRepr is repr(str) for the strings an error message quotes.
func pyRepr(s string) string {
	q := byte('\'')
	if strings.ContainsRune(s, '\'') && !strings.ContainsRune(s, '"') {
		q = '"'
	}
	var sb strings.Builder
	sb.WriteByte(q)
	for _, r := range s {
		switch {
		case r == rune(q) || r == '\\':
			sb.WriteByte('\\')
			sb.WriteRune(r)
		case r == '\n':
			sb.WriteString(`\n`)
		case r == '\r':
			sb.WriteString(`\r`)
		case r == '\t':
			sb.WriteString(`\t`)
		case unicode.IsPrint(r):
			sb.WriteRune(r)
		case r < 0x100:
			fmt.Fprintf(&sb, `\x%02x`, r)
		case r < 0x10000:
			fmt.Fprintf(&sb, `\u%04x`, r)
		default:
			fmt.Fprintf(&sb, `\U%08x`, r)
		}
	}
	sb.WriteByte(q)
	return sb.String()
}
