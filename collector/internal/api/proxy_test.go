package api

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/hakupao/worklog/collector/internal/rt"
)

// proxyOracle is what httpx 0.28.1 picks (Client()._transport_for_url, trust_env on) for each URL
// under each environment, read from the venv on 2026-10-13 with every *_proxy variable cleared
// first. "" = no proxy. (An ALL_PROXY of socks5:// makes httpx.Client() raise ImportError without
// socksio; that crash is not ported.)
var proxyOracle = []struct {
	env    map[string]string
	result map[string]string
}{
	{map[string]string{"HTTPS_PROXY": "proxy.corp:3128"},
		map[string]string{"http://wl.test/api/tasks": "", "https://wl.test/api/tasks": "http://proxy.corp:3128", "https://www.example.com/x": "http://proxy.corp:3128", "https://example.com/x": "http://proxy.corp:3128", "https://wwwexample.com/x": "http://proxy.corp:3128", "http://192.168.0.1/": "", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "http://proxy.corp:3128", "http://LOCALHOST/": ""}},
	{map[string]string{"https_proxy": "http://lower:1", "HTTPS_PROXY": "http://upper:2"},
		map[string]string{"http://wl.test/api/tasks": "", "https://wl.test/api/tasks": "http://lower:1", "https://www.example.com/x": "http://lower:1", "https://example.com/x": "http://lower:1", "https://wwwexample.com/x": "http://lower:1", "http://192.168.0.1/": "", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "http://lower:1", "http://LOCALHOST/": ""}},
	{map[string]string{"HTTP_PROXY": "http://h:1", "ALL_PROXY": "https://a:2"},
		map[string]string{"http://wl.test/api/tasks": "http://h:1", "https://wl.test/api/tasks": "https://a:2", "https://www.example.com/x": "https://a:2", "https://example.com/x": "https://a:2", "https://wwwexample.com/x": "https://a:2", "http://192.168.0.1/": "http://h:1", "http://192.168.0.0/": "http://h:1", "http://localhost:8787/": "http://h:1", "http://[::1]:80/": "http://h:1", "https://wl.test:8443/": "https://a:2", "http://LOCALHOST/": "http://h:1"}},
	{map[string]string{"ALL_PROXY": "http://a:2", "HTTPS_PROXY": "http://s:3"},
		map[string]string{"http://wl.test/api/tasks": "http://a:2", "https://wl.test/api/tasks": "http://s:3", "https://www.example.com/x": "http://s:3", "https://example.com/x": "http://s:3", "https://wwwexample.com/x": "http://s:3", "http://192.168.0.1/": "http://a:2", "http://192.168.0.0/": "http://a:2", "http://localhost:8787/": "http://a:2", "http://[::1]:80/": "http://a:2", "https://wl.test:8443/": "http://s:3", "http://LOCALHOST/": "http://a:2"}},
	{map[string]string{"HTTPS_PROXY": "http://p:1", "NO_PROXY": "example.com"},
		map[string]string{"http://wl.test/api/tasks": "", "https://wl.test/api/tasks": "http://p:1", "https://www.example.com/x": "", "https://example.com/x": "", "https://wwwexample.com/x": "http://p:1", "http://192.168.0.1/": "", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "http://p:1", "http://LOCALHOST/": ""}},
	{map[string]string{"HTTPS_PROXY": "http://p:1", "no_proxy": ".example.com, localhost"},
		map[string]string{"http://wl.test/api/tasks": "", "https://wl.test/api/tasks": "http://p:1", "https://www.example.com/x": "", "https://example.com/x": "http://p:1", "https://wwwexample.com/x": "http://p:1", "http://192.168.0.1/": "", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "http://p:1", "http://LOCALHOST/": ""}},
	{map[string]string{"ALL_PROXY": "http://p:1", "NO_PROXY": "192.168.0.0/16,::1,LOCALHOST"},
		map[string]string{"http://wl.test/api/tasks": "http://p:1", "https://wl.test/api/tasks": "http://p:1", "https://www.example.com/x": "http://p:1", "https://example.com/x": "http://p:1", "https://wwwexample.com/x": "http://p:1", "http://192.168.0.1/": "http://p:1", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "http://p:1", "http://LOCALHOST/": ""}},
	{map[string]string{"ALL_PROXY": "http://p:1", "NO_PROXY": "wl.test,*"},
		map[string]string{"http://wl.test/api/tasks": "", "https://wl.test/api/tasks": "", "https://www.example.com/x": "", "https://example.com/x": "", "https://wwwexample.com/x": "", "http://192.168.0.1/": "", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "", "http://LOCALHOST/": ""}},
	{map[string]string{"ALL_PROXY": "http://p:1", "NO_PROXY": "https://wl.test:8443"},
		map[string]string{"http://wl.test/api/tasks": "http://p:1", "https://wl.test/api/tasks": "http://p:1", "https://www.example.com/x": "http://p:1", "https://example.com/x": "http://p:1", "https://wwwexample.com/x": "http://p:1", "http://192.168.0.1/": "http://p:1", "http://192.168.0.0/": "http://p:1", "http://localhost:8787/": "http://p:1", "http://[::1]:80/": "http://p:1", "https://wl.test:8443/": "", "http://LOCALHOST/": "http://p:1"}},
	{map[string]string{"HTTP_PROXY": "http://h:1", "REQUEST_METHOD": "GET"},
		map[string]string{"http://wl.test/api/tasks": "", "https://wl.test/api/tasks": "", "https://www.example.com/x": "", "https://example.com/x": "", "https://wwwexample.com/x": "", "http://192.168.0.1/": "", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "", "http://LOCALHOST/": ""}},
	{map[string]string{"HTTP_PROXY": "http://h:1", "http_proxy": "http://l:2", "REQUEST_METHOD": "GET"},
		map[string]string{"http://wl.test/api/tasks": "http://l:2", "https://wl.test/api/tasks": "", "https://www.example.com/x": "", "https://example.com/x": "", "https://wwwexample.com/x": "", "http://192.168.0.1/": "http://l:2", "http://192.168.0.0/": "http://l:2", "http://localhost:8787/": "http://l:2", "http://[::1]:80/": "http://l:2", "https://wl.test:8443/": "", "http://LOCALHOST/": "http://l:2"}},
	{map[string]string{"HTTPS_PROXY": "http://user:pw@p:1"},
		map[string]string{"http://wl.test/api/tasks": "", "https://wl.test/api/tasks": "http://p:1", "https://www.example.com/x": "http://p:1", "https://example.com/x": "http://p:1", "https://wwwexample.com/x": "http://p:1", "http://192.168.0.1/": "", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "http://p:1", "http://LOCALHOST/": ""}},
	{map[string]string{"HTTPS_PROXY": "http://p:1", "NO_PROXY": " , wl.test "},
		map[string]string{"http://wl.test/api/tasks": "", "https://wl.test/api/tasks": "", "https://www.example.com/x": "http://p:1", "https://example.com/x": "http://p:1", "https://wwwexample.com/x": "http://p:1", "http://192.168.0.1/": "", "http://192.168.0.0/": "", "http://localhost:8787/": "", "http://[::1]:80/": "", "https://wl.test:8443/": "", "http://LOCALHOST/": ""}},
}

func posixGetenv(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

// windowsGetenv is the Windows environment: names are case-insensitive.
func windowsGetenv(m map[string]string) func(string) string {
	return func(k string) string {
		for n, v := range m {
			if strings.EqualFold(n, k) {
				return v
			}
		}
		return ""
	}
}

func pick(t *testing.T, env *rt.Env, raw string) string {
	t.Helper()
	req, err := http.NewRequest("GET", raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	u, err := envProxy(env)(req)
	if err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	if u == nil {
		return ""
	}
	return u.Scheme + "://" + u.Hostname() + ":" + u.Port()
}

func TestEnvProxyMatchesHTTPX(t *testing.T) {
	for i, c := range proxyOracle {
		env := &rt.Env{Getenv: posixGetenv(c.env), GOOS: "darwin"}
		for raw, want := range c.result {
			if got := pick(t, env, raw); got != want {
				t.Errorf("env %d %v, %s: proxy %q, httpx %q", i, c.env, raw, got, want)
			}
		}
	}
}

// On Windows os.environ holds upper-case names only, so urllib's lower-case pass never runs and
// REQUEST_METHOD drops HTTP_PROXY whatever case it was set in.
func TestEnvProxyOnWindows(t *testing.T) {
	env := &rt.Env{Getenv: windowsGetenv(map[string]string{"http_proxy": "http://l:2", "REQUEST_METHOD": "GET"}), GOOS: "windows"}
	if got := pick(t, env, "http://wl.test/"); got != "" {
		t.Fatalf("proxy %q", got)
	}
	env = &rt.Env{Getenv: windowsGetenv(map[string]string{"https_proxy": "p.corp:8080", "no_proxy": "LOCALHOST"}), GOOS: "windows"}
	if got := pick(t, env, "https://wl.test/"); got != "http://p.corp:8080" {
		t.Fatalf("proxy %q", got)
	}
	if got := pick(t, env, "http://localhost/"); got != "" {
		t.Fatalf("proxy %q", got)
	}
}

func TestNoEnvironmentNoProxy(t *testing.T) {
	env := &rt.Env{Getenv: posixGetenv(nil), GOOS: "darwin"}
	if got := pick(t, env, "https://wl.test/"); got != "" {
		t.Fatalf("proxy %q", got)
	}
}

// End to end: with HTTP_PROXY set, the request goes to the proxy in absolute form, carrying the
// proxy credentials; NO_PROXY sends it straight to the server.
func TestRequestsGoThroughTheEnvironmentProxy(t *testing.T) {
	var proxied *http.Request
	proxy := newFixture(t, func(w http.ResponseWriter, r *http.Request) {
		proxied = r.Clone(r.Context())
		reply(200, `{"id": "x"}`)(w, r)
	})
	pu, _ := url.Parse(proxy.srv.URL)
	pu.User = url.UserPassword("u", "p w")
	vars := map[string]string{"HTTP_PROXY": pu.String()}
	f := newFixture(t, reply(200, `{}`)) // its outbox and stderr only
	f.c = NewClient(ClientConfig{URL: "http://wl.test/", Token: "tok", OutboxDir: f.outbox(), Version: "1"},
		&rt.Env{Stderr: f.stderr, Now: testEnv(nil).Now, Getenv: posixGetenv(vars), GOOS: "darwin"})
	if got := f.c.PutTask(makeTask(), true); got != OK {
		t.Fatalf("PutTask = %q", got)
	}
	if proxied == nil || proxied.RequestURI != "http://wl.test/api/tasks/T20260918-01" {
		t.Fatalf("proxy saw %v", proxied)
	}
	if user, pass, ok := (&http.Request{Header: http.Header{"Authorization": proxied.Header["Proxy-Authorization"]}}).BasicAuth(); !ok || user != "u" || pass != "p w" {
		t.Fatalf("Proxy-Authorization %v", proxied.Header["Proxy-Authorization"])
	}

	// NO_PROXY: the proxy is not asked.
	direct := newFixture(t, reply(200, `{}`))
	before := proxy.rec.n()
	vars = map[string]string{"ALL_PROXY": pu.String(), "NO_PROXY": "127.0.0.1"}
	c := NewClient(ClientConfig{URL: direct.srv.URL, Token: "tok", OutboxDir: direct.outbox(), Version: "1"},
		&rt.Env{Stderr: direct.stderr, Now: testEnv(nil).Now, Getenv: posixGetenv(vars), GOOS: "darwin"})
	if got := c.PutTask(makeTask(), true); got != OK || direct.rec.n() != 1 || proxy.rec.n() != before {
		t.Fatalf("PutTask = %q, direct %d, proxy %d", got, direct.rec.n(), proxy.rec.n()-before)
	}
}
