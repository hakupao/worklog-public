package config

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strings"
	"testing"

	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

type fakeEnv struct {
	*rt.Env
	stderr *bytes.Buffer
}

// newEnv builds an Env with an isolated environment: only the given variables exist.
func newEnv(t *testing.T, vars map[string]string) fakeEnv {
	t.Helper()
	buf := &bytes.Buffer{}
	e := rt.Default()
	e.Stderr = buf
	e.Stdout = &bytes.Buffer{}
	e.Getenv = func(k string) string { return vars[k] }
	e.Home = t.TempDir()
	e.Cwd = t.TempDir()
	e.Exe = filepath.Join(t.TempDir(), "bin", "wl")
	return fakeEnv{e, buf}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// loadAt writes config.toml into a fresh root and loads it with WORKLOG_HOME=home.
func loadAt(t *testing.T, toml string, home map[string]string) (*Config, fakeEnv, string, string) {
	t.Helper()
	root := t.TempDir()
	h := filepath.Join(t.TempDir(), "home")
	writeFile(t, filepath.Join(root, "config.toml"), toml)
	for name, body := range home {
		writeFile(t, filepath.Join(h, name), body)
	}
	env := newEnv(t, map[string]string{"WORKLOG_ROOT": root, "WORKLOG_HOME": h})
	cfg, err := Load(env.Env)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	return cfg, env, root, h
}

// --- ports of tests/test_config_api.py ---

func TestDefaultsWithoutAPI(t *testing.T) {
	cfg, _, _, home := loadAt(t, "machine=\"mac\"\n", nil)
	if cfg.APIURL != "" || cfg.APIToken != "" || cfg.Home != home {
		t.Fatalf("got %+v", cfg)
	}
}

func TestReadsAPIURLAndToken(t *testing.T) {
	cfg, _, _, _ := loadAt(t, "machine=\"mac\"\napi_url=\"https://wl.example.workers.dev\"\n",
		map[string]string{"credentials.toml": "api_token=\"s3cret\"\n"})
	if cfg.APIURL != "https://wl.example.workers.dev" || cfg.APIToken != "s3cret" {
		t.Fatalf("got %+v", cfg)
	}
}

func TestTokenInConfigTomlIsIgnored(t *testing.T) {
	cfg, _, _, _ := loadAt(t, "machine=\"mac\"\napi_token=\"leaked\"\n", nil)
	if cfg.APIToken != "" {
		t.Fatalf("token %q", cfg.APIToken)
	}
}

func TestMalformedCredentialsAreIgnoredWithWarning(t *testing.T) {
	cfg, env, _, _ := loadAt(t, "machine=\"mac\"\n", map[string]string{"credentials.toml": "api_token = \n"})
	if cfg.APIToken != "" {
		t.Fatalf("token %q", cfg.APIToken)
	}
	if !strings.Contains(env.stderr.String(), "ignoring unreadable credentials file") {
		t.Fatalf("stderr %q", env.stderr.String())
	}
}

func TestLocalTomlOverridesMachine(t *testing.T) {
	cfg, _, _, _ := loadAt(t, "machine=\"macmini\"\n", map[string]string{"local.toml": "machine = \"win11\"\n"})
	if cfg.Machine != "win11" {
		t.Fatalf("machine %q", cfg.Machine)
	}
}

func TestWithoutLocalTomlMachineComesFromConfig(t *testing.T) {
	cfg, _, _, _ := loadAt(t, "machine=\"macmini\"\n", nil)
	if cfg.Machine != "macmini" {
		t.Fatalf("machine %q", cfg.Machine)
	}
}

func TestMalformedLocalTomlIsIgnoredWithWarning(t *testing.T) {
	cfg, env, _, _ := loadAt(t, "machine=\"macmini\"\n", map[string]string{"local.toml": "machine = \n"})
	if cfg.Machine != "macmini" {
		t.Fatalf("machine %q", cfg.Machine)
	}
	if !strings.Contains(env.stderr.String(), "ignoring unreadable local config") {
		t.Fatalf("stderr %q", env.stderr.String())
	}
}

func TestEmptyMachineInLocalTomlIsIgnored(t *testing.T) {
	cfg, _, _, _ := loadAt(t, "machine=\"macmini\"\n", map[string]string{"local.toml": "machine = \"\"\n"})
	if cfg.Machine != "macmini" {
		t.Fatalf("machine %q", cfg.Machine)
	}
}

func TestReadsAccessServiceToken(t *testing.T) {
	cfg, _, _, _ := loadAt(t, "machine=\"mac\"\n", map[string]string{
		"credentials.toml": "api_token=\"t\"\naccess_client_id=\"abc.access\"\naccess_client_secret=\"shh\"\n"})
	if cfg.AccessClientID != "abc.access" || cfg.AccessClientSecret != "shh" {
		t.Fatalf("got %+v", cfg)
	}
}

func TestAccessServiceTokenDefaultsToNone(t *testing.T) {
	cfg, _, _, _ := loadAt(t, "machine=\"mac\"\n", nil)
	if cfg.AccessClientID != "" || cfg.AccessClientSecret != "" {
		t.Fatalf("got %+v", cfg)
	}
}

// Python's "package repo root" fallback becomes the executable's directory ancestors.
func TestFindRootFallsBackToExeDirAncestor(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, filepath.Join(repo, "config.toml"), "machine = 'x'\n")
	env := newEnv(t, map[string]string{"WORKLOG_HOME": t.TempDir()})
	env.Exe = filepath.Join(repo, "bin", "wl")
	writeFile(t, env.Exe, "")
	cfg, err := Load(env.Env)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := filepath.EvalSymlinks(repo)
	if cfg.Root != want {
		t.Fatalf("root %q want %q", cfg.Root, want)
	}
}

func TestFindRootPrefersCwdAncestorOverExeDir(t *testing.T) {
	cwdRoot := t.TempDir()
	writeFile(t, filepath.Join(cwdRoot, "config.toml"), "machine = 'x'\n")
	sub := filepath.Join(cwdRoot, "a", "b")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	exeRoot := t.TempDir()
	writeFile(t, filepath.Join(exeRoot, "config.toml"), "machine = 'y'\n")
	env := newEnv(t, map[string]string{"WORKLOG_HOME": t.TempDir()})
	env.Cwd = sub
	env.Exe = filepath.Join(exeRoot, "bin", "wl")
	cfg, err := Load(env.Env)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := filepath.EvalSymlinks(cwdRoot)
	if cfg.Root != want || cfg.Machine != "x" {
		t.Fatalf("got root %q machine %q want %q", cfg.Root, cfg.Machine, want)
	}
}

// --- root discovery errors ---

func TestWorklogRootWithoutConfigErrors(t *testing.T) {
	dir := t.TempDir()
	env := newEnv(t, map[string]string{"WORKLOG_ROOT": dir})
	_, err := Load(env.Env)
	want := "worklog: config.toml not found in WORKLOG_ROOT=" + dir
	if err == nil || err.Error() != want {
		t.Fatalf("err %v want %q", err, want)
	}
}

func TestNoRootAnywhereErrors(t *testing.T) {
	env := newEnv(t, nil)
	_, err := Load(env.Env)
	want := "worklog: config.toml not found. Set WORKLOG_ROOT or create a config.toml in the current directory or an ancestor."
	if err == nil || err.Error() != want {
		t.Fatalf("err %v", err)
	}
}

func TestHomeDefaultsToDotWorklog(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "config.toml"), "machine='m'\n")
	env := newEnv(t, map[string]string{"WORKLOG_ROOT": root})
	cfg, err := Load(env.Env)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Home != filepath.Join(env.Home, ".worklog") {
		t.Fatalf("home %q", cfg.Home)
	}
	if cfg.StatePath() != filepath.Join(cfg.Home, "harvest_state.json") {
		t.Fatalf("state %q", cfg.StatePath())
	}
}

// D5: a malformed config.toml is one line, not a traceback.
func TestMalformedConfigIsOneLine(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "config.toml"), "machine = \"m\n")
	env := newEnv(t, map[string]string{"WORKLOG_ROOT": root})
	_, err := Load(env.Env)
	prefix := "worklog: cannot read " + filepath.Join(root, "config.toml") + ": "
	if err == nil || !strings.HasPrefix(err.Error(), prefix) || strings.Contains(err.Error(), "\n") {
		t.Fatalf("err %q", err)
	}
	var g struct {
		Cases []struct {
			Name  string `json:"name"`
			Error string `json:"error"`
		} `json:"cases"`
	}
	testkit.Golden(t, "config", &g)
	found := false
	for _, c := range g.Cases {
		if c.Name == "malformed" && c.Error == "TOMLDecodeError" {
			found = true
		}
	}
	if !found {
		t.Fatal("golden has no malformed/TOMLDecodeError case")
	}
}

func TestWrongTypeIsAnError(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "config.toml"), "machine=\"m\"\nprojects = 3\n")
	env := newEnv(t, map[string]string{"WORKLOG_ROOT": root})
	if _, err := Load(env.Env); err == nil {
		t.Fatal("want error (golden: ValidationError)")
	}
}

// A non-finite [pricing] rate (TOML inf / nan, which tomllib accepts too) is a config error in Go
// (spec §6 D18): a NaN cost must never reach a request body.
func TestNonFinitePricingIsAnError(t *testing.T) {
	for _, rate := range []string{"inf", "+inf", "-inf", "nan", "-nan"} {
		root := t.TempDir()
		writeFile(t, filepath.Join(root, "config.toml"), "machine=\"m\"\n[pricing.m]\ninput = 1.0\noutput = "+rate+"\n")
		env := newEnv(t, map[string]string{"WORKLOG_ROOT": root})
		_, err := Load(env.Env)
		if err == nil || err.Error() != "invalid config.toml: pricing.m.output must be a finite number" {
			t.Errorf("%s: err %v", rate, err)
		}
	}
}

// Spec §6 D18, Go column: TOML 1.1 forms tomllib rejects load (a BOM, a newline in an inline
// table, \e); a [pricing] rate Python would coerce ("15", true) and a min_active_minutes of
// Unicode digits are config errors.
func TestD18TOMLAndCoercion(t *testing.T) {
	cfg, _, _, _ := loadAt(t, "\ufeffmachine=\"m\"\nx={a=1,\nb=2}\ny=\"\\e\"\n", map[string]string{"credentials.toml": "\ufeffapi_token=\"t\"\n"})
	if cfg.Machine != "m" || cfg.APIToken != "t" {
		t.Fatalf("got %+v", cfg)
	}
	for body, want := range map[string]string{
		"[pricing.m]\ninput = \"15\"\n":           "invalid config.toml: pricing.m.input must be a number",
		"[pricing.m]\ninput = true\n":             "invalid config.toml: pricing.m.input must be a number",
		"[harvest]\nmin_active_minutes = \"３\"\n": `invalid config.toml: harvest.min_active_minutes: invalid literal for int(): "３"`,
	} {
		root := t.TempDir()
		writeFile(t, filepath.Join(root, "config.toml"), "machine=\"m\"\n"+body)
		env := newEnv(t, map[string]string{"WORKLOG_ROOT": root})
		if _, err := Load(env.Env); err == nil || err.Error() != want {
			t.Errorf("%q: err %v", body, err)
		}
	}
}

// --- single-quoted Windows keys and [projects] order ---

func TestSingleQuotedWindowsKeysAndProjectOrder(t *testing.T) {
	toml := "machine=\"m\"\n[projects]\n\"/work/tie\" = \"TieFirst\"\n\"/work/tie/\" = \"TieSecond\"\n" +
		"'C:\\Work' = \"Win\"\n\"/work\" = \"Root\"\n'C:\\Work\\Acme\\x y' = \"Sp\"\n"
	cfg, _, _, _ := loadAt(t, toml, nil)
	want := []Project{{"/work/tie", "TieFirst"}, {"/work/tie/", "TieSecond"}, {`C:\Work`, "Win"}, {"/work", "Root"}, {`C:\Work\Acme\x y`, "Sp"}}
	if !reflect.DeepEqual(cfg.Projects, want) {
		t.Fatalf("got %v", cfg.Projects)
	}
}

// --- the config.json golden ---

type goldenCfg struct {
	Machine            string                        `json:"machine"`
	Root               string                        `json:"root"`
	Home               string                        `json:"home"`
	StatePath          string                        `json:"state_path"`
	Requesters         [][2]string                   `json:"requesters"`
	Projects           [][2]string                   `json:"projects"`
	ExcludeCwd         []string                      `json:"exclude_cwd_patterns"`
	ExcludePrompt      []string                      `json:"exclude_prompt_patterns"`
	Pricing            map[string]map[string]float64 `json:"pricing"`
	MinActiveMinutes   int                           `json:"min_active_minutes"`
	SummarizeModel     string                        `json:"summarize_model"`
	APIURL             *string                       `json:"api_url"`
	APIToken           *string                       `json:"api_token"`
	AccessClientID     *string                       `json:"access_client_id"`
	AccessClientSecret *string                       `json:"access_client_secret"`
}

type goldenCase struct {
	Name      string            `json:"name"`
	File      string            `json:"file"`
	ConfigTOM string            `json:"config.toml"`
	HomeFiles map[string]string `json:"home_files"`
	Config    *goldenCfg        `json:"config"`
	Error     string            `json:"error"`
	Stderr    []string          `json:"stderr"`
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func checkGolden(t *testing.T, c goldenCase, toml string) {
	root := t.TempDir()
	home := filepath.Join(t.TempDir(), "home")
	writeFile(t, filepath.Join(root, "config.toml"), toml)
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	for n, b := range c.HomeFiles {
		writeFile(t, filepath.Join(home, n), b)
	}
	env := newEnv(t, map[string]string{"WORKLOG_ROOT": root, "WORKLOG_HOME": home})
	cfg, err := Load(env.Env)
	if c.Error != "" {
		if err == nil {
			t.Fatalf("want error %s", c.Error)
		}
		return
	}
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	g := c.Config
	if g.Machine == "<platform.node()>" {
		host, _ := os.Hostname()
		g.Machine = host
	}
	if cfg.Machine != g.Machine || cfg.Root != root || cfg.Home != home || cfg.StatePath() != filepath.Join(home, "harvest_state.json") {
		t.Errorf("identity: got %q %q %q", cfg.Machine, cfg.Root, cfg.Home)
	}
	var gotReq, gotProj [][2]string
	if len(cfg.Requesters) != len(g.Requesters) {
		t.Errorf("requesters len %d want %d", len(cfg.Requesters), len(g.Requesters))
	}
	for _, kv := range g.Requesters {
		if v, ok := cfg.Requesters[kv[0]]; !ok || v != kv[1] {
			t.Errorf("requester %q = %q,%v", kv[0], v, ok)
		}
	}
	_ = gotReq
	for _, p := range cfg.Projects {
		gotProj = append(gotProj, [2]string{p.Dir, p.Name})
	}
	if !reflect.DeepEqual(gotProj, g.Projects) && !(len(gotProj) == 0 && len(g.Projects) == 0) {
		t.Errorf("projects %v want %v", gotProj, g.Projects)
	}
	if !reflect.DeepEqual(nz(cfg.ExcludeCwdPatterns), nz(g.ExcludeCwd)) {
		t.Errorf("exclude_cwd %v want %v", cfg.ExcludeCwdPatterns, g.ExcludeCwd)
	}
	if !reflect.DeepEqual(nz(cfg.ExcludePromptPatterns), nz(g.ExcludePrompt)) {
		t.Errorf("exclude_prompt %v want %v", cfg.ExcludePromptPatterns, g.ExcludePrompt)
	}
	if len(cfg.Pricing) != len(g.Pricing) {
		t.Errorf("pricing len %d want %d", len(cfg.Pricing), len(g.Pricing))
	}
	for m, kv := range g.Pricing {
		if !reflect.DeepEqual(cfg.Pricing[m], kv) {
			t.Errorf("pricing[%s] = %v want %v", m, cfg.Pricing[m], kv)
		}
	}
	if cfg.MinActiveMinutes != g.MinActiveMinutes || cfg.SummarizeModel != g.SummarizeModel {
		t.Errorf("min/model: %d %q", cfg.MinActiveMinutes, cfg.SummarizeModel)
	}
	if cfg.APIURL != str(g.APIURL) || cfg.APIToken != str(g.APIToken) ||
		cfg.AccessClientID != str(g.AccessClientID) || cfg.AccessClientSecret != str(g.AccessClientSecret) {
		t.Errorf("api fields: %+v", cfg)
	}
	// stderr: Python's wording up to the parser's own detail in parentheses.
	var want []string
	for _, l := range c.Stderr {
		want = append(want, homeLine(runtime.GOOS, l, home))
	}
	var got []string
	if s := strings.TrimSuffix(env.stderr.String(), "\n"); s != "" {
		got = strings.Split(s, "\n")
	}
	if len(got) != len(want) {
		t.Fatalf("stderr %q want %q", got, want)
	}
	for i := range want {
		wp, _, _ := strings.Cut(want[i], " (")
		if !strings.HasPrefix(got[i], wp+" (") {
			t.Errorf("stderr[%d] %q want prefix %q", i, got[i], wp)
		}
	}
}

var homePath = regexp.MustCompile(`<HOME>[^\s(]*`)

// homeLine puts home into a golden stderr line the way Python prints it on goos: the message
// formats home / "credentials.toml" (config.py:76, :94), and str(Path) is native, so on Windows
// the golden's "/" is a backslash.
func homeLine(goos, l, home string) string {
	return homePath.ReplaceAllStringFunc(l, func(p string) string {
		if goos == "windows" {
			p = strings.ReplaceAll(p, "/", `\`)
		}
		return strings.Replace(p, "<HOME>", home, 1)
	})
}

func TestHomeLineIsPythonsSpellingPerOS(t *testing.T) {
	l := "worklog: ignoring unreadable credentials file <HOME>/credentials.toml (a/b)"
	if got := homeLine("darwin", l, "/h"); got != "worklog: ignoring unreadable credentials file /h/credentials.toml (a/b)" {
		t.Errorf("posix %q", got)
	}
	if got := homeLine("windows", l, `C:\t\home`); got != `worklog: ignoring unreadable credentials file C:\t\home\credentials.toml (a/b)` {
		t.Errorf("windows %q", got)
	}
}

func nz(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func TestGolden(t *testing.T) {
	var g struct {
		Example goldenCase   `json:"example"`
		Cases   []goldenCase `json:"cases"`
	}
	testkit.Golden(t, "config", &g)
	repo := filepath.Join(testkit.TestdataDir(t), "..", "..")
	t.Run(g.Example.File, func(t *testing.T) {
		b, err := os.ReadFile(filepath.Join(repo, g.Example.File))
		if err != nil {
			t.Fatal(err)
		}
		checkGolden(t, g.Example, string(b))
	})
	for _, c := range g.Cases {
		c := c
		t.Run(c.Name, func(t *testing.T) { checkGolden(t, c, c.ConfigTOM) })
	}
}

func TestStatePathsLiveUnderWorklogHome(t *testing.T) {
	cfg, _, _, home := loadAt(t, "", nil)
	for got, want := range map[string]string{
		cfg.CollectorStatePath(): "collector_state.json",
		cfg.LockPath():           "harvest.lock",
		cfg.TiersLogPath():       "tiers.jsonl",
	} {
		if got != filepath.Join(home, want) {
			t.Errorf("%s: got %q", want, got)
		}
	}
}
