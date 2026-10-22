package harvest

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const deadPid = 4242

func writeLock(t *testing.T, path string, pid int, since time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(lockContent(pid, since, "theirs")), 0o644); err != nil {
		t.Fatal(err)
	}
}

func onlyAlive(pids ...int) func(int) bool {
	return func(pid int) bool {
		for _, p := range pids {
			if p == pid {
				return true
			}
		}
		return false
	}
}

func TestLockHeldByALivePidIsRespected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "harvest.lock")
	now := jstAt(2026, 10, 20, 14, 0)
	since := now.Add(-59 * time.Minute)
	writeLock(t, path, deadPid, since)
	release, holder, err := Acquire(path, now, time.Hour, onlyAlive(deadPid))
	if !errors.Is(err, ErrLocked) {
		t.Fatalf("err %v", err)
	}
	if want := "pid 4242 since 2026-10-20T13:01:00+09:00"; holder != want {
		t.Fatalf("holder %q want %q", holder, want)
	}
	release() // a no-op: the lock is not ours
	if b, _ := os.ReadFile(path); !strings.Contains(string(b), "theirs") {
		t.Fatalf("the holder's lock was touched: %q", b)
	}

	// Our own lock is respected by a second Acquire, and released by its release.
	os.Remove(path)
	release, _, err = Acquire(path, now, time.Hour, onlyAlive(os.Getpid()))
	if err != nil {
		t.Fatal(err)
	}
	if _, holder, err := Acquire(path, now, time.Hour, onlyAlive(os.Getpid())); !errors.Is(err, ErrLocked) ||
		!strings.HasPrefix(holder, "pid "+strconv.Itoa(os.Getpid())+" since ") {
		t.Fatalf("second acquire: %v %q", err, holder)
	}
	release()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("release left the lock: %v", err)
	}
	release() // twice is harmless
}

func TestLockOfADeadPidOrOlderThan60MinIsReplaced(t *testing.T) {
	now := jstAt(2026, 10, 20, 14, 0)
	for _, c := range []struct {
		name  string
		since time.Time
		alive func(int) bool
	}{
		{"dead pid", now.Add(-time.Minute), onlyAlive()},
		{"older than 60 min", now.Add(-61 * time.Minute), onlyAlive(deadPid)},
	} {
		path := filepath.Join(t.TempDir(), "harvest.lock")
		writeLock(t, path, deadPid, c.since)
		release, _, err := Acquire(path, now, time.Hour, c.alive)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		b, _ := os.ReadFile(path)
		if pid, _, ok := parseLock(b); !ok || pid != os.Getpid() {
			t.Fatalf("%s: lock now %q", c.name, b)
		}
		release()
		if m, _ := filepath.Glob(filepath.Join(filepath.Dir(path), "*")); len(m) != 0 {
			t.Fatalf("%s: left %v", c.name, m)
		}
	}
}

func TestStaleLockRaceOnlyOneWinner(t *testing.T) {
	now := jstAt(2026, 10, 20, 14, 0)
	alive := onlyAlive(os.Getpid())
	for i := range 300 {
		dir := t.TempDir()
		path := filepath.Join(dir, "harvest.lock")
		writeLock(t, path, deadPid, now.Add(-time.Minute))
		var (
			start    sync.WaitGroup
			done     sync.WaitGroup
			mu       sync.Mutex
			wins     int
			releases []func()
			errs     []error
		)
		start.Add(1)
		for range 2 {
			done.Add(1)
			go func() {
				defer done.Done()
				start.Wait()
				release, _, err := Acquire(path, now, time.Hour, alive)
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					wins++
					releases = append(releases, release)
				} else if !errors.Is(err, ErrLocked) {
					errs = append(errs, err)
				}
			}()
		}
		start.Done()
		done.Wait()
		if wins != 1 || len(errs) != 0 {
			t.Fatalf("iteration %d: %d winners, errors %v", i, wins, errs)
		}
		releases[0]()
		if m, _ := filepath.Glob(filepath.Join(dir, "*")); len(m) != 0 {
			t.Fatalf("iteration %d: left %v", i, m)
		}
	}
}

func TestAcquireOtherErrorIsReturnedWithANoopRelease(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing", "harvest.lock")
	release, _, err := Acquire(path, time.Now(), time.Hour, onlyAlive())
	if err == nil || errors.Is(err, ErrLocked) {
		t.Fatalf("err %v", err)
	}
	release() // always callable
}

// Final review, finding 6: on Windows a contender's read of the lock makes claimStale's rename fail
// (Go opens files without FILE_SHARE_DELETE), and a read can fail the same way. Neither may make the
// caller run without the lock: Acquire retries, then answers ErrLocked.
func TestStaleClaimReadOrRenameFailureIsRetriedThenLocked(t *testing.T) {
	now := jstAt(2026, 10, 20, 14, 0)
	sharing := errors.New("The process cannot access the file because it is being used by another process.")
	for _, c := range []struct {
		name         string
		fails        int // failures before the seam behaves again; 0 = always
		read, rename bool
		wantLocked   bool
	}{
		{"rename always fails", 0, false, true, true},
		{"read always fails", 0, true, false, true},
		{"rename fails once", 1, false, true, false},
		{"read fails once", 1, true, false, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "harvest.lock")
			writeLock(t, path, deadPid, now.Add(-time.Minute))
			n := 0
			fail := func() bool { n++; return c.fails == 0 || n <= c.fails }
			if c.read {
				readLock = func(p string) ([]byte, error) {
					if fail() {
						return nil, sharing
					}
					return os.ReadFile(p)
				}
			}
			if c.rename {
				renameLock = func(a, b string) error {
					if fail() {
						return sharing
					}
					return os.Rename(a, b)
				}
			}
			t.Cleanup(func() { readLock, renameLock = os.ReadFile, os.Rename })
			release, _, err := Acquire(path, now, time.Hour, onlyAlive())
			defer release()
			if c.wantLocked {
				if !errors.Is(err, ErrLocked) {
					t.Fatalf("err %v, want ErrLocked", err)
				}
				if b, _ := os.ReadFile(path); !strings.Contains(string(b), "theirs") {
					t.Fatalf("the stale lock was touched: %q", b)
				}
				return
			}
			if err != nil {
				t.Fatalf("err %v", err)
			}
			if b, _ := os.ReadFile(path); !strings.Contains(string(b), strconv.Itoa(os.Getpid())) {
				t.Fatalf("lock now %q", b)
			}
		})
	}
}

func TestPidAlive(t *testing.T) {
	if !PidAlive(os.Getpid()) {
		t.Fatal("this process is not alive")
	}
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	if PidAlive(cmd.Process.Pid) {
		t.Fatalf("pid %d of a finished process is alive", cmd.Process.Pid)
	}
	if PidAlive(0) || PidAlive(-1) {
		t.Fatal("pid 0 / -1 alive")
	}
}
