package harvest

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var errBusy = errors.New("busy")

// fakeRename fails with errBusy the first `busy` times, then renames; errBusy counts as transient.
func fakeRename(t *testing.T, busy int) *int {
	oldRename, oldTransient, oldBudget := rename, transient, replaceBudget
	t.Cleanup(func() { rename, transient, replaceBudget = oldRename, oldTransient, oldBudget })
	calls := 0
	rename = func(from, to string) error {
		calls++
		if calls <= busy {
			return errBusy
		}
		return os.Rename(from, to)
	}
	transient = func(err error) bool { return errors.Is(err, errBusy) }
	return &calls
}

// A target held open for a moment (Defender scanning the last state file) is retried, not fatal.
func TestSaveStateRetriesATransientRename(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "harvest_state.json")
	write(t, p, []byte(`{"old": {"mtime": 1.0}}`))
	calls := fakeRename(t, 3)
	if err := SaveState(p, map[string]Bookmark{"new": {Mtime: 2}}); err != nil {
		t.Fatal(err)
	}
	if *calls != 4 {
		t.Fatalf("calls %d", *calls)
	}
	if b, _ := os.ReadFile(p); string(b) != `{"new": {"mtime": 2.0}}` {
		t.Fatalf("%s", b)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("left behind: %v", entries)
	}
}

// A target that stays busy past the budget fails as before: old state whole, no temporary file.
func TestSaveStateGivesUpAfterTheBudget(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "harvest_state.json")
	write(t, p, []byte(`{"old": {"mtime": 1.0}}`))
	calls := fakeRename(t, 1<<30)
	replaceBudget = 30 * time.Millisecond
	start := time.Now()
	if err := SaveState(p, map[string]Bookmark{"new": {Mtime: 2}}); !errors.Is(err, errBusy) {
		t.Fatalf("err %v", err)
	}
	if d := time.Since(start); d > time.Second {
		t.Fatalf("took %v", d)
	}
	if *calls < 2 {
		t.Fatalf("calls %d", *calls)
	}
	if b, _ := os.ReadFile(p); string(b) != `{"old": {"mtime": 1.0}}` {
		t.Fatalf("%s", b)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("left behind: %v", entries)
	}
}

// Any other error is not retried.
func TestSaveStateDoesNotRetryOtherErrors(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "harvest_state.json")
	fakeRename(t, 0)
	calls := 0
	rename = func(string, string) error { calls++; return os.ErrPermission }
	transient = func(err error) bool { return errors.Is(err, errBusy) }
	if err := SaveState(p, map[string]Bookmark{"new": {Mtime: 2}}); err == nil || calls != 1 {
		t.Fatalf("err %v calls %d", err, calls)
	}
}
