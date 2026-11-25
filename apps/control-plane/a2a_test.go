package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"log"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testA2ASecret = "super-secret-easytier-a2a-key-2026"

func buildSignedTestEnvelope(t *testing.T, overrides map[string]any, secret string, now time.Time) []byte {
	t.Helper()
	issuedAt := now.UnixMilli()
	expiresAt := issuedAt + 60_000
	unsigned := map[string]any{
		"protocolVersion":    "a2a.v1",
		"messageId":          "msg-a2a-001",
		"sourceAgentId":      "agent-alpha",
		"targetAgentId":      "agent-beta",
		"sourceEndpoint":     "http://100.64.0.10:3003",
		"targetEndpoint":     "http://100.64.0.20:3003",
		"companyId":          int64(42),
		"delegationDepth":    1,
		"dataClassification": "restricted",
		"fencingToken":       int64(7),
		"issuedAt":           issuedAt,
		"expiresAt":          expiresAt,
		"nonce":              "0123456789abcdef0123456789abcdef",
		"claimedStatus":      "proposed",
		"payload": map[string]any{
			"task":   "verify-build",
			"detail": "a < b & c > d",
		},
	}
	for k, v := range overrides {
		if v == nil {
			delete(unsigned, k)
		} else {
			unsigned[k] = v
		}
	}

	sig, err := ComputeA2ASignature(unsigned, secret)
	if err != nil {
		t.Fatalf("ComputeA2ASignature failed: %v", err)
	}
	unsigned["signature"] = sig

	body, err := CanonicalJSON(unsigned)
	if err != nil {
		t.Fatalf("CanonicalJSON failed: %v", err)
	}
	return body
}

// rewriteRoundTripper keeps the configured private-mesh origin intact at the
// HTTP layer while routing the request to a local httptest receiver.
type rewriteRoundTripper struct {
	target *url.URL
	base   http.RoundTripper
}

func (rt rewriteRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = rt.target.Scheme
	clone.URL.Host = rt.target.Host
	clone.Host = req.Host
	return rt.base.RoundTrip(clone)
}

type a2aTestHarness struct {
	mgr      *A2AManager
	reg      A2APeerRegistration
	leaf     *x509.Certificate
	now      time.Time
	calls    *int32
	handler  http.HandlerFunc
	upstream *httptest.Server
}

// newTestPeerIdentity generates a CA and a leaf signed by that CA, plus the
// leaf SPKI pin and a trust pool.
func newTestPeerIdentity(t *testing.T, now, notBefore, notAfter time.Time) (*x509.Certificate, *x509.Certificate, *x509.CertPool, string) {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(10),
		Subject:               pkix.Name{CommonName: "test-a2a-ca"},
		NotBefore:             now.Add(-24 * time.Hour),
		NotAfter:              now.Add(24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create CA: %v", err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatalf("parse CA: %v", err)
	}
	caPool := x509.NewCertPool()
	caPool.AddCert(caCert)

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(11),
		Subject:      pkix.Name{CommonName: "agent-alpha"},
		NotBefore:    notBefore,
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create leaf: %v", err)
	}
	leaf, err := x509.ParseCertificate(leafDER)
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	pin := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
	return caCert, leaf, caPool, hex.EncodeToString(pin[:])
}

func queuedReceipt(messageID string, now time.Time) A2ADelegateResponse {
	return A2ADelegateResponse{
		Status:          "queued",
		MessageID:       messageID,
		CompanyID:       42,
		DelegationDepth: 1,
		FencingToken:    7,
		ReceivedAt:      now.UTC().Format(time.RFC3339),
	}
}

func newA2ATestHarness(t *testing.T, upstream http.HandlerFunc, now time.Time) *a2aTestHarness {
	t.Helper()
	h := &a2aTestHarness{calls: new(int32), now: now}
	if upstream == nil {
		upstream = func(w http.ResponseWriter, _ *http.Request) {
			atomic.AddInt32(h.calls, 1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(queuedReceipt("msg-a2a-001", now))
		}
	}
	h.handler = upstream
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.handler(w, r)
	}))
	h.upstream = server
	t.Cleanup(server.Close)
	target, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}

	_, leaf, caPool, pin := newTestPeerIdentity(t, now, now.Add(-time.Hour), now.Add(time.Hour))
	reg := A2APeerRegistration{
		PeerID:     "peer-alpha",
		AgentID:    "agent-alpha",
		CompanyID:  42,
		KeyID:      "key-2026-01",
		SPKISHA256: pin,
	}

	mgr := NewA2AManager(testA2ASecret, 42, "http://100.64.0.20:3000")
	mgr.nowFunc = func() time.Time { return now }
	mgr.forwardRetryDelay = 0
	mgr.peerRegistrations = []A2APeerRegistration{reg}
	mgr.peerCA = caPool
	mgr.httpClient = &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport:     rewriteRoundTripper{target: target, base: http.DefaultTransport},
	}
	h.mgr = mgr
	h.reg = reg
	h.leaf = leaf
	return h
}

func (h *a2aTestHarness) request(t *testing.T, body []byte, override func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/a2a/delegate", bytes.NewReader(body))
	req.RemoteAddr = "100.64.0.10:54321"
	req.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{h.leaf}}
	req.Header.Set("X-A2A-Protocol", "a2a.v1")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(a2aKeyIDHeader, h.reg.KeyID)
	if override != nil {
		override(req)
	}
	rec := httptest.NewRecorder()
	h.mgr.HandleDelegate()(rec, req)
	return rec
}

func TestIsPrivateMeshHost(t *testing.T) {
	allowed := []string{
		"10.0.0.5",
		"10.255.255.254:3003",
		"100.64.0.1",
		"100.127.255.254:8080",
		"http://100.64.10.2:3003/a2a/delegate",
		"172.16.0.1",
		"172.31.255.254",
		"192.168.1.10",
		"fd00::1",
		"[fd12:3456::1]:3003",
		"https://[fd00::42]:3003/a2a/delegate",
	}
	for _, host := range allowed {
		if !IsPrivateMeshHost(host) {
			t.Errorf("expected private mesh host %q to be allowed", host)
		}
	}

	denied := []string{
		"",
		"127.0.0.1",
		"127.0.0.1:3003",
		"::1",
		"[::1]:3003",
		"169.254.169.254",
		"8.8.8.8",
		"1.1.1.1:443",
		"100.63.255.255",
		"100.128.0.1",
		"172.15.255.255",
		"172.32.0.1",
		"fe80::1",
		"example.com",
		"https://api.example.com/a2a/delegate",
		"ftp://100.64.0.1/file",
	}
	for _, host := range denied {
		if IsPrivateMeshHost(host) {
			t.Errorf("expected non-mesh host %q to be rejected", host)
		}
	}
}

func TestPrivateMeshCIDRParity(t *testing.T) {
	expected := "10.0.0.0/8,100.64.0.0/10,172.16.0.0/12,192.168.0.0/16,fd00::/8"
	if privateMeshCIDRs != expected {
		t.Fatalf("canonical CIDR list diverged: got %q, want %q", privateMeshCIDRs, expected)
	}
	if len(parsedPrivateMeshCIDRs) != 5 {
		t.Fatalf("expected 5 canonical CIDRs, got %d", len(parsedPrivateMeshCIDRs))
	}
	representatives := []string{"10.1.2.3", "100.64.0.1", "100.127.255.254", "172.16.0.1", "192.168.1.10", "fd00::1", "fdff:ffff::1"}
	for _, ip := range representatives {
		if !IsPrivateMeshHost(ip) {
			t.Errorf("IsPrivateMeshHost rejected canonical address %q", ip)
		}
		if !isBlockedGitHost(ip) {
			t.Errorf("isBlockedGitHost rejected canonical address %q", ip)
		}
	}
	publicAddresses := []string{"8.8.8.8", "100.63.255.255", "100.128.0.1", "172.32.0.1", "192.169.0.1"}
	for _, ip := range publicAddresses {
		if IsPrivateMeshHost(ip) || isBlockedGitHost(ip) {
			t.Errorf("both validators must reject public address %q", ip)
		}
	}
	// The git SSRF filter is intentionally broader than the mesh range list.
	for _, ip := range []string{"fe80::1", "::1", "127.0.0.1"} {
		if IsPrivateMeshHost(ip) {
			t.Errorf("mesh validator must reject non-mesh address %q", ip)
		}
		if !isBlockedGitHost(ip) {
			t.Errorf("git SSRF filter must block non-mesh address %q", ip)
		}
	}
}

func TestNormalizePrivateMeshOrigin(t *testing.T) {
	valid := map[string]string{
		" http://100.64.0.20:3000 ": "http://100.64.0.20:3000",
		"https://[fd00::20]:3000":   "https://[fd00::20]:3000",
	}
	for input, want := range valid {
		got, err := normalizePrivateMeshOrigin(input)
		if err != nil || got != want {
			t.Errorf("normalizePrivateMeshOrigin(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	invalid := []string{
		"",
		"http://8.8.8.8:3000",
		"http://127.0.0.1:3000",
		"http://100.64.0.1:3000/path",
		"http://user@100.64.0.1:3000",
		"ftp://100.64.0.1",
		"http://100.64.0.1?q=1",
		"http://100.64.0.1#frag",
	}
	for _, input := range invalid {
		if got, err := normalizePrivateMeshOrigin(input); err == nil {
			t.Errorf("normalizePrivateMeshOrigin(%q) unexpectedly accepted %q", input, got)
		}
	}
}

func TestA2ADelegateForwardsUnmutatedEnvelope(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	h := newA2ATestHarness(t, nil, now)

	var body []byte
	var header http.Header
	var path string
	h.handler = func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(h.calls, 1)
		body = readAllForTest(r)
		header = r.Header.Clone()
		path = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(queuedReceipt("msg-a2a-001", now))
	}

	envelope := buildSignedTestEnvelope(t, nil, testA2ASecret, now)
	rec := h.request(t, envelope, func(r *http.Request) {
		r.Header.Set("Authorization", "Bearer must-not-be-forwarded")
		r.Header.Set("X-Forwarded-For", "8.8.8.8")
	})
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	var receipt A2ADelegateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &receipt); err != nil {
		t.Fatalf("decode receipt: %v", err)
	}
	if receipt.Status != "queued" || receipt.MessageID != "msg-a2a-001" || receipt.CompanyID != 42 {
		t.Fatalf("unexpected receipt: %+v", receipt)
	}
	if !bytes.Equal(body, envelope) {
		t.Fatalf("envelope body was mutated:\ngot  %s\nwant %s", body, envelope)
	}
	if path != "/a2a/delegate" {
		t.Fatalf("expected upstream path /a2a/delegate, got %q", path)
	}
	if header.Get("X-A2A-Protocol") != "a2a.v1" || header.Get("Content-Type") != "application/json" {
		t.Fatalf("signed protocol/header not preserved: %v", header)
	}
	if header.Get(a2aKeyIDHeader) != h.reg.KeyID {
		t.Fatalf("key-id header not preserved: %q", header.Get(a2aKeyIDHeader))
	}
	if header.Get("Authorization") != "" || header.Get("X-Forwarded-For") != "" {
		t.Fatalf("credential or forwarded identity header leaked upstream: %v", header)
	}
	if got := atomic.LoadInt32(h.calls); got != 1 {
		t.Fatalf("expected 1 upstream call, got %d", got)
	}
}

func readAllForTest(r *http.Request) []byte {
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r.Body)
	return buf.Bytes()
}

func TestA2ADelegateRejectsRedirect(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	h := newA2ATestHarness(t, nil, now)
	h.handler = func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(h.calls, 1)
		http.Redirect(w, r, "http://8.8.8.8/a2a/delegate", http.StatusFound)
	}
	rec := h.request(t, buildSignedTestEnvelope(t, nil, testA2ASecret, now), nil)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on redirect, got %d: %s", rec.Code, rec.Body.String())
	}
	assertA2AError(t, rec, "UPSTREAM_REDIRECT_REJECTED")
	if strings.Contains(strings.ToLower(rec.Body.String()), "queued") {
		t.Fatalf("redirect failure must not claim queued: %s", rec.Body.String())
	}
}

func TestA2ADelegateForwardTimeout(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	h := newA2ATestHarness(t, nil, now)
	h.mgr.forwardTimeout = 40 * time.Millisecond
	h.mgr.forwardAttempts = 1
	h.handler = func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(h.calls, 1)
		// Outlive the forward deadline, but release the connection so the
		// httptest server can shut down cleanly.
		time.Sleep(200 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(queuedReceipt("msg-a2a-001", now))
	}
	rec := h.request(t, buildSignedTestEnvelope(t, nil, testA2ASecret, now), nil)
	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504 on timeout, got %d: %s", rec.Code, rec.Body.String())
	}
	assertA2AError(t, rec, "UPSTREAM_UNAVAILABLE")
	if strings.Contains(strings.ToLower(rec.Body.String()), "queued") {
		t.Fatalf("timeout failure must not claim queued: %s", rec.Body.String())
	}
}

func TestA2ADelegateUpstreamRejection(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	h := newA2ATestHarness(t, nil, now)
	h.handler = func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(h.calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(A2AErrorResponse{Error: "nonce already seen", ReasonCode: "REPLAY_NONCE_DETECTED"})
	}
	rec := h.request(t, buildSignedTestEnvelope(t, nil, testA2ASecret, now), nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 from upstream, got %d: %s", rec.Code, rec.Body.String())
	}
	assertA2AError(t, rec, "REPLAY_NONCE_DETECTED")
	if strings.Contains(strings.ToLower(rec.Body.String()), "queued") {
		t.Fatalf("upstream rejection must not claim queued: %s", rec.Body.String())
	}
}

func TestA2ADelegateRetryIsBounded(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)

	t.Run("transient 503 retried once then succeeds", func(t *testing.T) {
		h := newA2ATestHarness(t, nil, now)
		h.handler = func(w http.ResponseWriter, r *http.Request) {
			if atomic.AddInt32(h.calls, 1) == 1 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(queuedReceipt("msg-a2a-001", now))
		}
		rec := h.request(t, buildSignedTestEnvelope(t, nil, testA2ASecret, now), nil)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("expected 202 after retry, got %d: %s", rec.Code, rec.Body.String())
		}
		if got := atomic.LoadInt32(h.calls); got != 2 {
			t.Fatalf("expected exactly 2 attempts, got %d", got)
		}
	})

	t.Run("409 is not retried", func(t *testing.T) {
		h := newA2ATestHarness(t, nil, now)
		h.handler = func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(h.calls, 1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(A2AErrorResponse{Error: "duplicate", ReasonCode: "REPLAY_NONCE_DETECTED"})
		}
		rec := h.request(t, buildSignedTestEnvelope(t, nil, testA2ASecret, now), nil)
		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
		}
		if got := atomic.LoadInt32(h.calls); got != 1 {
			t.Fatalf("4xx must not be retried; got %d attempts", got)
		}
	})
}

func TestA2ADelegateDoesNotKeepLocalReplayAuthority(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	h := newA2ATestHarness(t, nil, now)
	envelope := buildSignedTestEnvelope(t, nil, testA2ASecret, now)

	first := h.request(t, envelope, nil)
	if first.Code != http.StatusAccepted {
		t.Fatalf("first delegation: expected 202, got %d: %s", first.Code, first.Body.String())
	}
	h.handler = func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(h.calls, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(A2AErrorResponse{Error: "duplicate", ReasonCode: "REPLAY_NONCE_DETECTED"})
	}
	second := h.request(t, envelope, nil)
	if second.Code != http.StatusConflict {
		t.Fatalf("replayed delegation must be rejected by upstream, got %d: %s", second.Code, second.Body.String())
	}
	if got := atomic.LoadInt32(h.calls); got != 2 {
		t.Fatalf("both envelopes must reach the durable receiver, got %d calls", got)
	}
}

func TestA2ATransportPeerIdentity(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	envelope := buildSignedTestEnvelope(t, nil, testA2ASecret, now)

	t.Run("missing certificate cannot be replaced by forwarded headers", func(t *testing.T) {
		h := newA2ATestHarness(t, nil, now)
		rec := h.request(t, envelope, func(r *http.Request) {
			r.TLS = nil
			r.Header.Set("X-Forwarded-Client-Cert", h.reg.SPKISHA256)
			r.Header.Set("X-Client-Cert", h.reg.SPKISHA256)
			r.Header.Set("X-Forwarded-For", "100.64.0.10")
		})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
		}
		assertA2AError(t, rec, "PEER_CERT_MISSING")
		if got := atomic.LoadInt32(h.calls); got != 0 {
			t.Fatalf("unauthenticated request was forwarded %d times", got)
		}
	})

	t.Run("expired certificate rejected", func(t *testing.T) {
		h := newA2ATestHarness(t, nil, now)
		_, leaf, _, _ := newTestPeerIdentity(t, now, now.Add(-2*time.Hour), now.Add(-time.Hour))
		rec := h.request(t, envelope, func(r *http.Request) {
			r.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{leaf}}
		})
		assertA2AError(t, rec, "PEER_CERT_EXPIRED")
	})

	t.Run("untrusted certificate rejected", func(t *testing.T) {
		h := newA2ATestHarness(t, nil, now)
		_, leaf, _, _ := newTestPeerIdentity(t, now, now.Add(-time.Hour), now.Add(time.Hour))
		rec := h.request(t, envelope, func(r *http.Request) {
			r.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{leaf}}
		})
		assertA2AError(t, rec, "PEER_CERT_UNTRUSTED")
	})

	t.Run("wrong agent rejected", func(t *testing.T) {
		h := newA2ATestHarness(t, nil, now)
		other := buildSignedTestEnvelope(t, map[string]any{"sourceAgentId": "agent-other"}, testA2ASecret, now)
		rec := h.request(t, other, nil)
		assertA2AError(t, rec, "PEER_IDENTITY_MISMATCH")
	})

	t.Run("wrong key id rejected", func(t *testing.T) {
		h := newA2ATestHarness(t, nil, now)
		rec := h.request(t, envelope, func(r *http.Request) {
			r.Header.Set(a2aKeyIDHeader, "key-rotated-out")
		})
		assertA2AError(t, rec, "PEER_KEY_MISMATCH")
	})

	t.Run("registered peer accepted", func(t *testing.T) {
		h := newA2ATestHarness(t, nil, now)
		rec := h.request(t, envelope, nil)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

func TestA2APeerCertificateRotationAndRevocation(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	envelope := buildSignedTestEnvelope(t, nil, testA2ASecret, now)
	h := newA2ATestHarness(t, nil, now)

	oldCA, oldLeaf, _, oldPin := newTestPeerIdentity(t, now, now.Add(-time.Hour), now.Add(time.Hour))
	newCA, newLeaf, _, newPin := newTestPeerIdentity(t, now, now.Add(-time.Hour), now.Add(time.Hour))
	pool := x509.NewCertPool()
	pool.AddCert(oldCA)
	pool.AddCert(newCA)
	h.mgr.peerCA = pool
	oldReg := A2APeerRegistration{PeerID: "peer-alpha", AgentID: "agent-alpha", CompanyID: 42, KeyID: "key-old", SPKISHA256: oldPin}
	newReg := A2APeerRegistration{PeerID: "peer-alpha", AgentID: "agent-alpha", CompanyID: 42, KeyID: "key-new", SPKISHA256: newPin}
	h.mgr.peerRegistrations = []A2APeerRegistration{oldReg, newReg}

	withCert := func(cert *x509.Certificate, keyID string) func(*http.Request) {
		return func(r *http.Request) {
			r.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}
			r.Header.Set(a2aKeyIDHeader, keyID)
		}
	}

	for _, tc := range []struct {
		name string
		cert *x509.Certificate
		key  string
	}{
		{"old key during overlap", oldLeaf, "key-old"},
		{"new key during overlap", newLeaf, "key-new"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := h.request(t, envelope, withCert(tc.cert, tc.key))
			if rec.Code != http.StatusAccepted {
				t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}

	// Removing the old registration retires it deterministically.
	h.mgr.peerRegistrations = []A2APeerRegistration{newReg}
	rec := h.request(t, envelope, withCert(oldLeaf, "key-old"))
	assertA2AError(t, rec, "PEER_IDENTITY_MISMATCH")
	rec = h.request(t, envelope, withCert(newLeaf, "key-new"))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("new key must remain valid after old-key revocation, got %d: %s", rec.Code, rec.Body.String())
	}
}

func assertA2AError(t *testing.T, rec *httptest.ResponseRecorder, reasonCode string) {
	t.Helper()
	var errResp A2AErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("decode error response: %v (%s)", err, rec.Body.String())
	}
	if errResp.ReasonCode != reasonCode {
		t.Fatalf("expected reasonCode %q, got %q (status %d, body %s)", reasonCode, errResp.ReasonCode, rec.Code, rec.Body.String())
	}
	if strings.Contains(errResp.Error, testA2ASecret) {
		t.Fatal("response leaked signing secret")
	}
}

func TestA2ADelegateSecurityRejections(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		remoteAddr string
		overrides  map[string]any
		signSecret string
		wantStatus int
		wantCode   string
	}{
		{
			name:       "rejects public source IP",
			remoteAddr: "8.8.8.8:12345",
			signSecret: testA2ASecret,
			wantStatus: http.StatusForbidden,
			wantCode:   "PUBLIC_ENDPOINT_FORBIDDEN",
		},
		{
			name:       "rejects loopback source IP",
			remoteAddr: "127.0.0.1:12345",
			signSecret: testA2ASecret,
			wantStatus: http.StatusForbidden,
			wantCode:   "PUBLIC_ENDPOINT_FORBIDDEN",
		},
		{
			name:       "rejects self-acceptance claim",
			remoteAddr: "100.64.0.10:12345",
			overrides:  map[string]any{"claimedStatus": "accepted"},
			signSecret: testA2ASecret,
			wantStatus: http.StatusForbidden,
			wantCode:   "SERVER_ONLY_ACCEPTED_AUTHORITY",
		},
		{
			name:       "rejects delegation depth > 3",
			remoteAddr: "100.64.0.10:12345",
			overrides:  map[string]any{"delegationDepth": 4},
			signSecret: testA2ASecret,
			wantStatus: http.StatusForbidden,
			wantCode:   "DELEGATION_DEPTH_EXCEEDED",
		},
		{
			name:       "rejects companyId <= 0",
			remoteAddr: "100.64.0.10:12345",
			overrides:  map[string]any{"companyId": int64(0)},
			signSecret: testA2ASecret,
			wantStatus: http.StatusForbidden,
			wantCode:   "COMPANY_ISOLATION_VIOLATION",
		},
		{
			name:       "rejects cross-company mismatch",
			remoteAddr: "100.64.0.10:12345",
			overrides:  map[string]any{"companyId": int64(99)},
			signSecret: testA2ASecret,
			wantStatus: http.StatusForbidden,
			wantCode:   "COMPANY_ISOLATION_VIOLATION",
		},
		{
			name:       "rejects expired TTL",
			remoteAddr: "100.64.0.10:12345",
			overrides: map[string]any{
				"issuedAt":  now.Add(-2 * time.Minute).UnixMilli(),
				"expiresAt": now.Add(-1 * time.Minute).UnixMilli(),
			},
			signSecret: testA2ASecret,
			wantStatus: http.StatusUnauthorized,
			wantCode:   "ENVELOPE_EXPIRED",
		},
		{
			name:       "rejects invalid signature",
			remoteAddr: "100.64.0.10:12345",
			signSecret: "wrong-secret-that-is-at-least-16-chars",
			wantStatus: http.StatusUnauthorized,
			wantCode:   "INVALID_SIGNATURE",
		},
		{
			name:       "rejects invalid data classification",
			remoteAddr: "100.64.0.10:12345",
			overrides:  map[string]any{"dataClassification": "public_unclassified"},
			signSecret: testA2ASecret,
			wantStatus: http.StatusForbidden,
			wantCode:   "CLASSIFICATION_VIOLATION",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newA2ATestHarness(t, nil, now)
			body := buildSignedTestEnvelope(t, tc.overrides, tc.signSecret, now)
			rec := h.request(t, body, func(r *http.Request) { r.RemoteAddr = tc.remoteAddr })
			if rec.Code != tc.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", tc.wantStatus, rec.Code, rec.Body.String())
			}
			assertA2AError(t, rec, tc.wantCode)
			if got := atomic.LoadInt32(h.calls); got != 0 {
				t.Fatalf("rejected envelope was forwarded %d times", got)
			}
		})
	}
}

func TestA2AMethodNotAllowed(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	h := newA2ATestHarness(t, nil, now)
	req := httptest.NewRequest(http.MethodGet, "/a2a/delegate", nil)
	rec := httptest.NewRecorder()
	h.mgr.HandleDelegate()(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestA2ADelegateLogSanitizationStripsNewlines(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	h := newA2ATestHarness(t, nil, now)

	var logBuf bytes.Buffer
	origOut := log.Writer()
	log.SetOutput(&logBuf)
	t.Cleanup(func() { log.SetOutput(origOut) })

	// 1) Rejection path with newline injection attempt in RemoteAddr.
	body := buildSignedTestEnvelope(t, nil, testA2ASecret, now)
	rec := h.request(t, body, func(r *http.Request) {
		r.RemoteAddr = "203.0.113.5:1234\r\nforged=log\nentry"
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}

	// 2) Forward failure path with newline injection attempt in MessageID.
	hFail := newA2ATestHarness(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(A2AErrorResponse{Error: "bad", ReasonCode: "INVALID_ENVELOPE"})
	}, now)
	injectedID := "msg-1\r\nFAKE_AUDIT=true"
	body2 := buildSignedTestEnvelope(t, map[string]any{"messageId": injectedID}, testA2ASecret, now)
	rec2 := hFail.request(t, body2, nil)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec2.Code)
	}

	logged := logBuf.String()
	lines := strings.Split(strings.TrimSpace(logged), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected exactly 2 log lines (no injected newlines), got %d:\n%s", len(lines), logged)
	}
	if strings.Contains(logged, "\r") {
		t.Fatalf("log output contained carriage return: %q", logged)
	}
}
