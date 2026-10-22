// Package tokens is harvest/tokens.py: token usage per model, and its API-equivalent cost from the
// [pricing] table (spec §4.10).
//
// Model order is insertion order in both buckets, and the cost is summed in that order (Review
// Focus 3): the model names reach the server as z.record keys, and a different summation order
// changes the last digits of cost_usd.
package tokens

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
)

// Fields is tokens.FIELDS. Every field but reasoning (a part of output) is billed.
var Fields = [6]string{"input", "output", "cache_read", "cache_write_5m", "cache_write_1h", "reasoning"}

const billed = 5 // Fields[:billed] is _BILLED

// fastSuffix marks a fast-mode request of <model>, counted and priced as "<model>:fast".
const fastSuffix = ":fast"

// Usage is one row of counts, in Fields order.
type Usage [6]int64

// bucket is a dict[str, dict[str, int]] that keeps insertion order.
type bucket struct {
	models []string
	rows   map[string]*Usage
}

// row is bucket.setdefault(model, _zero()).
func (b *bucket) row(model string) *Usage {
	if r, ok := b.rows[model]; ok {
		return r
	}
	if b.rows == nil {
		b.rows = map[string]*Usage{}
	}
	r := new(Usage)
	b.rows[model] = r
	b.models = append(b.models, model)
	return r
}

// value is the bucket as an ordered object of ordered FIELDS objects, all ints.
func (b *bucket) value() *pyjson.Object {
	o := pyjson.NewObject()
	for _, m := range b.models {
		r := pyjson.NewObject()
		for i, f := range Fields {
			r.Set(f, pyjson.Int(b.rows[m][i]))
		}
		o.Set(m, r)
	}
	return o
}

// Tally is tokens.Tally: usage by model, and the part of it the session's subagents used.
type Tally struct{ byModel, subagent bucket }

func NewTally() *Tally { return &Tally{} }

// Add counts u under model in by_model, and in subagent too when a subagent made the request.
func (t *Tally) Add(model string, u Usage, subagent bool) {
	buckets := []*bucket{&t.byModel}
	if subagent {
		buckets = append(buckets, &t.subagent)
	}
	for _, b := range buckets {
		r := b.row(model)
		for i := range r {
			r[i] += u[i]
		}
	}
}

// AddSubagent counts everything o used as this session's subagent usage.
func (t *Tally) AddSubagent(o *Tally) {
	for _, m := range o.byModel.models {
		t.Add(m, *o.byModel.rows[m], true)
	}
}

// Value is as_dict(): {"by_model": {...}, "subagent": {...}}, a snapshot of the counts.
func (t *Tally) Value() *pyjson.Object {
	o := pyjson.NewObject()
	o.Set("by_model", t.byModel.value())
	o.Set("subagent", t.subagent.value())
	return o
}

// stripAtEnd applies one re.sub of a "...$" pattern: match(s) gives the start of the match ending at
// len(s) (or -1). Python's $ also matches just before a final "\n", which then stays.
func stripAtEnd(s string, match func(string) int) string {
	t, nl := s, ""
	if strings.HasSuffix(s, "\n") {
		t, nl = s[:len(s)-1], "\n"
	}
	if i := match(t); i >= 0 {
		return t[:i] + nl
	}
	return s
}

// bracketSuffix is the start of the leftmost match of `\[[^\]]*\]` that ends the string.
func bracketSuffix(s string) int {
	if !strings.HasSuffix(s, "]") {
		return -1
	}
	body := s[:len(s)-1]
	from := strings.LastIndexByte(body, ']') + 1
	if i := strings.IndexByte(body[from:], '['); i >= 0 {
		return from + i
	}
	return -1
}

// dateSuffix is the start of `-\d{8}` ending the string; \d is any Unicode decimal digit (Nd), as in
// Python's re on str.
func dateSuffix(s string) int {
	end := len(s)
	for range 8 {
		r, n := utf8.DecodeLastRuneInString(s[:end])
		if n == 0 || !unicode.Is(unicode.Nd, r) {
			return -1
		}
		end -= n
	}
	if end > 0 && s[end-1] == '-' {
		return end - 1
	}
	return -1
}

// NormalizeModel is normalize_model: strip, then drop a trailing "[…]" then a trailing "-YYYYMMDD"
// until nothing changes ("claude-opus-5-5[1m]" → "claude-opus-5-5").
func NormalizeModel(name string) string {
	name = pystr.Strip(name)
	for {
		stripped := stripAtEnd(stripAtEnd(name, bracketSuffix), dateSuffix)
		if stripped == name {
			return name
		}
		name = stripped
	}
}

// PriceFor is price_for: the [pricing] entry of the normalized model. A ":fast" model only matches
// a ":fast" entry, never the standard price.
func PriceFor(model string, pricing map[string]map[string]float64) (map[string]float64, bool) {
	key := NormalizeModel(model)
	if base, fast := strings.CutSuffix(model, fastSuffix); fast {
		key = NormalizeModel(base) + fastSuffix
	}
	r, ok := pricing[key]
	return r, ok
}

// WithCost is with_cost: t's value with cost_usd and cost_partial added; nil stays nil.
//
// A model with no price, or with tokens in a field its price leaves out, makes the cost partial;
// when no model used has a price at all, cost_usd is null rather than a misleading 0.
func WithCost(t *Tally, pricing map[string]map[string]float64) *pyjson.Object {
	if t == nil {
		return nil
	}
	cost := 0.0
	var billedAny, pricedAny, partial bool
	for _, m := range t.byModel.models {
		u := t.byModel.rows[m]
		used := false
		for i := range billed {
			used = used || u[i] != 0
		}
		if !used {
			continue
		}
		billedAny = true
		rates, ok := PriceFor(m, pricing)
		if !ok {
			partial = true
			continue
		}
		pricedAny = true
		for i, f := range Fields[:billed] {
			if u[i] == 0 {
				continue
			}
			rate, ok := rates[f]
			if !ok {
				partial = true
				continue
			}
			// usage[f] * float(rate) / 1_000_000, each step rounded on its own.
			q := float64(u[i]) * rate
			q /= 1_000_000
			cost += q
		}
	}
	out := t.Value()
	if pricedAny || !billedAny {
		out.Set("cost_usd", pyjson.Float(pytime.Round(cost, 6)))
	} else {
		out.Set("cost_usd", nil)
	}
	out.Set("cost_partial", partial)
	return out
}
