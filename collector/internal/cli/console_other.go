//go:build !windows

package cli

import "github.com/hakupao/worklog/collector/internal/rt"

// setupConsole has nothing to do off Windows: output is UTF-8 bytes with "\n" newlines already.
func setupConsole(*rt.Env) (restore func()) { return func() {} }
