// Package config loads config.toml, credentials.toml and local.toml exactly as the former Python
// collector's config.py did (removed 2026-10-22; see git history): the same precedence, the same
// warning and error strings (D5 aside), [projects] in file order.
//
// This is the one package where decoding into map[string]any is allowed (spec §8): nothing decoded
// that way reaches a serialization path; every value is copied into typed fields here.
package config

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"

	"github.com/hakupao/worklog/collector/internal/rt"
)

// Project maps a working-directory prefix to a project name.
type Project struct{ Dir, Name string }

// Config is the loaded configuration. An empty string in an API field means None.
type Config struct {
	Machine, Root, Home, SummarizeModel string
	Requesters                          map[string]string // lookup only
	Projects                            []Project         // config.toml order
	ExcludeCwdPatterns                  []string
	ExcludePromptPatterns               []string
	Pricing                             map[string]map[string]float64 // lookup only; ints widened
	MinActiveMinutes                    int
	APIURL, APIToken                    string
	AccessClientID, AccessClientSecret  string
}

// StatePath is the harvest bookmark file. It describes this machine's logs, not the repo, so it
// lives in home.
func (c *Config) StatePath() string { return filepath.Join(c.Home, "harvest_state.json") }

// CollectorStatePath, LockPath and TiersLogPath are the tiered harvest's files, beside StatePath.
func (c *Config) CollectorStatePath() string { return filepath.Join(c.Home, "collector_state.json") }
func (c *Config) LockPath() string           { return filepath.Join(c.Home, "harvest.lock") }
func (c *Config) TiersLogPath() string       { return filepath.Join(c.Home, "tiers.jsonl") }

const defaultExcludePrompt = "Review this change for security vulnerabilities"

func isFile(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.Mode().IsRegular()
}

// resolve is Path.resolve(): absolute, symlinks followed where the path exists.
func resolve(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	if real, err := filepath.EvalSymlinks(p); err == nil {
		p = real
	}
	return p
}

// ancestorWithConfig returns the first of start and its parents that holds a config.toml.
func ancestorWithConfig(start string) (string, bool) {
	if start == "" {
		return "", false
	}
	for cur := resolve(start); ; {
		if isFile(filepath.Join(cur, "config.toml")) {
			return cur, true
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return "", false
		}
		cur = parent
	}
}

func findRoot(env *rt.Env) (string, error) {
	if r, ok := ancestorWithConfig(env.Cwd); ok {
		return r, nil
	}
	if env.Exe != "" {
		if r, ok := ancestorWithConfig(filepath.Dir(env.Exe)); ok {
			return r, nil
		}
	}
	return "", errors.New("worklog: config.toml not found. Set WORKLOG_ROOT or create a config.toml " +
		"in the current directory or an ancestor.")
}

// decodeFile parses a TOML file. The error text follows Python's "<message> (at line L, column C)".
func decodeFile(path string) (map[string]any, toml.MetaData, error) {
	var raw map[string]any
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, toml.MetaData{}, err
	}
	md, err := toml.Decode(string(data), &raw)
	if err != nil {
		var pe toml.ParseError
		if errors.As(err, &pe) {
			return nil, md, fmt.Errorf("%s (at line %d, column %d)", pe.Message, pe.Position.Line, pe.Position.Col)
		}
		return nil, md, err
	}
	if raw == nil {
		raw = map[string]any{}
	}
	return raw, md, nil
}

// nonemptyStr is _nonempty_str: the value if it is a non-empty string, else None.
func nonemptyStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func invalid(field, want string) error {
	return fmt.Errorf("invalid config.toml: %s must be %s", field, want)
}

func strField(raw map[string]any, key, def string) (string, error) {
	v, ok := raw[key]
	if !ok {
		return def, nil
	}
	s, ok := v.(string)
	if !ok {
		return "", invalid(key, "a string")
	}
	return s, nil
}

func strList(v any, field string, def []string) ([]string, error) {
	if v == nil {
		return def, nil
	}
	list, ok := v.([]any)
	if !ok {
		return nil, invalid(field, "a list of strings")
	}
	out := make([]string, 0, len(list))
	for _, e := range list {
		s, ok := e.(string)
		if !ok {
			return nil, invalid(field, "a list of strings")
		}
		out = append(out, s)
	}
	return out, nil
}

// pyInt is int(value) for the TOML scalar types.
func pyInt(v any) (int, error) {
	switch x := v.(type) {
	case int64:
		return int(x), nil
	case bool:
		if x {
			return 1, nil
		}
		return 0, nil
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return 0, errors.New("cannot convert float to integer")
		}
		return int(x), nil // truncates toward zero, like int()
	case string:
		n, err := strconv.Atoi(strings.ReplaceAll(strings.TrimSpace(x), "_", ""))
		if err != nil {
			return 0, fmt.Errorf("invalid literal for int(): %q", x)
		}
		return n, nil
	}
	return 0, errors.New("int() argument must be a string or a number")
}

func number(v any) (float64, bool) {
	switch x := v.(type) {
	case int64:
		return float64(x), true
	case float64:
		return x, true
	}
	return 0, false
}

// stringTable reads [name] as an ordered list of string pairs.
func stringTable(raw map[string]any, md toml.MetaData, name string) ([][2]string, error) {
	v, ok := raw[name]
	if !ok {
		return nil, nil
	}
	tbl, ok := v.(map[string]any)
	if !ok {
		return nil, invalid(name, "a table")
	}
	var out [][2]string
	seen := map[string]bool{}
	for _, k := range md.Keys() {
		if len(k) != 2 || k[0] != name || seen[k[1]] {
			continue
		}
		seen[k[1]] = true
		s, ok := tbl[k[1]].(string)
		if !ok {
			return nil, invalid(name+"."+k[1], "a string")
		}
		out = append(out, [2]string{k[1], s})
	}
	return out, nil
}

// Load reads the configuration. WORKLOG_ROOT, else the first cwd ancestor holding config.toml,
// else the first ancestor of the executable's directory. Warnings go through env.Warnf.
func Load(env *rt.Env) (*Config, error) {
	var root string
	if r := env.Getenv("WORKLOG_ROOT"); r != "" {
		root = r
		if !isFile(filepath.Join(root, "config.toml")) {
			return nil, fmt.Errorf("worklog: config.toml not found in WORKLOG_ROOT=%s", root)
		}
	} else {
		var err error
		if root, err = findRoot(env); err != nil {
			return nil, err
		}
	}

	cfgPath := filepath.Join(root, "config.toml")
	raw, md, err := decodeFile(cfgPath)
	if err != nil {
		return nil, fmt.Errorf("worklog: cannot read %s: %v", cfgPath, err) // D5
	}

	cfg := &Config{Root: root, MinActiveMinutes: 3}
	harvest, _ := raw["harvest"].(map[string]any)
	if _, ok := raw["harvest"]; ok && harvest == nil {
		return nil, invalid("harvest", "a table")
	}

	if cfg.SummarizeModel, err = strField(raw, "summarize_model", "haiku"); err != nil {
		return nil, err
	}
	if cfg.APIURL, err = strField(raw, "api_url", ""); err != nil {
		return nil, err
	}

	home := env.Getenv("WORKLOG_HOME")
	if home == "" {
		home = filepath.Join(env.Home, ".worklog")
	}
	cfg.Home = filepath.Clean(home)

	credPath := filepath.Join(cfg.Home, "credentials.toml")
	if isFile(credPath) {
		if creds, _, err := decodeFile(credPath); err != nil {
			env.Warnf("worklog: ignoring unreadable credentials file %s (%v)", credPath, err)
		} else {
			cfg.APIToken = nonemptyStr(creds["api_token"])
			cfg.AccessClientID = nonemptyStr(creds["access_client_id"])
			cfg.AccessClientSecret = nonemptyStr(creds["access_client_secret"])
		}
	}

	if cfg.Machine, err = strField(raw, "machine", ""); err != nil {
		return nil, err
	}
	if _, ok := raw["machine"]; !ok {
		cfg.Machine, _ = os.Hostname() // platform.node()
	}
	localPath := filepath.Join(cfg.Home, "local.toml")
	if isFile(localPath) {
		if local, _, err := decodeFile(localPath); err != nil {
			env.Warnf("worklog: ignoring unreadable local config %s (%v)", localPath, err)
		} else if m := nonemptyStr(local["machine"]); m != "" {
			cfg.Machine = m
		}
	}

	req, err := stringTable(raw, md, "requesters")
	if err != nil {
		return nil, err
	}
	cfg.Requesters = make(map[string]string, len(req))
	for _, kv := range req {
		cfg.Requesters[kv[0]] = kv[1]
	}
	proj, err := stringTable(raw, md, "projects")
	if err != nil {
		return nil, err
	}
	for _, kv := range proj {
		cfg.Projects = append(cfg.Projects, Project{Dir: kv[0], Name: kv[1]})
	}

	cfg.Pricing = map[string]map[string]float64{}
	if v, ok := raw["pricing"]; ok {
		tbl, ok := v.(map[string]any)
		if !ok {
			return nil, invalid("pricing", "a table")
		}
		for model, mv := range tbl {
			inner, ok := mv.(map[string]any)
			if !ok {
				return nil, invalid("pricing."+model, "a table")
			}
			prices := make(map[string]float64, len(inner))
			for k, pv := range inner {
				f, ok := number(pv)
				if !ok {
					return nil, invalid("pricing."+model+"."+k, "a number")
				}
				// TOML inf / nan, which Python would carry into a NaN cost (spec §6 D18).
				if math.IsInf(f, 0) || math.IsNaN(f) {
					return nil, invalid("pricing."+model+"."+k, "a finite number")
				}
				prices[k] = f
			}
			cfg.Pricing[model] = prices
		}
	}

	if cfg.ExcludeCwdPatterns, err = strList(harvest["exclude_cwd_patterns"], "harvest.exclude_cwd_patterns", []string{}); err != nil {
		return nil, err
	}
	if cfg.ExcludePromptPatterns, err = strList(harvest["exclude_prompt_patterns"], "harvest.exclude_prompt_patterns",
		[]string{defaultExcludePrompt}); err != nil {
		return nil, err
	}
	if v, ok := harvest["min_active_minutes"]; ok {
		n, err := pyInt(v)
		if err != nil {
			return nil, fmt.Errorf("invalid config.toml: harvest.min_active_minutes: %v", err)
		}
		cfg.MinActiveMinutes = n
	}
	return cfg, nil
}
