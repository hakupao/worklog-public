// Package rt is the process environment and the single injection point for the clock, the
// environment variables, the home directory and the host OS. No other package reads time.Now,
// os.Getenv, os.UserHomeDir or runtime.GOOS; they take an *Env (or a value derived from it).
package rt

import (
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"time"
)

// Env is what a command sees of its process.
type Env struct {
	Stdout, Stderr io.Writer
	Now            func() time.Time    // wall clock
	Getenv         func(string) string // os.Getenv
	Home           string              // os.UserHomeDir(), else user.Current().HomeDir
	GOOS           string              // runtime.GOOS; drives every host-flavour choice
	Exe            string              // os.Executable() after EvalSymlinks
	Cwd            string
}

// Default is the real process environment. A lookup that fails leaves its field empty.
func Default() *Env {
	e := &Env{
		Stdout: os.Stdout,
		Stderr: os.Stderr,
		Now:    time.Now,
		Getenv: os.Getenv,
		GOOS:   runtime.GOOS,
	}
	e.Home, _ = os.UserHomeDir()
	if e.Home == "" {
		// Python's Path.home() without HOME reads the password database.
		if u, err := user.Current(); err == nil {
			e.Home = u.HomeDir
		}
	}
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		e.Exe = exe
	}
	e.Cwd, _ = os.Getwd()
	return e
}

// NowLocal is Now() cut to microseconds, the resolution of Python's datetime, so a ts or note id
// formatted from it matches what Python would write. It reads the clock.
func (e *Env) NowLocal() time.Time {
	return e.Now().Truncate(time.Microsecond)
}

// Warnf writes one line to Stderr in a single Write, with the newline appended.
func (e *Env) Warnf(format string, a ...any) {
	io.WriteString(e.Stderr, fmt.Sprintf(format, a...)+"\n")
}
