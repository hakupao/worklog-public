//go:build windows

package harvest

import (
	"errors"
	"syscall"
)

// transientRename: ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION, the errors a
// rename gets while another process briefly has the target open.
func transientRename(err error) bool {
	var errno syscall.Errno
	if !errors.As(err, &errno) {
		return false
	}
	switch errno {
	case 5, 32, 33:
		return true
	}
	return false
}
