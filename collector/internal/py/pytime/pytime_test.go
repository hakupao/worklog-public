package pytime_test

import (
	"io/fs"
	"math"
	"strconv"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

type parseCase struct {
	Input    string `json:"input"`
	ISO      string `json:"isoformat"`
	Pydantic string `json:"pydantic"`
	Aware    bool   `json:"aware"`
	Offset   *int   `json:"utc_offset_seconds"`
	JSTDate  string `json:"jst_date"`
	Date     string `json:"date"`
	Error    string `json:"error"`
	Message  string `json:"message"`
}

func loadDatetime(t *testing.T) (parse, dates []parseCase) {
	var g struct {
		Parse []parseCase `json:"parse"`
		Dates []parseCase `json:"dates"`
	}
	testkit.Golden(t, "datetime", &g)
	if len(g.Parse) == 0 || len(g.Dates) == 0 {
		t.Fatal("empty datetime golden")
	}
	return g.Parse, g.Dates
}

// claude_code._parse_timestamp → isoformat / pydantic spelling / awareness / offset / link._local_date.
func TestFromISOGolden(t *testing.T) {
	parse, _ := loadDatetime(t)
	for _, c := range parse {
		i, err := pytime.FromISO(c.Input)
		if c.Error != "" {
			if err == nil {
				t.Errorf("FromISO(%q) = %v, want %s", c.Input, i.ISOFormat(), c.Error)
			} else if err.Error() != c.Message {
				t.Errorf("FromISO(%q) error %q, want %q", c.Input, err, c.Message)
			}
			continue
		}
		if err != nil {
			t.Errorf("FromISO(%q): %v", c.Input, err)
			continue
		}
		if got := i.ISOFormat(); got != c.ISO {
			t.Errorf("FromISO(%q).ISOFormat() = %q, want %q", c.Input, got, c.ISO)
		}
		if got := i.Pydantic(); got != c.Pydantic {
			t.Errorf("FromISO(%q).Pydantic() = %q, want %q", c.Input, got, c.Pydantic)
		}
		if i.Aware != c.Aware {
			t.Errorf("FromISO(%q).Aware = %v", c.Input, i.Aware)
		}
		if c.Offset != nil {
			if _, off := i.T.Zone(); off != *c.Offset {
				t.Errorf("FromISO(%q) offset %d, want %d", c.Input, off, *c.Offset)
			}
		}
		if got := pytime.JSTDate(i).String(); got != c.JSTDate {
			t.Errorf("JSTDate(%q) = %s, want %s", c.Input, got, c.JSTDate)
		}
		if i.T.Nanosecond()%1000 != 0 {
			t.Errorf("FromISO(%q) not truncated to µs: %d ns", c.Input, i.T.Nanosecond())
		}
	}
}

// date.fromisoformat, narrowed by D6 to YYYY-MM-DD and YYYYMMDD.
func TestParseDateGolden(t *testing.T) {
	_, dates := loadDatetime(t)
	isoWeekForm := map[string]bool{"2026-W40-5": true, "2026W405": true}
	for _, c := range dates {
		d, err := pytime.ParseDate(c.Input)
		switch {
		case isoWeekForm[c.Input]: // D6: Python accepts, Go rejects
			if err == nil {
				t.Errorf("ParseDate(%q) = %s, want an error (D6)", c.Input, d)
			}
		case c.Error != "":
			if err == nil {
				t.Errorf("ParseDate(%q) = %s, want %s", c.Input, d, c.Error)
			} else if err.Error() != c.Message {
				t.Errorf("ParseDate(%q) error %q, want %q", c.Input, err, c.Message)
			}
		case err != nil:
			t.Errorf("ParseDate(%q): %v", c.Input, err)
		case d.String() != c.Date:
			t.Errorf("ParseDate(%q) = %s, want %s", c.Input, d, c.Date)
		}
	}
}

func TestDateArithmetic(t *testing.T) {
	d := pytime.Date{Y: 2026, M: time.December, D: 31}
	if got := d.AddDays(1).String(); got != "2027-01-01" {
		t.Errorf("AddDays(1) = %s", got)
	}
	if got := (pytime.Date{Y: 2028, M: time.March, D: 1}).AddDays(-1).String(); got != "2028-02-29" {
		t.Errorf("AddDays(-1) = %s", got)
	}
	if got := (pytime.Date{Y: 5, M: time.January, D: 2}).String(); got != "0005-01-02" {
		t.Errorf("String = %s", got)
	}
}

// D3: a naive instant is compared as UTC against an aware one; same-kind comparisons are plain.
func TestBefore(t *testing.T) {
	mk := func(s string) pytime.Instant {
		i, err := pytime.FromISO(s)
		if err != nil {
			t.Fatal(err)
		}
		return i
	}
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"2026-09-18T09:00:00", "2026-09-18T09:00:01", true},
		{"2026-09-18T09:00:00Z", "2026-09-18T18:00:00+09:00", false},
		{"2026-09-18T18:00:00+09:00", "2026-09-18T09:00:00.000001Z", true},
		{"2026-09-18T09:00:00", "2026-09-18T09:00:00.000001Z", true}, // naive as UTC
		{"2026-09-18T09:00:00", "2026-09-18T18:00:00+09:00", false},  // equal as UTC
		{"2026-09-18T10:00:00", "2026-09-18T18:30:00+09:00", false},
		{"2026-09-18T09:30:00Z", "2026-09-18T10:00:00", true},
	} {
		if got := mk(c.a).Before(mk(c.b)); got != c.want {
			t.Errorf("%s Before %s = %v", c.a, c.b, got)
		}
	}
}

// datetime.now() is naive local wall time: Naive keeps the wall clock, drops the zone, cuts to µs.
func TestNaive(t *testing.T) {
	loc := time.FixedZone("JST", 9*3600)
	i := pytime.Naive(time.Date(2026, 10, 13, 8, 30, 15, 123456789, loc))
	if i.Aware {
		t.Fatal("aware")
	}
	if got := i.ISOFormat(); got != "2026-10-13T08:30:15.123456" {
		t.Errorf("ISOFormat = %s", got)
	}
	if got := i.Pydantic(); got != "2026-10-13T08:30:15.123456" {
		t.Errorf("Pydantic = %s", got)
	}
	if got := pytime.JSTDate(pytime.Naive(time.Date(2026, 10, 13, 23, 30, 0, 0, time.UTC))).String(); got != "2026-10-13" {
		t.Errorf("JSTDate(naive) = %s", got)
	}
}

// Negative and second-bearing offsets in both spellings (checked against CPython 3.14.4 / pydantic 2.13.5).
func TestOffsetSpelling(t *testing.T) {
	for in, want := range map[string][2]string{
		"2026-09-18T09:00:00-05:30:30": {"2026-09-18T09:00:00-05:30:30", "2026-09-18T09:00:00-05:30"},
		"2026-09-18T09:00:00+00:00:30": {"2026-09-18T09:00:00+00:00:30", "2026-09-18T09:00:00+00:00"},
		"2026-09-18T09:00:00-00:00:30": {"2026-09-18T09:00:00-00:00:30", "2026-09-18T09:00:00-00:00"},
		"2026-09-18T09:00:00+23:59:59": {"2026-09-18T09:00:00+23:59:59", "2026-09-18T09:00:00+23:59"},
		"0001-01-01T00:00:00":          {"0001-01-01T00:00:00", "0001-01-01T00:00:00"},
	} {
		i, err := pytime.FromISO(in)
		if err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		if got := [2]string{i.ISOFormat(), i.Pydantic()}; got != want {
			t.Errorf("%s: got %q, want %q", in, got, want)
		}
	}
}

type fakeInfo struct{ mt time.Time }

func (f fakeInfo) Name() string       { return "f" }
func (f fakeInfo) Size() int64        { return 0 }
func (f fakeInfo) Mode() fs.FileMode  { return 0 }
func (f fakeInfo) ModTime() time.Time { return f.mt }
func (f fakeInfo) IsDir() bool        { return false }
func (f fakeInfo) Sys() any           { return nil }

func TestMtimeGolden(t *testing.T) {
	var g struct {
		Cases []struct {
			Sec     int64   `json:"sec"`
			Nsec    int64   `json:"nsec"`
			StMtime float64 `json:"st_mtime"`
			Repr    string  `json:"repr"`
			Hex     string  `json:"hex"`
			Div     string  `json:"unixnano_div_1e9"`
			Differs bool    `json:"differs_from_unixnano_div"`
		} `json:"cases"`
	}
	testkit.Golden(t, "mtime", &g)
	if len(g.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range g.Cases {
		got := pytime.MtimeFloat(fakeInfo{time.Unix(c.Sec, c.Nsec)})
		if got != c.StMtime {
			t.Errorf("%d.%09d: MtimeFloat = %v, want %v", c.Sec, c.Nsec, got, c.StMtime)
		}
		if r := pytime.FloatRepr(got); r != c.Repr {
			t.Errorf("%d.%09d: FloatRepr = %s, want %s", c.Sec, c.Nsec, r, c.Repr)
		}
		if h := strconv.FormatFloat(got, 'x', 13, 64); h != c.Hex {
			// Python's float.hex() spelling is 0x1.<13 hex>p+N; Go's is 0x1.<13 hex>p+NN.
			if want, _ := strconv.ParseFloat(c.Hex, 64); want != got {
				t.Errorf("%d.%09d: bits %s, want %s", c.Sec, c.Nsec, h, c.Hex)
			}
		}
		// The naive formula is what the golden calls out as wrong.
		div := float64(time.Unix(c.Sec, c.Nsec).UnixNano()) / 1e9
		if (pytime.FloatRepr(div) != c.Repr) != c.Differs {
			t.Errorf("%d.%09d: UnixNano/1e9 = %s; golden says differs=%v", c.Sec, c.Nsec, pytime.FloatRepr(div), c.Differs)
		}
	}
}

func TestFloatRepr(t *testing.T) {
	for f, want := range map[float64]string{
		1: "1.0", 0.1: "0.1", 1e16: "1e+16", 1e15: "1000000000000000.0", 1e-5: "1e-05", 1e-4: "0.0001",
		0.30000000000000004: "0.30000000000000004", 12345678901234567: "1.2345678901234568e+16",
		5e-324: "5e-324", math.MaxFloat64: "1.7976931348623157e+308", 1.5e-10: "1.5e-10", 123456789.123: "123456789.123",
		math.Inf(1): "inf", math.Inf(-1): "-inf", 1790294400.1234567: "1790294400.1234567", 100: "100.0",
	} {
		if got := pytime.FloatRepr(f); got != want {
			t.Errorf("FloatRepr(%v) = %s, want %s", f, got, want)
		}
	}
	if got := pytime.FloatRepr(math.Copysign(0, -1)); got != "-0.0" {
		t.Errorf("-0.0 → %s", got)
	}
	if got := pytime.FloatRepr(math.NaN()); got != "nan" {
		t.Errorf("nan → %s", got)
	}
}

// digest_rhythm's round(x) and round(x, 1) / round(cost, 6), on exact ties.
func TestRoundGolden(t *testing.T) {
	var g struct {
		RHE []struct {
			X     float64 `json:"x"`
			Round int64   `json:"round"`
		} `json:"round_half_even"`
		R1 []struct {
			X     float64 `json:"x"`
			Round float64 `json:"round"`
		} `json:"round1"`
		R6 []struct {
			X     float64 `json:"x"`
			Round float64 `json:"round"`
		} `json:"round6"`
	}
	testkit.Golden(t, "digest_rhythm", &g)
	if len(g.RHE) == 0 || len(g.R1) == 0 || len(g.R6) == 0 {
		t.Fatal("empty rounding golden")
	}
	for _, c := range g.RHE {
		if got := pytime.RoundHalfEven(c.X); got != c.Round {
			t.Errorf("round(%v) = %d, want %d", c.X, got, c.Round)
		}
	}
	for _, c := range g.R1 {
		if got := pytime.Round(c.X, 1); got != c.Round || math.Signbit(got) != math.Signbit(c.Round) {
			t.Errorf("round(%v, 1) = %v, want %v", c.X, got, c.Round)
		}
	}
	for _, c := range g.R6 {
		if got := pytime.Round(c.X, 6); got != c.Round {
			t.Errorf("round(%v, 6) = %v, want %v", c.X, got, c.Round)
		}
	}
}

// Cases the differential run against CPython 3.14.4 turned up or pinned (outputs from Python).
func TestFromISOEdges(t *testing.T) {
	for in, want := range map[string]string{
		"2026-09-18T09:00:00.5":  "2026-09-18T09:00:00.500000",
		"2026-09-18T09:00+09:75": "2026-09-18T09:00:00+10:15",
		"2026-09-18é09:00":       "2026-09-18T09:00:00",
		"2026-W53-1":             "2026-12-28T00:00:00",
		"2020-W53-7T01:02:03Z":   "2021-01-03T01:02:03+00:00",
		"2026-12-31T24:00:00Z":   "2027-01-01T00:00:00+00:00",
		"2026-09-18T090000.25":   "2026-09-18T09:00:00.250000",
		"2026-09-18T09:00:00,1Z": "2026-09-18T09:00:00.100000+00:00",
	} {
		i, err := pytime.FromISO(in)
		if err != nil {
			t.Errorf("%q: %v", in, err)
		} else if got := i.ISOFormat(); got != want {
			t.Errorf("%q: %s, want %s", in, got, want)
		}
	}
	for in, msg := range map[string]string{
		"2026-00-18T24:00:03":    "month must be in 1..12, not 0",
		"2026-09-18T24:00:01":    "minute, second, and microsecond must be 0 when hour is 24",
		"2026-09-18T25:00":       "hour must be in 0..23, not 25",
		"0000-01-01":             "year must be in 1..9999, not 0",
		"2026-09-18T09:00+24:00": "offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24), not datetime.timedelta(days=1)",
		"2026-W54-1":             "Invalid isoformat string: '2026-W54-1'",
		"2026-09-18T09:00:00.":   "Invalid isoformat string: '2026-09-18T09:00:00.'",
	} {
		if _, err := pytime.FromISO(in); err == nil || err.Error() != msg {
			t.Errorf("%q: error %v, want %q", in, err, msg)
		}
	}
	// D15: Python accepts an offset with a fraction of a second; a Go zone cannot hold one.
	if _, err := pytime.FromISO("2026-09-18T09:00:00+09:00:30.5"); err == nil {
		t.Error("sub-second offset: want an error")
	}
}
