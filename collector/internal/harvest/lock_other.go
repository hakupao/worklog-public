//go:build !windows

package harvest

import (
	"errors"
	"syscall"
)

// PidAlive is kill(pid, 0): no error, or EPERM (someone else's process), means it exists.
func PidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
