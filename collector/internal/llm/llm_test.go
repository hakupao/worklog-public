package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/rt"
)

// The test binary doubles as the fake claude: copied to <dir>/claude[.exe] and put first on PATH,
// it acts out WL_FAKE_CLAUDE instead of running the tests.
func TestMain(m *testing.M) {
	if mode := os.Getenv("WL_FAKE_CLAUDE"); mode != "" {
		os.Exit(fakeClaude(mode))
	}
	os.Exit(m.Run())
}

type record struct {
	Argv  []string
	Stdin []byte
	Cwd   string
}

func fakeClaude(mode string) int {
	switch mode {
	case "echo": // records what it was given, answers with CRLF-padded text
		stdin, _ := io.ReadAll(os.Stdin)
		cwd, _ := os.Getwd()
		b, _ := json.Marshal(record{Argv: os.Args, Stdin: stdin, Cwd: cwd})
		_ = os.WriteFile(os.Getenv("WL_FAKE_CLAUDE_OUT"), b, 0o644)
		fmt.Print("  答え\r\nです\r")
		return 0
	case "exit3":
		fmt.Print("partial")
		return 3
	case "sleep":
		time.Sleep(5 * time.Second)
		return 0
	case "fork", "forksleep": // a grandchild inherits stdout and outlives this process
		self, _ := os.Executable()
		gc := exec.Command(self)
		gc.Env = append(os.Environ(), "WL_FAKE_CLAUDE=sleep")
		gc.Stdout = os.Stdout
		if err := gc.Start(); err != nil {
			return 9
		}
		fmt.Print("answer")
		if mode == "forksleep" {
			time.Sleep(5 * time.Second)
		}
		return 0
	}
	return 99
}

// installFake puts a copy of the test binary named claude[.exe] first on PATH.
func installFake(t *testing.T, mode string) string {
	t.Helper()
	dir := t.TempDir()
	// A fork-mode grandchild outlives the test by design and, on Windows, keeps claude.exe locked
	// until its sleep ends; wait it out before TempDir's own cleanup (cleanups run last-first).
	t.Cleanup(func() {
		for end := time.Now().Add(10 * time.Second); os.RemoveAll(dir) != nil && time.Now().Before(end); {
			time.Sleep(100 * time.Millisecond)
		}
	})
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	name := "claude"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	b, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), b, 0o755); err != nil {
		t.Fatal(err)
	}
	// macOS scans a new executable on its first exec (7–20 s measured under load); run it once
	// here so that the timing tests time Run, not the scan.
	warm := exec.Command(filepath.Join(dir, name))
	warm.Env = append(os.Environ(), "WL_FAKE_CLAUDE=exit3")
	_ = warm.Run()
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("WL_FAKE_CLAUDE", mode)
	out := filepath.Join(t.TempDir(), "record.json")
	t.Setenv("WL_FAKE_CLAUDE_OUT", out)
	return out
}

func TestClaudeArgvIsPythons(t *testing.T) {
	got := ClaudeArgv("haiku", "sys")
	want := []string{"claude", "-p", "--setting-sources", "", "--no-session-persistence", "--model", "haiku", "--system-prompt", "sys"}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") || len(got) != len(want) {
		t.Fatalf("argv = %q", got)
	}
}

// TextIOWrapper(newline=None) on Windows writes every "\n" as "\r\n", an existing "\r\n" included.
func TestTranslateStdin(t *testing.T) {
	in := []byte("a\nb\r\nc\rd\n")
	if got := TranslateStdin(in, false); !bytes.Equal(got, in) {
		t.Errorf("posix: %q", got)
	}
	if got := TranslateStdin(in, true); string(got) != "a\r\nb\r\r\nc\rd\r\n" {
		t.Errorf("windows: %q", got)
	}
}

// str.encode("utf-8", "replace"): a lone surrogate (WTF-8 from pyjson) becomes "?".
func TestEncodeStdinReplacesLoneSurrogates(t *testing.T) {
	got := encodeStdin([]byte("a\xed\xa0\x80b\xed\xbf\xbfé😀"))
	if string(got) != "a?b?é😀" {
		t.Fatalf("%q", got)
	}
}

type fakeRunner struct {
	res  Result
	err  error
	argv []string
	in   []byte
	tmo  time.Duration
}

func (f *fakeRunner) Run(_ context.Context, argv []string, stdin []byte, timeout time.Duration) (Result, error) {
	f.argv, f.in, f.tmo = argv, stdin, timeout
	return f.res, f.err
}

func TestGenerate(t *testing.T) {
	for _, c := range []struct {
		res  Result
		err  error
		want string
		ok   bool
	}{
		{Result{Stdout: []byte("  答え\r\nです\r 　")}, nil, "答え\nです", true},
		{Result{Stdout: []byte("ok\xff")}, nil, "ok�", true},
		{Result{Stdout: []byte("x"), ExitCode: 1}, nil, "", false},
		{Result{Stdout: []byte(" \n")}, nil, "", false},
		{Result{Stdout: []byte("\nNot logged in · Please run /login")}, nil, "", false},
		{Result{Stdout: []byte("x")}, errors.New("boom"), "", false},
	} {
		f := &fakeRunner{res: c.res, err: c.err}
		got, ok := Generate(f, "p\nq", "sonnet", "sys", 180*time.Second)
		if got != c.want || ok != c.ok {
			t.Errorf("%q/%v: Generate = %q, %v", c.res.Stdout, c.err, got, ok)
		}
		if string(f.in) != "p\nq" || f.tmo != 180*time.Second || f.argv[len(f.argv)-1] != "sys" || f.argv[6] != "sonnet" {
			t.Errorf("runner got %q %q %v", f.argv, f.in, f.tmo)
		}
	}
}

func TestNewClaudeSendsArgvAndStdinFromATempCwd(t *testing.T) {
	for _, goos := range []string{runtime.GOOS, "windows"} {
		out := installFake(t, "echo")
		wd, _ := os.Getwd()
		r := NewClaude(&rt.Env{GOOS: goos})
		argv := ClaudeArgv("haiku", "システム\n2行")
		res, err := r.Run(context.Background(), argv, []byte("<transcript>\n[user] 直して\xed\xa0\x80\n</transcript>"), 30*time.Second)
		if err != nil || res.ExitCode != 0 {
			t.Fatalf("%s: Run = %+v, %v", goos, res, err)
		}
		if string(res.Stdout) != "  答え\r\nです\r" {
			t.Errorf("%s: stdout %q (raw bytes; Generate decodes)", goos, res.Stdout)
		}
		var rec record
		b, err := os.ReadFile(out)
		if err != nil || json.Unmarshal(b, &rec) != nil {
			t.Fatalf("%s: no record: %v", goos, err)
		}
		if strings.Join(rec.Argv[1:], "\x00") != strings.Join(argv[1:], "\x00") {
			t.Errorf("%s: argv %q", goos, rec.Argv)
		}
		want := "<transcript>\n[user] 直して?\n</transcript>"
		if goos == "windows" {
			want = strings.ReplaceAll(want, "\n", "\r\n")
		}
		if string(rec.Stdin) != want {
			t.Errorf("%s: stdin %q, want %q", goos, rec.Stdin, want)
		}
		if rec.Cwd == "" || sameDir(rec.Cwd, wd) {
			t.Errorf("%s: cwd %q is not a fresh temp dir", goos, rec.Cwd)
		}
		if _, err := os.Stat(rec.Cwd); !os.IsNotExist(err) {
			t.Errorf("%s: temp cwd %q not removed: %v", goos, rec.Cwd, err)
		}
	}
}

func sameDir(a, b string) bool {
	ra, _ := filepath.EvalSymlinks(a)
	rb, _ := filepath.EvalSymlinks(b)
	return ra == rb
}

func TestNewClaudeReportsTheExitCode(t *testing.T) {
	installFake(t, "exit3")
	res, err := NewClaude(&rt.Env{GOOS: runtime.GOOS}).Run(context.Background(), ClaudeArgv("m", "s"), nil, 30*time.Second)
	if err != nil || res.ExitCode != 3 || string(res.Stdout) != "partial" {
		t.Fatalf("Run = %+v, %v", res, err)
	}
}

func TestNewClaudeTimesOut(t *testing.T) {
	installFake(t, "sleep")
	start := time.Now()
	_, err := NewClaude(&rt.Env{GOOS: runtime.GOOS}).Run(context.Background(), ClaudeArgv("m", "s"), nil, 300*time.Millisecond)
	if err == nil {
		t.Fatal("no error on timeout")
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("timeout took %v", d)
	}
}

// A grandchild that inherited stdout keeps Run reading after the child exits, as Python's
// communicate() reads to EOF: the call succeeds once the grandchild lets go (5 s), well within the
// deadline.
func TestNewClaudeReadsUntilAGrandchildLetsGoOfStdout(t *testing.T) {
	installFake(t, "fork")
	start := time.Now()
	res, err := NewClaude(&rt.Env{GOOS: runtime.GOOS}).Run(context.Background(), ClaudeArgv("m", "s"), nil, 30*time.Second)
	if err != nil || string(res.Stdout) != "answer" || res.ExitCode != 0 {
		t.Fatalf("Run = %+v, %v", res, err)
	}
	if d := time.Since(start); d < 4*time.Second {
		t.Errorf("Run returned after %v, before the grandchild closed stdout", d)
	}
}

// Past the deadline a held pipe fails the call (Python raises TimeoutExpired), whether the child
// exited at once (fork) or had to be killed (forksleep); after a kill Run waits only waitDelay.
func TestNewClaudeIsNotBlockedByAGrandchildPastTheDeadline(t *testing.T) {
	old := waitDelay
	waitDelay = 300 * time.Millisecond
	defer func() { waitDelay = old }()
	for _, c := range []struct {
		mode    string
		timeout time.Duration
	}{{"fork", time.Second}, {"forksleep", 300 * time.Millisecond}} {
		installFake(t, c.mode)
		start := time.Now()
		_, err := NewClaude(&rt.Env{GOOS: runtime.GOOS}).Run(context.Background(), ClaudeArgv("m", "s"), nil, c.timeout)
		if err == nil {
			t.Errorf("%s: no error", c.mode)
		}
		if d := time.Since(start); d > c.timeout+2*time.Second {
			t.Errorf("%s: Run blocked for %v on the grandchild's pipe", c.mode, d)
		}
	}
}

func TestNewClaudeWithoutClaudeOnPathIsAnError(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, err := NewClaude(&rt.Env{GOOS: runtime.GOOS}).Run(context.Background(), ClaudeArgv("m", "s"), nil, time.Second); err == nil {
		t.Fatal("no error")
	}
}

// D7: on Windows exec.LookPath honours PATHEXT, so a claude.cmd alone on PATH is found (Python's
// subprocess finds only claude.exe and falls back). Runs on the Windows CI runner.
func TestD7ClaudeCmdIsFoundViaPATHEXT(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("PATHEXT lookup is Windows-only")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "claude.cmd"), []byte("@echo off\r\necho cmd-claude\r\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	res, err := NewClaude(&rt.Env{GOOS: "windows"}).Run(context.Background(), ClaudeArgv("m", "s"), nil, 30*time.Second)
	if err != nil || res.ExitCode != 0 || !strings.Contains(string(res.Stdout), "cmd-claude") {
		t.Fatalf("Run = %q %d, %v", res.Stdout, res.ExitCode, err)
	}
}
