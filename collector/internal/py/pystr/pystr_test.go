package pystr_test

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

type golden struct {
	SplitLines []struct {
		Input string   `json:"input"`
		Lines []string `json:"lines"`
	} `json:"splitlines"`
	Strip []struct {
		Input    string `json:"input"`
		Stripped string `json:"stripped"`
	} `json:"strip"`
	Head []struct {
		Input string `json:"input"`
		N     int    `json:"n"`
		Head  string `json:"head"`
	} `json:"head"`
	DecodeReplace []struct {
		Bytes string `json:"bytes"`
		Text  string `json:"text"`
	} `json:"decode_replace"`
	UniversalNewlines []struct {
		Input string `json:"input"`
		Text  string `json:"text"`
	} `json:"universal_newlines"`
	ReadTextHead []struct {
		Bytes string `json:"bytes"`
		N     int    `json:"n"`
		Text  string `json:"text"`
	} `json:"read_text_head"`
}

func load(t *testing.T) golden {
	var g golden
	testkit.Golden(t, "pystr", &g)
	if len(g.SplitLines) == 0 || len(g.Strip) == 0 || len(g.Head) == 0 || len(g.DecodeReplace) == 0 ||
		len(g.UniversalNewlines) == 0 || len(g.ReadTextHead) == 0 {
		t.Fatal("empty pystr golden section")
	}
	return g
}

func unhex(t *testing.T, s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSplitLines(t *testing.T) {
	for _, c := range load(t).SplitLines {
		got := pystr.SplitLines(c.Input)
		if len(got) == 0 && len(c.Lines) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.Lines) {
			t.Errorf("SplitLines(%q) = %q, want %q", c.Input, got, c.Lines)
		}
		// The log reader splits the bytes it read: the same lines.
		var fromBytes []string
		for _, l := range pystr.SplitLines([]byte(c.Input)) {
			fromBytes = append(fromBytes, string(l))
		}
		if !reflect.DeepEqual(fromBytes, c.Lines) {
			t.Errorf("SplitLines([]byte(%q)) = %q, want %q", c.Input, fromBytes, c.Lines)
		}
	}
}

func TestStrip(t *testing.T) {
	for _, c := range load(t).Strip {
		if got := pystr.Strip(c.Input); got != c.Stripped {
			t.Errorf("Strip(%q) = %q, want %q", c.Input, got, c.Stripped)
		}
		if got := string(pystr.StripBytes([]byte(c.Input))); got != c.Stripped {
			t.Errorf("StripBytes(%q) = %q, want %q", c.Input, got, c.Stripped)
		}
	}
}

func TestHead(t *testing.T) {
	for _, c := range load(t).Head {
		if got := pystr.Head(c.Input, c.N); got != c.Head {
			t.Errorf("Head(%q, %d) = %q, want %q", c.Input, c.N, got, c.Head)
		}
	}
	if got := pystr.Head("abc", 0); got != "" {
		t.Errorf("Head(abc, 0) = %q", got)
	}
	// A lone surrogate from pyjson (WTF-8, 3 bytes) is one code point, as in Python.
	if got := pystr.Head("\xed\xa0\x80bc", 2); got != "\xed\xa0\x80b" {
		t.Errorf("Head(lone surrogate) = %q", got)
	}
}

func TestDecodeReplace(t *testing.T) {
	for _, c := range load(t).DecodeReplace {
		if got := pystr.DecodeReplace(unhex(t, c.Bytes)); got != c.Text {
			t.Errorf("DecodeReplace(%s) = %q, want %q", c.Bytes, got, c.Text)
		}
	}
}

func TestUniversalNewlines(t *testing.T) {
	for _, c := range load(t).UniversalNewlines {
		if got := pystr.UniversalNewlines(c.Input); got != c.Text {
			t.Errorf("UniversalNewlines(%q) = %q, want %q", c.Input, got, c.Text)
		}
	}
}

func TestReadTextHead(t *testing.T) {
	dir := t.TempDir()
	for i, c := range load(t).ReadTextHead {
		p := filepath.Join(dir, "f"+string(rune('a'+i)))
		if err := os.WriteFile(p, unhex(t, c.Bytes), 0o644); err != nil {
			t.Fatal(err)
		}
		got, err := pystr.ReadTextHead(p, c.N)
		if err != nil {
			t.Fatalf("ReadTextHead(%s): %v", c.Bytes, err)
		}
		if got != c.Text {
			t.Errorf("ReadTextHead(%s, %d) = %q, want %q", c.Bytes, c.N, got, c.Text)
		}
	}
	if _, err := pystr.ReadTextHead(filepath.Join(dir, "missing"), 10); err == nil {
		t.Error("missing file: want an error")
	}
}

// The cut lands after newline translation and counts code points, even when the bytes needed run
// far past n (CRLF pairs, 4-byte characters, invalid bytes): every n gives Head of the whole decoded
// file.
func TestReadTextHeadMatchesWholeFile(t *testing.T) {
	data := []byte("\r\n\r\n😀😀\xff\xfe\xe3\x81\x8a\xe3\r\r\nend\r")
	p := filepath.Join(t.TempDir(), "x")
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	whole := pystr.UniversalNewlines(pystr.DecodeReplace(data))
	for n := 0; n <= 20; n++ {
		got, err := pystr.ReadTextHead(p, n)
		if err != nil {
			t.Fatal(err)
		}
		if want := pystr.Head(whole, n); got != want {
			t.Errorf("n=%d: %q, want %q", n, got, want)
		}
	}
}
