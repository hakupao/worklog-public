package pytime

import (
	"io/fs"
	"math"
	"strconv"
	"strings"
)

// MtimeFloat is CPython's st_mtime: (double)sec + (double)nsec * 1e-9, each step rounded (the
// explicit conversion keeps the compiler from fusing the multiply-add). Not UnixNano()/1e9, which
// differs in the last bits.
func MtimeFloat(fi fs.FileInfo) float64 {
	t := fi.ModTime()
	return float64(t.Unix()) + float64(float64(t.Nanosecond())*1e-9)
}

// FloatRepr is Python's repr(float): the shortest round-tripping digits, in exponent form when the
// decimal exponent is below -4 or at least 16, and with ".0" on an integral value.
func FloatRepr(f float64) string {
	switch {
	case math.IsNaN(f):
		return "nan"
	case math.IsInf(f, 1):
		return "inf"
	case math.IsInf(f, -1):
		return "-inf"
	}
	e := strconv.FormatFloat(f, 'e', -1, 64) // d[.ddd]e±XX, the same exponent spelling as Python
	exp, _ := strconv.Atoi(e[strings.LastIndexByte(e, 'e')+1:])
	if exp < -4 || exp >= 16 {
		return e
	}
	s := strconv.FormatFloat(f, 'f', -1, 64)
	if !strings.Contains(s, ".") {
		s += ".0"
	}
	return s
}

// RoundHalfEven is Python's round(x) with no digits: ties go to the even integer. For NaN, ±Inf or
// |x| >= 2^63 Python raises (ValueError / OverflowError) while Go's conversion gives an
// unspecified int64; callers only round finite values in int64 range (digest_rhythm minutes).
func RoundHalfEven(f float64) int64 {
	return int64(math.RoundToEven(f))
}

// Round is Python's round(x, ndigits) for ndigits >= 0: correctly rounded from the exact binary
// value (ties to even), never math.Round(x*10^n)/10^n.
func Round(f float64, ndigits int) float64 {
	r, _ := strconv.ParseFloat(strconv.FormatFloat(f, 'f', ndigits, 64), 64)
	return r
}
