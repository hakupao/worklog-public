package pytime

import (
	"fmt"
	"time"
)

// Date is a calendar date (Python's datetime.date).
type Date struct {
	Y int
	M time.Month
	D int
}

// ParseDate reads YYYY-MM-DD or YYYYMMDD. Python's date.fromisoformat also takes ISO week forms
// (2026-W40-5); Go does not (spec §6 D6). Errors carry Python's messages.
func ParseDate(s string) (Date, error) {
	b := []byte(s)
	var y, m, d int
	ok := false
	switch len(b) {
	case 10:
		ok = b[4] == '-' && b[7] == '-' && digits(b[0:4], &y) && digits(b[5:7], &m) && digits(b[8:10], &d)
	case 8:
		ok = digits(b[0:4], &y) && digits(b[4:6], &m) && digits(b[6:8], &d)
	}
	if !ok {
		return Date{}, invalidISO(s)
	}
	if err := checkDate(y, m, d); err != nil {
		return Date{}, err
	}
	return Date{y, time.Month(m), d}, nil
}

func digits(b []byte, v *int) bool {
	*v = 0
	for _, c := range b {
		if c < '0' || c > '9' {
			return false
		}
		*v = *v*10 + int(c-'0')
	}
	return true
}

// String is date.isoformat(): YYYY-MM-DD.
func (d Date) String() string {
	return fmt.Sprintf("%04d-%02d-%02d", d.Y, int(d.M), d.D)
}

// AddDays is d + timedelta(days=n).
func (d Date) AddDays(n int) Date {
	t := time.Date(d.Y, d.M, d.D+n, 0, 0, 0, 0, time.UTC)
	return Date{t.Year(), t.Month(), t.Day()}
}

var tokyo = time.FixedZone("JST", 9*3600)

// JSTDate is link._local_date: an aware instant's date in Asia/Tokyo (no DST, so a fixed +09:00),
// a naive one's own date.
func JSTDate(i Instant) Date {
	t := i.T
	if i.Aware {
		t = t.In(tokyo)
	}
	return Date{t.Year(), t.Month(), t.Day()}
}

// daysIn is days_in_month; 0 for a month outside 1..12, as CPython's table gives for month 0.
func daysIn(y, m int) int {
	if m < 1 || m > 12 {
		return 0
	}
	return time.Date(y, time.Month(m)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// checkDate is CPython's check_date_args.
func checkDate(y, m, d int) error {
	if y < 1 || y > 9999 {
		return fmt.Errorf("year must be in 1..9999, not %d", y)
	}
	if m < 1 || m > 12 {
		return fmt.Errorf("month must be in 1..12, not %d", m)
	}
	if dim := daysIn(y, m); d < 1 || d > dim {
		return fmt.Errorf("day %d must be in range 1..%d for month %d in year %d", d, dim, m, y)
	}
	return nil
}
