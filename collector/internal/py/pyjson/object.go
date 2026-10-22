// Package pyjson is ordered JSON with Python's json semantics (spec §5.1): objects keep insertion
// order, integers and floats stay apart, and Dumps writes what CPython's json.dumps writes.
package pyjson

// Value is a decoded JSON value: nil | bool | Int | BigInt | Float | string | []Value | *Object.
// Dumps also takes int, int64, float64, []string and []*Object.
type Value = any

// Int is a JSON integer literal within int64.
type Int int64

// BigInt is a JSON integer literal beyond int64, a Python int all the same, kept as its decimal text
// (an optional "-", then digits without a leading zero). Dumps writes it back verbatim; Equal
// compares it by value. Code that needs the number (a token count, an int() coercion) treats it as
// not an integer (spec §6 D4).
type BigInt string

// Float is a JSON number with a fraction or an exponent; it dumps as Python's repr ("2.0").
type Float float64

// Object is a JSON object in insertion order. Setting an existing key keeps its position, as a
// Python dict does. A small object finds its keys by looking through them; the map is built only once
// it has indexFrom keys, since a log holds millions of small objects and a map each was a third of
// what the parse allocated.
type Object struct {
	keys  []string
	index map[string]int // nil below indexFrom keys
	vals  []Value
}

const indexFrom = 8

func NewObject() *Object { return &Object{} }

// find is the position of k, or -1.
func (o *Object) find(k string) int {
	if o.index != nil {
		if i, ok := o.index[k]; ok {
			return i
		}
		return -1
	}
	for i, key := range o.keys {
		if key == k {
			return i
		}
	}
	return -1
}

func (o *Object) Get(k string) (Value, bool) {
	if o == nil {
		return nil, false
	}
	i := o.find(k)
	if i < 0 {
		return nil, false
	}
	return o.vals[i], true
}

func (o *Object) Set(k string, v Value) {
	if i := o.find(k); i >= 0 {
		o.vals[i] = v
		return
	}
	o.keys = append(o.keys, k)
	o.vals = append(o.vals, v)
	if o.index != nil {
		o.index[k] = len(o.keys) - 1
	} else if len(o.keys) >= indexFrom {
		o.reindex()
	}
}

func (o *Object) reindex() {
	o.index = make(map[string]int, len(o.keys))
	for j, key := range o.keys {
		o.index[key] = j
	}
}

func (o *Object) Delete(k string) {
	i := o.find(k)
	if i < 0 {
		return
	}
	o.keys = append(o.keys[:i], o.keys[i+1:]...)
	o.vals = append(o.vals[:i], o.vals[i+1:]...)
	if o.index != nil {
		delete(o.index, k)
		for j := i; j < len(o.keys); j++ {
			o.index[o.keys[j]] = j
		}
	}
}

// Keys returns a copy of the keys, in order.
func (o *Object) Keys() []string {
	if o == nil {
		return nil
	}
	return append([]string(nil), o.keys...)
}

func (o *Object) Len() int {
	if o == nil {
		return 0
	}
	return len(o.keys)
}
