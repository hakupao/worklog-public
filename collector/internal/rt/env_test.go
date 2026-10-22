package rt_test

import (
	"os"
	"os/user"
	"runtime"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/rt"
)

type writes struct{ calls []string }

func (w *writes) Write(p []byte) (int, error) {
	w.calls = append(w.calls, string(p))
	return len(p), nil
}

func TestNowLocalTruncatesToMicroseconds(t *testing.T) {
	loc := time.FixedZone("JST", 9*3600)
	e := &rt.Env{Now: func() time.Time { return time.Date(2026, 10, 13, 8, 30, 15, 123456789, loc) }}
	got := e.NowLocal()
	if want := time.Date(2026, 10, 13, 8, 30, 15, 123456000, loc); !got.Equal(want) || got.Location() != loc {
		t.Fatalf("NowLocal = %v, want %v", got, want)
	}
}

func TestWarnfIsOneLineOneWrite(t *testing.T) {
	w := &writes{}
	e := &rt.Env{Stderr: w}
	e.Warnf("worklog: skipped %s (%d)", "x", 2)
	e.Warnf("plain")
	if len(w.calls) != 2 || w.calls[0] != "worklog: skipped x (2)\n" || w.calls[1] != "plain\n" {
		t.Fatalf("writes = %q", w.calls)
	}
}

func TestDefault(t *testing.T) {
	e := rt.Default()
	if e.Stdout == nil || e.Stderr == nil || e.Now == nil || e.Getenv == nil {
		t.Fatal("nil field")
	}
	if e.GOOS != runtime.GOOS || e.Home == "" || e.Exe == "" || e.Cwd == "" {
		t.Fatalf("Default = %+v", e)
	}
}

// Without HOME, Python's Path.home() reads the password database (pwd.getpwuid); Default falls
// back to os/user the same way instead of leaving Home empty.
func TestDefaultHomeWithoutHOMEIsThePasswordEntry(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("HOME is not the home variable on Windows")
	}
	u, err := user.Current()
	if err != nil || u.HomeDir == "" {
		t.Skipf("no password entry here: %v", err)
	}
	t.Setenv("HOME", "")
	os.Unsetenv("HOME")
	if got := rt.Default().Home; got != u.HomeDir {
		t.Fatalf("Home = %q, want %q", got, u.HomeDir)
	}
}
