package api

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/testkit"
)

// A Python-parked outbox replays equal: golden/cli_transcripts.json → harvest_flushes_outbox. The
// generator parked two notes with json.dumps(ensure_ascii=False) under {stamp:019d}-{hex}.json names;
// the stub answered N1 with 200 and N2 with 400. Go must send the same requests and leave the same
// tree (N2 under rejected/).
func TestAPythonParkedOutboxReplaysEqual(t *testing.T) {
	var raw []byte
	testkit.Golden(t, "cli_transcripts", &raw)
	root := dec(t, raw).(*pyjson.Object)
	var sc *pyjson.Object
	for _, s := range get(root, "scenarios").([]pyjson.Value) {
		if get(s.(*pyjson.Object), "name") == "harvest_flushes_outbox" {
			sc = s.(*pyjson.Object)
		}
	}
	if sc == nil {
		t.Fatal("no harvest_flushes_outbox scenario")
	}

	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/notes/N2" {
			reply(400, `{"error": "bad"}`)(w, r)
			return
		}
		reply(200, `{"ok": true}`)(w, r)
	})
	// The bytes gen_golden.py wrote (json.dumps(payload, ensure_ascii=False)).
	os.MkdirAll(f.outbox(), 0o755)
	os.WriteFile(filepath.Join(f.outbox(), "1791000000000000000-000000.json"),
		[]byte(`{"method": "PUT", "path": "/api/notes/N1", "body": {"id": "N1", "text": "一件目"}}`), 0o644)
	os.WriteFile(filepath.Join(f.outbox(), "1791000000000000001-000001.json"),
		[]byte(`{"method": "PUT", "path": "/api/notes/N2", "body": {"id": "N2", "text": "二件目"}}`), 0o644)

	if sent, rem := f.c.Flush(); sent != 1 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	wantReqs := get(sc, "requests").([]pyjson.Value)[:2]
	got := f.rec.all()
	if len(got) != 2 {
		t.Fatalf("requests = %d", len(got))
	}
	for i, w := range wantReqs {
		wo := w.(*pyjson.Object)
		if got[i].Method != get(wo, "method") || got[i].Path != get(wo, "path") {
			t.Fatalf("request %d: %s %s", i, got[i].Method, got[i].Path)
		}
		if !pyjson.Equal(dec(t, got[i].Body), get(wo, "body")) {
			t.Fatalf("request %d body %s", i, got[i].Body)
		}
		if ct := get(get(wo, "headers").(*pyjson.Object), "Content-Type"); got[i].Header.Get("Content-Type") != ct {
			t.Fatalf("request %d content-type %q", i, got[i].Header.Get("Content-Type"))
		}
	}
	after := get(sc, "outbox_after").(*pyjson.Object)
	tree := pyjson.NewObject()
	filepath.WalkDir(f.outbox(), func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(f.outbox(), p)
			tree.Set(filepath.ToSlash(rel), readJSON(t, p))
		}
		return nil
	})
	if !pyjson.Equal(tree, after) {
		t.Fatalf("outbox after\n got %s\nwant %s", pyjson.Compact(tree), pyjson.Compact(after))
	}
}

// What Go parks has Python's shape: {"method", "path", "body"} in that order, the name
// {stamp:019d}-{6 hex}.json, the body the record's model_dump_json.
func TestParkedFileNameAndBody(t *testing.T) {
	f := newFixture(t, reply(503, ""))
	f.c.PutTask(makeTask(), true)
	files := jsonFiles(t, f.outbox())
	if len(files) != 1 {
		t.Fatalf("files %v", files)
	}
	if !regexp.MustCompile(`^[0-9]{19}-[0-9a-f]{6}\.json$`).MatchString(filepath.Base(files[0])) {
		t.Fatalf("name %s", filepath.Base(files[0]))
	}
	b, _ := os.ReadFile(files[0])
	// json.dumps(..., ensure_ascii=False): default separators, raw UTF-8, no trailing newline.
	if !strings.HasPrefix(string(b), `{"method": "PUT", "path": "/api/tasks/T20260918-01", "body": {"id": "T20260918-01", `) ||
		!strings.Contains(string(b), `"requester": "田中さん"`) || strings.HasSuffix(string(b), "\n") {
		t.Fatalf("file %s", b)
	}
}

// Spec §6 D14: a file whose JSON is valid but not an object (an array, a string) is set aside like a
// corrupt one, and flush goes on. Python raises TypeError out of flush.
func TestANonObjectOutboxFileGoesToRejected(t *testing.T) {
	f := newFixture(t, reply(200, `{}`))
	os.MkdirAll(f.outbox(), 0o755)
	write := func(name, s string) { os.WriteFile(filepath.Join(f.outbox(), name), []byte(s), 0o644) }
	write("1791000000000000000-000000.json", `{"method": "PUT", "path": "/api/notes/N1", "body": {"id": "N1"}}`)
	write("1791000000000000005-zzzzzz.json", `[1, 2]`)
	write("1791000000000000006-000000.json", `"a string"`)
	write("1791000000000000007-000000.json", `{"method": "PUT", "path": "/api/notes/N2"}`)
	write("1791000000000000008-000000.json", `{"method": 1, "path": "/api/notes/N3", "body": {}}`)
	write("1791000000000000009-000000.json", `{"method": "PUT", "path": "/api/notes/N4", "body": {"id": "N4"}}`)
	if sent, rem := f.c.Flush(); sent != 2 || rem != 0 {
		t.Fatalf("Flush = %d, %d", sent, rem)
	}
	noOutboxFiles(t, f)
	var rejected []string
	for _, p := range jsonFiles(t, filepath.Join(f.outbox(), "rejected")) {
		rejected = append(rejected, filepath.Base(p))
	}
	want := "1791000000000000005-zzzzzz.json,1791000000000000006-000000.json,1791000000000000007-000000.json,1791000000000000008-000000.json"
	if strings.Join(rejected, ",") != want {
		t.Fatalf("rejected %v", rejected)
	}
	if b, _ := os.ReadFile(filepath.Join(f.outbox(), "rejected", "1791000000000000005-zzzzzz.json")); string(b) != "[1, 2]" {
		t.Fatalf("moved file changed: %s", b)
	}
	var paths []string
	for _, r := range f.rec.all() {
		paths = append(paths, r.Path)
	}
	if strings.Join(paths, ",") != "/api/notes/N1,/api/notes/N4" {
		t.Fatalf("sent %v", paths)
	}
}

// Only *.json directly in the outbox is replayed; rejected/ is a record, never a queue.
func TestFlushNeverReplaysRejected(t *testing.T) {
	f := newFixture(t, reply(200, `{}`))
	os.MkdirAll(filepath.Join(f.outbox(), "rejected"), 0o755)
	os.WriteFile(filepath.Join(f.outbox(), "rejected", "1.json"), []byte(`{"method": "PUT", "path": "/x", "body": {}}`), 0o644)
	os.WriteFile(filepath.Join(f.outbox(), "2.txt"), []byte(`{"method": "PUT", "path": "/y", "body": {}}`), 0o644)
	if sent, rem := f.c.Flush(); sent != 0 || rem != 0 || f.rec.n() != 0 {
		t.Fatalf("Flush = %d, %d (requests %d)", sent, rem, f.rec.n())
	}
}
