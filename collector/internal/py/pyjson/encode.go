package pyjson

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// Opts are json.dumps's options. The item separator is ", " on one line and "," with an indent;
// the key separator is ": ".
type Opts struct {
	EnsureASCII, SortKeys bool
	Indent                *int // nil = one line
	compact               bool // separators=(",", ":")
}

// Default is json.dumps(v): ensure_ascii=True, ", " / ": ".
func Default() Opts { return Opts{EnsureASCII: true} }

// Unicode is json.dumps(v, ensure_ascii=False).
func Unicode() Opts { return Opts{} }

// Indented is json.dumps(v, ensure_ascii=False, indent=n).
func Indented(n int) Opts { return Opts{Indent: &n} }

// Sorted adds sort_keys=True (code-point order, which is Go's byte order).
func (o Opts) Sorted() Opts {
	o.SortKeys = true
	return o
}

// Compact is the wire form: json.dumps(v, ensure_ascii=False, separators=(",", ":")).
func Compact(v Value) []byte { return Dumps(v, Opts{compact: true}) }

// Dumps is CPython's json.dumps with o, byte for byte. A value of a type Value does not list
// panics, as json.dumps raises TypeError.
func Dumps(v Value, o Opts) []byte {
	e := &encoder{o: o}
	e.value(v, 0)
	return []byte(e.sb.String())
}

type encoder struct {
	o  Opts
	sb strings.Builder
}

func (e *encoder) itemSep() string {
	switch {
	case e.o.compact:
		return ","
	case e.o.Indent != nil:
		return ","
	}
	return ", "
}

func (e *encoder) keySep() string {
	if e.o.compact {
		return ":"
	}
	return ": "
}

func (e *encoder) newline(level int) {
	if e.o.Indent == nil {
		return
	}
	e.sb.WriteByte('\n')
	e.sb.WriteString(strings.Repeat(" ", *e.o.Indent*level))
}

func (e *encoder) value(v Value, level int) {
	switch x := v.(type) {
	case nil:
		e.sb.WriteString("null")
	case bool:
		if x {
			e.sb.WriteString("true")
		} else {
			e.sb.WriteString("false")
		}
	case Int:
		e.sb.WriteString(strconv.FormatInt(int64(x), 10))
	case BigInt:
		e.sb.WriteString(string(x))
	case int:
		e.sb.WriteString(strconv.Itoa(x))
	case int64:
		e.sb.WriteString(strconv.FormatInt(x, 10))
	case Float:
		e.float(float64(x))
	case float64:
		e.float(x)
	case string:
		e.str(x)
	case []Value:
		e.list(len(x), func(i int) { e.value(x[i], level+1) }, level)
	case []string:
		e.list(len(x), func(i int) { e.str(x[i]) }, level)
	case []*Object:
		e.list(len(x), func(i int) { e.value(x[i], level+1) }, level)
	case *Object:
		if x == nil {
			e.sb.WriteString("null")
			return
		}
		e.object(x, level)
	default:
		panic(fmt.Sprintf("pyjson: Object of type %T is not JSON serializable", v))
	}
}

// float is float.__repr__, with json's spellings for the non-finite values.
func (e *encoder) float(f float64) {
	switch {
	case math.IsNaN(f):
		e.sb.WriteString("NaN")
	case math.IsInf(f, 1):
		e.sb.WriteString("Infinity")
	case math.IsInf(f, -1):
		e.sb.WriteString("-Infinity")
	default:
		e.sb.WriteString(pytime.FloatRepr(f))
	}
}

func (e *encoder) list(n int, item func(int), level int) {
	if n == 0 {
		e.sb.WriteString("[]")
		return
	}
	e.sb.WriteByte('[')
	for i := 0; i < n; i++ {
		if i > 0 {
			e.sb.WriteString(e.itemSep())
		}
		e.newline(level + 1)
		item(i)
	}
	e.newline(level)
	e.sb.WriteByte(']')
}

func (e *encoder) object(o *Object, level int) {
	if o.Len() == 0 {
		e.sb.WriteString("{}")
		return
	}
	order := make([]int, len(o.keys))
	for i := range order {
		order[i] = i
	}
	if e.o.SortKeys {
		sort.SliceStable(order, func(a, b int) bool { return o.keys[order[a]] < o.keys[order[b]] })
	}
	e.sb.WriteByte('{')
	for n, i := range order {
		if n > 0 {
			e.sb.WriteString(e.itemSep())
		}
		e.newline(level + 1)
		e.str(o.keys[i])
		e.sb.WriteString(e.keySep())
		e.value(o.vals[i], level+1)
	}
	e.newline(level)
	e.sb.WriteByte('}')
}

const hexDigits = "0123456789abcdef"

func (e *encoder) u4(r rune) {
	e.sb.WriteString(`\u`)
	e.sb.WriteByte(hexDigits[r>>12&0xf])
	e.sb.WriteByte(hexDigits[r>>8&0xf])
	e.sb.WriteByte(hexDigits[r>>4&0xf])
	e.sb.WriteByte(hexDigits[r&0xf])
}

// decodeWTF8 is utf8.DecodeRuneInString that also reads a lone surrogate's 3-byte form.
func decodeWTF8(s string) (rune, int) {
	if len(s) >= 3 && s[0] == 0xed && s[1] >= 0xa0 && s[1] <= 0xbf && s[2] >= 0x80 && s[2] <= 0xbf {
		return 0xd000 | rune(s[1]&0x3f)<<6 | rune(s[2]&0x3f), 3
	}
	return utf8.DecodeRuneInString(s)
}

// str is encode_basestring_ascii (ensure_ascii) or encode_basestring: '"', '\\' and \b \f \n \r \t
// get their short escapes, other controls \u00XX; with ensure_ascii everything from 0x7f up is
// \uXXXX, lower-case hex, astral characters as a surrogate pair.
func (e *encoder) str(s string) {
	e.sb.WriteByte('"')
	for i := 0; i < len(s); {
		r, n := decodeWTF8(s[i:])
		raw := s[i : i+n]
		i += n
		switch r {
		case '"':
			e.sb.WriteString(`\"`)
		case '\\':
			e.sb.WriteString(`\\`)
		case '\n':
			e.sb.WriteString(`\n`)
		case '\r':
			e.sb.WriteString(`\r`)
		case '\t':
			e.sb.WriteString(`\t`)
		case '\b':
			e.sb.WriteString(`\b`)
		case '\f':
			e.sb.WriteString(`\f`)
		default:
			switch {
			case r < 0x20:
				e.u4(r)
			case r < 0x7f || !e.o.EnsureASCII:
				e.sb.WriteString(raw)
			case r >= 0x10000:
				r -= 0x10000
				e.u4(0xd800 | r>>10)
				e.u4(0xdc00 | r&0x3ff)
			default:
				e.u4(r)
			}
		}
	}
	e.sb.WriteByte('"')
}
