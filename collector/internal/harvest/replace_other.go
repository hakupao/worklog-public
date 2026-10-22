//go:build !windows

package harvest

// transientRename: a POSIX rename replaces an open file, so no failure is worth retrying.
func transientRename(error) bool { return false }
