package pyjson

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Decode is json.loads on a str: Python's grammar (NaN, Infinity and -Infinity are numbers; only
// " \t\n\r" is whitespace; raw control characters in strings are errors; a leading BOM is an error),
// object key order kept, a duplicate key keeping its first position with the last value, and an
// integer literal kept apart from a float (beyond int64 as BigInt; beyond 4300 digits an error, as
// int()'s digit limit makes json.loads raise ValueError). A lone surrogate escape ("\ud800") is kept, as Python
// keeps it, encoded as WTF-8 (the 3-byte form UTF-8 would give it); Dumps writes it back.
func Decode(data []byte) (Value, error) {
	if !utf8.Valid(data) {
		return nil, errors.New("pyjson: invalid UTF-8")
	}
	d := &decoder{b: data}
	if len(data) >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf {
		return nil, d.err("Unexpected UTF-8 BOM (decode using utf-8-sig)")
	}
	d.ws()
	v, err := d.value()
	if err != nil {
		return nil, err
	}
	d.ws()
	if d.p != len(d.b) {
		return nil, d.err("Extra data")
	}
	return v, nil
}

type decoder struct {
	b []byte
	p int
}

func (d *decoder) err(msg string) error {
	return fmt.Errorf("pyjson: %s at byte %d", msg, d.p)
}

func (d *decoder) ws() {
	for d.p < len(d.b) {
		switch d.b[d.p] {
		case ' ', '\t', '\n', '\r':
			d.p++
		default:
			return
		}
	}
}

func (d *decoder) lit(s string) bool {
	if len(d.b)-d.p >= len(s) && string(d.b[d.p:d.p+len(s)]) == s {
		d.p += len(s)
		return true
	}
	return false
}

func (d *decoder) value() (Value, error) {
	if d.p >= len(d.b) {
		return nil, d.err("Expecting value")
	}
	switch c := d.b[d.p]; {
	case c == '"':
		return d.str()
	case c == '{':
		return d.object()
	case c == '[':
		return d.array()
	case d.lit("null"):
		return nil, nil
	case d.lit("true"):
		return true, nil
	case d.lit("false"):
		return false, nil
	case d.lit("NaN"):
		return Float(math.NaN()), nil
	case d.lit("Infinity"):
		return Float(math.Inf(1)), nil
	case d.lit("-Infinity"):
		return Float(math.Inf(-1)), nil
	case c == '-' || (c >= '0' && c <= '9'):
		return d.number()
	}
	return nil, d.err("Expecting value")
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// maxIntDigits is sys.int_info.default_max_str_digits: int() of a longer literal raises ValueError.
const maxIntDigits = 4300

// number is the scanner's _match_number: -?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?, where a fraction or
// exponent that does not complete is left as extra data.
func (d *decoder) number() (Value, error) {
	start := d.p
	b := d.b
	if b[d.p] == '-' {
		d.p++
	}
	switch {
	case d.p < len(b) && b[d.p] == '0':
		d.p++
	case d.p < len(b) && b[d.p] >= '1' && b[d.p] <= '9':
		for d.p < len(b) && isDigit(b[d.p]) {
			d.p++
		}
	default:
		d.p = start
		return nil, d.err("Expecting value")
	}
	isFloat := false
	if d.p+1 < len(b) && b[d.p] == '.' && isDigit(b[d.p+1]) {
		isFloat = true
		d.p += 2
		for d.p < len(b) && isDigit(b[d.p]) {
			d.p++
		}
	}
	if d.p < len(b) && (b[d.p] == 'e' || b[d.p] == 'E') {
		e := d.p
		d.p++
		if d.p < len(b) && (b[d.p] == '-' || b[d.p] == '+') {
			d.p++
		}
		digits := d.p
		for d.p < len(b) && isDigit(b[d.p]) {
			d.p++
		}
		if d.p > digits {
			isFloat = true
		} else {
			d.p = e
		}
	}
	s := string(b[start:d.p])
	if isFloat {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) { // 1e400 is inf in Python too
			return nil, d.err("bad number")
		}
		return Float(f), nil
	}
	i, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		if digits := len(s) - strings.Count(s[:1], "-"); digits > maxIntDigits {
			return nil, d.err("Exceeds the limit (4300 digits) for integer string conversion")
		}
		return BigInt(s), nil // the grammar is checked above, so only ErrRange gets here
	}
	return Int(i), nil
}

func hex4(b []byte) (rune, bool) {
	if len(b) < 4 {
		return 0, false
	}
	var r rune
	for _, c := range b[:4] {
		r <<= 4
		switch {
		case c >= '0' && c <= '9':
			r |= rune(c - '0')
		case c >= 'a' && c <= 'f':
			r |= rune(c - 'a' + 10)
		case c >= 'A' && c <= 'F':
			r |= rune(c - 'A' + 10)
		default:
			return 0, false
		}
	}
	return r, true
}

// appendWTF8 appends r as UTF-8, or a lone surrogate as its 3-byte generalized form.
func appendWTF8(out []byte, r rune) []byte {
	if r >= 0xd800 && r <= 0xdfff {
		return append(out, 0xe0|byte(r>>12), 0x80|byte(r>>6)&0x3f, 0x80|byte(r)&0x3f)
	}
	return utf8.AppendRune(out, r)
}

// special is the bytes that end a run of a string's characters copied as they are.
var special = func() (t [256]bool) {
	for c := range 0x20 {
		t[c] = true
	}
	t['"'], t['\\'] = true, true
	return t
}()

// plain moves past the string characters that need no decoding, eight bytes at a time while none of
// them can be special: a log is gigabytes of string values, and this loop is most of the parse.
func (d *decoder) plain() {
	const ones, highs = 0x0101010101010101, 0x8080808080808080
	for d.p+8 <= len(d.b) {
		x := binary.LittleEndian.Uint64(d.b[d.p:])
		q, bs := x^('"'*ones), x^('\\'*ones)
		// A zero byte in q or bs, or a byte below 0x20 in x, sets its high bit here (and maybe
		// some above it, which only sends the word to the byte loop).
		if ((q-ones)&^q|(bs-ones)&^bs|(x-0x20*ones)&^x)&highs != 0 {
			break
		}
		d.p += 8
	}
	for d.p < len(d.b) && !special[d.b[d.p]] {
		d.p++
	}
}

func (d *decoder) str() (string, error) {
	d.p++ // opening quote
	// Most strings have no escape: they are one copy of the input, not a growing buffer.
	start := d.p
	d.plain()
	if d.p < len(d.b) && d.b[d.p] == '"' {
		d.p++
		return string(d.b[start : d.p-1]), nil
	}
	// The decoded string is never longer than its source up to the closing quote (every escape
	// shrinks or keeps its length), so one allocation holds it, and String() does not copy it again.
	end := d.p
	for end < len(d.b) && d.b[end] != '"' {
		if d.b[end] == '\\' {
			end++
		}
		end++
	}
	var out strings.Builder
	out.Grow(min(end, len(d.b)) - start)
	out.Write(d.b[start:d.p])
	for {
		if d.p >= len(d.b) {
			return "", d.err("Unterminated string")
		}
		c := d.b[d.p]
		switch {
		case c == '"':
			d.p++
			return out.String(), nil
		case c < 0x20:
			return "", d.err("Invalid control character")
		case c != '\\':
			run := d.p
			d.plain()
			out.Write(d.b[run:d.p])
			continue
		}
		d.p++
		if d.p >= len(d.b) {
			return "", d.err("Unterminated string")
		}
		esc := d.b[d.p]
		d.p++
		switch esc {
		case '"', '\\', '/':
			out.WriteByte(esc)
		case 'b':
			out.WriteByte('\b')
		case 'f':
			out.WriteByte('\f')
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case 't':
			out.WriteByte('\t')
		case 'u':
			r, ok := hex4(d.b[d.p:])
			if !ok {
				return "", d.err("Invalid \\uXXXX escape")
			}
			d.p += 4
			if r >= 0xd800 && r <= 0xdbff && d.p+6 <= len(d.b) && d.b[d.p] == '\\' && d.b[d.p+1] == 'u' {
				r2, ok := hex4(d.b[d.p+2:])
				if !ok {
					d.p += 2
					return "", d.err("Invalid \\uXXXX escape")
				}
				if r2 >= 0xdc00 && r2 <= 0xdfff {
					r = 0x10000 + (r-0xd800)<<10 + (r2 - 0xdc00)
					d.p += 6
				}
			}
			var buf [4]byte
			out.Write(appendWTF8(buf[:0], r))
		default:
			return "", d.err("Invalid \\escape")
		}
	}
}

func (d *decoder) object() (Value, error) {
	d.p++
	o := NewObject()
	d.ws()
	if d.p < len(d.b) && d.b[d.p] == '}' {
		d.p++
		return o, nil
	}
	for {
		if d.p >= len(d.b) || d.b[d.p] != '"' {
			return nil, d.err("Expecting property name enclosed in double quotes")
		}
		k, err := d.str()
		if err != nil {
			return nil, err
		}
		d.ws()
		if d.p >= len(d.b) || d.b[d.p] != ':' {
			return nil, d.err("Expecting ':' delimiter")
		}
		d.p++
		d.ws()
		v, err := d.value()
		if err != nil {
			return nil, err
		}
		o.Set(k, v)
		d.ws()
		if d.p < len(d.b) && d.b[d.p] == '}' {
			d.p++
			return o, nil
		}
		if d.p >= len(d.b) || d.b[d.p] != ',' {
			return nil, d.err("Expecting ',' delimiter")
		}
		d.p++
		d.ws()
	}
}

func (d *decoder) array() (Value, error) {
	d.p++
	a := []Value{}
	d.ws()
	if d.p < len(d.b) && d.b[d.p] == ']' {
		d.p++
		return a, nil
	}
	for {
		v, err := d.value()
		if err != nil {
			return nil, err
		}
		a = append(a, v)
		d.ws()
		if d.p < len(d.b) && d.b[d.p] == ']' {
			d.p++
			return a, nil
		}
		if d.p >= len(d.b) || d.b[d.p] != ',' {
			return nil, d.err("Expecting ',' delimiter")
		}
		d.p++
		d.ws()
	}
}
