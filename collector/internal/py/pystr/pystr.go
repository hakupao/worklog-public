// Package pystr reproduces the Python str behaviour the parsers, prompts and excerpts depend on
// (spec §5.6): splitlines, strip, code-point slicing, the "replace" UTF-8 decoder and universal
// newlines.
package pystr

import (
	"bytes"
	"io"
	"os"
	"strings"
	"unicode/utf8"
)

// decodeRune reads one code point. A lone surrogate in its 3-byte WTF-8 form (as pyjson.Decode
// keeps "\ud800") is one code point, as in Python.
func decodeRune(s string) (rune, int) {
	if len(s) >= 3 && s[0] == 0xed && s[1] >= 0xa0 && s[1] <= 0xbf && s[2] >= 0x80 && s[2] <= 0xbf {
		return 0xd000 | rune(s[1]&0x3f)<<6 | rune(s[2]&0x3f), 3
	}
	return utf8.DecodeRuneInString(s)
}

// isLineBreak is the set str.splitlines() splits on, besides "\r\n".
func isLineBreak(r rune) bool {
	switch r {
	case '\n', '\r', '\v', '\f', 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029:
		return true
	}
	return false
}

// breakStart is the bytes a line break can start with: the ASCII ones, and the lead bytes of
// U+0085 (C2 85) and U+2028/U+2029 (E2 80 A8/A9). Any other byte is skipped on its own: a byte
// that is not a continuation byte (80..BF) always starts a code point, valid or not, so skipping
// byte by byte never lands inside one that is a break.
var breakStart = func() (t [256]bool) {
	for _, c := range []byte{'\n', '\r', '\v', '\f', 0x1c, 0x1d, 0x1e, 0xc2, 0xe2} {
		t[c] = true
	}
	return t
}()

// wordMayBreak says whether one of the 8 bytes of w could start a line break, by the classic
// bit tricks: a byte below 0x1f, or a byte equal to C2 or E2, sets its high bit in the mask.
func wordMayBreak[T ~string | ~[]byte](w T) bool {
	const ones, highs = 0x0101010101010101, 0x8080808080808080
	var x uint64
	for k := 7; k >= 0; k-- {
		x = x<<8 | uint64(w[k])
	}
	c2, e2 := x^(0xc2*ones), x^(0xe2*ones)
	return ((x-0x1f*ones)&^x|(c2-ones)&^c2|(e2-ones)&^e2)&highs != 0
}

// SplitLines is str.splitlines(): it also breaks on \v \f \x1c \x1d \x1e \x85 U+2028 U+2029, and a
// final line break does not start an empty line. It takes a log's bytes as they were read too, so
// the file is not copied into a string first.
func SplitLines[T ~string | ~[]byte](s T) []T {
	var out []T
	start := 0
	for i := 0; i < len(s); {
		if !breakStart[s[i]] {
			i++
			// Eight bytes at a time while none is below 0x1f, C2 or E2 (see wordMayBreak).
			for i+8 <= len(s) && !wordMayBreak(s[i:i+8]) {
				i += 8
			}
			continue
		}
		r, n := rune(s[i]), 1
		if r >= utf8.RuneSelf {
			r, n = decodeRune(string(s[i:min(i+utf8.UTFMax, len(s))]))
		}
		if !isLineBreak(r) {
			i += n
			continue
		}
		out = append(out, s[start:i])
		i += n
		if r == '\r' && i < len(s) && s[i] == '\n' {
			i++
		}
		start = i
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	return out
}

// isSpace is Python's str.isspace() for one code point (Unicode White_Space plus \x1c-\x1f, which
// Python counts as whitespace through their bidi class).
func isSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', 0x1c, 0x1d, 0x1e, 0x1f, ' ', 0x85, 0xa0, 0x1680,
		0x2028, 0x2029, 0x202f, 0x205f, 0x3000:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// Strip is str.strip(): Python's whitespace, which is wider than unicode.IsSpace (\x1c-\x1f).
func Strip(s string) string {
	return strings.TrimFunc(s, isSpace)
}

// StripBytes is Strip on bytes.
func StripBytes(b []byte) []byte {
	return bytes.TrimFunc(b, isSpace)
}

// Head is s[:n], counting code points, for n >= 0. A negative n gives "" (it is not Python's
// slice from the end; no caller passes one).
func Head(s string, n int) string {
	i := 0
	for k := 0; k < n && i < len(s); k++ {
		_, w := decodeRune(s[i:])
		i += w
	}
	return s[:i]
}

// DecodeReplace is bytes.decode("utf-8", "replace"): each maximal invalid subpart becomes one
// U+FFFD (Unicode's recommended practice, which CPython follows; Go's per-byte RuneError does not).
func DecodeReplace(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var sb strings.Builder
	for i := 0; i < len(b); {
		c := b[i]
		if c < 0x80 {
			sb.WriteByte(c)
			i++
			continue
		}
		need, lo, hi := 0, byte(0x80), byte(0xbf)
		switch {
		case c >= 0xc2 && c <= 0xdf:
			need = 1
		case c == 0xe0:
			need, lo = 2, 0xa0
		case c >= 0xe1 && c <= 0xec, c == 0xee, c == 0xef:
			need = 2
		case c == 0xed:
			need, hi = 2, 0x9f
		case c == 0xf0:
			need, lo = 3, 0x90
		case c >= 0xf1 && c <= 0xf3:
			need = 3
		case c == 0xf4:
			need, hi = 3, 0x8f
		default: // 0x80-0xc1, 0xf5-0xff never start a sequence
			sb.WriteRune(utf8.RuneError)
			i++
			continue
		}
		j := i + 1
		for k := 0; k < need; k++ {
			if j >= len(b) || b[j] < lo || b[j] > hi {
				break
			}
			j++
			lo, hi = 0x80, 0xbf // only the second byte has a narrowed range
		}
		if j-i == need+1 {
			sb.Write(b[i:j])
		} else {
			sb.WriteRune(utf8.RuneError)
		}
		i = j
	}
	return sb.String()
}

// UniversalNewlines is text-mode reading's newline translation: "\r\n" and "\r" become "\n".
func UniversalNewlines(s string) string {
	if !strings.Contains(s, "\r") {
		return s
	}
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
}

// ReadTextHead is open(path, encoding="utf-8", errors="replace").read(n): decoded with
// DecodeReplace, newlines translated, then the first n code points. It reads only as many bytes
// as n code points can come from (4 each) plus enough to settle the last one.
func ReadTextHead(path string, n int) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, int64(4*n+4)))
	if err != nil {
		return "", err
	}
	return Head(UniversalNewlines(DecodeReplace(b)), n), nil
}
