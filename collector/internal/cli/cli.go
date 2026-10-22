// Package cli is the wl command line (cli.py): new, done, hold, note, ls, harvest, review and
// plan judge, with Python's arguments, output lines and exit codes (spec §4.1).
package cli

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/harvest"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// Version is set at build time with -ldflags "-X github.com/hakupao/worklog/collector/internal/cli.Version=…";
// it is the User-Agent's version.
var Version = "dev"

// Seams the tests replace: the claude runner, harvest's summarizer workers (run.harvest's
// default), and the random tail of a note id.
var (
	newRunner      = llm.NewClaude
	harvestWorkers = 4
	acquireLock    = harvest.Acquire
	noteTail       = func() string {
		var b [2]byte
		_, _ = rand.Read(b[:])
		return hex.EncodeToString(b[:])
	}
)

// table is the command set (tests/test_cli.py:105 pins it).
var table []*command

func init() {
	table = []*command{
		{name: "new", args: []string{"REQUESTER", "TITLE"}, run: runNew, help: "Register a case and print the id the server allocated.",
			opts: []option{{names: []string{"--project"}, kind: value, meta: "TEXT"}, {names: []string{"--received"}, kind: value, meta: "YYYY-MM-DD"}}},
		{name: "done", args: []string{"TASK_ID"}, run: runDone, help: "Mark a case done.",
			opts: []option{{names: []string{"--deliverable"}, kind: multi, meta: "PATH", help: "repeatable"}, {names: []string{"--hours"}, kind: value, meta: "FLOAT", help: "x>=0"}}},
		{name: "hold", args: []string{"TASK_ID"}, run: runHold, help: "Put a case on hold."},
		{name: "note", args: []string{"TASK_ID", "TEXT"}, run: runNote, help: "Write a note (TASK_ID - for none) and append it to the case's 備考.",
			opts: []option{{names: []string{"--minutes"}, kind: value, meta: "INTEGER"}}},
		{name: "ls", run: runLs, help: "List the open and held cases.",
			opts: []option{{names: []string{"--all"}, kind: flag}}},
		{name: "harvest", run: runHarvest, help: "Collect the agent session logs.",
			opts: []option{
				{names: []string{"--claude-root"}, kind: value, meta: "PATH"},
				{names: []string{"--codex-root"}, kind: value, meta: "PATH"},
				{names: []string{"--since"}, kind: value, meta: "INTEGER", help: "直近N日以内に更新されたログのみ対象（既定: 14日、--refresh-meta は全期間）"},
				{names: []string{"--refresh-meta", "--files-only"}, kind: flag, help: "既存セッションの成果物候補と token 用量・費用だけを更新する（--files-only は旧名）"},
				{names: []string{"--tiered"}, kind: flag, help: "スケジューラ用: 変わったログだけを読み、期限の来た仕事だけを行う"},
			}},
		{name: "review", run: runReview, help: "週次の AI 振り返りを生成してサーバーに保存する。",
			opts: []option{{names: []string{"--week"}, kind: value, meta: "YYYY-Www", help: "対象週（例: 2026-W39）。既定は先週"}, {names: []string{"--force"}, kind: flag, help: "既存の振り返りを作り直す"}}},
		{name: "plan", help: "計画 / 今日の予定", sub: []*command{
			{name: "judge", run: runPlanJudge, help: "今日の予定をセッションと突き合わせて判定する（指紋が同じでも再判定する）。",
				opts: []option{{names: []string{"--date"}, kind: value, meta: "YYYY-MM-DD", help: "対象日（YYYY-MM-DD、JST）。既定は今日"}}},
		}},
	}
}

// Main runs one wl command line and returns the exit code. A panic anywhere is reported as one
// stderr line and exit 1, where Python prints a traceback and exits 1.
func Main(args []string, env *rt.Env) (code int) {
	defer setupConsole(env)()
	defer func() {
		if p := recover(); p != nil {
			crash(env, p)
			code = 1
		}
	}()
	return dispatch(env, "wl", table, args)
}

// crash is the one line an uncaught error prints.
func crash(env *rt.Env, p any) {
	env.Warnf("worklog: unexpected error: %v", p)
}

// dispatch finds the command for args in group (the top level or plan) and runs it.
func dispatch(env *rt.Env, path string, group []*command, args []string) int {
	for i, tok := range args {
		switch {
		case tok == "--help":
			groupHelp(env.Stdout, path, group)
			return 0
		case strings.HasPrefix(tok, "-") && len(tok) > 1 && tok != "--":
			name, _, _ := strings.Cut(tok, "=")
			return usage(env, &usageError{path, "No such option: " + name}, true)
		case tok == "--":
			continue
		}
		var c *command
		for _, x := range group {
			if x.name == tok {
				c = x
			}
		}
		if c == nil {
			return usage(env, &usageError{path, fmt.Sprintf("No such command '%s'.", tok)}, true)
		}
		sub := path + " " + c.name
		if c.sub != nil {
			return dispatch(env, sub, c.sub, args[i+1:])
		}
		p, help, uerr := c.parse(sub, args[i+1:])
		if uerr != nil {
			return usage(env, uerr, false)
		}
		if help {
			commandHelp(env.Stdout, sub, c)
			return 0
		}
		return c.run(env, p)
	}
	return usage(env, &usageError{path, "Missing command."}, true)
}

// usage prints a click-style usage error to stderr and returns 2.
func usage(env *rt.Env, e *usageError, group bool) int {
	line := "Usage: " + e.path + " [OPTIONS]"
	if group {
		line += " COMMAND [ARGS]..."
	} else if c := lookup(e.path); c != nil {
		line += argsSpec(c)
	}
	env.Warnf("%s", line)
	env.Warnf("Try '%s --help' for help.", e.path)
	env.Warnf("")
	env.Warnf("Error: %s", e.msg)
	return 2
}

// lookup is the command at a "wl x [y]" path.
func lookup(path string) *command {
	group := table
	var c *command
	for _, n := range strings.Fields(path)[1:] {
		c = nil
		for _, x := range group {
			if x.name == n {
				c = x
			}
		}
		if c == nil {
			return nil
		}
		group = c.sub
	}
	return c
}

func argsSpec(c *command) string {
	s := ""
	for _, a := range c.args {
		s += " " + a
	}
	return s
}

func groupHelp(w io.Writer, path string, group []*command) {
	lines := []string{"Usage: " + path + " [OPTIONS] COMMAND [ARGS]...", "", "Options:", "  --help  Show this message and exit.", "", "Commands:"}
	for _, c := range group {
		lines = append(lines, fmt.Sprintf("  %-8s %s", c.name, c.help))
	}
	writeLines(w, lines)
}

func commandHelp(w io.Writer, path string, c *command) {
	lines := []string{"Usage: " + path + " [OPTIONS]" + argsSpec(c), ""}
	if c.help != "" {
		lines = append(lines, "  "+c.help, "")
	}
	lines = append(lines, "Options:")
	for _, o := range c.opts {
		name := strings.Join(o.names, ", ")
		if o.kind != flag {
			name += " " + o.meta
		}
		lines = append(lines, fmt.Sprintf("  %-28s %s", name, o.help))
	}
	lines = append(lines, fmt.Sprintf("  %-28s %s", "--help", "Show this message and exit."))
	writeLines(w, lines)
}

// writeLines writes each line with its own Write (stdout is never buffered: spec §4.17).
func writeLines(w io.Writer, lines []string) {
	for _, l := range lines {
		io.WriteString(w, l+"\n")
	}
}

// out prints one stdout line (typer.echo).
func out(env *rt.Env, format string, a ...any) {
	io.WriteString(env.Stdout, fmt.Sprintf(format, a...)+"\n")
}

// loadCfg is _load_cfg: a config error is printed as is, exit 1.
func loadCfg(env *rt.Env) (*config.Config, int) {
	cfg, err := config.Load(env)
	if err != nil {
		env.Warnf("%s", err)
		return nil, 1
	}
	return cfg, 0
}

// client is _client: the API is the only store, so a command with nowhere to write cannot run.
func client(cfg *config.Config, env *rt.Env) (*api.Client, int) {
	if cfg.APIURL == "" || cfg.APIToken == "" {
		env.Warnf("error: api_url (config.toml) and api_token (~/.worklog/credentials.toml) are required")
		return nil, 1
	}
	return api.NewClient(api.ClientConfig{
		URL: cfg.APIURL, Token: cfg.APIToken,
		AccessID: cfg.AccessClientID, AccessSecret: cfg.AccessClientSecret,
		OutboxDir: filepath.Join(cfg.Home, "outbox"), Version: Version,
	}, env), 0
}

// setup is _load_cfg then _client.
func setup(env *rt.Env) (*config.Config, *api.Client, int) {
	cfg, code := loadCfg(env)
	if code != 0 {
		return nil, nil, code
	}
	c, code := client(cfg, env)
	return cfg, c, code
}
