package cli

import (
	"bytes"
	"io"
)

// windowsText is what Python's sys.stdout and sys.stderr do on Windows when they are a pipe or a
// file (TextIOWrapper, newline=None): every "\n" goes out as "\r\n". console_windows.go wraps the
// two streams in it when they are not a console. Each Write stays one write, so a line written in
// one piece stays one piece in a merged 2>&1 stream.
type windowsText struct{ w io.Writer }

func (t windowsText) Write(p []byte) (int, error) {
	if _, err := t.w.Write(bytes.ReplaceAll(p, []byte("\n"), []byte("\r\n"))); err != nil {
		return 0, err
	}
	return len(p), nil
}
