package harvest

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// A real turn: it moves the fingerprint and the prompt digest.
const realTurn = `{"type": "user", "sessionId": "abcd1234-ef56-7890-ab12-cd34ef567890", "isSidechain": false, "cwd": "/work/proj-a", "timestamp": "2026-09-18T12:00:00.000Z", "message": {"role": "user", "content": "次の修正もお願いします"}}` + "\n" +
	`{"type": "assistant", "sessionId": "abcd1234-ef56-7890-ab12-cd34ef567890", "isSidechain": false, "cwd": "/work/proj-a", "timestamp": "2026-09-18T12:05:00.000Z", "message": {"role": "assistant", "content": [{"type": "text", "text": "承知しました"}]}}` + "\n"

const claudeKey = "claude-code:" + claudeSessionID
const codexKey = "codex:" + codexSessionID

func degraded(*session.RawSession, string) (string, string) { return "first line only", "fallback" }

// addSubagentUsage moves the session's tokens (so its fingerprint) without changing the prompt.
func (f *fx) addSubagentUsage(name string) {
	f.t.Helper()
	sub := filepath.Join(strings.TrimSuffix(f.claudeLog, ".jsonl"), "subagents", name+".jsonl")
	write(f.t, sub, []byte(`{"type": "assistant", "isSidechain": true, "message": {"id": "msg_`+name+`", "model": "claude-opus-5-5", "role": "assistant", "content": [], "usage": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}}`+"\n"))
	touchLater(f.t, sub)
}

func (f *fx) cstate() *CollectorState { return LoadCollectorState(f.cfg.CollectorStatePath()) }

// tiered is one scheduled run: the collector state as saved by the previous run, workers = 1.
func (f *fx) tiered(st Store, sum Summarizer) TieredResult {
	f.t.Helper()
	r, err := RunTiered(f.cfg, st, f.roots, sum, &fourteen, 1, f.cstate(), TieredOpts{Now: f.env.Now()}, nil, f.env)
	if err != nil {
		f.t.Fatal(err)
	}
	return r
}

func (f *fx) full(st Store, sum Summarizer, cs *CollectorState) Result {
	f.t.Helper()
	r, err := Run(f.cfg, st, f.roots, sum, &fourteen, 4, cs, f.env)
	if err != nil {
		f.t.Fatal(err)
	}
	return r
}

func (f *fx) stateBytes() []byte {
	f.t.Helper()
	b, err := os.ReadFile(f.cfg.StatePath())
	if err != nil {
		f.t.Fatal(err)
	}
	return b
}

func (f *fx) bookmark(key string) (Bookmark, bool) {
	b, ok := LoadState(f.cfg.StatePath())[key]
	return b, ok
}

func sameBM(a *Bookmark, b Bookmark) bool {
	return a != nil && a.Mtime == b.Mtime && (a.FP == nil) == (b.FP == nil) && (a.FP == nil || *a.FP == *b.FP)
}

// pinMtimes gives both logs the same fixed mtime, so twin fixtures write identical state files.
func (f *fx) pinMtimes(at time.Time) {
	f.t.Helper()
	for _, p := range []string{f.claudeLog, f.codexLog} {
		if err := os.Chtimes(p, at, at); err != nil {
			f.t.Fatal(err)
		}
	}
}

type step struct {
	res      Result
	appended []string
	state    []byte
	stderr   string
	cs       *CollectorState
}

// fullModeScenario drives a fixture through today's harvest_test.go situations: first send, idle
// noise (R0), a real turn summarized as a fallback, its repair, a refusal, a park.
func fullModeScenario(f *fx, pin time.Time, cs func() *CollectorState) []step {
	var out []step
	hours := 0
	// touchLater from a pinned base: appendText alone would give each twin its own clock reading.
	touchLater := func(t *testing.T, p string) {
		hours++
		at := pin.Add(time.Duration(hours) * time.Hour)
		if err := os.Chtimes(p, at, at); err != nil {
			t.Fatal(err)
		}
	}
	st := newStore()
	sum := &countingSummarizer{}
	record := func(r Result, c *CollectorState) {
		out = append(out, step{r, slices.Clone(st.appended), f.stateBytes(), f.stderr.String(), c})
	}
	run := func(s Summarizer) {
		c := cs()
		record(f.full(st, s, c), c)
	}
	run(sum.fn)
	appendText(f.t, f.claudeLog, idleNoise)
	touchLater(f.t, f.claudeLog)
	run(sum.fn)
	appendText(f.t, f.claudeLog, realTurn)
	touchLater(f.t, f.claudeLog)
	run(degraded)
	appendText(f.t, f.claudeLog, idleNoise)
	touchLater(f.t, f.claudeLog)
	run(sum.fn)
	st.def = answer{nil, api.Rejected}
	appendText(f.t, f.claudeLog, realTurn)
	touchLater(f.t, f.claudeLog)
	run(sum.fn)
	st.def = answer{nil, api.Retry}
	run(sum.fn)
	return out
}

func TestFullModeRecordsTheCacheButDecidesAsToday(t *testing.T) {
	pin := time.Now().Add(-2 * time.Hour).Truncate(time.Microsecond)
	plain, rec := setup(t), setup(t)
	plain.pinMtimes(pin)
	rec.pinMtimes(pin)
	var shared *CollectorState
	want := fullModeScenario(plain, pin, func() *CollectorState { return nil })
	got := fullModeScenario(rec, pin, func() *CollectorState {
		if shared == nil {
			shared = rec.cstate()
		}
		return shared
	})
	for i := range want {
		w, g := want[i], got[i]
		if w.res != g.res || !slices.Equal(w.appended, g.appended) || !bytes.Equal(w.state, g.state) || w.stderr != g.stderr {
			t.Fatalf("step %d differs:\n got %+v %v %s %q\nwant %+v %v %s %q", i, g.res, g.appended, g.state, g.stderr,
				w.res, w.appended, w.state, w.stderr)
		}
	}
	if _, err := os.Stat(plain.cfg.CollectorStatePath()); err == nil {
		t.Error("cs == nil wrote collector_state.json")
	}
	disk := rec.cstate()
	e, ok := disk.Sessions[claudeKey]
	if !ok {
		t.Fatalf("no entry for %s: %+v", claudeKey, disk.Sessions)
	}
	// The last bookmark write was the park in step 5: the entry follows it.
	if b, _ := rec.bookmark(claudeKey); !sameBM(e.BM, b) {
		t.Errorf("entry bm %+v, bookmark %+v", e.BM, b)
	}
	if len(disk.Files) != 0 {
		t.Errorf("full mode indexed files: %v", disk.Files)
	}
}

// The three recordings the brief names, each read back right after its run.
func TestFullModeRecordsSendR0AndFallbackEntries(t *testing.T) {
	f := setup(t)
	st := newStore()
	run := func(sum Summarizer) SummaryEntry {
		t.Helper()
		f.full(st, sum, f.cstate())
		e, ok := f.cstate().Sessions[claudeKey]
		if !ok {
			t.Fatal("no entry")
		}
		b, _ := f.bookmark(claudeKey)
		if !sameBM(e.BM, b) {
			t.Fatalf("entry bm %+v, bookmark %+v", e.BM, b)
		}
		return e
	}
	sent := run(stubSummarizer)
	if sent.Summary != "stub summary" || sent.Source != "llm" || sent.Tries != 0 || sent.PFP == "" || sent.PFP != sent.CurPFP ||
		sent.At == 0 || sent.Path != f.claudeLog || sent.LastMsg == nil {
		t.Fatalf("send entry %+v", sent)
	}
	appendText(t, f.claudeLog, idleNoise)
	touchLater(t, f.claudeLog)
	moved := run(stubSummarizer) // R0: only the bookmark moves, and BM with it (S3)
	if moved.BM.Mtime != mtimeOf(t, f.claudeLog) || moved.At != sent.At || moved.Summary != sent.Summary {
		t.Fatalf("R0 entry %+v (sent %+v)", moved, sent)
	}
	appendText(t, f.claudeLog, realTurn)
	touchLater(t, f.claudeLog)
	fb := run(degraded)
	if fb.Source != "fallback" || fb.Tries != 1 || fb.Summary != "first line only" || fb.BM.FP != nil || fb.PFP == sent.PFP {
		t.Fatalf("fallback entry %+v", fb)
	}
}

func TestR0UnchangedFingerprintOnlyMovesTheBookmark(t *testing.T) {
	f := setup(t)
	st := newStore()
	sum := &countingSummarizer{}
	f.tiered(st, sum.fn)
	before := f.cstate().Sessions[claudeKey]
	appendText(t, f.claudeLog, idleNoise)
	touchLater(t, f.claudeLog)
	r := f.tiered(st, sum.fn)
	// The Claude log moved (parsed, R0); the Codex one did not (stat skip). No call, no send.
	if r.Parsed != 1 || r.Skipped != 2 || len(sum.calls) != 2 || len(st.appended) != 2 || r.New+r.Updated != 0 {
		t.Fatalf("result %+v calls %v appended %v", r, sum.calls, st.appended)
	}
	b, _ := f.bookmark(claudeKey)
	if b.Mtime != mtimeOf(t, f.claudeLog) || b.FP == nil || *b.FP != *before.BM.FP {
		t.Fatalf("bookmark %+v", b)
	}
	e := f.cstate().Sessions[claudeKey]
	if !sameBM(e.BM, b) || e.At != before.At || e.Summary != before.Summary || e.CurPFP != before.PFP {
		t.Fatalf("entry %+v", e)
	}
}

func TestR1NewSessionIsSummarizedAtOnce(t *testing.T) {
	f := setup(t)
	st := newStore()
	sum := &countingSummarizer{}
	r := f.tiered(st, sum.fn)
	if r.Parsed != 2 || r.NewSummaries != 2 || r.Bootstrap != 0 || len(sum.calls) != 2 || r.New != 2 {
		t.Fatalf("result %+v calls %v", r, sum.calls)
	}
	cs := f.cstate()
	for _, k := range []string{claudeKey, codexKey} {
		e, ok := cs.Sessions[k]
		b, _ := f.bookmark(k)
		if !ok || e.Source != "llm" || e.Tries != 0 || !sameBM(e.BM, b) {
			t.Errorf("%s: entry %+v bookmark %+v", k, e, b)
		}
	}
	if fe := cs.Files[f.claudeLog]; fe.Key != claudeKey || fe.Kind != KindSession {
		t.Errorf("index %+v", cs.Files)
	}
}

func TestR1ExistingBookmarkWithoutCacheCountsAsBootstrap(t *testing.T) {
	f := setup(t)
	st := newStore()
	f.full(st, stubSummarizer, nil) // bookmarks, no cache
	appendText(t, f.claudeLog, realTurn)
	touchLater(t, f.claudeLog)
	sum := &countingSummarizer{}
	r := f.tiered(st, sum.fn)
	// Both logs are parsed (no index yet); Codex matches by mtime, Claude has no cache entry.
	if r.Parsed != 2 || r.Bootstrap != 1 || r.NewSummaries != 0 || !slices.Equal(sum.calls, []string{claudeSessionID}) || r.Skipped != 1 {
		t.Fatalf("result %+v calls %v", r, sum.calls)
	}
}

func TestR1ForeignBookmarkInvalidatesTheCacheEntry(t *testing.T) {
	f := setup(t)
	st := newStore()
	f.tiered(st, stubSummarizer)
	// "Python" re-wrote the bookmark: same mtime, its own fingerprint.
	state := LoadState(f.cfg.StatePath())
	b := state[claudeKey]
	py := "python-fp"
	b.FP = &py
	state[claudeKey] = b
	if err := SaveState(f.cfg.StatePath(), state); err != nil {
		t.Fatal(err)
	}
	// Tokens move (fp moves, prompt does not): a valid entry would be R2 with no call.
	f.addSubagentUsage("a1")
	sum := &countingSummarizer{}
	r := f.tiered(st, sum.fn)
	if r.Bootstrap != 1 || r.Reused != 0 || !slices.Equal(sum.calls, []string{claudeSessionID}) {
		t.Fatalf("result %+v calls %v", r, sum.calls)
	}
}

func TestR1FallbackStartsTriesAtOne(t *testing.T) {
	f := setup(t)
	st := newStore()
	r := f.tiered(st, degraded)
	if r.Fallback != 2 || r.NewSummaries != 2 {
		t.Fatalf("result %+v", r)
	}
	now := epoch(f.env.Now())
	cs := f.cstate()
	for _, k := range []string{claudeKey, codexKey} {
		e := cs.Sessions[k]
		b, _ := f.bookmark(k)
		if e.Source != "fallback" || e.Tries != 1 || e.At != e.Tried || e.At > now || now-e.At > 60 || b.FP != nil || !sameBM(e.BM, b) {
			t.Errorf("%s: entry %+v bookmark %+v", k, e, b)
		}
	}
}

func TestR2TokensOnlyChangeIsResentWithTheCachedSummaryAndNoCall(t *testing.T) {
	f := setup(t)
	st := newStore()
	f.tiered(st, stubSummarizer)
	before, _ := f.bookmark(claudeKey)
	f.addSubagentUsage("a1")
	sum := &countingSummarizer{}
	fresh := func(raw *session.RawSession, m string) (string, string) { sum.fn(raw, m); return "fresh", "llm" }
	r := f.tiered(st, fresh)
	if len(sum.calls) != 0 || r.Reused != 1 || r.Parsed != 1 {
		t.Fatalf("result %+v calls %v", r, sum.calls)
	}
	if n := strings.Count(strings.Join(st.appended, " "), "Sabcd1234"); n != 2 {
		t.Fatalf("appended %v", st.appended)
	}
	rec := st.records["Sabcd1234"]
	if rec.Summary != "stub summary" || rec.SummarySource != "llm" || rec.Tokens == nil {
		t.Fatalf("resent %+v", rec)
	}
	after, _ := f.bookmark(claudeKey)
	if after.FP == nil || *after.FP == *before.FP {
		t.Fatalf("bookmark %+v (before %+v)", after, before)
	}
	if e := f.cstate().Sessions[claudeKey]; !sameBM(e.BM, after) || e.CurPFP != e.PFP {
		t.Fatalf("entry %+v", e)
	}
}

// B2: today's mtime-equal skip writes no bookmark, so the index must be written from the parse.
func TestMtimeMatchedSessionIsIndexedWithoutABookmarkWrite(t *testing.T) {
	f := setup(t)
	st := newStore()
	f.full(st, stubSummarizer, nil)
	before := f.stateBytes()
	sum := &countingSummarizer{}
	r := f.tiered(st, sum.fn)
	if r.Parsed != 2 || r.Skipped != 2 || len(sum.calls) != 0 || len(st.appended) != 2 {
		t.Fatalf("first tiered %+v calls %v", r, sum.calls)
	}
	if !bytes.Equal(f.stateBytes(), before) {
		t.Fatalf("state changed:\n%s\n%s", before, f.stateBytes())
	}
	cs := f.cstate()
	for p, k := range map[string]string{f.claudeLog: claudeKey, f.codexLog: codexKey} {
		if fe := cs.Files[p]; fe.Key != k || fe.Kind != KindSession || fe.Mtime != mtimeOf(t, p) {
			t.Errorf("%s: index %+v", p, fe)
		}
	}
	if r := f.tiered(st, sum.fn); r.Parsed != 0 || r.Skipped != 2 {
		t.Fatalf("second tiered %+v", r)
	}
}

// logsIn is every log a parser would open under dir: *.jsonl outside subagents/ directories.
func logsIn(t *testing.T, dir string) int {
	t.Helper()
	n := 0
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && d.Name() == "subagents" {
			return filepath.SkipDir
		}
		if !d.IsDir() && strings.HasSuffix(p, ".jsonl") {
			n++
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// B2 over the corpus: harvest_state.json as Python left it, then two tiered runs. The units used are
// the harvest_test.go ones, with their own two roots (claude_projects/, codex_sessions/).
func TestPythonSeedThenTieredThenTieredParsesNothing(t *testing.T) {
	sessions := loadGolden(t, "sessions")
	states := at(loadGolden(t, "state_after_python"), "units").(*pyjson.Object)
	logs := testkit.CopyCorpus(t, ".")
	tried := 0
	for _, key := range states.Keys() {
		if !strings.HasPrefix(key, "logs/test_harvest_run/") {
			continue
		}
		unit := unitDir(logs, key)
		cr, xr := filepath.Join(unit, "claude_projects"), filepath.Join(unit, "codex_sessions")
		if _, err := os.Stat(cr); err != nil {
			continue
		}
		if _, err := os.Stat(xr); err != nil {
			continue
		}
		tried++
		cfg := goldenCfg(t, sessions)
		write(t, cfg.StatePath(), pyjson.Dumps(at(states, key), pyjson.Default()))
		store := &goldenStore{tasks: goldenTasks(sessions)}
		claude := &fakeClaude{}
		roots := []Root{{"claude-code", cr}, {"codex", xr}}
		run := func() TieredResult {
			env, _ := goldenEnv(t)
			r, err := RunTiered(cfg, store, roots, claude.summarizer(), nil, 1, LoadCollectorState(cfg.CollectorStatePath()),
				TieredOpts{Now: goldenNow}, nil, env)
			if err != nil {
				t.Fatalf("%s: %v", key, err)
			}
			return r
		}
		want := logsIn(t, cr) + logsIn(t, xr)
		if r := run(); r.Parsed != want {
			t.Errorf("%s: first tiered parsed %d, want %d (%+v)", key, r.Parsed, want, r)
		}
		after1, _ := os.ReadFile(cfg.StatePath())
		calls := claude.calls
		r := run()
		after2, _ := os.ReadFile(cfg.StatePath())
		if r.Parsed != 0 || claude.calls != calls || !bytes.Equal(after1, after2) {
			t.Errorf("%s: second tiered %+v, %d calls; state\n%s\n%s", key, r, claude.calls-calls, after1, after2)
		}
	}
	if tried < 3 {
		t.Fatalf("only %d units", tried)
	}
}

func TestRejectedSendWritesTheCacheButNoBookmark(t *testing.T) {
	f := setup(t)
	f.roots = f.roots[:1] // the Claude log alone
	st := newStore()
	st.def = answer{nil, api.Rejected}
	sum := &countingSummarizer{}
	r1 := f.tiered(st, sum.fn)
	if _, ok := f.bookmark(claudeKey); ok {
		t.Fatal("a refused session was bookmarked")
	}
	e1, ok := f.cstate().Sessions[claudeKey]
	if !ok || e1.BM != nil || e1.Summary != "stub summary" {
		t.Fatalf("entry %+v", e1)
	}
	r2 := f.tiered(st, sum.fn)
	if len(sum.calls) != 1 || r1.Parsed != 1 || r2.Parsed != 1 || r1.Rejected != 1 || r2.Rejected != 1 || r2.Reused != 0 {
		t.Fatalf("calls %v, run 1 %+v, run 2 %+v", sum.calls, r1, r2)
	}
	if e2 := f.cstate().Sessions[claudeKey]; e2.BM != nil {
		t.Fatalf("bm after run 2 %+v", e2.BM)
	}
	if n := strings.Count(strings.Join(st.appended, " "), "Sabcd1234"); n != 2 {
		t.Fatalf("appended %v", st.appended)
	}
}

func TestStateSaveOrderHarvestStateFirst(t *testing.T) {
	f := setup(t)
	f.roots = f.roots[:1]
	st := newStore()
	f.tiered(st, stubSummarizer)
	appendText(t, f.claudeLog, realTurn)
	touchLater(t, f.claudeLog)

	failures := 0
	saveCollectorState = func(string, *CollectorState) error {
		failures++
		// harvest_state.json is already on disk when the collector state is saved.
		if b, _ := f.bookmark(claudeKey); failures > 1 && b.Mtime != mtimeOf(t, f.claudeLog) {
			t.Errorf("save %d: bookmark %+v not yet saved", failures, b)
		}
		return errors.New("disk full")
	}
	t.Cleanup(func() { saveCollectorState = SaveCollectorState })
	if r := f.tiered(st, stubSummarizer); r.New+r.Updated != 1 {
		t.Fatalf("result %+v", r)
	}
	saveCollectorState = SaveCollectorState
	if failures != 2 { // end of phase 1, after the send
		t.Fatalf("%d collector-state saves", failures)
	}
	if !strings.Contains(f.stderr.String(), "worklog: could not save "+f.cfg.CollectorStatePath()) {
		t.Fatalf("stderr %q", f.stderr.String())
	}
	b, _ := f.bookmark(claudeKey)
	if e := f.cstate().Sessions[claudeKey]; sameBM(e.BM, b) {
		t.Fatal("bm is not stale")
	}
	// A tokens-only move would be R2 against a valid entry; the stale one gives R1.
	f.addSubagentUsage("a1")
	sum := &countingSummarizer{}
	if r := f.tiered(st, sum.fn); r.Bootstrap != 1 || len(sum.calls) != 1 {
		t.Fatalf("result %+v calls %v", r, sum.calls)
	}
}

// The equivalence gate: on an empty state the first tiered run is full mode, over every corpus unit.
func TestFirstTieredRunOnEmptyStateEqualsFullMode(t *testing.T) {
	sessions := loadGolden(t, "sessions")
	units := at(sessions, "units").(*pyjson.Object)
	compared := 0
	for _, key := range units.Keys() {
		type out struct {
			res    Result
			bodies []byte
			state  []byte
			stderr string
		}
		one := func(tiered bool) out {
			logs := testkit.CopyCorpus(t, ".")
			cfg := goldenCfg(t, sessions)
			store := &goldenStore{tasks: goldenTasks(sessions)}
			claude := &fakeClaude{}
			env, stderr := goldenEnv(t)
			roots := unitRoots(unitDir(logs, key))
			var res Result
			var err error
			if tiered {
				var tr TieredResult
				tr, err = RunTiered(cfg, store, roots, claude.summarizer(), nil, 1, LoadCollectorState(cfg.CollectorStatePath()),
					TieredOpts{Now: goldenNow}, nil, env)
				res = tr.Result
			} else {
				res, err = Run(cfg, store, roots, claude.summarizer(), nil, 1, nil, env)
			}
			if err != nil {
				t.Fatalf("%s: %v", key, err)
			}
			state, _ := os.ReadFile(cfg.StatePath())
			return out{res, pyjson.Compact(store.bodies), state, strings.ReplaceAll(stderr.String(), logs, "<logs>")}
		}
		want, got := one(false), one(true)
		compared++
		if want.res != got.res {
			t.Errorf("%s: result %+v, full mode %+v", key, got.res, want.res)
		}
		if !bytes.Equal(want.bodies, got.bodies) {
			t.Errorf("%s: bodies\n%s\nfull mode\n%s", key, got.bodies, want.bodies)
		}
		if !bytes.Equal(want.state, got.state) {
			t.Errorf("%s: state\n%s\nfull mode\n%s", key, got.state, want.state)
		}
		if want.stderr != got.stderr {
			t.Errorf("%s: stderr\n%q\nfull mode\n%q", key, got.stderr, want.stderr)
		}
	}
	if compared < 20 {
		t.Fatalf("only %d units", compared)
	}
}

// spec §5.7: tiered mode counts fallback= at the summary attempt, full mode in send(). In 3a the two
// coincide (a refused send still counts in both); they part at R6 (Task 3b), a cached fallback re-sent
// without an attempt.
func TestTieredFallbackCountIsAttemptOutcomeFullModeUnchanged(t *testing.T) {
	full, tiered := setup(t), setup(t)
	fs, ts := newStore(), newStore()
	fs.def, ts.def = answer{nil, api.Rejected}, answer{nil, api.Rejected}
	if r := full.full(fs, degraded, nil); r.Fallback != 2 || r.Rejected != 2 {
		t.Fatalf("full %+v", r)
	}
	if r := tiered.tiered(ts, degraded); r.Fallback != 2 || r.Rejected != 2 {
		t.Fatalf("tiered %+v", r)
	}
	// An R2 re-send makes no attempt, so counts no fallback even with an llm summary in hand.
	ok := setup(t)
	st := newStore()
	ok.tiered(st, stubSummarizer)
	ok.addSubagentUsage("a1")
	if r := ok.tiered(st, degraded); r.Reused != 1 || r.Fallback != 0 {
		t.Fatalf("R2 %+v", r)
	}
}

// Review Focus 1: a kind=session skip is the bookmark's mtime against the log's, whatever the index
// recorded. A bookmark reset to {mtime: 0} (tiered-rollback) parses an unchanged log; a log that moved
// and was bookmarked by someone else (full mode) is skipped though the index is stale.
func TestStatSkipComparesTheBookmarkNotTheIndex(t *testing.T) {
	f := setup(t)
	f.roots = f.roots[:1]
	st := newStore()
	f.tiered(st, stubSummarizer)
	state := LoadState(f.cfg.StatePath())
	state[claudeKey] = Bookmark{Mtime: 0}
	if err := SaveState(f.cfg.StatePath(), state); err != nil {
		t.Fatal(err)
	}
	sum := &countingSummarizer{}
	if r := f.tiered(st, sum.fn); r.Parsed != 1 || len(sum.calls) != 1 {
		t.Fatalf("reset bookmark: %+v calls %v", r, sum.calls)
	}
	appendText(t, f.claudeLog, realTurn)
	touchLater(t, f.claudeLog)
	f.full(st, sum.fn, nil) // bookmarks the new mtime; the index keeps the old one
	if fe := f.cstate().Files[f.claudeLog]; fe.Mtime == mtimeOf(t, f.claudeLog) {
		t.Fatal("index not stale")
	}
	if r := f.tiered(st, sum.fn); r.Parsed != 0 || r.Skipped != 1 {
		t.Fatalf("stale index: %+v", r)
	}
}

// ---- Task 3b: R3–R7, R3f and the refresh set ---------------------------------------------------

// clock is a frozen rt.Env clock the test moves by hand; f.tiered passes it as TieredOpts.Now too.
type clock struct{ t time.Time }

func (f *fx) freeze(at time.Time) *clock {
	c := &clock{at}
	f.env.Now = func() time.Time { return c.t }
	return c
}

// flaky is a counting summarizer that can be told to fall back. Every answer is a new text, so a
// send shows which attempt it came from.
type flaky struct {
	countingSummarizer
	fail bool
}

func (s *flaky) fn(raw *session.RawSession, m string) (string, string) {
	s.countingSummarizer.fn(raw, m)
	n := s.n()
	if s.fail {
		return fmt.Sprintf("fallback %d", n), "fallback"
	}
	return fmt.Sprintf("summary %d", n), "llm"
}

func (s *flaky) n() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

// turnAt appends a real user turn stamped at, and gives the log that mtime: it moves the prompt
// digest and last_msg.
func (f *fx) turnAt(at time.Time, text string) {
	f.t.Helper()
	appendText(f.t, f.claudeLog, fmt.Sprintf(`{"type": "user", "sessionId": %q, "isSidechain": false, "cwd": "/work/proj-a", "timestamp": %q, "message": {"role": "user", "content": %q}}`+"\n",
		claudeSessionID, at.UTC().Format("2006-01-02T15:04:05.000Z"), text))
	if err := os.Chtimes(f.claudeLog, at, at); err != nil {
		f.t.Fatal(err)
	}
}

// claudeOnly is a fixture with the Claude log alone, on a frozen clock at a whole second.
func claudeOnly(t *testing.T, at time.Time) (*fx, *clock) {
	f := setup(t)
	f.roots = f.roots[:1]
	return f, f.freeze(at)
}

func base() time.Time { return time.Now().Truncate(time.Second) }

func TestR3ActiveSessionIsRefreshedOnlyAfter60Minutes(t *testing.T) {
	t0 := base()
	f, c := claudeOnly(t, t0)
	st := newStore()
	sum := &flaky{}
	f.tiered(st, sum.fn) // R1
	var got []int
	for k := 1; k <= 4; k++ {
		c.t = t0.Add(time.Duration(15*k) * time.Minute)
		f.turnAt(c.t, fmt.Sprintf("続きの作業 %d", k))
		n := sum.n()
		f.tiered(st, sum.fn)
		got = append(got, sum.n()-n)
	}
	if !slices.Equal(got, []int{0, 0, 0, 1}) {
		t.Fatalf("calls per run %v, want [0 0 0 1]", got)
	}
	if rec := st.records["Sabcd1234"]; rec.Summary != "summary 2" || rec.SummarySource != "llm" {
		t.Fatalf("last send %q %q", rec.Summary, rec.SummarySource)
	}
	if e := f.cstate().Sessions[claudeKey]; e.PFP != e.CurPFP || e.At != epoch(c.t) || e.Tries != 0 {
		t.Fatalf("entry %+v", e)
	}
}

func TestR3StoppedSessionIsRefreshedOnceFromTheRefreshSetWithoutALogChange(t *testing.T) {
	T := base()
	f, c := claudeOnly(t, T.Add(-15*time.Minute))
	st := newStore()
	sum := &flaky{}
	f.tiered(st, sum.fn) // R1 at T-15
	f.turnAt(T, "最後の確認をお願いします")
	var got []int
	var bm15 Bookmark
	for _, m := range []int{15, 30, 45} {
		c.t = T.Add(time.Duration(m) * time.Minute)
		n, sends := sum.n(), len(st.appended)
		r := f.tiered(st, sum.fn)
		got = append(got, sum.n()-n)
		b, _ := f.bookmark(claudeKey)
		rec := st.records["Sabcd1234"]
		switch m {
		case 15: // R4: the log moved, the cached summary is re-sent
			bm15 = b
			if len(st.appended) != sends+1 || rec.Summary != "summary 1" || b.FP == nil {
				t.Fatalf("T+15: %+v %q %+v", r, rec.Summary, b)
			}
		case 30: // R3 from the refresh set: the log did not move, mtime and fp equal the bookmark
			if r.Parsed != 1 || len(st.appended) != sends+1 || rec.Summary != "summary 2" || rec.SummarySource != "llm" {
				t.Fatalf("T+30: %+v sends %d %q", r, len(st.appended)-sends, rec.Summary)
			}
			if b.Mtime != bm15.Mtime || b.FP == nil || *b.FP != *bm15.FP {
				t.Fatalf("T+30 bookmark %+v, T+15 %+v", b, bm15)
			}
		case 45:
			if r.Parsed != 0 || len(st.appended) != sends {
				t.Fatalf("T+45: %+v", r)
			}
		}
	}
	if !slices.Equal(got, []int{0, 1, 0}) {
		t.Fatalf("calls per run %v, want [0 1 0]", got)
	}
	if m := mtimeOf(t, f.claudeLog); m != epoch(T) {
		t.Fatalf("log moved: %v", m)
	}
}

func TestR3fFailedRefreshKeepsAndSendsTheCachedLlmSummary(t *testing.T) {
	t0 := base()
	f, c := claudeOnly(t, t0)
	st := newStore()
	sum := &flaky{}
	f.tiered(st, sum.fn) // R1: "summary 1"
	f.turnAt(t0.Add(5*time.Minute), "追加の修正をお願いします")
	c.t = t0.Add(15 * time.Minute)
	f.tiered(st, sum.fn) // R4
	before := f.cstate().Sessions[claudeKey]
	bm, _ := f.bookmark(claudeKey)
	if before.PFP == before.CurPFP || bm.FP == nil {
		t.Fatalf("not stale after R4: %+v %+v", before, bm)
	}

	c.t = t0.Add(35 * time.Minute) // stopped for 30 min: R3 is due, and the attempt falls back
	sum.fail = true
	r := f.tiered(st, sum.fn)
	if sum.n() != 2 || r.Fallback != 1 || r.Parsed != 1 {
		t.Fatalf("R3f run %+v calls %v", r, sum.calls)
	}
	if rec := st.records["Sabcd1234"]; rec.Summary != "summary 1" || rec.SummarySource != "llm" {
		t.Fatalf("sent %q %q", rec.Summary, rec.SummarySource)
	}
	after, _ := f.bookmark(claudeKey)
	if after.FP == nil || *after.FP != *bm.FP || after.Mtime != bm.Mtime {
		t.Fatalf("bookmark %+v, before %+v", after, bm)
	}
	e := f.cstate().Sessions[claudeKey]
	if e.Tries != 1 || e.Tried != epoch(c.t) || e.Summary != before.Summary || e.Source != "llm" || e.PFP != before.PFP ||
		e.At != before.At || e.CurPFP != before.CurPFP || !sameBM(e.BM, after) {
		t.Fatalf("entry %+v, before %+v", e, before)
	}

	sum.fail = false
	for _, m := range []int{50, 94} { // within 1 h of the failed attempt: no call, nothing parsed
		c.t = t0.Add(time.Duration(m) * time.Minute)
		if r := f.tiered(st, sum.fn); sum.n() != 2 || r.Parsed != 0 {
			t.Fatalf("+%d: %+v calls %v", m, r, sum.calls)
		}
	}
	c.t = t0.Add(95 * time.Minute)
	f.tiered(st, sum.fn)
	if sum.n() != 3 || st.records["Sabcd1234"].Summary != "summary 3" {
		t.Fatalf("retry: calls %v sent %q", sum.calls, st.records["Sabcd1234"].Summary)
	}
	if e := f.cstate().Sessions[claudeKey]; e.Tries != 0 || e.PFP != e.CurPFP || e.Summary != "summary 3" {
		t.Fatalf("entry after retry %+v", e)
	}
}

func TestR4StaleSummaryIsResentUntilRefreshDue(t *testing.T) {
	t0 := base()
	f, c := claudeOnly(t, t0)
	st := newStore()
	sum := &flaky{}
	f.tiered(st, sum.fn)
	at := f.cstate().Sessions[claudeKey].At
	for k := 1; k <= 3; k++ {
		c.t = t0.Add(time.Duration(15*k) * time.Minute)
		f.turnAt(c.t, fmt.Sprintf("進捗 %d", k))
		sends := len(st.appended)
		r := f.tiered(st, sum.fn)
		rec := st.records["Sabcd1234"]
		if sum.n() != 1 || len(st.appended) != sends+1 || rec.Summary != "summary 1" || rec.SummarySource != "llm" || r.Fallback != 0 {
			t.Fatalf("+%d: %+v calls %v sent %q %q", 15*k, r, sum.calls, rec.Summary, rec.SummarySource)
		}
		e := f.cstate().Sessions[claudeKey]
		b, _ := f.bookmark(claudeKey)
		if e.PFP == e.CurPFP || e.At != at || e.Source != "llm" || b.FP == nil || !sameBM(e.BM, b) {
			t.Fatalf("+%d: entry %+v bookmark %+v", 15*k, e, b)
		}
	}
	c.t = t0.Add(60 * time.Minute)
	f.turnAt(c.t, "進捗 4")
	f.tiered(st, sum.fn)
	if sum.n() != 2 || st.records["Sabcd1234"].Summary != "summary 2" {
		t.Fatalf("due: calls %v sent %q", sum.calls, st.records["Sabcd1234"].Summary)
	}
}

func TestR5FallbackIsRetriedOnBackoffWithoutAnyMtimeChange(t *testing.T) {
	t0 := base()
	f, c := claudeOnly(t, t0)
	st := newStore()
	sum := &flaky{fail: true}
	f.tiered(st, sum.fn) // R1 falls back: tries 1
	mtime := mtimeOf(t, f.claudeLog)
	gaps := []time.Duration{time.Hour, 2 * time.Hour, 4 * time.Hour, 8 * time.Hour, 24 * time.Hour, 24 * time.Hour}
	last := t0
	for i, g := range gaps {
		c.t = last.Add(g - time.Minute)
		n := sum.n()
		if r := f.tiered(st, sum.fn); sum.n() != n || r.Parsed != 0 {
			t.Fatalf("attempt %d, a minute early: %+v calls %d", i+1, r, sum.n()-n)
		}
		c.t = last.Add(g)
		final := i == len(gaps)-1
		sum.fail = !final
		sends := len(st.appended)
		r := f.tiered(st, sum.fn)
		if sum.n() != n+1 || r.Parsed != 1 || len(st.appended) != sends+1 {
			t.Fatalf("attempt %d at +%v: %+v calls %d", i+1, c.t.Sub(t0), r, sum.n()-n)
		}
		e := f.cstate().Sessions[claudeKey]
		b, _ := f.bookmark(claudeKey)
		rec := st.records["Sabcd1234"]
		wantTries, wantSource := i+2, "fallback"
		if final {
			wantTries, wantSource = 0, "llm"
		}
		if e.Tries != wantTries || e.Tried != epoch(c.t) || e.Source != wantSource || rec.SummarySource != wantSource ||
			rec.Summary != e.Summary || (b.FP != nil) != final || !sameBM(e.BM, b) {
			t.Fatalf("attempt %d: entry %+v bookmark %+v sent %q %q", i+1, e, b, rec.Summary, rec.SummarySource)
		}
		last = c.t
	}
	if m := mtimeOf(t, f.claudeLog); m != mtime {
		t.Fatalf("log moved: %v != %v", m, mtime)
	}
	c.t = last.Add(24 * time.Hour)
	if n := sum.n(); f.tiered(st, sum.fn).Parsed != 0 || sum.n() != n {
		t.Fatalf("after success: calls %v", sum.calls)
	}
}

func TestR6FallbackWithinBackoffIsResentWithoutACall(t *testing.T) {
	t0 := base()
	f, c := claudeOnly(t, t0)
	st := newStore()
	sum := &flaky{fail: true}
	f.tiered(st, sum.fn) // R1: "fallback 1", tries 1
	sum.fail = false
	c.t = t0.Add(15 * time.Minute)
	f.turnAt(c.t, "まだ続きます")
	sends := len(st.appended)
	r := f.tiered(st, sum.fn)
	rec := st.records["Sabcd1234"]
	if sum.n() != 1 || r.Fallback != 0 || len(st.appended) != sends+1 || rec.Summary != "fallback 1" || rec.SummarySource != "fallback" {
		t.Fatalf("R6: %+v calls %v sent %q %q", r, sum.calls, rec.Summary, rec.SummarySource)
	}
	b, _ := f.bookmark(claudeKey)
	e := f.cstate().Sessions[claudeKey]
	if b.FP != nil || b.Mtime != epoch(c.t) || e.Tries != 1 || e.Tried != epoch(t0) || e.Source != "fallback" || !sameBM(e.BM, b) {
		t.Fatalf("entry %+v bookmark %+v", e, b)
	}
	c.t = t0.Add(30 * time.Minute)
	if r := f.tiered(st, sum.fn); r.Parsed != 0 || sum.n() != 1 {
		t.Fatalf("+30: %+v", r)
	}
	c.t = t0.Add(60 * time.Minute) // the backoff has run out: R5
	f.tiered(st, sum.fn)
	if sum.n() != 2 || st.records["Sabcd1234"].SummarySource != "llm" {
		t.Fatalf("+60: calls %v", sum.calls)
	}
}

func TestR7PreTieringFallbackBookmarkIsAdoptedAndRetriedOnce(t *testing.T) {
	t.Run("repaired", func(t *testing.T) {
		f := setup(t)
		f.roots = f.roots[:1]
		st := newStore()
		f.full(st, degraded, nil) // a fallback from before tiering: fp-less bookmark, no cache
		before, _ := f.bookmark(claudeKey)
		c := f.freeze(base())
		sum := &flaky{}
		r := f.tiered(st, sum.fn)
		if r.Adopted != 1 || sum.n() != 1 || r.Skipped != 0 || r.Parsed != 1 {
			t.Fatalf("adoption run %+v calls %v", r, sum.calls)
		}
		if rec := st.records["Sabcd1234"]; rec.Summary != "summary 1" || rec.SummarySource != "llm" {
			t.Fatalf("sent %q %q", rec.Summary, rec.SummarySource)
		}
		b, _ := f.bookmark(claudeKey)
		e := f.cstate().Sessions[claudeKey]
		if b.FP == nil || b.Mtime != before.Mtime || e.Source != "llm" || e.Tries != 0 || !sameBM(e.BM, b) {
			t.Fatalf("entry %+v bookmark %+v", e, b)
		}
		c.t = c.t.Add(15 * time.Minute)
		if r := f.tiered(st, sum.fn); r.Adopted != 0 || r.Parsed != 0 || sum.n() != 1 {
			t.Fatalf("next run %+v calls %v", r, sum.calls)
		}
	})
	t.Run("falls back again", func(t *testing.T) {
		f := setup(t)
		f.roots = f.roots[:1]
		st := newStore()
		f.full(st, degraded, nil)
		c := f.freeze(base())
		sum := &flaky{fail: true}
		if r := f.tiered(st, sum.fn); r.Adopted != 1 || r.Fallback != 1 || sum.n() != 1 {
			t.Fatalf("adoption run %+v calls %v", r, sum.calls)
		}
		if e := f.cstate().Sessions[claudeKey]; e.Source != "fallback" || e.Tries != 1 || e.Tried != epoch(c.t) {
			t.Fatalf("entry %+v", e)
		}
		c.t = c.t.Add(15 * time.Minute)
		if r := f.tiered(st, sum.fn); r.Adopted != 0 || sum.n() != 1 {
			t.Fatalf("next run %+v calls %v", r, sum.calls)
		}
	})
	t.Run("not when full mode recorded the entry", func(t *testing.T) {
		f := setup(t)
		f.roots = f.roots[:1]
		st := newStore()
		f.full(st, degraded, f.cstate()) // valid fallback entry, tried just now
		f.freeze(base().Add(time.Second))
		sum := &flaky{}
		if r := f.tiered(st, sum.fn); r.Adopted != 0 || sum.n() != 0 {
			t.Fatalf("run %+v calls %v", r, sum.calls)
		}
	})
}

func TestTrivialFpLessBookmarkIsNotAdopted(t *testing.T) {
	f := setup(t)
	root := filepath.Join(f.tmp, "projects")
	write(t, filepath.Join(root, "-work-x", "s.jsonl"),
		[]byte(`{"type": "user", "sessionId": "abcdef1234567890", "cwd": "/work/x", "timestamp": "2026-09-18T00:00:00.000Z", "isSidechain": false, "message": {"role": "user", "content": "hi"}}`+"\n"))
	f.roots = []Root{{"claude-code", root}}
	st := newStore()
	f.full(st, stubSummarizer, nil)
	if b, ok := f.bookmark("claude-code:abcdef1234567890"); !ok || b.FP != nil {
		t.Fatalf("bookmark %+v", b)
	}
	f.freeze(base())
	sum := &flaky{}
	r := f.tiered(st, sum.fn)
	if r.Adopted != 0 || sum.n() != 0 || r.Parsed != 1 || r.Skipped != 1 || len(st.appended) != 0 {
		t.Fatalf("run %+v calls %v appended %v", r, sum.calls, st.appended)
	}
	if _, ok := f.cstate().Sessions["claude-code:abcdef1234567890"]; ok {
		t.Fatal("a trivial session got a cache entry")
	}
}

// A fork of the fixture's Codex session (its session_id is the parent's), with its own usage.
const codexFork = `{"timestamp": "2026-09-18T08:55:00.000Z", "type": "session_meta", "payload": {"id": "fork-a", "session_id": "11112222-3333-4444-5555-666677778888", "cwd": "/work/proj-b", "source": {"subagent": {"thread_spawn": {"parent_thread_id": "11112222-3333-4444-5555-666677778888", "depth": 1}}}, "forked_from_id": "11112222-3333-4444-5555-666677778888"}}
{"timestamp": "2026-09-18T08:55:00.000Z", "type": "session_meta", "payload": {"id": "11112222-3333-4444-5555-666677778888", "session_id": "11112222-3333-4444-5555-666677778888", "cwd": "/work/proj-b", "source": "cli"}}
{"timestamp": "2026-09-18T09:00:00.000Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "replayed parent prompt"}]}}
{"type": "turn_context", "payload": {"model": "gpt-6-sol", "cwd": "/work/proj-b"}}
{"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 30, "cached_input_tokens": 20, "cache_write_input_tokens": 0, "output_tokens": 5, "reasoning_output_tokens": 1, "total_tokens": 35}, "last_token_usage": {"input_tokens": 30, "cached_input_tokens": 20, "cache_write_input_tokens": 0, "output_tokens": 5, "reasoning_output_tokens": 1, "total_tokens": 35}}}}
`

// B1: a refreshed session is produced by the pass, so its record is the one a pass that found the
// log changed sends: the fork's and the subagent's tokens, the combined mtime, files_written.
func TestRefreshQueueReparseEqualsThePassRecord(t *testing.T) {
	pin := base().Add(-2 * time.Hour)
	build := func() (*fx, string, string) {
		f := setup(t)
		f.addCodexPatch()
		fork := filepath.Join(filepath.Dir(f.codexLog), "rollout-2026-09-18T09-30-00-fork-a.jsonl")
		write(t, fork, []byte(codexFork))
		f.addSubagentUsage("a1")
		sub := filepath.Join(strings.TrimSuffix(f.claudeLog, ".jsonl"), "subagents", "a1.jsonl")
		for p, d := range map[string]time.Duration{f.claudeLog: 0, sub: 10 * time.Minute, f.codexLog: 0, fork: 20 * time.Minute} {
			if err := os.Chtimes(p, pin.Add(d), pin.Add(d)); err != nil {
				t.Fatal(err)
			}
		}
		return f, sub, fork
	}
	refreshed, sub, fork := build()
	pass, _, _ := build()
	t0 := pin.Add(time.Hour)
	c := refreshed.freeze(t0)
	st := newStore()
	refreshed.tiered(st, degraded) // R1 falls back for both: fp-less bookmarks
	c.t = t0.Add(time.Hour)
	sum := &flaky{}
	r := refreshed.tiered(st, sum.fn) // R5 for both, from the refresh set: no log moved
	if sum.n() != 2 || len(st.appended) != 4 || r.Fallback != 0 {
		t.Fatalf("refresh run %+v calls %v appended %v", r, sum.calls, st.appended)
	}

	pass.freeze(t0.Add(time.Hour))
	ps := newStore()
	pass.tiered(ps, (&flaky{}).fn) // the pass that finds both logs changed (no bookmark): R1

	for id, k := range map[string]string{"Sabcd1234": claudeKey, "S11112222": codexKey} {
		a, b := st.records[id], ps.records[id]
		if a.SummarySource != "llm" {
			t.Fatalf("%s: refreshed source %q", id, a.SummarySource)
		}
		a.Summary, a.SummarySource, a.TS = b.Summary, b.SummarySource, b.TS
		if ga, gb := pyjson.Compact(a.Object()), pyjson.Compact(b.Object()); !bytes.Equal(ga, gb) {
			t.Errorf("%s: refreshed record\n%s\npass record\n%s", id, ga, gb)
		}
		ba, _ := refreshed.bookmark(k)
		bb, _ := pass.bookmark(k)
		if ba.FP == nil || bb.FP == nil || *ba.FP != *bb.FP || ba.Mtime != bb.Mtime {
			t.Errorf("%s: bookmark %+v, pass %+v", k, ba, bb)
		}
	}
	// The record carries what only the pass merges in.
	if b, _ := refreshed.bookmark(claudeKey); b.Mtime != mtimeOf(t, sub) {
		t.Errorf("claude bookmark mtime %v, subagent %v", b.Mtime, mtimeOf(t, sub))
	}
	if b, _ := refreshed.bookmark(codexKey); b.Mtime != mtimeOf(t, fork) {
		t.Errorf("codex bookmark mtime %v, fork %v", b.Mtime, mtimeOf(t, fork))
	}
	cx := st.records["S11112222"]
	if !slices.Equal(cx.FilesWritten, []string{"/work/proj-b/out/spec.md"}) {
		t.Errorf("files_written %v", cx.FilesWritten)
	}
	for id, model := range map[string]string{"S11112222": "gpt-6-sol", "Sabcd1234": "claude-opus-5-5"} {
		tk := st.records[id].Tokens
		sv, _ := tk.Get("subagent")
		so, _ := sv.(*pyjson.Object)
		if so == nil {
			t.Fatalf("%s: tokens %s", id, pyjson.Compact(tk))
		}
		if _, ok := so.Get(model); !ok {
			t.Errorf("%s: subagent tokens %s", id, pyjson.Compact(so))
		}
	}
}

// The index still names a path whose file moved away: the entry is left alone (the session is not
// refreshed from a guess), and the next rescan finds it.
func TestRefreshSetEntryWhosePathIsGoneIsLeftForTheRescan(t *testing.T) {
	t0 := base()
	f, c := claudeOnly(t, t0)
	st := newStore()
	sum := &flaky{fail: true}
	f.tiered(st, sum.fn) // fallback: due for R5 in 1 h
	before := f.cstate().Sessions[claudeKey]
	moved := filepath.Join(filepath.Dir(filepath.Dir(f.claudeLog)), "-work-proj-z", claudeLog)
	if err := os.MkdirAll(filepath.Dir(moved), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(f.claudeLog, moved); err != nil {
		t.Fatal(err)
	}
	sum.fail = false
	for _, h := range []int{1, 2} {
		c.t = t0.Add(time.Duration(h) * time.Hour)
		n := sum.n()
		r := f.tiered(st, sum.fn)
		if sum.n() != n {
			t.Fatalf("+%dh: %+v calls %v", h, r, sum.calls)
		}
	}
	cs := f.cstate()
	if e := cs.Sessions[claudeKey]; e.Tries != before.Tries || e.Tried != before.Tried || e.Summary != before.Summary {
		t.Fatalf("entry %+v, before %+v", e, before)
	}
	if fe := cs.Files[moved]; fe.Key != claudeKey || fe.Kind != KindSession {
		t.Fatalf("moved log not indexed: %+v", cs.Files)
	}
}

// Every corpus unit, each agent on its own copy (shared roots would share index paths, which no real
// layout does). A unit whose two logs carry one session ID is left out: spec §5.4 parses the log
// whose mtime is not in the bookmark on every run, as today.
func TestSecondTieredRunOnAnUnchangedCorpusParsesNothingAndCallsNothing(t *testing.T) {
	sessions := loadGolden(t, "sessions")
	units := at(sessions, "units").(*pyjson.Object)
	tried, twins := 0, 0
	for _, key := range units.Keys() {
		cfg := goldenCfg(t, sessions)
		store := &goldenStore{tasks: goldenTasks(sessions)}
		claude := &fakeClaude{}
		unit := strings.TrimPrefix(key, "logs/")
		roots := []Root{unitRoots(testkit.CopyCorpus(t, unit))[0], unitRoots(testkit.CopyCorpus(t, unit))[1]}
		run := func(now time.Time) TieredResult {
			env, _ := goldenEnv(t)
			r, err := RunTiered(cfg, store, roots, claude.summarizer(), nil, 1, LoadCollectorState(cfg.CollectorStatePath()),
				TieredOpts{Now: now}, nil, env)
			if err != nil {
				t.Fatalf("%s: %v", key, err)
			}
			return r
		}
		run(goldenNow)
		seen := map[string]bool{}
		twin := false
		for _, fe := range LoadCollectorState(cfg.CollectorStatePath()).Files {
			if fe.Kind == KindSession {
				twin = twin || seen[fe.Key]
				seen[fe.Key] = true
			}
		}
		if twin {
			twins++
			continue
		}
		tried++
		state1, _ := os.ReadFile(cfg.StatePath())
		calls, bodies := claude.calls, len(store.bodies)
		r := run(goldenNow.Add(15 * time.Minute))
		state2, _ := os.ReadFile(cfg.StatePath())
		if r.Parsed != 0 || claude.calls != calls || len(store.bodies) != bodies || !bytes.Equal(state1, state2) {
			t.Errorf("%s: second run %+v, %d calls, %d sends", key, r, claude.calls-calls, len(store.bodies)-bodies)
		}
	}
	if tried < 20 || twins > 2 {
		t.Fatalf("%d units compared, %d left out", tried, twins)
	}
}

func TestLostSendWritesTheCacheButNoBookmark(t *testing.T) {
	f := setup(t)
	f.roots = f.roots[:1]
	st := newStore()
	st.def = answer{nil, api.Lost}
	sum := &countingSummarizer{}
	r1 := f.tiered(st, sum.fn)
	if _, ok := f.bookmark(claudeKey); ok {
		t.Fatal("a lost session was bookmarked")
	}
	e1, ok := f.cstate().Sessions[claudeKey]
	if !ok || e1.BM != nil || e1.Summary != "stub summary" {
		t.Fatalf("entry %+v", e1)
	}
	r2 := f.tiered(st, sum.fn)
	if len(sum.calls) != 1 || r1.Lost != 1 || r2.Lost != 1 || r2.Reused != 0 || r2.Parsed != 1 {
		t.Fatalf("calls %v, run 1 %+v, run 2 %+v", sum.calls, r1, r2)
	}
	if e2 := f.cstate().Sessions[claudeKey]; e2.BM != nil {
		t.Fatalf("bm after run 2 %+v", e2.BM)
	}
}

// stoppedAndDue leaves the Claude session with a stale llm summary whose log stopped 30 min ago:
// the next run (at T+30) refreshes it from the refresh set, with mtime and fp equal to the bookmark.
func stoppedAndDue(t *testing.T) (*fx, *clock, *fakeStore, *flaky, time.Time) {
	T := base()
	f, c := claudeOnly(t, T.Add(-15*time.Minute))
	st := newStore()
	sum := &flaky{}
	f.tiered(st, sum.fn) // R1
	f.turnAt(T, "最後の確認をお願いします")
	c.t = T.Add(15 * time.Minute)
	f.tiered(st, sum.fn) // R4
	c.t = T.Add(30 * time.Minute)
	return f, c, st, sum, T
}

// Controller ruling on concern 1: a Lost send of an mtime-matched key leaves its entry as it was, so
// the refresh set retries it. A Rejected one: TestRejectedRefreshSendKeepsTheEntryAndIsRetriedOnTheBackoff.
func TestLostRefreshSendLeavesTheEntryAndIsRetriedOnTheNextDueRun(t *testing.T) {
	t.Run("R3 from the refresh set", func(t *testing.T) {
		f, c, st, sum, T := stoppedAndDue(t)
		before := f.cstate().Sessions[claudeKey]
		bm, _ := f.bookmark(claudeKey)
		st.def = answer{nil, api.Lost}
		if r := f.tiered(st, sum.fn); r.Lost != 1 || sum.n() != 2 {
			t.Fatalf("lost run %+v calls %v", r, sum.calls)
		}
		if e := f.cstate().Sessions[claudeKey]; !reflect.DeepEqual(e, before) {
			t.Fatalf("entry %+v, before %+v", e, before)
		}
		if b, _ := f.bookmark(claudeKey); !sameBM(&bm, b) {
			t.Fatalf("bookmark %+v, before %+v", b, bm)
		}
		st.def = oneInsert
		c.t = T.Add(45 * time.Minute)
		if r := f.tiered(st, sum.fn); r.Parsed != 1 || sum.n() != 3 || st.records["Sabcd1234"].Summary != "summary 3" {
			t.Fatalf("retry %+v calls %v sent %q", r, sum.calls, st.records["Sabcd1234"].Summary)
		}
		if e := f.cstate().Sessions[claudeKey]; e.PFP != e.CurPFP || e.Summary != "summary 3" {
			t.Fatalf("entry after retry %+v", e)
		}
	})
	t.Run("R7 adoption", func(t *testing.T) {
		f := setup(t)
		f.roots = f.roots[:1]
		st := newStore()
		f.full(st, degraded, nil)
		bm, _ := f.bookmark(claudeKey)
		c := f.freeze(base())
		sum := &flaky{}
		st.def = answer{nil, api.Lost}
		if r := f.tiered(st, sum.fn); r.Adopted != 1 || r.Lost != 1 || sum.n() != 1 {
			t.Fatalf("lost adoption %+v calls %v", r, sum.calls)
		}
		e := f.cstate().Sessions[claudeKey]
		if e.Source != "fallback" || e.Tries != 0 || e.At != 0 || !sameBM(e.BM, bm) {
			t.Fatalf("adopted entry %+v", e)
		}
		st.def = oneInsert
		c.t = c.t.Add(15 * time.Minute)
		if r := f.tiered(st, sum.fn); r.Parsed != 1 || sum.n() != 2 || st.records["Sabcd1234"].SummarySource != "llm" {
			t.Fatalf("retry %+v calls %v", r, sum.calls)
		}
	})
}

// Final-review ruling on finding 1: a Rejected send of an mtime-matched key keeps the prior entry, as
// a Lost one does, but counts the attempt (tries++, tried = now), so the refresh set retries it on the
// backoff instead of the stat skip hiding a summary the server never took.
func TestRejectedRefreshSendKeepsTheEntryAndIsRetriedOnTheBackoff(t *testing.T) {
	f, c, st, sum, T := stoppedAndDue(t)
	before := f.cstate().Sessions[claudeKey]
	bm, _ := f.bookmark(claudeKey)
	st.def = answer{nil, api.Rejected}
	if r := f.tiered(st, sum.fn); r.Rejected != 1 || sum.n() != 2 {
		t.Fatalf("rejected run %+v calls %v", r, sum.calls)
	}
	want := before
	want.Tries, want.Tried = 1, epoch(T.Add(30*time.Minute))
	if e := f.cstate().Sessions[claudeKey]; !reflect.DeepEqual(e, want) {
		t.Fatalf("entry %+v, want %+v", e, want)
	}
	if want.CurPFP == want.PFP { // still stale, so tiered-rollback resets it
		t.Fatalf("kept entry not stale: %+v", want)
	}
	if b, _ := f.bookmark(claudeKey); !sameBM(&bm, b) {
		t.Fatalf("bookmark %+v, before %+v", b, bm)
	}
	st.def = oneInsert
	c.t = T.Add(30*time.Minute + 59*time.Minute)
	if r := f.tiered(st, sum.fn); r.Parsed != 0 || sum.n() != 2 {
		t.Fatalf("inside the backoff %+v calls %v", r, sum.calls)
	}
	c.t = T.Add(90 * time.Minute)
	if r := f.tiered(st, sum.fn); r.Parsed != 1 || sum.n() != 3 || st.records["Sabcd1234"].Summary != "summary 3" {
		t.Fatalf("retry %+v calls %v sent %q", r, sum.calls, st.records["Sabcd1234"].Summary)
	}
	if e := f.cstate().Sessions[claudeKey]; e.PFP != e.CurPFP || e.Summary != "summary 3" || e.Tries != 0 {
		t.Fatalf("entry after retry %+v", e)
	}
}

// Final review, finding 2: a refresh-set key whose session has become excluded or trivial (a config
// change) leaves the cache, so it is not re-parsed on every run until the 15-day prune.
func TestRefreshSetKeyThatBecameExcludedOrTrivialLeavesTheCache(t *testing.T) {
	for _, c := range []struct {
		name string
		set  func(f *fx)
	}{
		{"excluded", func(f *fx) { f.cfg.ExcludeCwdPatterns = []string{"/work/proj-a"} }},
		{"trivial", func(f *fx) { f.cfg.ExcludePromptPatterns = []string{""} }}, // "" is in every prompt
	} {
		t.Run(c.name, func(t *testing.T) {
			t0 := base()
			f, clk := claudeOnly(t, t0)
			st := newStore()
			sum := &flaky{fail: true}
			f.tiered(st, sum.fn) // a fallback: in the refresh set from +1 h
			c.set(f)
			clk.t = t0.Add(time.Hour)
			if r := f.tiered(st, sum.fn); r.Parsed != 1 || sum.n() != 1 {
				t.Fatalf("+1h: %+v calls %v", r, sum.calls)
			}
			if e, ok := f.cstate().Sessions[claudeKey]; ok {
				t.Errorf("entry kept: %+v", e)
			}
			clk.t = t0.Add(75 * time.Minute)
			if r := f.tiered(st, sum.fn); r.Parsed != 0 || sum.n() != 1 {
				t.Fatalf("+75m: %+v calls %v", r, sum.calls)
			}
		})
	}
}

// Final review, finding 3: the parsers check since before Keep, so a refresh-set path older than the
// window would never be offered. refreshSet leaves it out; the prune or the rescan deals with it.
func TestRefreshSetLeavesOutALogOlderThanSince(t *testing.T) {
	t0 := base()
	f, _ := claudeOnly(t, t0)
	old := t0.Add(-20 * 24 * time.Hour)
	if err := os.Chtimes(f.claudeLog, old, old); err != nil {
		t.Fatal(err)
	}
	sum := &flaky{fail: true}
	if _, err := RunTiered(f.cfg, newStore(), f.roots, sum.fn, nil, 1, f.cstate(), TieredOpts{Now: t0}, nil, f.env); err != nil {
		t.Fatal(err)
	}
	cs, state := f.cstate(), LoadState(f.cfg.StatePath())
	if e, ok := cs.Valid(claudeKey, state); !ok || e.Source != "fallback" {
		t.Fatalf("seed: %+v %v", e, ok)
	}
	now := epoch(t0.Add(time.Hour))
	if keys, _ := refreshSet(cs, state, now, nil); !keys[claudeKey] {
		t.Fatalf("no window: %v", keys)
	}
	inside, outside := sinceEpoch(t0, 21), sinceEpoch(t0, 14)
	if keys, _ := refreshSet(cs, state, now, &inside); !keys[claudeKey] {
		t.Fatalf("21-day window: %v", keys)
	}
	if keys, paths := refreshSet(cs, state, now, &outside); len(keys) != 0 || len(paths) != 0 {
		t.Fatalf("14-day window: keys %v paths %v", keys, paths)
	}
}

// Finding 1, the R7 path: a rejected adoption keeps the adopted entry with tries 1, retried after 1 h.
func TestRejectedAdoptionKeepsTheEntryAndIsRetriedOnTheBackoff(t *testing.T) {
	f := setup(t)
	f.roots = f.roots[:1]
	st := newStore()
	f.full(st, degraded, nil)
	bm, _ := f.bookmark(claudeKey)
	c := f.freeze(base())
	t0 := c.t
	sum := &flaky{}
	st.def = answer{nil, api.Rejected}
	if r := f.tiered(st, sum.fn); r.Adopted != 1 || r.Rejected != 1 || sum.n() != 1 {
		t.Fatalf("rejected adoption %+v calls %v", r, sum.calls)
	}
	e := f.cstate().Sessions[claudeKey]
	if e.Source != "fallback" || e.Tries != 1 || e.Tried != epoch(t0) || !sameBM(e.BM, bm) {
		t.Fatalf("adopted entry %+v", e)
	}
	st.def = oneInsert
	c.t = t0.Add(15 * time.Minute)
	if r := f.tiered(st, sum.fn); r.Parsed != 0 || sum.n() != 1 {
		t.Fatalf("inside the backoff %+v calls %v", r, sum.calls)
	}
	c.t = t0.Add(time.Hour)
	if r := f.tiered(st, sum.fn); r.Parsed != 1 || sum.n() != 2 || st.records["Sabcd1234"].SummarySource != "llm" {
		t.Fatalf("retry %+v calls %v", r, sum.calls)
	}
}

// ---- Task 3c: rescan, prune, counters and the decision log -------------------------------------

// decisions collects the log callback's lines.
type decisions struct{ lines []*pyjson.Object }

func (d *decisions) log(l *pyjson.Object) { d.lines = append(d.lines, l) }

func (d *decisions) rules() []string {
	var out []string
	for _, l := range d.lines {
		out = append(out, str(l, "rule"))
	}
	return out
}

func str(o *pyjson.Object, k string) string { v, _ := o.Get(k); s, _ := v.(string); return s }

func flo(o *pyjson.Object, k string) float64 { v, _ := o.Get(k); return number(v) }

func (f *fx) tieredWith(st Store, sum Summarizer, rescan bool, log func(*pyjson.Object)) TieredResult {
	f.t.Helper()
	r, err := RunTiered(f.cfg, st, f.roots, sum, &fourteen, 1, f.cstate(), TieredOpts{Now: f.env.Now(), Rescan: rescan}, log, f.env)
	if err != nil {
		f.t.Fatal(err)
	}
	return r
}

func (f *fx) saveCS(cs *CollectorState) {
	f.t.Helper()
	if err := SaveCollectorState(f.cfg.CollectorStatePath(), cs); err != nil {
		f.t.Fatal(err)
	}
}

func tierLine(ts float64, key string) *pyjson.Object {
	o := pyjson.NewObject()
	o.Set("ts", pyjson.Float(ts))
	o.Set("key", key)
	return o
}

func TestRescanIgnoresTheIndexPrunesAndRotatesTheLog(t *testing.T) {
	T := base()
	f, _ := claudeOnly(t, T)
	st := newStore()
	f.tiered(st, stubSummarizer)

	// A wrong index: the real session filed as an empty log, with the mtime it has now.
	cs := f.cstate()
	cs.Files[f.claudeLog] = FileEntry{Key: "claude-code:", Kind: KindNone, Mtime: mtimeOf(t, f.claudeLog), Seen: epoch(T)}
	gone := filepath.Join(f.tmp, "gone.jsonl")
	old := filepath.Join(f.tmp, "old.jsonl")
	write(t, old, []byte("x\n"))
	oldAt := T.Add(-20 * 24 * time.Hour)
	if err := os.Chtimes(old, oldAt, oldAt); err != nil {
		t.Fatal(err)
	}
	cs.Files[gone] = FileEntry{Key: "claude-code:gone", Kind: KindSession, Mtime: epoch(T), Seen: epoch(T)}
	cs.Files[old] = FileEntry{Key: "claude-code:old", Kind: KindSession, Mtime: epoch(oldAt), Seen: epoch(T)}
	cs.Sessions["claude-code:stale"] = SummaryEntry{Seen: epoch(T.Add(-16 * 24 * time.Hour))}
	cs.Sessions["claude-code:recent"] = SummaryEntry{Seen: epoch(T.Add(-14 * 24 * time.Hour))}
	f.saveCS(cs)
	var lines []byte
	for _, l := range []*pyjson.Object{tierLine(epoch(T.Add(-9*24*time.Hour)), "too old"), tierLine(epoch(T.Add(-7*24*time.Hour)), "kept"), tierLine(epoch(T), "today")} {
		lines = append(lines, append(pyjson.Compact(l), '\n')...)
	}
	write(t, f.cfg.TiersLogPath(), lines)

	if r := f.tieredWith(st, stubSummarizer, false, nil); r.Parsed != 0 {
		t.Fatalf("a plain run trusts the index: %+v", r)
	}
	cs = f.cstate()
	if _, ok := cs.Files[gone]; !ok || len(cs.Sessions) != 3 {
		t.Fatalf("a plain run prunes nothing: files %v sessions %d", cs.Files, len(cs.Sessions))
	}
	if b, _ := os.ReadFile(f.cfg.TiersLogPath()); bytes.Count(b, []byte("\n")) != 3 {
		t.Fatalf("a plain run rotates nothing: %q", b)
	}

	r := f.tieredWith(st, stubSummarizer, true, nil)
	if r.Parsed != 1 || r.Skipped != 1 {
		t.Fatalf("rescan ignores the index: %+v", r)
	}
	cs = f.cstate()
	if fe := cs.Files[f.claudeLog]; fe.Kind != KindSession || fe.Key != claudeKey {
		t.Errorf("index not repaired: %+v", fe)
	}
	for _, p := range []string{gone, old} {
		if _, ok := cs.Files[p]; ok {
			t.Errorf("%s not pruned", p)
		}
	}
	if _, ok := cs.Sessions["claude-code:stale"]; ok {
		t.Error("stale session not pruned")
	}
	for _, k := range []string{"claude-code:recent", claudeKey} {
		if _, ok := cs.Sessions[k]; !ok {
			t.Errorf("%s pruned", k)
		}
	}
	b, _ := os.ReadFile(f.cfg.TiersLogPath())
	if got := string(b); strings.Contains(got, "too old") || !strings.Contains(got, "kept") || !strings.Contains(got, "today") {
		t.Errorf("rotation kept 8 days: %q", got)
	}
}

func TestTiersCountersSplitNewBootstrapReusedRefreshedFailedAdopted(t *testing.T) {
	type counts struct{ parsed, new, bootstrap, reused, refreshed, failed, adopted, fallback int }
	of := func(r TieredResult) counts {
		return counts{r.Parsed, r.NewSummaries, r.Bootstrap, r.Reused, r.Refreshed, r.Failed, r.Adopted, r.Fallback}
	}
	check := func(t *testing.T, what string, r TieredResult, want counts) {
		t.Helper()
		if got := of(r); got != want {
			t.Fatalf("%s: got %+v want %+v", what, got, want)
		}
	}

	t.Run("llm session: new, R4, R3f, R3, R2", func(t *testing.T) {
		T := base()
		f, c := claudeOnly(t, T.Add(-15*time.Minute))
		st, sum := newStore(), &flaky{}
		check(t, "R1", f.tiered(st, sum.fn), counts{parsed: 1, new: 1})
		f.turnAt(T, "最後の確認をお願いします")
		c.t = T.Add(15 * time.Minute)
		check(t, "R4", f.tiered(st, sum.fn), counts{parsed: 1, reused: 1})
		c.t, sum.fail = T.Add(30*time.Minute), true
		check(t, "R3f", f.tiered(st, sum.fn), counts{parsed: 1, failed: 1, fallback: 1})
		c.t, sum.fail = T.Add(90*time.Minute), false
		check(t, "R3", f.tiered(st, sum.fn), counts{parsed: 1, refreshed: 1})
		f.addSubagentUsage("a1")
		c.t = T.Add(105 * time.Minute)
		check(t, "R2", f.tiered(st, sum.fn), counts{parsed: 1, reused: 1})
	})
	t.Run("fallback session: R1, R6, R5 fails, R5 succeeds", func(t *testing.T) {
		T := base()
		f, c := claudeOnly(t, T)
		st, sum := newStore(), &flaky{fail: true}
		check(t, "R1 falling back is new, not failed", f.tiered(st, sum.fn), counts{parsed: 1, new: 1, fallback: 1})
		f.turnAt(T.Add(time.Minute), "もう一つお願いします")
		c.t = T.Add(10 * time.Minute)
		check(t, "R6 re-sends the cached fallback", f.tiered(st, sum.fn), counts{parsed: 1, reused: 1})
		c.t = T.Add(time.Hour)
		check(t, "R5 falls back", f.tiered(st, sum.fn), counts{parsed: 1, failed: 1, fallback: 1})
		sum.fail = false
		c.t = T.Add(3 * time.Hour)
		check(t, "R5 succeeds", f.tiered(st, sum.fn), counts{parsed: 1, refreshed: 1})
	})
	t.Run("reused counts accepted or parked re-sends only", func(t *testing.T) {
		T := base()
		f, c := claudeOnly(t, T)
		st, sum := newStore(), &flaky{}
		check(t, "R1", f.tiered(st, sum.fn), counts{parsed: 1, new: 1})
		f.addSubagentUsage("a1")
		for i, out := range []api.Outcome{api.Rejected, api.Lost, api.Retry, api.OK} {
			st.def = answer{nil, out}
			if out == api.OK {
				st.def = oneInsert
			}
			c.t = T.Add(time.Duration(i+1) * 15 * time.Minute)
			want := counts{parsed: 1}
			if out == api.Retry || out == api.OK {
				want.reused = 1
			}
			check(t, fmt.Sprintf("R2 %v", out), f.tiered(st, sum.fn), want)
			if out == api.Retry { // parked: bookmarked, so the next R2 needs the log to move again
				f.addSubagentUsage("a2")
			}
		}
	})
	t.Run("bootstrap and adoption", func(t *testing.T) {
		f := setup(t)
		f.roots = f.roots[:1]
		st := newStore()
		f.full(st, stubSummarizer, nil) // a bookmark with an fp, no cache
		appendText(t, f.claudeLog, realTurn)
		touchLater(t, f.claudeLog)
		check(t, "bootstrap", f.tiered(st, stubSummarizer), counts{parsed: 1, bootstrap: 1})

		g := setup(t)
		g.roots = g.roots[:1]
		gs := newStore()
		g.full(gs, degraded, nil) // an fp-less bookmark, no cache: R7 then R5
		check(t, "adoption", g.tiered(gs, stubSummarizer), counts{parsed: 1, adopted: 1, refreshed: 1})
	})
}

func TestFallbackCountIsAttemptsThatFellBackNotReSends(t *testing.T) {
	T := base()
	f, c := claudeOnly(t, T)
	st, sum := newStore(), &flaky{fail: true}
	if r := f.tiered(st, sum.fn); r.Fallback != 1 { // R1
		t.Fatalf("R1: %+v", r)
	}
	f.turnAt(T.Add(time.Minute), "もう一つお願いします")
	c.t = T.Add(15 * time.Minute)
	n := sum.n()
	if r := f.tiered(st, sum.fn); r.Fallback != 0 || sum.n() != n || r.Failed != 0 { // R6: re-sent, no attempt
		t.Fatalf("R6: %+v calls %d->%d", r, n, sum.n())
	}
	if rec := st.records["Sabcd1234"]; rec.SummarySource != "fallback" {
		t.Fatalf("R6 sent %q", rec.SummarySource)
	}
	c.t = T.Add(time.Hour + time.Minute)
	if r := f.tiered(st, sum.fn); r.Fallback != 1 || r.Failed != 1 { // R5 falls back again
		t.Fatalf("R5: %+v", r)
	}
}

func TestDecisionLogHasOneLinePerSessionDecision(t *testing.T) {
	T := base()
	f, c := claudeOnly(t, T.Add(-15*time.Minute))
	st, sum := newStore(), &flaky{}
	run := func(want ...string) []*pyjson.Object {
		t.Helper()
		var d decisions
		f.tieredWith(st, sum.fn, false, d.log)
		if !slices.Equal(d.rules(), want) {
			t.Fatalf("rules %v, want %v", d.rules(), want)
		}
		return d.lines
	}
	var all []*pyjson.Object

	l := run("R1")
	all = append(all, l...)
	e := f.cstate().Sessions[claudeKey]
	if str(l[0], "key") != claudeKey || str(l[0], "source") != "llm" || str(l[0], "pfp") != e.PFP || str(l[0], "cur_pfp") != e.CurPFP ||
		flo(l[0], "at") != e.At || flo(l[0], "ts") != epoch(c.t) || e.PFP == "" {
		t.Errorf("R1 line %s, entry %+v", pyjson.Compact(l[0]), e)
	}
	f.turnAt(T, "最後の確認をお願いします")
	c.t = T.Add(15 * time.Minute)
	l = run("R4")
	all = append(all, l...)
	if str(l[0], "pfp") == str(l[0], "cur_pfp") || str(l[0], "source") != "llm" {
		t.Errorf("R4 line is stale: %s", pyjson.Compact(l[0]))
	}
	c.t, sum.fail = T.Add(30*time.Minute), true
	l = run("R3f")
	all = append(all, l...)
	if str(l[0], "source") != "llm" || flo(l[0], "at") != e.At {
		t.Errorf("R3f line keeps the cached llm summary: %s", pyjson.Compact(l[0]))
	}
	c.t, sum.fail = T.Add(90*time.Minute), false
	all = append(all, run("R3")...)
	f.addSubagentUsage("a1")
	c.t = T.Add(105 * time.Minute)
	l = run("R2")
	all = append(all, l...)
	if str(l[0], "pfp") != str(l[0], "cur_pfp") {
		t.Errorf("R2 line: %s", pyjson.Compact(l[0]))
	}
	later := T.Add(3 * time.Hour) // the log moved, the fingerprint did not
	if err := os.Chtimes(f.claudeLog, later, later); err != nil {
		t.Fatal(err)
	}
	c.t = T.Add(120 * time.Minute)
	all = append(all, run("R0")...)
	c.t = T.Add(135 * time.Minute)
	if got := run(); got != nil { // nothing parsed, nothing decided
		t.Errorf("unchanged run logged %v", got)
	}

	want := []string{"ts", "key", "rule", "source", "pfp", "cur_pfp", "at"}
	for _, l := range all {
		if !slices.Equal(l.Keys(), want) {
			t.Errorf("fields %v", l.Keys())
		}
		for _, text := range []string{"summary ", "最後の確認", "次の修正", "承知"} {
			if strings.Contains(string(pyjson.Compact(l)), text) {
				t.Errorf("line carries text %q: %s", text, pyjson.Compact(l))
			}
		}
	}

	t.Run("R7 then R5", func(t *testing.T) {
		g := setup(t)
		g.roots = g.roots[:1]
		g.full(newStore(), degraded, nil)
		g.freeze(base())
		var d decisions
		g.tieredWith(newStore(), stubSummarizer, false, d.log)
		if !slices.Equal(d.rules(), []string{"R7", "R5"}) {
			t.Fatalf("rules %v", d.rules())
		}
	})
	t.Run("the file", func(t *testing.T) {
		g, gc := claudeOnly(t, base())
		logf := NewTiersLog(g.cfg, g.env)
		g.tieredWith(newStore(), stubSummarizer, false, logf)
		gc.t = gc.t.Add(time.Minute)
		g.tieredWith(newStore(), stubSummarizer, false, logf)
		b, err := os.ReadFile(g.cfg.TiersLogPath())
		if err != nil || bytes.Count(b, []byte("\n")) != 1 || !bytes.HasSuffix(b, []byte("}\n")) {
			t.Fatalf("%v %q", err, b)
		}
		v, err := pyjson.Decode(bytes.TrimSpace(b))
		if o, ok := v.(*pyjson.Object); err != nil || !ok || !slices.Equal(o.Keys(), want) {
			t.Fatalf("%v %v", err, v)
		}
	})
}

func TestNoneAndExcludedFilesAreSkippedUntilTheyChange(t *testing.T) {
	f := setup(t)
	f.roots = f.roots[:1]
	f.cfg.ExcludeCwdPatterns = []string{"proj-a"}
	none := filepath.Join(filepath.Dir(f.claudeLog), "nothing.jsonl")
	write(t, none, []byte(`{"type": "summary", "summary": "no session id here"}`+"\n"))
	st := newStore()
	r := f.tiered(st, stubSummarizer)
	if r.Parsed != 2 || r.Skipped != 1 || len(st.appended) != 0 {
		t.Fatalf("first run %+v", r)
	}
	cs := f.cstate()
	if fe := cs.Files[none]; fe.Kind != KindNone || fe.Mtime != mtimeOf(t, none) {
		t.Fatalf("none entry %+v", fe)
	}
	if fe := cs.Files[f.claudeLog]; fe.Kind != KindExcluded || fe.Mtime != mtimeOf(t, f.claudeLog) {
		t.Fatalf("excluded entry %+v", fe)
	}

	// Unchanged: neither is parsed; the excluded one still counts in skipped, the empty one does not.
	if r := f.tiered(st, stubSummarizer); r.Parsed != 0 || r.Skipped != 1 {
		t.Fatalf("second run %+v", r)
	}

	// Each parsed again once its mtime moves.
	touchLater(t, none)
	if r := f.tiered(st, stubSummarizer); r.Parsed != 1 || r.Skipped != 1 {
		t.Fatalf("none moved: %+v", r)
	}
	touchLater(t, f.claudeLog)
	if r := f.tiered(st, stubSummarizer); r.Parsed != 1 || r.Skipped != 1 {
		t.Fatalf("excluded moved: %+v", r)
	}
	// A rescan reads both again.
	if r := f.tieredWith(st, stubSummarizer, true, nil); r.Parsed != 2 {
		t.Fatalf("rescan: %+v", r)
	}
}
