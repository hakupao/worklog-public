//go:build windows

package harvest

import (
	"errors"
	"syscall"
)

// PidAlive is OpenProcess + GetExitCodeProcess: a process that exists and has not exited reports
// STILL_ACTIVE (259). Access denied means it exists (someone else's process).
func PidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	const processQueryLimitedInformation, stillActive = 0x1000, 259
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return errors.Is(err, syscall.ERROR_ACCESS_DENIED)
	}
	defer syscall.CloseHandle(h)
	var code uint32
	if syscall.GetExitCodeProcess(h, &code) != nil {
		return true
	}
	return code == stillActive
}
