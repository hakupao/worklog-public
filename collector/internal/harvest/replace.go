package harvest

import (
	"os"
	"time"
)

// rename is os.Rename (a test seam for a failed replace).
var rename = os.Rename

// replaceBudget bounds how long replaceFile keeps retrying a transient failure (a test seam).
var replaceBudget = 2 * time.Second

// transient reports a rename failure that goes away by itself (a test seam; see transientRename).
var transient = transientRename

// replaceFile renames tmp over path. On Windows the rename fails with "Access is denied" while
// another process holds path open without FILE_SHARE_DELETE; Defender's real-time scan does that to
// each new state file for a moment, and harvest saves the state after every session it sends
// (Task 14 A2 on Win11: 5 Go harvests exited 1 this way). Such failures are retried with a growing
// pause for up to replaceBudget, as cmd/go's robustio does; any other error returns at once.
func replaceFile(tmp, path string) error {
	deadline := time.Now().Add(replaceBudget)
	pause := time.Millisecond
	for {
		err := rename(tmp, path)
		if err == nil || !transient(err) || time.Now().Add(pause).After(deadline) {
			return err
		}
		time.Sleep(pause)
		pause = min(2*pause, 100*time.Millisecond)
	}
}
