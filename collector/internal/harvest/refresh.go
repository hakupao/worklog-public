package harvest

import (
	"github.com/hakupao/worklog/collector/internal/api"
	"github.com/hakupao/worklog/collector/internal/config"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/rt"
	"github.com/hakupao/worklog/collector/internal/session"
	"github.com/hakupao/worklog/collector/internal/tokens"
)

// metaBatch is META_BATCH: the server takes at most this many sessions per request.
const metaBatch = 500

// RefreshMeta is refresh_meta: re-parse the logs (sinceDays nil = all) and send only what is
// derived from them without an LLM: files_written, tokens with cost, active_intervals and
// artifacts. No summaries, no links, no bookmarks; excluded cwds are left out, trivial sessions are
// not. It returns (sent, updated, OK), or the Outcome of the first batch that did not land; the
// batches before it stay applied, which is harmless because the next run sends the same values.
func RefreshMeta(cfg *config.Config, c MetaClient, roots []Root, sinceDays *int, env *rt.Env) (sent, updated int, out api.Outcome) {
	var items []*pyjson.Object
	scan(roots, sinceDays, env, func(agent string, raw *session.RawSession) {
		if isExcluded(raw.Cwd, cfg.ExcludeCwdPatterns) {
			return
		}
		o := pyjson.NewObject()
		o.Set("agent", agent)
		o.Set("session_id", raw.SessionID)
		files := []pyjson.Value{}
		for _, f := range raw.FilesWritten {
			files = append(files, f)
		}
		o.Set("files_written", files)
		if t := tokens.WithCost(raw.Tokens, cfg.Pricing); t != nil {
			o.Set("tokens", t)
		} else {
			o.Set("tokens", nil)
		}
		// The spelling Session.model_dump_json() gives (UTC as Z), so ingest and refresh hand the
		// server one form.
		ivs := []pyjson.Value{}
		for _, iv := range session.ActiveIntervals(raw.Messages, gapMinutes) {
			ivs = append(ivs, []pyjson.Value{iv[0].Pydantic(), iv[1].Pydantic()})
		}
		o.Set("active_intervals", ivs)
		o.Set("artifacts", artifactList(raw.Artifacts))
		items = append(items, o)
	})
	for i := 0; i < len(items); i += metaBatch {
		n, o := c.PutSessionMeta(items[i:min(i+metaBatch, len(items))])
		if o != api.OK {
			return 0, 0, o
		}
		updated += n
	}
	return len(items), updated, api.OK
}
