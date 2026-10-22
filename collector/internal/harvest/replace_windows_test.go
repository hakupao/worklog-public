//go:build windows

package harvest

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// holdOpen opens path the way a scanner without FILE_SHARE_DELETE does.
func holdOpen(t *testing.T, path string) syscall.Handle {
	name, _ := syscall.UTF16PtrFromString(path)
	h, err := syscall.CreateFile(name, syscall.GENERIC_READ, syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE,
		nil, syscall.OPEN_EXISTING, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// The Win11 failure itself: a rename over a file held open without FILE_SHARE_DELETE is
// "Access is denied", and SaveState gets through once the holder lets go.
func TestSaveStateOutlastsAWindowsHolder(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "harvest_state.json")
	write(t, p, []byte(`{"old": {"mtime": 1.0}}`))
	h := holdOpen(t, p)
	other := filepath.Join(dir, "other.json")
	write(t, other, []byte(`{}`))
	if err := os.Rename(other, p); !errors.Is(err, syscall.Errno(5)) || !transientRename(err) {
		syscall.CloseHandle(h)
		t.Fatalf("rename over a held file: %v", err)
	}
	os.Remove(other)
	released := make(chan struct{})
	go func() {
		time.Sleep(150 * time.Millisecond)
		syscall.CloseHandle(h)
		close(released)
	}()
	t.Cleanup(func() { <-released }) // before TempDir's RemoveAll, even when SaveState fails early
	if err := SaveState(p, map[string]Bookmark{"new": {Mtime: 2}}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != `{"new": {"mtime": 2.0}}` {
		t.Fatalf("%s", b)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("left behind: %v", entries)
	}
}

// A holder that never lets go still fails, with the old state whole.
func TestSaveStateFailsWhileAWindowsHolderStays(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "harvest_state.json")
	write(t, p, []byte(`{"old": {"mtime": 1.0}}`))
	h := holdOpen(t, p)
	defer syscall.CloseHandle(h)
	old := replaceBudget
	replaceBudget = 50 * time.Millisecond
	t.Cleanup(func() { replaceBudget = old })
	if err := SaveState(p, map[string]Bookmark{"new": {Mtime: 2}}); !errors.Is(err, syscall.Errno(5)) {
		t.Fatalf("err %v", err)
	}
	if b, _ := os.ReadFile(p); string(b) != `{"old": {"mtime": 1.0}}` {
		t.Fatalf("%s", b)
	}
}
