package pyjson

import (
	"math"
	"testing"
)

// Expected values printed by CPython 3.14.4: str(v) and bool(v) of json.loads values.
func TestStrIsPythonsStr(t *testing.T) {
	o := NewObject()
	o.Set("k", "v's")
	nested := NewObject()
	nested.Set("a", []Value{Float(1e16), Float(1e-5), Float(math.NaN()), Float(math.Inf(1))})
	for _, c := range []struct {
		v    Value
		want string
	}{
		{Int(1), "1"},
		{Float(1.5), "1.5"},
		{true, "True"},
		{false, "False"},
		{nil, "None"},
		{"a", "a"},
		{[]Value{Int(1), "a", nil, true, o, Float(1.5), `x"y`, `a'b"c`, "\x00\u2028\xed\xa0\x80é😀\t\n\\"},
			"[1, 'a', None, True, {'k': \"v's\"}, 1.5, 'x\"y', 'a\\'b\"c', '\\x00\\u2028\\ud800é😀\\t\\n\\\\']"},
		{NewObject(), "{}"},
		{[]Value{}, "[]"},
		{nested, "{'a': [1e+16, 1e-05, nan, inf]}"},
		{"\u00a0\x7f\U000e0001", "\u00a0\x7f\U000e0001"}, // a bare str is itself
		{[]Value{"\u00a0\x7f\U000e0001"}, `['\xa0\x7f\U000e0001']`},
	} {
		if got := Str(c.v); got != c.want {
			t.Errorf("Str(%#v) = %q, want %q", c.v, got, c.want)
		}
	}
}

func TestTruthyIsPythonsBool(t *testing.T) {
	full := NewObject()
	full.Set("a", nil)
	for _, c := range []struct {
		v    Value
		want bool
	}{
		{nil, false}, {false, false}, {true, true}, {Int(0), false}, {Int(-1), true},
		{Float(0), false}, {Float(math.Copysign(0, -1)), false}, {Float(math.NaN()), true},
		{"", false}, {" ", true}, {[]Value{}, false}, {[]Value{nil}, true},
		{NewObject(), false}, {full, true}, {(*Object)(nil), false},
	} {
		if got := Truthy(c.v); got != c.want {
			t.Errorf("Truthy(%#v) = %v", c.v, got)
		}
	}
}

func TestTypeNameIsPythons(t *testing.T) {
	for v, want := range map[string]Value{
		"NoneType": nil, "bool": true, "int": Int(1), "float": Float(1), "str": "", "list": []Value{}, "dict": NewObject(),
	} {
		if got := TypeName(want); got != v {
			t.Errorf("TypeName(%#v) = %q, want %q", want, got, v)
		}
	}
}

// Messages printed by CPython 3.14.4 for v["k"] and iter(v).
func TestSubscriptAndIterRaiseAsPython(t *testing.T) {
	o := NewObject()
	o.Set("k", Int(1))
	o.Set("j", nil)
	for _, c := range []struct {
		v    Value
		want Value
		err  string
	}{
		{o, Int(1), ""},
		{NewObject(), nil, "'k'"},
		{"s", nil, "string indices must be integers, not 'str'"},
		{[]Value{}, nil, "list indices must be integers or slices, not str"},
		{nil, nil, "'NoneType' object is not subscriptable"},
		{Int(1), nil, "'int' object is not subscriptable"},
		{Float(1), nil, "'float' object is not subscriptable"},
		{true, nil, "'bool' object is not subscriptable"},
	} {
		got, err := Subscript(c.v, "k")
		if c.err == "" && (err != nil || got != c.want) || c.err != "" && (err == nil || err.Error() != c.err) {
			t.Errorf("Subscript(%#v) = %v, %v", c.v, got, err)
		}
	}
	for _, c := range []struct {
		v    Value
		want string
		err  string
	}{
		{[]Value{Int(1), "a"}, "[1, 'a']", ""},
		{o, "['k', 'j']", ""},
		{"aé😀", "['a', 'é', '😀']", ""},
		{nil, "", "'NoneType' object is not iterable"},
		{Int(1), "", "'int' object is not iterable"},
		{Float(1), "", "'float' object is not iterable"},
		{false, "", "'bool' object is not iterable"},
	} {
		got, err := Iter(c.v)
		if c.err == "" && (err != nil || Str(got) != c.want) || c.err != "" && (err == nil || err.Error() != c.err) {
			t.Errorf("Iter(%#v) = %v, %v", c.v, got, err)
		}
	}
}
