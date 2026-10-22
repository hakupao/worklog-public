package pyjson

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// Str is Python's str(v) for a json.loads value: a str is itself, None/True/False are spelled as
// Python spells them, numbers as repr, and a list or dict as its repr (strings quoted by repr's
// rules). The side jobs' parsers use it for `str(row.get(...) or "")`.
func Str(v Value) string {
	if s, ok := v.(string); ok {
		return s
	}
	var sb strings.Builder
	repr(&sb, v)
	return sb.String()
}

// Truthy is Python's bool(v) for a json.loads value.
func Truthy(v Value) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case Int:
		return x != 0
	case BigInt:
		return x != "0" && x != "-0" // never 0 when decoded; kept for a hand-made value
	case Float:
		return x != 0 // NaN is truthy
	case string:
		return x != ""
	case []Value:
		return len(x) > 0
	case *Object:
		return x != nil && x.Len() > 0
	}
	return true
}

// TypeName is type(v).__name__ for a json.loads value, as Python's error messages spell it.
func TypeName(v Value) string {
	switch v.(type) {
	case nil:
		return "NoneType"
	case bool:
		return "bool"
	case Int, BigInt:
		return "int"
	case Float:
		return "float"
	case string:
		return "str"
	case []Value:
		return "list"
	case *Object:
		return "dict"
	}
	return fmt.Sprintf("%T", v)
}

func repr(sb *strings.Builder, v Value) {
	switch x := v.(type) {
	case nil:
		sb.WriteString("None")
	case bool:
		if x {
			sb.WriteString("True")
		} else {
			sb.WriteString("False")
		}
	case Int:
		sb.WriteString(strconv.FormatInt(int64(x), 10))
	case BigInt:
		sb.WriteString(string(x))
	case Float:
		sb.WriteString(pytime.FloatRepr(float64(x)))
	case string:
		reprStr(sb, x)
	case []Value:
		sb.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				sb.WriteString(", ")
			}
			repr(sb, e)
		}
		sb.WriteByte(']')
	case *Object:
		sb.WriteByte('{')
		for i, k := range x.Keys() {
			if i > 0 {
				sb.WriteString(", ")
			}
			reprStr(sb, k)
			sb.WriteString(": ")
			e, _ := x.Get(k)
			repr(sb, e)
		}
		sb.WriteByte('}')
	default:
		fmt.Fprint(sb, x)
	}
}

// reprStr is unicode_repr: single quotes unless the text has a ' and no "; \\, the quote, \t \n
// \r get short escapes; other non-printable code points (str.isprintable, which unicode.IsPrint
// matches: letters, marks, numbers, punctuation, symbols and the ASCII space) are \xNN, \uNNNN or
// \UNNNNNNNN. A lone surrogate (kept in WTF-8 by Decode) is non-printable.
func reprStr(sb *strings.Builder, s string) {
	quote := byte('\'')
	if strings.IndexByte(s, '\'') >= 0 && strings.IndexByte(s, '"') < 0 {
		quote = '"'
	}
	sb.WriteByte(quote)
	for i := 0; i < len(s); {
		r, n := decodeWTF8(s[i:])
		raw := s[i : i+n]
		i += n
		switch {
		case r == rune(quote) || r == '\\':
			sb.WriteByte('\\')
			sb.WriteRune(r)
		case r == '\t':
			sb.WriteString(`\t`)
		case r == '\n':
			sb.WriteString(`\n`)
		case r == '\r':
			sb.WriteString(`\r`)
		case r < 0x7f && r >= 0x20:
			sb.WriteRune(r)
		case r >= 0xd800 && r <= 0xdfff || !unicode.IsPrint(r):
			switch {
			case r < 0x100:
				fmt.Fprintf(sb, `\x%02x`, r)
			case r < 0x10000:
				fmt.Fprintf(sb, `\u%04x`, r)
			default:
				fmt.Fprintf(sb, `\U%08x`, r)
			}
		default:
			sb.WriteString(raw)
		}
	}
	sb.WriteByte(quote)
}

// Subscript is v[key] with a str key, or the error Python raises, worded as str(exc): KeyError
// "'key'" for a missing key, TypeError for a value that is not a dict.
func Subscript(v Value, key string) (Value, error) {
	switch x := v.(type) {
	case *Object:
		if e, ok := x.Get(key); ok {
			return e, nil
		}
		var sb strings.Builder
		reprStr(&sb, key)
		return nil, errors.New(sb.String())
	case string:
		return nil, errors.New("string indices must be integers, not 'str'")
	case []Value:
		return nil, errors.New("list indices must be integers or slices, not str")
	}
	return nil, fmt.Errorf("'%s' object is not subscriptable", TypeName(v))
}

// Iter is what a for loop over v yields: a list's items, a dict's keys, a str's characters; for
// anything else the TypeError Python raises.
func Iter(v Value) ([]Value, error) {
	switch x := v.(type) {
	case []Value:
		return x, nil
	case *Object:
		out := []Value{}
		for _, k := range x.Keys() {
			out = append(out, k)
		}
		return out, nil
	case string:
		out := []Value{}
		for i := 0; i < len(x); {
			_, n := decodeWTF8(x[i:])
			out = append(out, x[i:i+n])
			i += n
		}
		return out, nil
	}
	return nil, fmt.Errorf("'%s' object is not iterable", TypeName(v))
}
