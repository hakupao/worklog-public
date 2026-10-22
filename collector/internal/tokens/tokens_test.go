package tokens

import (
	"math"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/BurntSushi/toml"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

type pricing = map[string]map[string]float64

// golden is the slice of golden/tokens.json read with encoding/json (no order or int/float needed).
type golden struct {
	Fields         []string
	NormalizeModel []struct{ In, Out string } `json:"normalize_model"`
	PriceFor       []struct {
		Model string
		Rates map[string]float64
	} `json:"price_for"`
	PricingExample pricing `json:"pricing_example"`
	PricingCustom  pricing `json:"pricing_custom"`
}

func loadGolden(t *testing.T) golden {
	t.Helper()
	var g golden
	testkit.Golden(t, "tokens", &g)
	return g
}

// orderedGolden is golden/tokens.json decoded with pyjson, for the cases where key order and the
// int/float distinction are the point.
func orderedGolden(t *testing.T) *pyjson.Object {
	t.Helper()
	var raw []byte
	testkit.Golden(t, "tokens", &raw)
	v, err := pyjson.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	return v.(*pyjson.Object)
}

func get(t *testing.T, o *pyjson.Object, k string) pyjson.Value {
	t.Helper()
	v, ok := o.Get(k)
	if !ok {
		t.Fatalf("golden: no key %q", k)
	}
	return v
}

// rowOf is a FIELDS row of the golden as a Usage.
func rowOf(t *testing.T, o *pyjson.Object) Usage {
	t.Helper()
	var u Usage
	for i, f := range Fields {
		u[i] = int64(get(t, o, f).(pyjson.Int))
	}
	return u
}

// tallyOf rebuilds a Tally from a golden as_dict value, model order kept for both buckets.
func tallyOf(t *testing.T, v *pyjson.Object) *Tally {
	t.Helper()
	tl := NewTally()
	for _, bucket := range []struct {
		name string
		dst  *bucket
	}{{"by_model", &tl.byModel}, {"subagent", &tl.subagent}} {
		b := get(t, v, bucket.name).(*pyjson.Object)
		for _, m := range b.Keys() {
			u := rowOf(t, get(t, b, m).(*pyjson.Object))
			*bucket.dst.row(m) = u
		}
	}
	return tl
}

func row(input, output, cacheRead, w5, w1, reasoning int64) Usage {
	return Usage{input, output, cacheRead, w5, w1, reasoning}
}

func TestFieldsGolden(t *testing.T) {
	g := loadGolden(t)
	if !reflect.DeepEqual(g.Fields, Fields[:]) {
		t.Fatalf("Fields = %v, golden %v", Fields, g.Fields)
	}
}

// test_normalize_model_strips_date_and_bracket_suffixes (all four parametrized cases are in the golden).
func TestNormalizeModelGolden(t *testing.T) {
	for _, c := range loadGolden(t).NormalizeModel {
		if got := NormalizeModel(c.In); got != c.Out {
			t.Errorf("NormalizeModel(%q) = %q, want %q", c.In, got, c.Out)
		}
	}
}

// Python's re: \d is any Unicode decimal digit and $ also matches before a final "\n"; the bracket
// match is the leftmost one that reaches the end.
func TestNormalizeModelRegexEdges(t *testing.T) {
	for in, want := range map[string]string{
		"m-٢٠٢٦٠١٠١":      "m",
		"x[a[b]":          "x",
		"a-20260101\n[x]": "a\n",
		"a\n[1m]":         "a\n",
		"m-2026010a":      "m-2026010a",
		"m20260101":       "m20260101",
		"m-120260101":     "m-120260101",
		"m[a]b":           "m[a]b",
		"m[]":             "m",
		"m[x]　":           "m",
		"m-20260101[1m] ": "m",
		"m-1234567８[a]x]": "m-1234567８[a]x]",
	} {
		if got := NormalizeModel(in); got != want {
			t.Errorf("NormalizeModel(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPriceForGolden(t *testing.T) {
	g := loadGolden(t)
	for _, c := range g.PriceFor {
		got, ok := PriceFor(c.Model, g.PricingExample)
		if ok != (c.Rates != nil) || !reflect.DeepEqual(got, c.Rates) && ok {
			t.Errorf("PriceFor(%q) = %v, %v; want %v", c.Model, got, ok, c.Rates)
		}
	}
}

// test_price_for_matches_the_id_exactly_once_suffixes_are_stripped
func TestPriceForMatchesTheIDExactlyOnceSuffixesAreStripped(t *testing.T) {
	p := loadGolden(t).PricingExample
	for model, want := range map[string][2]any{
		"claude-opus-5-5":           {"input", 4.0},
		"claude-opus-5":             {"input", 5.0},
		"claude-haiku-4-5-20251001": {"input", 1.0},
		"claude-opus-5-5[1m]":       {"input", 4.0},
		"claude-fable-5-1":          {"cache_read", 0.25},
		"claude-fable-5":            {"cache_read", 1.00},
	} {
		r, ok := PriceFor(model, p)
		if !ok || r[want[0].(string)] != want[1].(float64) {
			t.Errorf("PriceFor(%q) = %v, %v", model, r, ok)
		}
	}
	for _, unknown := range []string{"claude-fable-5-2", "claude-sonnet-5-1", "claude-opus-5-5-mini", "claude-opus-50", "gpt-6-luna"} {
		if _, ok := PriceFor(unknown, p); ok {
			t.Errorf("PriceFor(%q) found a price", unknown)
		}
	}
}

// test_fast_mode_only_matches_a_fast_price
func TestFastModeOnlyMatchesAFastPrice(t *testing.T) {
	p := loadGolden(t).PricingExample
	if r, ok := PriceFor("claude-opus-5-5:fast", p); !ok || r["output"] != 40.0 {
		t.Errorf("opus-5-5:fast = %v, %v", r, ok)
	}
	if _, ok := PriceFor("claude-opus-5:fast", p); ok {
		t.Error("opus-5:fast has no fast price")
	}
	if _, ok := PriceFor("claude-opus-5-5", pricing{"claude-opus-5-5:fast": {"input": 8}}); ok {
		t.Error("a standard model matched a :fast entry")
	}
}

func repoPricing(t *testing.T, name string) pricing {
	t.Helper()
	var doc struct{ Pricing pricing }
	if _, err := toml.DecodeFile(filepath.Join(testkit.TestdataDir(t), "..", "..", name), &doc); err != nil {
		t.Fatal(err)
	}
	return doc.Pricing
}

// test_pricing_table_is_the_one_in_the_plan, on config.example.toml. Its second half, comparing the
// machine's own config.toml with it, was dropped on 2026-10-22 so that no test depends on the
// repo-root config.toml (a public copy of the repo has none).
func TestPricingTableIsTheOneInThePlan(t *testing.T) {
	example := repoPricing(t, "config.example.toml")
	expected := map[string][3]float64{
		"claude-fable-5-1": {10, 50, 0.25}, "claude-fable-5": {10, 50, 1.00}, "claude-opus-5-5": {4, 20, 0.20},
		"claude-opus-5": {5, 25, 0.50}, "claude-opus-4-8": {5, 25, 0.50}, "claude-opus-4-7": {5, 25, 0.50},
		"claude-opus-4-6": {5, 25, 0.50}, "claude-sonnet-5-5": {2, 10, 0.20}, "claude-sonnet-5": {2, 10, 0.20},
		"claude-sonnet-4-6": {3, 15, 0.30}, "claude-haiku-4-5": {1, 5, 0.10},
	}
	openai := map[string][4]float64{
		"gpt-6-astra": {10, 50, 1.00, 12.5}, "gpt-6-sol": {2, 10, 0.20, 2.5},
		"gpt-6.1-sol": {2, 10, 0.10, 2.5}, "gpt-5.6-sol": {4, 20, 0.40, 5.0},
	}
	if len(example) != len(expected)+len(openai)+1 {
		t.Errorf("[pricing] has %d models", len(example))
	}
	for m, r := range openai {
		want := map[string]float64{"input": r[0], "output": r[1], "cache_read": r[2], "cache_write_5m": r[3]}
		if !reflect.DeepEqual(example[m], want) {
			t.Errorf("%s = %v, want %v", m, example[m], want)
		}
	}
	if want := (map[string]float64{"input": 8, "output": 40}); !reflect.DeepEqual(example["claude-opus-5-5:fast"], want) {
		t.Errorf("opus-5-5:fast = %v", example["claude-opus-5-5:fast"])
	}
	for m, r := range expected {
		p := example[m]
		if p["input"] != r[0] || p["output"] != r[1] || p["cache_read"] != r[2] ||
			math.Abs(p["cache_write_5m"]-1.25*r[0]) > 1e-9 || math.Abs(p["cache_write_1h"]-2*r[0]) > 1e-9 {
			t.Errorf("%s = %v", m, p)
		}
	}
	if g := loadGolden(t).PricingExample; !reflect.DeepEqual(g, example) {
		t.Errorf("golden pricing_example differs from config.example.toml")
	}
}

// Every with_cost case of the golden: the ordered value, and json.dumps of it byte for byte (cost_usd
// a float, "0.0" not "0"; the summation order cases change the last digits otherwise).
func TestWithCostGolden(t *testing.T) {
	g := orderedGolden(t)
	tables := map[string]pricing{"example": loadGolden(t).PricingExample, "custom": loadGolden(t).PricingCustom}
	for _, cv := range get(t, g, "with_cost").([]pyjson.Value) {
		c := cv.(*pyjson.Object)
		name := get(t, c, "name").(string)
		var tl *Tally
		if tv := get(t, c, "tokens"); tv != nil {
			tl = tallyOf(t, tv.(*pyjson.Object))
		}
		out := WithCost(tl, tables[get(t, c, "pricing").(string)])
		want := get(t, c, "out")
		if want == nil {
			if out != nil {
				t.Errorf("%s: WithCost = %s, want nil", name, pyjson.Dumps(out, pyjson.Default()))
			}
			continue
		}
		if out == nil {
			t.Errorf("%s: WithCost = nil", name)
			continue
		}
		if !pyjson.Equal(out, want) {
			t.Errorf("%s: WithCost = %s, want %s", name, pyjson.Dumps(out, pyjson.Default()), pyjson.Dumps(want, pyjson.Default()))
		}
		if got, wantJSON := string(pyjson.Dumps(out, pyjson.Default())), get(t, c, "out_json").(string); got != wantJSON {
			t.Errorf("%s: json.dumps\n got %s\nwant %s", name, got, wantJSON)
		}
	}
}

func costOf(t *testing.T, o *pyjson.Object) (cost *float64, partial bool) {
	t.Helper()
	if v := get(t, o, "cost_usd"); v != nil {
		f := float64(v.(pyjson.Float))
		cost = &f
	}
	return cost, get(t, o, "cost_partial").(bool)
}

func single(model string, u Usage) *Tally {
	tl := NewTally()
	tl.Add(model, u, false)
	return tl
}

func approx(a, b float64) bool { return math.Abs(a-b) <= 1e-6*math.Max(1, math.Abs(b)) }

// test_an_unlisted_claude_model_makes_the_cost_partial
func TestAnUnlistedClaudeModelMakesTheCostPartial(t *testing.T) {
	tl := NewTally()
	tl.Add("claude-fable-5-2", row(1_000_000, 0, 0, 0, 0, 0), false)
	tl.Add("claude-opus-5-5", row(1_000_000, 0, 0, 0, 0, 0), false)
	cost, partial := costOf(t, WithCost(tl, loadGolden(t).PricingExample))
	if cost == nil || !approx(*cost, 4.0) || !partial {
		t.Errorf("cost %v partial %v", cost, partial)
	}
}

// test_with_cost_prices_every_billed_field_but_not_reasoning
func TestWithCostPricesEveryBilledFieldButNotReasoning(t *testing.T) {
	tl := single("claude-opus-5-5", row(1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 999))
	out := WithCost(tl, loadGolden(t).PricingExample)
	cost, partial := costOf(t, out)
	if cost == nil || !approx(*cost, 4+20+0.20+5+8) || partial {
		t.Errorf("cost %v partial %v", cost, partial)
	}
	byModel, _ := tl.Value().Get("by_model")
	if !pyjson.Equal(get(t, out, "by_model"), byModel) {
		t.Error("by_model changed")
	}
}

// test_with_cost_is_partial_with_an_unpriced_model_and_null_when_nothing_is_priced
func TestWithCostIsPartialWithAnUnpricedModelAndNullWhenNothingIsPriced(t *testing.T) {
	p := loadGolden(t).PricingExample
	mixed := NewTally()
	mixed.Add("claude-haiku-4-5-20251001", row(0, 1_000_000, 0, 0, 0, 0), false)
	mixed.Add("gpt-6-luna", row(5, 0, 0, 0, 0, 0), false)
	if cost, partial := costOf(t, WithCost(mixed, p)); cost == nil || !approx(*cost, 5.0) || !partial {
		t.Errorf("mixed: cost %v partial %v", cost, partial)
	}
	if cost, partial := costOf(t, WithCost(single("gpt-6-luna", row(5, 0, 0, 0, 0, 0)), p)); cost != nil || !partial {
		t.Errorf("codex only: cost %v partial %v", cost, partial)
	}
}

// test_with_cost_prices_codex_cached_input_and_cache_writes
func TestWithCostPricesCodexCachedInputAndCacheWrites(t *testing.T) {
	tl := single("gpt-6-astra", row(1_000_000, 1_000_000, 1_000_000, 1_000_000, 0, 999))
	if cost, partial := costOf(t, WithCost(tl, loadGolden(t).PricingExample)); cost == nil || !approx(*cost, 10+50+1.00+12.5) || partial {
		t.Errorf("cost %v partial %v", cost, partial)
	}
}

// test_with_cost_of_nothing
func TestWithCostOfNothing(t *testing.T) {
	p := loadGolden(t).PricingExample
	if WithCost(nil, p) != nil {
		t.Error("WithCost(nil) is not nil")
	}
	if got := string(pyjson.Dumps(WithCost(NewTally(), p), pyjson.Default())); got != `{"by_model": {}, "subagent": {}, "cost_usd": 0.0, "cost_partial": false}` {
		t.Errorf("empty: %s", got)
	}
	if _, partial := costOf(t, WithCost(single("gpt-6-sol", row(0, 0, 0, 0, 0, 3)), p)); partial {
		t.Error("a model with nothing billable made the cost partial")
	}
}

// test_with_cost_is_partial_when_a_price_leaves_a_used_field_out
func TestWithCostIsPartialWhenAPriceLeavesAUsedFieldOut(t *testing.T) {
	tl := single("m", row(1_000_000, 0, 0, 0, 10, 0))
	cost, partial := costOf(t, WithCost(tl, pricing{"m": {"input": 2.0, "output": 1.0}}))
	if cost == nil || !approx(*cost, 2.0) || !partial {
		t.Errorf("cost %v partial %v", cost, partial)
	}
}

// The golden tally: Add keeps first-seen model order in both buckets, AddSubagent counts another
// tally's by_model as subagent usage (and in by_model).
func TestTallyGolden(t *testing.T) {
	g := orderedGolden(t)
	want := get(t, get(t, g, "tally").([]pyjson.Value)[0].(*pyjson.Object), "as_dict")
	tl := NewTally()
	tl.Add("b", row(1, 2, 0, 0, 0, 0), false)
	tl.Add("a", row(3, 0, 0, 0, 0, 0), true)
	tl.Add("b", row(0, 0, 0, 0, 0, 4), false)
	other := NewTally()
	other.Add("c", row(0, 5, 0, 0, 0, 0), false)
	other.Add("a", row(0, 0, 6, 0, 0, 0), false)
	tl.AddSubagent(other)
	if got := tl.Value(); !pyjson.Equal(got, want) || string(pyjson.Dumps(got, pyjson.Default())) != string(pyjson.Dumps(want, pyjson.Default())) {
		t.Errorf("Value = %s\nwant %s", pyjson.Dumps(got, pyjson.Default()), pyjson.Dumps(want, pyjson.Default()))
	}
}

// Value is a snapshot: later adds do not change an earlier value, and WithCost does not alias the tally.
func TestValueIsASnapshot(t *testing.T) {
	tl := single("m", row(1, 0, 0, 0, 0, 0))
	v := tl.Value()
	before := string(pyjson.Dumps(v, pyjson.Default()))
	tl.Add("m", row(1, 0, 0, 0, 0, 0), false)
	tl.Add("n", row(1, 0, 0, 0, 0, 0), false)
	if after := string(pyjson.Dumps(v, pyjson.Default())); after != before {
		t.Errorf("Value changed: %s → %s", before, after)
	}
}

// The cost is summed in by_model insertion order (Review Focus 3): these three models give
// 60.767843 in the order a, b, c and 60.767844 in the order c, b, a (CPython 3.14.4's with_cost).
func TestWithCostSumsInModelInsertionOrder(t *testing.T) {
	p := pricing{
		"a": {"input": 4, "output": 20, "cache_read": 0.2},
		"b": {"input": 10, "cache_read": 0.25, "output": 50},
		"c": {"input": 0.1, "output": 0.3},
	}
	usage := map[string]Usage{
		"a": row(1227982, 398701, 19774081, 0, 0, 0),
		"b": row(2097442, 357457, 15393346, 0, 0, 0),
		"c": row(9855070, 819886, 50739621, 0, 0, 0),
	}
	for _, c := range []struct {
		order string
		want  float64
	}{{"abc", 60.767843}, {"cba", 60.767844}} {
		tl := NewTally()
		for _, m := range c.order {
			tl.Add(string(m), usage[string(m)], false)
		}
		if cost, _ := costOf(t, WithCost(tl, p)); cost == nil || *cost != c.want {
			t.Errorf("%s: cost %s, want %v", c.order, pyjson.Dumps(WithCost(tl, p), pyjson.Default()), c.want)
		}
	}
}
