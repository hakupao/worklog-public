// Command tiered-rollback prepares a tiered home for full mode (spec §5.11). Full mode never
// refreshes a summary whose log stopped moving, so each key whose cached summary is stale
// (cur_pfp != pfp) or a fallback gets its harvest_state.json bookmark rewritten to {mtime: 0}, with no
// fp. The next full-mode run then re-summarizes exactly those sessions, once. Every other
// bookmark, and every other file in the home, is left untouched.
//
//	go -C collector run ./tools/tiered-rollback <Home>
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/hakupao/worklog/collector/internal/harvest"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) != 1 {
		fmt.Fprintln(stderr, "usage: tiered-rollback <Home>   (the WORKLOG_HOME holding harvest_state.json and collector_state.json)")
		return 2
	}
	statePath := filepath.Join(args[0], "harvest_state.json")
	if _, err := os.Stat(statePath); err != nil {
		fmt.Fprintf(stderr, "tiered-rollback: %v\n", err)
		return 1
	}
	state := harvest.LoadState(statePath)
	cs := harvest.LoadCollectorState(filepath.Join(args[0], "collector_state.json"))
	n := 0
	for key, e := range cs.Sessions {
		if _, has := state[key]; has && (e.CurPFP != e.PFP || e.Source == "fallback") {
			state[key] = harvest.Bookmark{Mtime: 0}
			n++
		}
	}
	if n > 0 {
		if err := harvest.SaveState(statePath, state); err != nil {
			fmt.Fprintf(stderr, "tiered-rollback: %v\n", err)
			return 1
		}
	}
	fmt.Fprintf(stdout, "reset=%d\n", n)
	return 0
}
