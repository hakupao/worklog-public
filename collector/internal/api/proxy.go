package api

import (
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/hakupao/worklog/collector/internal/rt"
)

// Environment proxies, as httpx (trust_env, the default) takes them: urllib's
// getproxies_environment for http/https/all/no, turned into URL patterns by httpx's
// get_environment_proxies and matched most specific first (httpx _utils.URLPattern). The
// operating system's own proxy settings (macOS SystemConfiguration, the Windows registry), which
// urllib.getproxies falls back to when no variable is set, are not read (spec §6 D16).

// proxyVar is getproxies_environment()[name]. Lower case wins over upper case on POSIX; on Windows
// os.environ holds upper-case names only. Under CGI (REQUEST_METHOD set) an upper-case HTTP_PROXY
// is ignored (CVE-2016-1000110). env.Getenv cannot tell an empty variable from an unset one, so a
// lower-case variable set to "" does not cancel the upper-case one as it does in Python.
func proxyVar(env *rt.Env, name string) string {
	upper := env.Getenv(strings.ToUpper(name) + "_PROXY")
	cgi := name == "http" && env.Getenv("REQUEST_METHOD") != ""
	if env.GOOS == "windows" {
		if cgi {
			return ""
		}
		return upper
	}
	if lower := env.Getenv(name + "_proxy"); lower != "" {
		return lower
	}
	if cgi {
		return ""
	}
	return upper
}

// urlPattern is httpx's URLPattern, with the proxy its mount points at (nil = go direct).
type urlPattern struct {
	scheme string // "" = any
	host   string // "" = any
	port   int    // 0 = any
	hostRE *regexp.Regexp
	proxy  *url.URL
	err    error // a proxy URL that does not parse
}

func defaultPort(scheme string) int {
	switch scheme {
	case "http", "ws":
		return 80
	case "https", "wss":
		return 443
	case "ftp":
		return 21
	}
	return 0
}

func parsePattern(p string) urlPattern {
	var up urlPattern
	scheme, rest, _ := strings.Cut(p, "://")
	scheme = strings.ToLower(scheme)
	if scheme != "all" {
		up.scheme = scheme
	}
	if i := strings.IndexAny(rest, "/?#"); i >= 0 {
		rest = rest[:i]
	}
	if i := strings.LastIndexByte(rest, '@'); i >= 0 {
		rest = rest[i+1:]
	}
	host := rest
	if strings.HasPrefix(rest, "[") {
		if i := strings.IndexByte(rest, ']'); i >= 0 {
			host = rest[1:i]
			if strings.HasPrefix(rest[i+1:], ":") {
				up.port, _ = strconv.Atoi(rest[i+2:])
			}
		}
	} else if i := strings.LastIndexByte(rest, ':'); i >= 0 {
		host = rest[:i]
		up.port, _ = strconv.Atoi(rest[i+1:])
	}
	if up.port == defaultPort(up.scheme) {
		up.port = 0
	}
	host = strings.ToLower(host)
	if host == "*" {
		host = ""
	}
	up.host = host
	switch {
	case host == "":
	case strings.HasPrefix(host, "*."):
		up.hostRE = regexp.MustCompile(`^.+\.` + regexp.QuoteMeta(host[2:]) + `$`)
	case strings.HasPrefix(host, "*"):
		up.hostRE = regexp.MustCompile(`^(.+\.)?` + regexp.QuoteMeta(host[1:]) + `$`)
	default:
		up.hostRE = regexp.MustCompile(`^` + regexp.QuoteMeta(host) + `$`)
	}
	return up
}

func (up urlPattern) priority() [3]int {
	portPrio := 1
	if up.port != 0 {
		portPrio = 0
	}
	return [3]int{portPrio, -len(up.host), -len(up.scheme)}
}

func (up urlPattern) matches(u *url.URL) bool {
	scheme := strings.ToLower(u.Scheme)
	if up.scheme != "" && up.scheme != scheme {
		return false
	}
	if up.hostRE != nil && !up.hostRE.MatchString(strings.ToLower(u.Hostname())) {
		return false
	}
	if up.port != 0 {
		port, _ := strconv.Atoi(u.Port())
		if port == defaultPort(scheme) {
			port = 0
		}
		if port != up.port {
			return false
		}
	}
	return true
}

// envPatterns is get_environment_proxies(), sorted as httpx sorts its mounts (stable: equal
// priorities keep insertion order; a repeated pattern keeps its first place and its last target).
func envPatterns(env *rt.Env) []urlPattern {
	var keys []string
	mounts := map[string]*string{}
	mount := func(k string, proxy *string) {
		if _, ok := mounts[k]; !ok {
			keys = append(keys, k)
		}
		mounts[k] = proxy
	}
	for _, scheme := range []string{"http", "https", "all"} {
		if v := proxyVar(env, scheme); v != "" {
			if !strings.Contains(v, "://") {
				v = "http://" + v
			}
			mount(scheme+"://", &v)
		}
	}
	for _, h := range strings.Split(proxyVar(env, "no"), ",") {
		h = strings.TrimSpace(h)
		switch {
		case h == "*":
			return nil
		case h == "":
		case strings.Contains(h, "://"):
			mount(h, nil)
		case isIPv4(h):
			mount("all://"+h, nil)
		case isIPv6(h):
			mount("all://["+h+"]", nil)
		case strings.ToLower(h) == "localhost":
			mount("all://"+h, nil)
		default:
			mount("all://*"+h, nil)
		}
	}
	out := make([]urlPattern, 0, len(keys))
	for _, k := range keys {
		up := parsePattern(k)
		if p := mounts[k]; p != nil {
			up.proxy, up.err = url.Parse(*p)
		}
		out = append(out, up)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].priority(), out[j].priority()
		for k := range a {
			if a[k] != b[k] {
				return a[k] < b[k]
			}
		}
		return false
	})
	return out
}

func isIPv4(h string) bool {
	ip := net.ParseIP(strings.SplitN(h, "/", 2)[0])
	return ip != nil && ip.To4() != nil && !strings.Contains(h, ":")
}

func isIPv6(h string) bool {
	ip := net.ParseIP(strings.SplitN(h, "/", 2)[0])
	return ip != nil && strings.Contains(h, ":")
}

// envProxy is the http.Transport.Proxy function for env's proxy variables, read once.
func envProxy(env *rt.Env) func(*http.Request) (*url.URL, error) {
	patterns := envPatterns(env)
	return func(r *http.Request) (*url.URL, error) {
		for _, up := range patterns {
			if up.matches(r.URL) {
				return up.proxy, up.err
			}
		}
		return nil, nil
	}
}
