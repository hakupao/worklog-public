// Package llm runs `claude -p` for the summarizer and the side jobs (spec §4.16, §5.10): the argv
// and stdin bytes Python's subprocess.run(..., text=True, encoding="utf-8", errors="replace") hands
// over, a fresh temp cwd, a timeout, and stdout read back with universal newlines.
package llm

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// Result is what the child left: its raw stdout bytes and exit code.
type Result struct {
	Stdout   []byte
	ExitCode int
}

// Runner runs one claude call. An error means no usable result (spawn failure, timeout, a pipe
// still held at the deadline), where Python's subprocess.run raises.
type Runner interface {
	Run(ctx context.Context, argv []string, stdin []byte, timeout time.Duration) (Result, error)
}

// waitDelay bounds how long Run waits for the pipes to close after it killed the child at the
// deadline: a grandchild that inherited them must not block it (Python's run() kills the child
// and, on POSIX, does not wait for inherited pipes). After a normal exit the pipes are read until
// the deadline instead, as communicate() does.
var waitDelay = 2 * time.Second

type claude struct{ windows bool }

// NewClaude runs the real claude found on PATH (on Windows, exec.LookPath also honours PATHEXT, so a
// claude.cmd is found where Python finds only claude.exe: spec §6 D7).
func NewClaude(env *rt.Env) Runner { return claude{windows: env.GOOS == "windows"} }

func (c claude) Run(ctx context.Context, argv []string, stdin []byte, timeout time.Duration) (Result, error) {
	// --no-session-persistence + temp cwd: the call itself must not leave a session file that the
	// next harvest would pick up.
	dir, err := os.MkdirTemp("", "wl-claude-")
	if err != nil {
		return Result{}, err
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	// The three pipes are the process's own files, so exec starts no copying goroutine and Wait
	// returns when the child exits; reading is left to Run, which needs a different bound for
	// a normal exit and for a kill.
	var parent, child []*os.File // [stdin, stdout, stderr]
	defer func() {
		for _, f := range child {
			f.Close()
		}
	}()
	for i := 0; i < 3; i++ {
		r, w, err := os.Pipe()
		if err != nil {
			for _, f := range parent {
				f.Close()
			}
			return Result{}, err
		}
		if i == 0 {
			parent, child = append(parent, w), append(child, r)
		} else {
			parent, child = append(parent, r), append(child, w)
		}
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Stdin, cmd.Stdout, cmd.Stderr = child[0], child[1], child[2] // capture_output=True: claude's stderr never reaches ours
	if err := cmd.Start(); err != nil {
		for _, f := range parent {
			f.Close()
		}
		return Result{}, err
	}
	for _, f := range child {
		f.Close() // only the child (and what it spawns) holds these now, so EOF can come
	}
	child = nil
	go func() {
		parent[0].Write(TranslateStdin(encodeStdin(stdin), c.windows))
		parent[0].Close()
	}()
	var stdout bytes.Buffer
	read := make(chan struct{})
	go func() {
		drained := make(chan struct{})
		go func() {
			io.Copy(io.Discard, parent[2])
			parent[2].Close()
			close(drained)
		}()
		io.Copy(&stdout, parent[1])
		parent[1].Close()
		<-drained
		close(read)
	}()
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	var err2 error
	select {
	case err2 = <-exited:
		// communicate(): read both pipes to EOF, until the deadline at most.
		select {
		case <-read:
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
	case <-ctx.Done():
		cmd.Process.Kill()
		<-exited
		// A pipe a grandchild still holds is abandoned, not closed: on Windows, closing a pipe
		// with a Read pending blocks until the Read returns.
		select {
		case <-read:
		case <-time.After(waitDelay):
		}
		return Result{}, ctx.Err()
	}
	var exit *exec.ExitError
	if errors.As(err2, &exit) {
		return Result{Stdout: stdout.Bytes(), ExitCode: exit.ExitCode()}, nil
	}
	if err2 != nil {
		return Result{}, err2
	}
	return Result{Stdout: stdout.Bytes()}, nil
}

// ClaudeArgv is the argv of every claude call. --setting-sources "": ignore user/project CLAUDE.md
// and settings.
func ClaudeArgv(model, systemPrompt string) []string {
	return []string{"claude", "-p", "--setting-sources", "", "--no-session-persistence",
		"--model", model, "--system-prompt", systemPrompt}
}

// TranslateStdin is the text-mode stdin of subprocess on Windows (TextIOWrapper, newline=None):
// every "\n" is written as "\r\n". POSIX writes the encoded text untranslated.
func TranslateStdin(b []byte, windows bool) []byte {
	if !windows {
		return b
	}
	return bytes.ReplaceAll(b, []byte("\n"), []byte("\r\n"))
}

// encodeStdin is str.encode("utf-8", "replace"): a lone surrogate, which pyjson keeps in its
// 3-byte WTF-8 form, cannot be encoded and becomes "?".
func encodeStdin(b []byte) []byte {
	var out []byte
	for i := 0; i < len(b); i++ {
		if b[i] == 0xed && i+2 < len(b) && b[i+1] >= 0xa0 && b[i+1] <= 0xbf && b[i+2] >= 0x80 && b[i+2] <= 0xbf {
			if out == nil {
				out = append(make([]byte, 0, len(b)), b[:i]...)
			}
			out = append(out, '?')
			i += 2
			continue
		}
		if out != nil {
			out = append(out, b[i])
		}
	}
	if out == nil {
		return b
	}
	return out
}

// Generate is the side jobs' _generate (and summarize's call): the stripped answer, or false when
// the call failed, exited non-zero, answered nothing or "Not logged in". Stdout is decoded as
// subprocess's text mode decodes it: UTF-8 with replacement, then universal newlines.
func Generate(r Runner, prompt, model, system string, timeout time.Duration) (string, bool) {
	res, err := r.Run(context.Background(), ClaudeArgv(model, system), []byte(prompt), timeout)
	if err != nil || res.ExitCode != 0 {
		return "", false
	}
	text := pystr.Strip(pystr.UniversalNewlines(pystr.DecodeReplace(res.Stdout)))
	if text == "" || strings.HasPrefix(text, "Not logged in") {
		return "", false
	}
	return text, true
}
