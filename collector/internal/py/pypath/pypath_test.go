package pypath

import (
	"reflect"
	"sort"
	"testing"

	"github.com/hakupao/worklog/collector/internal/testkit"
)

type golden struct {
	Join map[string][]struct {
		A   string `json:"a"`
		B   string `json:"b"`
		Out string `json:"out"`
	} `json:"join"`
	Normpath map[string][]struct {
		In  string `json:"in"`
		Out string `json:"out"`
	} `json:"normpath"`
	Parts map[string][]struct {
		In    string   `json:"in"`
		Parts []string `json:"parts"`
	} `json:"parts"`
	Sorted map[string][]struct {
		In     []string `json:"in"`
		Sorted []string `json:"sorted"`
	} `json:"sorted"`
	RelativeTo []struct {
		Path    string `json:"path"`
		Base    string `json:"base"`
		Posix   bool   `json:"posix"`
		Windows bool   `json:"windows"`
	} `json:"relative_to"`
	IsAbs []struct {
		In  string `json:"in"`
		Out bool   `json:"out"`
	} `json:"is_absolute_any"`
	Quote []struct {
		In  string `json:"in"`
		Out string `json:"out"`
	} `json:"quote"`
	Casefold []struct {
		In       string `json:"in"`
		Casefold string `json:"casefold"`
		Lower    string `json:"lower"`
	} `json:"casefold"`
}

func load(t *testing.T) golden {
	var g golden
	testkit.Golden(t, "pypath", &g)
	if len(g.Join["posix"]) == 0 || len(g.Join["windows"]) == 0 || len(g.Normpath["windows"]) == 0 ||
		len(g.Parts["windows"]) == 0 || len(g.Sorted["windows"]) == 0 || len(g.RelativeTo) == 0 ||
		len(g.IsAbs) == 0 || len(g.Quote) == 0 || len(g.Casefold) == 0 {
		t.Fatal("empty pypath golden section")
	}
	return g
}

var flavours = map[string]Flavour{"posix": Posix, "windows": Windows}

func TestJoin(t *testing.T) {
	for name, f := range flavours {
		for _, c := range load(t).Join[name] {
			if got := f.Join(c.A, c.B); got != c.Out {
				t.Errorf("%s.Join(%q, %q) = %q, want %q", name, c.A, c.B, got, c.Out)
			}
		}
	}
}

func TestNormpath(t *testing.T) {
	for name, f := range flavours {
		for _, c := range load(t).Normpath[name] {
			if got := f.Normpath(c.In); got != c.Out {
				t.Errorf("%s.Normpath(%q) = %q, want %q", name, c.In, got, c.Out)
			}
		}
	}
}

func TestParts(t *testing.T) {
	for name, f := range flavours {
		for _, c := range load(t).Parts[name] {
			got := f.Parts(c.In)
			if len(got) == 0 && len(c.Parts) == 0 {
				continue
			}
			if !reflect.DeepEqual(got, c.Parts) {
				t.Errorf("%s.Parts(%q) = %q, want %q", name, c.In, got, c.Parts)
			}
		}
	}
}

// sorted(Path objects): the golden lists str(p), so compare through the same spelling.
func TestLessSorted(t *testing.T) {
	for name, f := range flavours {
		for _, c := range load(t).Sorted[name] {
			in := append([]string(nil), c.In...)
			sort.SliceStable(in, func(i, j int) bool { return f.Less(in[i], in[j]) })
			got := make([]string, len(in))
			for i, p := range in {
				got[i] = f.str(p)
			}
			if !reflect.DeepEqual(got, c.Sorted) {
				t.Errorf("%s sorted:\n got %q\nwant %q", name, got, c.Sorted)
			}
		}
	}
}

func TestRelativeTo(t *testing.T) {
	for _, c := range load(t).RelativeTo {
		if got := Posix.RelativeTo(c.Path, c.Base); got != c.Posix {
			t.Errorf("Posix.RelativeTo(%q, %q) = %v", c.Path, c.Base, got)
		}
		if got := Windows.RelativeTo(c.Path, c.Base); got != c.Windows {
			t.Errorf("Windows.RelativeTo(%q, %q) = %v", c.Path, c.Base, got)
		}
	}
}

func TestIsAbsAnyAndFlavourOf(t *testing.T) {
	for _, c := range load(t).IsAbs {
		if got := IsAbsAny(c.In); got != c.Out {
			t.Errorf("IsAbsAny(%q) = %v", c.In, got)
		}
	}
	for p, want := range map[string]Flavour{"/a": Posix, "//s/x": Posix, "C:\\a": Windows, "a": Windows, "": Windows} {
		if got := FlavourOf(p); got != want {
			t.Errorf("FlavourOf(%q) = %v", p, got)
		}
	}
	if HostFlavour("windows") != Windows || HostFlavour("darwin") != Posix || HostFlavour("linux") != Posix {
		t.Error("HostFlavour")
	}
}

func TestQuote(t *testing.T) {
	for _, c := range load(t).Quote {
		if got := Quote(c.In); got != c.Out {
			t.Errorf("Quote(%q) = %q, want %q", c.In, got, c.Out)
		}
	}
}

func TestCasefoldAndLower(t *testing.T) {
	for _, c := range load(t).Casefold {
		if got := Casefold(c.In); got != c.Casefold {
			t.Errorf("Casefold(%q) = %q, want %q", c.In, got, c.Casefold)
		}
		if got := pyLower(c.In); got != c.Lower {
			t.Errorf("pyLower(%q) = %q, want %q", c.In, got, c.Lower)
		}
	}
}

// PurePosixPath(p).name / PureWindowsPath(p).name, printed by CPython 3.14.4.
func TestNameIsPurePathName(t *testing.T) {
	for _, c := range []struct{ p, posix, windows string }{
		{"", "", ""}, {"/", "", ""}, {"a/b.pdf/", "b.pdf", "b.pdf"}, {"a/./b.pdf/.", "b.pdf", "b.pdf"},
		{"C:", "C:", ""}, {`C:\`, `C:\`, ""}, {"./X:", "X:", "X:"}, {`x\.pdf`, `x\.pdf`, ".pdf"},
	} {
		if got := Posix.Name(c.p); got != c.posix {
			t.Errorf("posix %q: %q", c.p, got)
		}
		if got := Windows.Name(c.p); got != c.windows {
			t.Errorf("windows %q: %q", c.p, got)
		}
	}
}
