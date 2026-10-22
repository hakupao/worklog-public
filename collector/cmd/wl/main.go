// Command wl is the worklog collector and CLI (Go port of the former Python collector,
// removed 2026-10-22; see git history).
package main

import (
	"os"

	"github.com/hakupao/worklog/collector/internal/cli"
	"github.com/hakupao/worklog/collector/internal/rt"
)

func main() {
	os.Exit(cli.Main(os.Args[1:], rt.Default()))
}
