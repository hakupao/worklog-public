package harvest

import (
	"encoding/hex"
	"slices"

	"golang.org/x/crypto/blake2b"

	"github.com/hakupao/worklog/collector/internal/model"
	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/session"
)

// Fingerprint is _fingerprint (spec §5.3): everything the Session record would carry except the
// summary and the clock. An open Claude Code window keeps appending metadata records to its log
// without a single new message, so the mtime moves every hour while nothing worth summarizing has
// changed; same fingerprint, same record, and the session is not summarized or sent again.
// files_written is compared as a set; prices are not in it (--refresh-meta re-prices); Artifacts
// are in it only when there are some, so a session that published none keeps the fingerprint it
// had before the field existed.
func Fingerprint(raw *session.RawSession, taskID *string, linkMethod string) string {
	return digest(fingerprintInput(raw, taskID, linkMethod))
}

// digest is blake2b(digest_size=16), a parameterised hash rather than a truncated one.
func digest(b []byte) string {
	h, _ := blake2b.New(16, nil) // only an over-long key or size fails
	h.Write(b)
	return hex.EncodeToString(h.Sum(nil))
}

// onFingerprint, when set, sees every fingerprint input harvest hashes (a test seam: golden
// fingerprint.json "harvest").
var onFingerprint func(input []byte)

// fingerprintInput is the exact json.dumps(fields, sort_keys=True) text: default separators,
// ensure_ascii, isoformat() datetimes (+00:00, not Z).
func fingerprintInput(raw *session.RawSession, taskID *string, linkMethod string) []byte {
	fields := []pyjson.Value{pyjson.Int(len(raw.Messages)), nil, nil}
	if first, ok := session.StartedAt(raw.Messages); ok {
		fields[1] = first.ISOFormat()
	}
	if last, ok := session.EndedAt(raw.Messages); ok {
		fields[2] = last.ISOFormat()
	}
	files := []pyjson.Value{}
	for _, f := range slices.Sorted(slices.Values(raw.FilesWritten)) {
		files = append(files, f)
	}
	fields = append(fields, files)
	if raw.Tokens != nil {
		fields = append(fields, raw.Tokens.Value())
	} else {
		fields = append(fields, nil)
	}
	if taskID != nil {
		fields = append(fields, *taskID)
	} else {
		fields = append(fields, nil)
	}
	fields = append(fields, linkMethod)
	if len(raw.Artifacts) > 0 {
		fields = append(fields, artifactList(raw.Artifacts))
	}
	return pyjson.Dumps(fields, pyjson.Default().Sorted())
}

// artifactList is RawSession.artifacts as the parser's dicts: {url, title, artifact_id, ts}.
func artifactList(arts []model.Artifact) []pyjson.Value {
	out := make([]pyjson.Value, len(arts))
	for i, a := range arts {
		o := pyjson.NewObject()
		o.Set("url", a.URL)
		o.Set("title", optStr(a.Title))
		o.Set("artifact_id", optStr(a.ArtifactID))
		o.Set("ts", a.TS)
		out[i] = o
	}
	return out
}

func optStr(s *string) pyjson.Value {
	if s == nil {
		return nil
	}
	return *s
}
