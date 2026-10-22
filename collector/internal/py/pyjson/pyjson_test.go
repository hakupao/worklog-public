package pyjson_test

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

type goldenCase struct {
	Name    string `json:"name"`
	Input   string `json:"input"`
	Default string `json:"default"`
	Unicode string `json:"unicode"`
	Indent1 string `json:"indent1"`
	Sorted  string `json:"sorted"`
	Compact string `json:"compact"`
}

func loadCases(t *testing.T) []goldenCase {
	var g struct {
		Cases []goldenCase `json:"cases"`
	}
	testkit.Golden(t, "pyjson", &g)
	if len(g.Cases) == 0 {
		t.Fatal("no pyjson cases")
	}
	return g.Cases
}

func modes() map[string]func(pyjson.Value) []byte {
	return map[string]func(pyjson.Value) []byte{
		"default": func(v pyjson.Value) []byte { return pyjson.Dumps(v, pyjson.Default()) },
		"unicode": func(v pyjson.Value) []byte { return pyjson.Dumps(v, pyjson.Unicode()) },
		"indent1": func(v pyjson.Value) []byte { return pyjson.Dumps(v, pyjson.Indented(1)) },
		"sorted":  func(v pyjson.Value) []byte { return pyjson.Dumps(v, pyjson.Default().Sorted()) },
		"compact": pyjson.Compact,
	}
}

func want(c goldenCase, mode string) string {
	return map[string]string{
		"default": c.Default, "unicode": c.Unicode, "indent1": c.Indent1, "sorted": c.Sorted, "compact": c.Compact,
	}[mode]
}

// Every golden case, in every mode json.dumps was run in.
func TestGoldenModes(t *testing.T) {
	for _, c := range loadCases(t) {
		v, err := pyjson.Decode([]byte(c.Input))
		if err != nil {
			t.Fatalf("%s: Decode: %v", c.Name, err)
		}
		for mode, dump := range modes() {
			if got := string(dump(v)); got != want(c, mode) {
				t.Errorf("%s/%s:\n got %q\nwant %q", c.Name, mode, got, want(c, mode))
			}
		}
	}
}

// Property: decoding what Python wrote and dumping it in the same mode gives Python's bytes back.
func TestRoundTripPythonOutput(t *testing.T) {
	for _, c := range loadCases(t) {
		for mode, dump := range modes() {
			out := want(c, mode)
			v, err := pyjson.Decode([]byte(out))
			if err != nil {
				t.Fatalf("%s/%s: Decode(%q): %v", c.Name, mode, out, err)
			}
			if got := string(dump(v)); got != out {
				t.Errorf("%s/%s round trip:\n got %q\nwant %q", c.Name, mode, got, out)
			}
			// Every mode's output decodes to the same value as the input (sorted reorders keys,
			// which the ordered comparison counts as a difference).
			in, _ := pyjson.Decode([]byte(c.Input))
			if mode != "sorted" && !pyjson.Equal(in, v) {
				t.Errorf("%s/%s: decoded output differs from decoded input", c.Name, mode)
			}
		}
	}
}

func TestIntFloatDistinction(t *testing.T) {
	for in, want := range map[string]pyjson.Value{
		"1": pyjson.Int(1), "-0": pyjson.Int(0), "1.0": pyjson.Float(1), "1e5": pyjson.Float(1e5),
		"1E5": pyjson.Float(1e5), "-0.0": pyjson.Float(math.Copysign(0, -1)), "2.5e-5": pyjson.Float(2.5e-5),
		"9223372036854775807": pyjson.Int(math.MaxInt64), "-9223372036854775808": pyjson.Int(math.MinInt64),
	} {
		v, err := pyjson.Decode([]byte(in))
		if err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		if v != want {
			t.Errorf("Decode(%s) = %#v, want %#v", in, v, want)
		}
	}
	for _, in := range []string{"NaN", "Infinity", "-Infinity", "1e400"} {
		v, err := pyjson.Decode([]byte(in))
		if err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		if _, ok := v.(pyjson.Float); !ok {
			t.Errorf("Decode(%s) = %#v, want a Float", in, v)
		}
	}
	// json.dumps spells the non-finite floats the way json.loads reads them.
	for in, want := range map[string]string{"NaN": "NaN", "Infinity": "Infinity", "-Infinity": "-Infinity", "1e400": "Infinity"} {
		v, _ := pyjson.Decode([]byte(in))
		if got := string(pyjson.Dumps(v, pyjson.Default())); got != want {
			t.Errorf("Dumps(Decode(%s)) = %s, want %s", in, got, want)
		}
	}
}

// An integer literal beyond int64 is a Python int like any other: kept as BigInt text, written back
// verbatim, truthy, an "int", and equal by value (CPython 3.14.4: 2**64 == float(2**64), while
// 12345678901234567890 != 1.2345678901234567e19).
func TestBigInt(t *testing.T) {
	for in, want := range map[string]pyjson.Value{
		"9223372036854775808": pyjson.BigInt("9223372036854775808"), "-9223372036854775809": pyjson.BigInt("-9223372036854775809"),
		strings.Repeat("9", 4300): pyjson.BigInt(strings.Repeat("9", 4300)), "-" + strings.Repeat("9", 4300): pyjson.BigInt("-" + strings.Repeat("9", 4300)),
	} {
		v, err := pyjson.Decode([]byte(in))
		if err != nil || v != want {
			t.Errorf("Decode(%.30s) = %#v, %v", in, v, err)
		}
	}
	v, err := pyjson.Decode([]byte(`{"id": 12345678901234567890, "n": [-18446744073709551616]}`))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(pyjson.Compact(v)); got != `{"id":12345678901234567890,"n":[-18446744073709551616]}` {
		t.Errorf("Compact = %s", got)
	}
	if got := string(pyjson.Dumps(v, pyjson.Indented(1))); got != "{\n \"id\": 12345678901234567890,\n \"n\": [\n  -18446744073709551616\n ]\n}" {
		t.Errorf("Dumps = %q", got)
	}
	big := pyjson.BigInt("12345678901234567890")
	if !pyjson.Truthy(big) || pyjson.TypeName(big) != "int" || pyjson.Str(big) != "12345678901234567890" {
		t.Errorf("Truthy %v TypeName %q Str %q", pyjson.Truthy(big), pyjson.TypeName(big), pyjson.Str(big))
	}
	for _, c := range []struct {
		a, b pyjson.Value
		want bool
	}{
		{big, pyjson.BigInt("12345678901234567890"), true},
		{big, pyjson.BigInt("12345678901234567891"), false},
		{big, pyjson.Float(1.2345678901234567e19), false},
		{pyjson.BigInt("18446744073709551616"), pyjson.Float(18446744073709551616), true},
		{pyjson.Float(-18446744073709551616), pyjson.BigInt("-18446744073709551616"), true},
		{pyjson.BigInt("18446744073709551616"), pyjson.Float(math.Inf(1)), false},
		{pyjson.BigInt("9223372036854775808"), pyjson.Int(math.MaxInt64), false},
		{pyjson.Int(math.MinInt64), pyjson.BigInt("-9223372036854775809"), false},
		{big, "12345678901234567890", false},
		{big, true, false},
	} {
		if got := pyjson.Equal(c.a, c.b); got != c.want {
			t.Errorf("Equal(%#v, %#v) = %v", c.a, c.b, got)
		}
	}
}

// json.loads rejects these; so must Decode.
func TestDecodeErrors(t *testing.T) {
	for _, in := range []string{
		"", " ", "1 2", "{", "[1,]", "{\"a\":1,}", "{'a': 1}", "01", "1.", ".5", "+1", "-", "1e", "tru",
		"\"\x01\"", "\"a\nb\"", "\"\\x\"", "\"\\u12\"", "\"abc", "\ufeff{}", "\"\xff\"", "nan", "inf",
		"{1: 2}", "[1 2]",
		// int() refuses more than 4300 digits (sys.int_info.default_max_str_digits): ValueError.
		strings.Repeat("1", 4301), "-" + strings.Repeat("1", 4301),
	} {
		if v, err := pyjson.Decode([]byte(in)); err == nil {
			t.Errorf("Decode(%q) = %#v, want an error", in, v)
		}
	}
	// Python's JSON whitespace is exactly " \t\n\r".
	if _, err := pyjson.Decode([]byte(" \t\r\n[1]\n")); err != nil {
		t.Errorf("whitespace: %v", err)
	}
	if _, err := pyjson.Decode([]byte("\v[1]")); err == nil {
		t.Errorf("\\v is not JSON whitespace")
	}
}

// Strings are scanned a word at a time; whatever byte ends a run (closing quote, escape, control
// character) and wherever it falls in the word, the result is the byte-by-byte one.
func TestStringScanAtEveryOffset(t *testing.T) {
	fill := "aé日\x7f !#~"
	for n := range 26 {
		prefix := strings.Repeat(fill, 3)[:n]
		if !utf8.ValidString(prefix) {
			continue
		}
		for _, c := range []struct{ tail, want string }{
			{`"`, ""}, {`\n"`, "\n"}, {`\"x" `, `"x`}, {`\u00e9\\"`, "é\\"}, {"x" + strings.Repeat("y", 17) + `"`, "x" + strings.Repeat("y", 17)},
		} {
			in := `"` + prefix + c.tail
			v, err := pyjson.Decode([]byte(in))
			if err != nil || v != prefix+c.want {
				t.Errorf("Decode(%q) = %q, %v; want %q", in, v, err, prefix+c.want)
			}
		}
		for _, bad := range []string{"\x01\"", "\x1f\"", "\n\"", ""} {
			if v, err := pyjson.Decode([]byte(`"` + prefix + bad)); err == nil {
				t.Errorf("Decode(%q) = %q, want an error", `"`+prefix+bad, v)
			}
		}
	}
}

// A lone surrogate survives json.loads → json.dumps (ensure_ascii) as Python keeps it.
func TestLoneSurrogate(t *testing.T) {
	for _, in := range []string{`"\ud800"`, `"a\udfffb"`, `"\ud83dx\ude00"`, `["\udbff", "\udc00"]`} {
		v, err := pyjson.Decode([]byte(in))
		if err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		if got := string(pyjson.Dumps(v, pyjson.Default())); got != in {
			t.Errorf("Dumps(Decode(%s)) = %s", in, got)
		}
	}
	// An escaped pair is one astral character.
	v, _ := pyjson.Decode([]byte(`"\ud83d\ude00"`))
	if v != "😀" {
		t.Errorf("pair = %q", v)
	}
}

func TestObjectOrder(t *testing.T) {
	o := pyjson.NewObject()
	o.Set("z", pyjson.Int(1))
	o.Set("a", pyjson.Int(2))
	o.Set("m", pyjson.Int(3))
	o.Set("z", pyjson.Int(9)) // keeps its position
	if got := strings.Join(o.Keys(), ","); got != "z,a,m" {
		t.Fatalf("keys = %s", got)
	}
	if v, ok := o.Get("z"); !ok || v != pyjson.Int(9) {
		t.Fatalf("z = %v %v", v, ok)
	}
	o.Delete("a")
	o.Delete("nope")
	if got := strings.Join(o.Keys(), ","); got != "z,m" || o.Len() != 2 {
		t.Fatalf("after delete: %s (%d)", got, o.Len())
	}
	if _, ok := o.Get("a"); ok {
		t.Fatal("a still there")
	}
	o.Set("a", pyjson.Int(4)) // re-added at the end
	if got := string(pyjson.Dumps(o, pyjson.Default())); got != `{"z": 9, "m": 3, "a": 4}` {
		t.Fatalf("dumps = %s", got)
	}
	if got := string(pyjson.Dumps(o, pyjson.Default().Sorted())); got != `{"a": 4, "m": 3, "z": 9}` {
		t.Fatalf("sorted = %s", got)
	}
	if got := string(pyjson.Dumps(pyjson.NewObject(), pyjson.Indented(2))); got != "{}" {
		t.Fatalf("empty indented = %s", got)
	}
}

// A small object has no index map and a large one has; both behave as a dict, across the switch and
// after deletes, against a plain model of one.
func TestObjectAcrossItsIndexThreshold(t *testing.T) {
	o := pyjson.NewObject()
	var order []string
	model := map[string]pyjson.Value{}
	set := func(k string, v int) {
		if _, ok := model[k]; !ok {
			order = append(order, k)
		}
		model[k] = pyjson.Int(v)
		o.Set(k, pyjson.Int(v))
	}
	del := func(k string) {
		if _, ok := model[k]; ok {
			delete(model, k)
			order = slices.DeleteFunc(order, func(x string) bool { return x == k })
		}
		o.Delete(k)
	}
	check := func(step string) {
		t.Helper()
		if got := o.Keys(); !slices.Equal(got, order) {
			t.Fatalf("%s: keys %q, want %q", step, got, order)
		}
		for _, k := range append(slices.Clone(order), "absent", "k3", "k12") {
			v, ok := o.Get(k)
			if w, wok := model[k]; ok != wok || v != w {
				t.Fatalf("%s: Get(%s) = %v %v, want %v %v", step, k, v, ok, w, wok)
			}
		}
	}
	for i := range 12 {
		set("k"+strconv.Itoa(i), i)
		check("set " + strconv.Itoa(i))
	}
	set("k2", 99)
	del("k3")
	del("k0")
	check("after deletes")
	set("k3", 7)
	set("k11", 8)
	check("re-set")
	for i := range 12 {
		del("k" + strconv.Itoa(i))
	}
	check("emptied")
	set("x", 1)
	set("x", 2)
	check("small again")
}

// Go-side values (int, float64, []string, nil *Object) dump like their Python counterparts.
func TestDumpsGoValues(t *testing.T) {
	var nilObj *pyjson.Object
	v := []pyjson.Value{1, int64(2), 2.0, 0.5, []string{"a", "é"}, nilObj, nil, true, pyjson.Float(1e16)}
	if got := string(pyjson.Dumps(v, pyjson.Default())); got != `[1, 2, 2.0, 0.5, ["a", "\u00e9"], null, null, true, 1e+16]` {
		t.Fatalf("got %s", got)
	}
	if got := string(pyjson.Dumps([]pyjson.Value{}, pyjson.Indented(1))); got != "[]" {
		t.Fatalf("got %s", got)
	}
	if got := string(pyjson.Dumps([]pyjson.Value{1, []pyjson.Value{2}}, pyjson.Indented(0))); got != "[\n1,\n[\n2\n]\n]" {
		t.Fatalf("indent 0: %q", got)
	}
}

func TestEqual(t *testing.T) {
	dec := func(s string) pyjson.Value {
		v, err := pyjson.Decode([]byte(s))
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	for _, c := range []struct {
		a, b string
		eq   bool
	}{
		{`{"a": 1, "b": 2}`, `{"a":1.0,"b":2}`, true},
		{`{"a": 1, "b": 2}`, `{"b": 2, "a": 1}`, false},
		{`[1, 2]`, `[1, 2, 3]`, false},
		{`{"a": "x"}`, `{"a": "y"}`, false},
		{`{"a": null}`, `{"a": false}`, false},
		{`true`, `1`, false},
		{`0`, `-0.0`, true},
		{`"\u00e9"`, `"é"`, true},
		{`{"a": {"b": [1, {"c": 2.5}]}}`, `{"a": {"b": [1.0, {"c": 2.5}]}}`, true},
		{`{"a": 1}`, `{"a": 1, "b": 1}`, false},
		{`NaN`, `NaN`, false},
		{`9007199254740993`, `9007199254740992`, false},
		{`9007199254740992`, `9007199254740992.0`, true},
	} {
		if got := pyjson.Equal(dec(c.a), dec(c.b)); got != c.eq {
			t.Errorf("Equal(%s, %s) = %v", c.a, c.b, got)
		}
	}
}

// A nil *Object is JSON null on both sides of Equal, as in Dumps.
func TestEqualNilObject(t *testing.T) {
	var n1, n2 *pyjson.Object
	for _, c := range []struct {
		a, b pyjson.Value
		eq   bool
	}{
		{n1, n2, true},
		{n1, nil, true},
		{nil, n2, true},
		{n1, pyjson.NewObject(), false},
		{pyjson.NewObject(), n1, false},
		{pyjson.NewObject(), pyjson.NewObject(), true},
		{[]pyjson.Value{n1}, []pyjson.Value{nil}, true},
		{n1, false, false},
	} {
		if got := pyjson.Equal(c.a, c.b); got != c.eq {
			t.Errorf("Equal(%#v, %#v) = %v", c.a, c.b, got)
		}
	}
	if got := string(pyjson.Dumps(n1, pyjson.Default())); got != "null" {
		t.Errorf("Dumps(nil *Object) = %s", got)
	}
}
