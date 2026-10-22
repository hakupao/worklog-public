//go:build windows

package cli

import (
	"io"
	"os"
	"syscall"

	"github.com/hakupao/worklog/collector/internal/rt"
)

var (
	kernel32           = syscall.NewLazyDLL("kernel32.dll")
	getConsoleOutputCP = kernel32.NewProc("GetConsoleOutputCP")
	setConsoleOutputCP = kernel32.NewProc("SetConsoleOutputCP")
)

// setupConsole sets the console output code page to UTF-8 (65001), so a real console shows the CJK
// lines as Python's stream.reconfigure(encoding="utf-8") does (spec §4.17). Go already writes a
// console with WriteConsoleW; this covers anything that reads the code page. Pipes and files get
// UTF-8 bytes either way, with "\n" written as "\r\n" as Python's text-mode streams write it
// (windowsText). The returned function puts the previous code page back, so the console is left as
// wl found it. Without a console (GetConsoleOutputCP answers 0) the code page is not changed.
func setupConsole(env *rt.Env) (restore func()) {
	env.Stdout = textMode(env.Stdout)
	env.Stderr = textMode(env.Stderr)
	prev, _, _ := getConsoleOutputCP.Call()
	if prev == 0 || prev == 65001 {
		return func() {}
	}
	_, _, _ = setConsoleOutputCP.Call(65001)
	return func() { _, _, _ = setConsoleOutputCP.Call(prev) }
}

// textMode wraps the process's own stdout or stderr in windowsText unless it is a console.
func textMode(w io.Writer) io.Writer {
	f, ok := w.(*os.File)
	if !ok || (f != os.Stdout && f != os.Stderr) {
		return w
	}
	var mode uint32
	if syscall.GetConsoleMode(syscall.Handle(f.Fd()), &mode) == nil {
		return w
	}
	return windowsText{w}
}
