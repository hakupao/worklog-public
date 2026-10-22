package harvest

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ErrLocked is Acquire's answer for a lock another live harvest holds (spec §5.9).
var ErrLocked = errors.New("another harvest holds the lock")

// lockContent is what harvest.lock holds: the pid, the start time and a nonce that tells this
// Acquire's lock from any other's (release removes only its own).
func lockContent(pid int, since time.Time, nonce string) string {
	return fmt.Sprintf("%d %s %s\n", pid, since.Format(time.RFC3339Nano), nonce)
}

// parseLock reads lockContent back.
func parseLock(b []byte) (int, time.Time, bool) {
	f := strings.Fields(string(b))
	if len(f) != 3 {
		return 0, time.Time{}, false
	}
	pid, err := strconv.Atoi(f[0])
	if err != nil {
		return 0, time.Time{}, false
	}
	since, err := time.Parse(time.RFC3339Nano, f[1])
	if err != nil {
		return 0, time.Time{}, false
	}
	return pid, since, true
}

// readLock and renameLock are os.ReadFile and os.Rename on the lock path (test seams). On Windows
// either can fail with a sharing violation while a contender has the file open.
var (
	readLock   = os.ReadFile
	renameLock = os.Rename
)

func newNonce() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// createLock is the O_EXCL create; a lock that could not be written whole is removed.
func createLock(path, content string) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, werr := f.WriteString(content)
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		os.Remove(path)
	}
	return werr
}

// Acquire takes the harvest lock at path (spec §5.9). A held lock is stale, and replaced, when its pid
// is not alive or it is older than staleAfter. ErrLocked: held and not stale, with holder "pid N since
// T", or a held lock that could not be read or claimed within the bounded retries (a Windows sharing
// violation while a contender has it open); any other create error: the caller warns and runs
// without the lock. release is never nil, removes the lock only while it is still this one, and may
// be called more than once.
func Acquire(path string, now time.Time, staleAfter time.Duration, alive func(pid int) bool) (func(), string, error) {
	noop := func() {}
	mine := lockContent(os.Getpid(), now, newNonce())
	holder := ""
	for range 4 {
		err := createLock(path, mine)
		if err == nil {
			var once sync.Once
			return func() {
				once.Do(func() {
					if b, err := os.ReadFile(path); err == nil && bytes.Equal(b, []byte(mine)) {
						os.Remove(path)
					}
				})
			}, "", nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return noop, "", err
		}
		held, err := readLock(path)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			contended()
			continue
		}
		pid, since, ok := parseLock(held)
		if !ok {
			// Created but not yet written (or garbled): only its age can make it stale.
			fi, err := os.Stat(path)
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			if err != nil {
				contended()
				continue
			}
			since = fi.ModTime()
		}
		holder = fmt.Sprintf("pid %d since %s", pid, since.In(jst).Format(time.RFC3339))
		if !(now.Sub(since) > staleAfter || ok && !alive(pid)) {
			return noop, holder, ErrLocked
		}
		if err := claimStale(path, held); err != nil {
			contended()
			continue
		}
	}
	if holder == "" {
		holder = "holder unreadable"
	}
	return noop, holder, ErrLocked
}

// contended is the pause before Acquire retries a lock it could not read or claim: a sharing
// violation lasts as long as the contender's open handle.
func contended() { time.Sleep(10 * time.Millisecond) }

// claimStale moves the stale lock out of the way so that only one replacer gets to create the next
// one: the rename succeeds for one of them, and the other's finds nothing (or a fresh lock). What was
// renamed is checked against the stale bytes judged; a fresh lock taken by mistake is linked back
// (never over a lock that appeared meanwhile). The caller then retries the O_EXCL create.
func claimStale(path string, stale []byte) error {
	claimed := path + "." + newNonce() + ".stale"
	if err := renameLock(path, claimed); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	if got, err := os.ReadFile(claimed); err == nil && !bytes.Equal(got, stale) {
		if os.Link(claimed, path) != nil {
			if _, err := os.Lstat(path); errors.Is(err, fs.ErrNotExist) {
				os.Rename(claimed, path)
			}
		}
	}
	os.Remove(claimed)
	return nil
}
