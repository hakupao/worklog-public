package pyjson

import (
	"math"
	"math/big"
)

// Equal is the ordered-value comparison of spec §5.2: objects have the same keys in the same order,
// strings and booleans are equal, and numbers are equal by value (Int 2 == Float 2.0, as in
// Python; a BigInt exactly, as a Python int), with NaN unequal to everything. A bool never equals a number. A nil *Object is JSON
// null (Dumps writes it so): equal to nil and to another nil *Object, not to an empty object.
func Equal(a, b Value) bool {
	a, b = nullObject(a), nullObject(b)
	switch x := a.(type) {
	case nil:
		return b == nil
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	case string:
		y, ok := b.(string)
		return ok && x == y
	case Int, BigInt, Float, int, int64, float64:
		return numEqual(x, b)
	case []Value:
		y, ok := b.([]Value)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !Equal(x[i], y[i]) {
				return false
			}
		}
		return true
	case *Object:
		y, ok := b.(*Object)
		if !ok || x.Len() != y.Len() {
			return false
		}
		for i := range x.keys {
			if x.keys[i] != y.keys[i] || !Equal(x.vals[i], y.vals[i]) {
				return false
			}
		}
		return true
	}
	return false
}

func nullObject(v Value) Value {
	if o, ok := v.(*Object); ok && o == nil {
		return nil
	}
	return v
}

// number splits a numeric value into an exact int or a float.
func number(v Value) (i int64, f float64, isInt, ok bool) {
	switch x := v.(type) {
	case Int:
		return int64(x), 0, true, true
	case int:
		return int64(x), 0, true, true
	case int64:
		return x, 0, true, true
	case Float:
		return 0, float64(x), false, true
	case float64:
		return 0, x, false, true
	}
	return 0, 0, false, false
}

func numEqual(a, b Value) bool {
	_, aBig := a.(BigInt)
	_, bBig := b.(BigInt)
	if aBig || bBig {
		x, okA := exactInt(a)
		y, okB := exactInt(b)
		return okA && okB && x.Cmp(y) == 0
	}
	ai, af, aInt, _ := number(a)
	bi, bf, bInt, ok := number(b)
	switch {
	case !ok:
		return false
	case aInt && bInt:
		return ai == bi
	case !aInt && !bInt:
		return af == bf
	case aInt:
		return intEqualsFloat(ai, bf)
	default:
		return intEqualsFloat(bi, af)
	}
}

// intEqualsFloat compares exactly, as Python's int == float does (no rounding of the int).
func intEqualsFloat(i int64, f float64) bool {
	if f != math.Trunc(f) || f < -9223372036854775808.0 || f >= 9223372036854775808.0 {
		return false
	}
	return int64(f) == i
}

// exactInt is a number's exact integer value; false for a non-number, a float with a fraction, and a
// non-finite float (which no int equals).
func exactInt(v Value) (*big.Int, bool) {
	if x, ok := v.(BigInt); ok {
		return new(big.Int).SetString(string(x), 10)
	}
	i, f, isInt, ok := number(v)
	switch {
	case !ok:
		return nil, false
	case isInt:
		return big.NewInt(i), true
	case math.IsInf(f, 0) || math.IsNaN(f) || f != math.Trunc(f):
		return nil, false
	}
	n, _ := big.NewFloat(f).Int(nil)
	return n, true
}
