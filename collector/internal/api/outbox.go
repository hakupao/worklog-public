package api

import (
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/hakupao/worklog/collector/internal/py/pyjson"
	"github.com/hakupao/worklog/collector/internal/py/pypath"
)

// The outbox (api_client.py:125-246, spec §4.4): {home}/outbox/*.json is the queue,
// {home}/outbox/rejected/*.json a record that is never replayed. Each file is
// {"method", "path", "body"} as json.dumps(..., ensure_ascii=False) writes it.

// rejectedDir is outbox/rejected, created best-effort.
func (c *Client) rejectedDir() string {
	dir := filepath.Join(c.outbox, "rejected")
	_ = os.MkdirAll(dir, 0o777)
	return dir
}

// parkName is a file name that both orders the record and cannot be taken twice. flush replays
// the names sorted, and ingest UPSERTs by session id, so the same session parked twice must replay
// oldest first. The nanosecond stamp gives the order but not uniqueness (Windows' clock ticks every
// ~15 ms), so it is forced upwards past this process's last one; the random tail keeps two
// processes that read the same tick apart; the zero-padding makes name order number order.
func (c *Client) parkName() string {
	c.mu.Lock()
	stamp := c.env.Now().UnixNano()
	if stamp <= c.lastPark {
		stamp = c.lastPark + 1
	}
	c.lastPark = stamp
	c.mu.Unlock()
	var tail [3]byte
	_, _ = rand.Read(tail[:])
	return fmt.Sprintf("%019d-%06x.json", stamp, int(tail[0])<<16|int(tail[1])<<8|int(tail[2]))
}

// park writes the request to the outbox (to rejected/ when rejected). False means the record is
// nowhere, and the caller must say so.
func (c *Client) park(method, path string, body pyjson.Value, rejected bool) bool {
	target := c.outbox
	if rejected {
		target = c.rejectedDir()
	}
	payload := pyjson.NewObject()
	payload.Set("method", method)
	payload.Set("path", path)
	payload.Set("body", body)
	err := os.MkdirAll(target, 0o777)
	if err == nil {
		err = os.WriteFile(filepath.Join(target, c.parkName()), pyjson.Dumps(payload, pyjson.Unicode()), 0o666)
	}
	if err != nil {
		c.env.Warnf("worklog: could not write outbox (%v); record not queued", err)
		return false
	}
	return true
}

// queued is sorted(outbox.glob("*.json")): the files directly in the outbox, in path order
// (pathlib's: case-insensitive on Windows, where the glob also matches case-insensitively).
func (c *Client) queued() ([]string, bool) {
	ents, err := os.ReadDir(c.outbox)
	if err != nil {
		return nil, false
	}
	fl := pypath.HostFlavour(c.env.GOOS)
	var names []string
	for _, e := range ents {
		n := e.Name()
		if strings.HasSuffix(n, ".json") || fl == pypath.Windows && strings.HasSuffix(strings.ToLower(n), ".json") {
			names = append(names, n)
		}
	}
	sort.SliceStable(names, func(i, j int) bool { return fl.Less(names[i], names[j]) })
	return names, true
}

// item is one parsed outbox file; false for a file flush must set aside: unreadable, not JSON,
// missing a key, or (spec §6 D14, where Python raises TypeError out of flush) JSON that is not an
// object or whose method/path is not a string.
func (c *Client) item(name string) (method, path string, body pyjson.Value, ok bool) {
	data, err := os.ReadFile(filepath.Join(c.outbox, name))
	if err != nil {
		return "", "", nil, false
	}
	v, err := pyjson.Decode(data)
	if err != nil {
		return "", "", nil, false
	}
	o, isObj := v.(*pyjson.Object)
	if !isObj {
		return "", "", nil, false
	}
	m, okM := o.Get("method")
	p, okP := o.Get("path")
	b, okB := o.Get("body")
	ms, isStrM := m.(string)
	ps, isStrP := p.(string)
	if !okM || !okP || !okB || !isStrM || !isStrP {
		return "", "", nil, false
	}
	return ms, ps, b, true
}

// Flush replays the outbox oldest first. It stops at the first retry and returns how many were
// sent and how many remain; rejected and unreadable files move to rejected/ and are not counted.
// With the breaker open nothing is sent.
func (c *Client) Flush() (sent, remaining int) {
	if fi, err := os.Stat(c.outbox); err != nil || !fi.IsDir() {
		return 0, 0
	}
	names, ok := c.queued()
	if !ok {
		return 0, 0
	}
	if c.isOffline() {
		return 0, len(names)
	}
	src := func(n string) string { return filepath.Join(c.outbox, n) }
	for i, name := range names {
		method, path, body, ok := c.item(name)
		if !ok {
			if err := c.rename(src(name), filepath.Join(c.rejectedDir(), name)); err != nil {
				c.env.Warnf("worklog: could not set aside unreadable outbox file %s (%v)", name, err)
			}
			continue
		}
		if body == nil {
			// json=None: httpx sends no body at all.
			body = noBody{}
		}
		out, _ := c.try(method, path, body)
		switch out {
		case Retry:
			return sent, len(names) - i
		case Rejected:
			if err := c.rename(src(name), filepath.Join(c.rejectedDir(), name)); err != nil {
				c.env.Warnf("worklog: could not move rejected %s out of the outbox (%v); it will be retried", name, err)
			}
		default:
			if err := c.remove(src(name)); err != nil {
				c.env.Warnf("worklog: sent %s but could not remove it from the outbox (%v); it will be re-sent", name, err)
			}
			sent++
		}
	}
	return sent, 0
}
