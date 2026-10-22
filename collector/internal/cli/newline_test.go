package cli

import (
	"bytes"
	"testing"
)

// Python's sys.stdout / sys.stderr on Windows, writing to a pipe or a file, are TextIOWrappers with
// newline=None: every "\n" goes out as "\r\n", one that follows a "\r" included.
func TestWindowsTextWriterTranslatesEveryNewline(t *testing.T) {
	var calls []string
	w := windowsText{rec(func(p []byte) { calls = append(calls, string(p)) })}
	in := "a\nb\r\nc\rd\n\n"
	n, err := w.Write([]byte(in))
	if err != nil || n != len(in) {
		t.Fatalf("Write = %d, %v; want %d (the caller's length, not the translated one)", n, err, len(in))
	}
	if len(calls) != 1 || calls[0] != "a\r\nb\r\r\nc\rd\r\n\r\n" {
		t.Fatalf("writes %q: want one write with every \\n as \\r\\n", calls)
	}
	var b bytes.Buffer
	if n, _ := (windowsText{&b}).Write([]byte("no newline")); n != 10 || b.String() != "no newline" {
		t.Fatalf("%d %q", n, b.String())
	}
}

type rec func([]byte)

func (r rec) Write(p []byte) (int, error) {
	r(append([]byte(nil), p...))
	return len(p), nil
}
