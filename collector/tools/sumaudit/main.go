// Command sumaudit serves the tiered plan's Rule-A audit S1: for each session key it prints the
// cached summary and its fingerprints from <Home>/collector_state.json, the key's decision lines in
// <Home>/tiers.jsonl, and a fresh summarize.Summarize of the log as it is now, through the local
// `claude`. It makes no HTTP call and writes nothing.
//
//	WORKLOG_ROOT=<repo> go -C collector run ./tools/sumaudit [--claude-root DIR] [--codex-root DIR] KEY...
//
// KEY is "claude-code:<session id>" or "codex:<session id>", as in harvest_state.json. The config
// (WORKLOG_ROOT, WORKLOG_HOME) is read as `wl` reads it, for Home and summarize_model.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/hakupao/worklog/collector/internal/claudecode"
	"github.com/hakupao/worklog/collector/internal/codex"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/harvest"
	"github.com/hakupao/worklog/collector/internal/llm"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/summarize"
)

func main() {
	env := rt.Default()
	os.Exit(run(os.Args[1:], env, llm.NewClaude(env)))
}

func run(args []string, env *rt.Env, runner llm.Runner) int {
	fs := flag.NewFlagSet("sumaudit", flag.ContinueOnError)
	fs.SetOutput(env.Stderr)
	claudeRoot := fs.String("claude-root", claudecode.DefaultRoot(env.Home), "Claude logs root")
	codexRoot := fs.String("codex-root", codex.DefaultRoot(env.Home), "Codex sessions root (archived_sessions/ is its sibling)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() == 0 {
		fmt.Fprintln(env.Stderr, "usage: sumaudit [--claude-root DIR] [--codex-root DIR] KEY...")
		return 2
	}
	cfg, err := config.Load(env)
	if err != nil {
		fmt.Fprintf(env.Stderr, "sumaudit: %v (set WORKLOG_ROOT to the directory holding config.toml)\n", err)
		return 2
	}
	cs := harvest.LoadCollectorState(cfg.CollectorStatePath())
	state := harvest.LoadState(cfg.StatePath())
	decisions := tiersLines(cfg.TiersLogPath())
	out := env.Stdout
	status := 0
	for _, key := range fs.Args() {
		fmt.Fprintf(out, "== %s\n", key)
		agent, id, _ := strings.Cut(key, ":")
		e, has := cs.Sessions[key]
		if has {
			_, valid := cs.Valid(key, state)
			fmt.Fprintf(out, "cache: source=%s tries=%d at=%s tried=%s last_msg=%s pfp=%s cur_pfp=%s bm_valid=%v\n",
				e.Source, e.Tries, stamp(e.At), stamp(e.Tried), stampPtr(e.LastMsg), e.PFP, e.CurPFP, valid)
			fmt.Fprintf(out, "cached summary: %s\n", e.Summary)
		} else {
			fmt.Fprintln(out, "cache: no entry")
		}
		ds := decisions[key]
		fmt.Fprintf(out, "tiers.jsonl: %d decision(s)", len(ds))
		for _, d := range ds {
			fmt.Fprintf(out, "; %s %s %s", stamp(d.TS), d.Rule, d.Source)
		}
		fmt.Fprintln(out)
		path, ok := cs.PathOf(key)
		if !ok {
			fmt.Fprintln(out, "log: unknown (no index entry or path)")
			status = 1
			continue
		}
		raw := parse(agent, id, path, *claudeRoot, *codexRoot, env)
		if raw == nil {
			fmt.Fprintf(out, "log: %s does not yield session %s\n", path, id)
			status = 1
			continue
		}
		pfp := harvest.PromptDigest(raw)
		fmt.Fprintf(out, "log: %s (pfp now %s, == cur_pfp %v, == pfp %v)\n", path, pfp, has && pfp == e.CurPFP, has && pfp == e.PFP)
		summary, source := summarize.Summarize(runner, raw, cfg.SummarizeModel)
		fmt.Fprintf(out, "fresh summary (%s): %s\n", source, summary)
	}
	return status
}

// parse reads the one log at path through the stat-first seam and returns its session with id.
func parse(agent, id, path, claudeRoot, codexRoot string, env *rt.Env) *session.RawSession {
	var found *session.RawSession
	keep := func(p string, _ float64) bool { return p == path }
	yield := func(raw *session.RawSession) {
		if raw.SessionID == id {
			found = raw
		}
	}
	switch agent {
	case "claude-code":
		claudecode.IterSessionsFiltered(claudeRoot, nil, claudecode.Filter{Keep: keep}, env, yield)
	case "codex":
		codex.IterSessionsFiltered(codexRoot, nil, codex.Filter{Keep: keep}, env, yield)
	}
	return found
}

type decision struct {
	TS     float64 `json:"ts"`
	Key    string  `json:"key"`
	Rule   string  `json:"rule"`
	Source string  `json:"source"`
}

// tiersLines is tiers.jsonl's session decisions by key, in file order; job lines and unreadable
// lines are left out.
func tiersLines(path string) map[string][]decision {
	out := map[string][]decision{}
	f, err := os.Open(path)
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		var d decision
		if json.Unmarshal(sc.Bytes(), &d) == nil && d.Key != "" {
			out[d.Key] = append(out[d.Key], d)
		}
	}
	return out
}

var jst = time.FixedZone("JST", 9*3600)

func stamp(epoch float64) string {
	if epoch == 0 {
		return "0"
	}
	return time.Unix(0, int64(epoch*1e9)).In(jst).Format("2006-01-02T15:04:05")
}

func stampPtr(p *float64) string {
	if p == nil {
		return "none"
	}
	return stamp(*p)
}
