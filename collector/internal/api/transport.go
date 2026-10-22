package api

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"time"
)

// Timeouts (api_client.py:32, :66): httpx's Timeout(t) is per phase — connecting, each read, each
// write — never a deadline for the whole request, so a slow but steady response does not time out.
const (
	defaultTimeout     = 10 * time.Second // writes, flush, post_judgement
	interactiveTimeout = 4 * time.Second  // every GET helper and create_task
)

// newHTTP is an http.Client that behaves like httpx's on the points the collector depends on
// (spec §4.3, §5.8): every phase bounded by timeout (dial, TLS handshake, response headers, and each
// Read/Write on the connection), no overall deadline, no redirects followed, HTTP/1.1.
//
// One client per timeout, and no keep-alive: a pooled connection would carry the deadline of the
// request that dialed it into the next one.
func newHTTP(timeout time.Duration, proxy func(*http.Request) (*url.URL, error)) *http.Client {
	dialer := &net.Dialer{Timeout: timeout}
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				c, err := dialer.DialContext(ctx, network, addr)
				if err != nil {
					return nil, err
				}
				return &phaseConn{Conn: c, timeout: timeout}, nil
			},
			Proxy:                 proxy,
			TLSHandshakeTimeout:   timeout,
			ResponseHeaderTimeout: timeout,
			DisableKeepAlives:     true,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// phaseConn gives every Read and Write a fresh deadline, as httpx gives each read and write
// operation its own timeout. A Write also moves the read deadline: the transport starts reading
// before the request is written, and that read must not expire during a long upload.
//
// The deadlines read the real clock (time.Now), not rt.Env.Now: they bound real socket I/O, and a
// test's frozen Env clock must not make them expire.
type phaseConn struct {
	net.Conn
	timeout time.Duration
}

func (c *phaseConn) Read(b []byte) (int, error) {
	if err := c.Conn.SetReadDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, err
	}
	return c.Conn.Read(b)
}

func (c *phaseConn) Write(b []byte) (int, error) {
	if err := c.Conn.SetDeadline(time.Now().Add(c.timeout)); err != nil {
		return 0, err
	}
	return c.Conn.Write(b)
}
