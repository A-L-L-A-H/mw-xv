package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	a2aProtocolVersion    = "a2a.v1"
	maxA2ADelegationDepth = 3
	maxA2ATTLMs           = 300_000
	defaultA2AClockSkewMs = 30_000
	maxA2ABodyBytes       = 1 << 20 // 1 MiB

	a2aKeyIDHeader        = "X-A2A-Key-ID"
	defaultA2AForwardMS   = 5_000
	maxA2AForwardMS       = 30_000
	defaultA2AForwardTries = 2
	maxA2AForwardTries    = 2
	maxA2AErrorBodyBytes  = 64 << 10
)

// privateMeshCIDRs is the single canonical Go declaration of the private mesh
// address space. It mirrors PRIVATE_MESH_CIDRS exported by
// packages/ai-runtime/src/a2a-protocol.ts. Any change here must be mirrored in
// the TypeScript export and verified by TestPrivateMeshCIDRParity.
const privateMeshCIDRs = "10.0.0.0/8,100.64.0.0/10,172.16.0.0/12,192.168.0.0/16,fd00::/8"

var parsedPrivateMeshCIDRs = mustParsePrivateMeshCIDRs(privateMeshCIDRs)

func mustParsePrivateMeshCIDRs(list string) []*net.IPNet {
	var out []*net.IPNet
	for _, entry := range strings.Split(list, ",") {
		_, network, err := net.ParseCIDR(strings.TrimSpace(entry))
		if err != nil {
			panic("invalid canonical private mesh CIDR: " + entry)
		}
		out = append(out, network)
	}
	return out
}

// IsPrivateMeshIP reports whether ip belongs to the canonical private mesh
// range list. Both A2A admission and git SSRF protection use this one list.
func IsPrivateMeshIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, network := range parsedPrivateMeshCIDRs {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// A2AEnvelope mirrors SignedA2AEnvelope in packages/ai-runtime/src/a2a-protocol.ts.
type A2AEnvelope struct {
	ProtocolVersion    string         `json:"protocolVersion"`
	MessageID          string         `json:"messageId"`
	SourceAgentID      string         `json:"sourceAgentId"`
	TargetAgentID      string         `json:"targetAgentId"`
	SourceEndpoint     string         `json:"sourceEndpoint,omitempty"`
	TargetEndpoint     string         `json:"targetEndpoint"`
	CompanyID          int64          `json:"companyId"`
	DelegationDepth    int            `json:"delegationDepth"`
	DataClassification string         `json:"dataClassification"`
	FencingToken       int64          `json:"fencingToken"`
	IssuedAt           int64          `json:"issuedAt"`
	ExpiresAt          int64          `json:"expiresAt"`
	Nonce              string         `json:"nonce"`
	ClaimedStatus      string         `json:"claimedStatus,omitempty"`
	Payload            map[string]any `json:"payload"`
	Signature          string         `json:"signature"`
}

// A2ADelegateResponse is returned by POST /a2a/delegate on success. The
// Control Plane only relays the upstream durable receiver's receipt.
type A2ADelegateResponse struct {
	Status          string `json:"status"`
	MessageID       string `json:"messageId"`
	CompanyID       int64  `json:"companyId"`
	DelegationDepth int    `json:"delegationDepth"`
	FencingToken    int64  `json:"fencingToken"`
	ReceivedAt      string `json:"receivedAt"`
}

// A2AErrorResponse is returned by POST /a2a/delegate on failure.
type A2AErrorResponse struct {
	Error      string `json:"error"`
	ReasonCode string `json:"reasonCode"`
}

// A2APeerRegistration binds a verified mesh transport identity (mTLS client
// certificate SPKI pin) to a registered A2A peer/agent key identity. This is
// the Go-side mirror of the canonical peer registry owned by @moonwitness/orm-a2a.
type A2APeerRegistration struct {
	PeerID     string `json:"peerId"`
	AgentID    string `json:"agentId"`
	CompanyID  int64  `json:"companyId"`
	KeyID      string `json:"keyId"`
	SPKISHA256 string `json:"spkiSha256"`
}

// A2AManager is a thin, fail-closed forwarder. Replay detection, fencing,
// persistence and receipt authority live only in the durable API receiver.
type A2AManager struct {
	signingSecret     string
	expectedCompanyID int64
	forwardOrigin     string // canonical private-mesh origin, e.g. http://100.64.0.20:3000
	forwardTimeout    time.Duration
	forwardAttempts   int
	forwardRetryDelay time.Duration
	httpClient        *http.Client
	peerRegistrations []A2APeerRegistration
	peerCA            *x509.CertPool
	nowFunc           func() time.Time
}

// NewA2AManager creates an A2AManager with explicit configuration. An empty
// forwardOrigin leaves the forwarder disabled (all requests fail closed).
func NewA2AManager(signingSecret string, expectedCompanyID int64, forwardOrigin string) *A2AManager {
	origin, err := normalizePrivateMeshOrigin(forwardOrigin)
	if err != nil {
		origin = ""
	}
	timeout := defaultA2AForwardMS * time.Millisecond
	return &A2AManager{
		signingSecret:     strings.TrimSpace(signingSecret),
		expectedCompanyID: expectedCompanyID,
		forwardOrigin:     origin,
		forwardTimeout:    timeout,
		forwardAttempts:   defaultA2AForwardTries,
		forwardRetryDelay: 25 * time.Millisecond,
		httpClient:        newA2AForwardHTTPClient(timeout),
		nowFunc:           time.Now,
	}
}

// NewA2AManagerFromEnv creates an A2AManager from environment configuration.
// Required settings: MW_A2A_SIGNING_SECRET, MW_A2A_COMPANY_ID,
// MW_A2A_FORWARD_ORIGIN, MW_A2A_PEER_REGISTRY_JSON and a peer CA. Missing or
// invalid settings do not enable local authority; they leave forwarding or
// peer verification disabled so every request is rejected.
func NewA2AManagerFromEnv() *A2AManager {
	secret := strings.TrimSpace(os.Getenv("MW_A2A_SIGNING_SECRET"))
	var companyID int64
	if raw := strings.TrimSpace(os.Getenv("MW_A2A_COMPANY_ID")); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			companyID = parsed
		}
	}

	timeout := boundedA2ATimeout(os.Getenv("MW_A2A_FORWARD_TIMEOUT_MS"))
	attempts := boundedA2AAttempts(os.Getenv("MW_A2A_FORWARD_MAX_ATTEMPTS"))
	mgr := NewA2AManager(secret, companyID, os.Getenv("MW_A2A_FORWARD_ORIGIN"))
	mgr.forwardTimeout = timeout
	mgr.forwardAttempts = attempts
	mgr.httpClient = newA2AForwardHTTPClient(timeout)
	mgr.peerRegistrations = parseA2APeerRegistrations(os.Getenv("MW_A2A_PEER_REGISTRY_JSON"))
	mgr.peerCA = loadA2APeerCA(os.Getenv("MW_A2A_PEER_CA_PEM"), os.Getenv("MW_A2A_PEER_CA_FILE"))
	return mgr
}

func boundedA2ATimeout(raw string) time.Duration {
	value := strings.TrimSpace(raw)
	if value == "" {
		return defaultA2AForwardMS * time.Millisecond
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 100 || parsed > maxA2AForwardMS {
		return defaultA2AForwardMS * time.Millisecond
	}
	return time.Duration(parsed) * time.Millisecond
}

func boundedA2AAttempts(raw string) int {
	value := strings.TrimSpace(raw)
	if value == "" {
		return defaultA2AForwardTries
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 || parsed > maxA2AForwardTries {
		return defaultA2AForwardTries
	}
	return parsed
}

// normalizePrivateMeshOrigin accepts only an http(s) origin with a private
// mesh IP literal host, no credentials, no path, no query and no fragment.
func normalizePrivateMeshOrigin(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("forward origin is required")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("invalid forward origin")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("forward origin must use http or https")
	}
	if parsed.User != nil {
		return "", errors.New("forward origin must not contain credentials")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", errors.New("forward origin must not contain a path")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("forward origin must not contain a query or fragment")
	}
	if !IsPrivateMeshHost(parsed.Hostname()) {
		return "", errors.New("forward origin must be a private mesh IP")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func newA2AForwardHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy: nil, // never route a private-mesh forward through an ambient proxy
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil || !IsPrivateMeshIP(net.ParseIP(host)) {
				return nil, errors.New("a2a forward target is not a private mesh IP")
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(host, port))
		},
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   timeout,
		ResponseHeaderTimeout: timeout,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse // redirects are never followed
		},
	}
}

func parseA2APeerRegistrations(raw string) []A2APeerRegistration {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	var registrations []A2APeerRegistration
	if err := json.Unmarshal([]byte(trimmed), &registrations); err != nil {
		log.Print("a2a peer registry is invalid; all peer authentication will fail closed")
		return nil
	}
	out := registrations[:0]
	for _, reg := range registrations {
		reg.PeerID = strings.TrimSpace(reg.PeerID)
		reg.AgentID = strings.TrimSpace(reg.AgentID)
		reg.KeyID = strings.TrimSpace(reg.KeyID)
		reg.SPKISHA256 = strings.ToLower(strings.TrimSpace(reg.SPKISHA256))
		if reg.PeerID == "" || reg.AgentID == "" || reg.CompanyID <= 0 || reg.KeyID == "" || reg.SPKISHA256 == "" {
			continue
		}
		out = append(out, reg)
	}
	return out
}

func loadA2APeerCA(inlinePEM, caFile string) *x509.CertPool {
	pemData := strings.TrimSpace(inlinePEM)
	if path := strings.TrimSpace(caFile); path != "" {
		if data, err := os.ReadFile(path); err == nil {
			pemData = string(data)
		} else {
			log.Print("a2a peer CA file could not be read; all peer authentication will fail closed")
			return nil
		}
	}
	if pemData == "" {
		return nil
	}
	pemData = strings.ReplaceAll(pemData, `\n`, "\n")
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(pemData)) {
		log.Print("a2a peer CA is invalid; all peer authentication will fail closed")
		return nil
	}
	return pool
}

// IsPrivateMeshHost returns true only for private EasyTier P2P mesh IP ranges:
// 10.0.0.0/8, 100.64.0.0/10, 172.16.0.0/12, 192.168.0.0/16, and fd00::/8.
// The ranges come from the single canonical privateMeshCIDRs declaration.
func IsPrivateMeshHost(hostOrURL string) bool {
	trimmed := strings.TrimSpace(hostOrURL)
	if trimmed == "" {
		return false
	}

	host := trimmed
	if strings.Contains(trimmed, "://") {
		parsed, err := url.Parse(trimmed)
		if err != nil {
			return false
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return false
		}
		host = parsed.Hostname()
	} else {
		if h, _, err := net.SplitHostPort(trimmed); err == nil {
			host = h
		}
	}

	host = strings.TrimPrefix(host, "[")
	host = strings.TrimSuffix(host, "]")
	if host == "" || strings.Contains(host, "%") {
		return false
	}
	return IsPrivateMeshIP(net.ParseIP(host))
}

// CanonicalJSON marshals v into compact JSON with lexicographically sorted object keys
// and HTML escaping disabled, matching TypeScript JSON.stringify(canonicalizeValue(v)).
func CanonicalJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	out := bytes.TrimSuffix(buf.Bytes(), []byte("\n"))
	return out, nil
}

// ComputeA2ASignature computes the wire-compatible HMAC-SHA256 hex digest over
// the canonical JSON representation of the unsigned envelope map.
func ComputeA2ASignature(unsigned map[string]any, signingSecret string) (string, error) {
	canonical, err := CanonicalJSON(unsigned)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, []byte(signingSecret))
	mac.Write(canonical)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// RedactA2ASecret removes any occurrence of the A2A signing secret and mesh secret patterns.
func RedactA2ASecret(text, secret string) string {
	return RedactMeshSecret(text, secret)
}

func isValidA2AClassification(c string) bool {
	switch c {
	case "local_only", "cloud_eligible", "restricted":
		return true
	default:
		return false
	}
}

type a2aReject struct {
	status     int
	reasonCode string
	message    string
}

// verifyRequest validates the signed envelope only. It deliberately does not
// check replay nonces or fencing tokens: the durable API receiver is the sole
// authority for those values.
func (m *A2AManager) verifyRequest(rawBody []byte, remoteAddr string) (*A2AEnvelope, *a2aReject) {
	if len(strings.TrimSpace(m.signingSecret)) < 16 {
		return nil, &a2aReject{
			status:     http.StatusUnauthorized,
			reasonCode: "INVALID_SECRET",
			message:    "A2A verification secret must be at least 16 characters.",
		}
	}

	if !IsPrivateMeshHost(remoteAddr) {
		return nil, &a2aReject{
			status:     http.StatusForbidden,
			reasonCode: "PUBLIC_ENDPOINT_FORBIDDEN",
			message:    "A2A delegation requests must originate from a private EasyTier mesh IP.",
		}
	}

	var env A2AEnvelope
	if err := json.Unmarshal(rawBody, &env); err != nil {
		return nil, &a2aReject{
			status:     http.StatusBadRequest,
			reasonCode: "INVALID_ENVELOPE",
			message:    "Malformed A2A envelope JSON.",
		}
	}

	if env.ProtocolVersion != a2aProtocolVersion {
		return nil, &a2aReject{
			status:     http.StatusBadRequest,
			reasonCode: "INVALID_PROTOCOL_VERSION",
			message:    "Unsupported A2A protocol version.",
		}
	}

	if !isValidA2AClassification(env.DataClassification) {
		return nil, &a2aReject{
			status:     http.StatusForbidden,
			reasonCode: "CLASSIFICATION_VIOLATION",
			message:    "Unsupported data classification for A2A delegation.",
		}
	}

	if !IsPrivateMeshHost(env.TargetEndpoint) {
		if env.DataClassification == "restricted" || env.DataClassification == "local_only" {
			return nil, &a2aReject{
				status:     http.StatusForbidden,
				reasonCode: "CLASSIFICATION_VIOLATION",
				message:    fmt.Sprintf("Data classification %q cannot leave the private EasyTier mesh.", env.DataClassification),
			}
		}
		return nil, &a2aReject{
			status:     http.StatusForbidden,
			reasonCode: "PUBLIC_ENDPOINT_FORBIDDEN",
			message:    "A2A target endpoint must be a private EasyTier mesh IP.",
		}
	}

	if env.SourceEndpoint != "" && !IsPrivateMeshHost(env.SourceEndpoint) {
		return nil, &a2aReject{
			status:     http.StatusForbidden,
			reasonCode: "PUBLIC_ENDPOINT_FORBIDDEN",
			message:    "A2A source endpoint must be a private EasyTier mesh IP.",
		}
	}

	if env.CompanyID <= 0 || (m.expectedCompanyID > 0 && env.CompanyID != m.expectedCompanyID) {
		return nil, &a2aReject{
			status:     http.StatusForbidden,
			reasonCode: "COMPANY_ISOLATION_VIOLATION",
			message:    "Cross-company or invalid companyId A2A delegation is forbidden.",
		}
	}

	if env.DelegationDepth < 0 || env.DelegationDepth > maxA2ADelegationDepth {
		return nil, &a2aReject{
			status:     http.StatusForbidden,
			reasonCode: "DELEGATION_DEPTH_EXCEEDED",
			message:    fmt.Sprintf("Delegation depth %d exceeds maximum allowed depth %d.", env.DelegationDepth, maxA2ADelegationDepth),
		}
	}

	if env.ClaimedStatus == "accepted" {
		return nil, &a2aReject{
			status:     http.StatusForbidden,
			reasonCode: "SERVER_ONLY_ACCEPTED_AUTHORITY",
			message:    "Peer A2A envelopes cannot self-assert accepted status.",
		}
	}

	if env.FencingToken <= 0 {
		return nil, &a2aReject{
			status:     http.StatusBadRequest,
			reasonCode: "INVALID_FENCING_TOKEN",
			message:    "A2A fencingToken must be a positive integer.",
		}
	}

	ttlMs := env.ExpiresAt - env.IssuedAt
	if ttlMs <= 0 || ttlMs > maxA2ATTLMs {
		return nil, &a2aReject{
			status:     http.StatusBadRequest,
			reasonCode: "INVALID_TTL",
			message:    fmt.Sprintf("A2A ttlMs must be between 1 and %d ms.", maxA2ATTLMs),
		}
	}

	if len(strings.TrimSpace(env.Nonce)) < 16 {
		return nil, &a2aReject{
			status:     http.StatusBadRequest,
			reasonCode: "INVALID_NONCE",
			message:    "A2A envelope nonce is missing or too short.",
		}
	}

	nowMs := m.nowFunc().UnixMilli()
	if nowMs > env.ExpiresAt {
		return nil, &a2aReject{
			status:     http.StatusUnauthorized,
			reasonCode: "ENVELOPE_EXPIRED",
			message:    "A2A envelope TTL has expired.",
		}
	}

	if env.IssuedAt > nowMs+defaultA2AClockSkewMs {
		return nil, &a2aReject{
			status:     http.StatusUnauthorized,
			reasonCode: "ENVELOPE_NOT_YET_VALID",
			message:    "A2A envelope issuedAt exceeds allowed clock skew.",
		}
	}

	if len(env.Signature) != 64 {
		return nil, &a2aReject{
			status:     http.StatusUnauthorized,
			reasonCode: "INVALID_SIGNATURE",
			message:    "A2A envelope signature format is invalid.",
		}
	}
	actualSigBytes, err := hex.DecodeString(env.Signature)
	if err != nil || len(actualSigBytes) != sha256.Size {
		return nil, &a2aReject{
			status:     http.StatusUnauthorized,
			reasonCode: "INVALID_SIGNATURE",
			message:    "A2A envelope signature format is invalid.",
		}
	}

	rawMap, err := decodeRawEnvelopeMap(rawBody)
	if err != nil {
		return nil, &a2aReject{
			status:     http.StatusBadRequest,
			reasonCode: "INVALID_ENVELOPE",
			message:    "Malformed A2A envelope object.",
		}
	}
	delete(rawMap, "signature")

	expectedSigHex, err := ComputeA2ASignature(rawMap, m.signingSecret)
	if err != nil {
		return nil, &a2aReject{
			status:     http.StatusInternalServerError,
			reasonCode: "INVALID_SIGNATURE",
			message:    "Failed to compute A2A envelope signature.",
		}
	}
	expectedSigBytes, _ := hex.DecodeString(expectedSigHex)
	if !hmac.Equal(actualSigBytes, expectedSigBytes) {
		return nil, &a2aReject{
			status:     http.StatusUnauthorized,
			reasonCode: "INVALID_SIGNATURE",
			message:    "A2A envelope HMAC-SHA256 signature verification failed.",
		}
	}

	return &env, nil
}

// verifyTransportPeer implements the Control Plane half of CF-017/CF-018: a
// signed envelope is not sufficient. The request must arrive over a verified
// TLS connection whose client certificate chain is trusted by the configured
// CA and whose SPKI pin maps to the registered peer/agent/key identity.
// Forwarded identity headers are never consulted.
func (m *A2AManager) verifyTransportPeer(r *http.Request, env *A2AEnvelope) *a2aReject {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
		return &a2aReject{http.StatusUnauthorized, "PEER_CERT_MISSING", "A2A delegation requires a verified mesh peer certificate."}
	}
	leaf := r.TLS.PeerCertificates[0]
	now := m.nowFunc()
	if now.Before(leaf.NotBefore) {
		return &a2aReject{http.StatusUnauthorized, "PEER_CERT_NOT_YET_VALID", "A2A peer certificate is not yet valid."}
	}
	if now.After(leaf.NotAfter) {
		return &a2aReject{http.StatusUnauthorized, "PEER_CERT_EXPIRED", "A2A peer certificate has expired."}
	}
	if m.peerCA == nil {
		return &a2aReject{http.StatusUnauthorized, "PEER_CERT_UNTRUSTED", "No trusted A2A peer CA is configured."}
	}
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:     m.peerCA,
		CurrentTime: now,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		return &a2aReject{http.StatusUnauthorized, "PEER_CERT_UNTRUSTED", "A2A peer certificate is not trusted."}
	}

	pin := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
	spkiHex := hex.EncodeToString(pin[:])
	presentedKeyID := strings.TrimSpace(r.Header.Get(a2aKeyIDHeader))
	for _, reg := range m.peerRegistrations {
		if !strings.EqualFold(reg.SPKISHA256, spkiHex) {
			continue
		}
		if reg.AgentID != env.SourceAgentID || reg.CompanyID != env.CompanyID {
			continue
		}
		if presentedKeyID != "" && presentedKeyID != reg.KeyID {
			return &a2aReject{http.StatusForbidden, "PEER_KEY_MISMATCH", "A2A key identity does not match the registered peer."}
		}
		return nil
	}
	return &a2aReject{http.StatusForbidden, "PEER_IDENTITY_MISMATCH", "A2A peer certificate is not registered for this agent and company."}
}

func decodeRawEnvelopeMap(rawBody []byte) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader(rawBody))
	dec.UseNumber()
	var out map[string]any
	if err := dec.Decode(&out); err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("envelope must be a JSON object")
	}
	return out, nil
}

// a2aForwardHeaders are never propagated upstream. Hop-by-hop fields would be
// regenerated by net/http; Authorization and X-Forwarded-* identity headers
// must never be used to establish peer identity at the durable receiver.
var a2aForwardHeaders = map[string]bool{
	"authorization":            true,
	"proxy-authorization":      true,
	"connection":               true,
	"proxy-connection":         true,
	"keep-alive":               true,
	"te":                       true,
	"trailer":                  true,
	"transfer-encoding":        true,
	"upgrade":                  true,
	"x-forwarded-for":          true,
	"x-forwarded-host":         true,
	"x-forwarded-proto":        true,
	"x-real-ip":                true,
	"x-client-cert":            true,
	"x-forwarded-client-cert":  true,
	"x-a2a-peer-identity":      true,
}

func copyA2AForwardHeaders(dst, src http.Header) {
	for name, values := range src {
		if a2aForwardHeaders[strings.ToLower(name)] {
			continue
		}
		for _, value := range values {
			dst.Add(name, value)
		}
	}
}

var a2aKnownReasonCodes = map[string]bool{
	"PUBLIC_ENDPOINT_FORBIDDEN":       true,
	"COMPANY_ISOLATION_VIOLATION":     true,
	"DELEGATION_DEPTH_EXCEEDED":       true,
	"CLASSIFICATION_VIOLATION":        true,
	"SERVER_ONLY_ACCEPTED_AUTHORITY":  true,
	"INVALID_FENCING_TOKEN":           true,
	"STALE_FENCING_TOKEN":             true,
	"INVALID_TTL":                     true,
	"ENVELOPE_EXPIRED":                true,
	"ENVELOPE_NOT_YET_VALID":          true,
	"REPLAY_NONCE_DETECTED":           true,
	"INVALID_NONCE":                   true,
	"INVALID_SIGNATURE":               true,
	"INVALID_SECRET":                  true,
	"INVALID_PROTOCOL_VERSION":        true,
	"INVALID_ENVELOPE":                true,
	"ENVELOPE_TOO_LARGE":              true,
	"SOURCE_ENDPOINT_MISMATCH":        true,
	"TARGET_ENDPOINT_MISMATCH":        true,
	"UPSTREAM_REJECTED":               true,
	"UPSTREAM_REDIRECT_REJECTED":      true,
	"UPSTREAM_UNAVAILABLE":            true,
	"FORWARD_NOT_CONFIGURED":          true,
}

func a2aSafeErrorForReason(code string) string {
	switch code {
	case "REPLAY_NONCE_DETECTED":
		return "A2A envelope nonce was already accepted by the durable receiver."
	case "STALE_FENCING_TOKEN":
		return "A2A fencing token is stale at the durable receiver."
	case "ENVELOPE_EXPIRED", "ENVELOPE_NOT_YET_VALID", "INVALID_TTL":
		return "A2A envelope validity window was rejected by the durable receiver."
	case "INVALID_SIGNATURE":
		return "A2A envelope signature was rejected by the durable receiver."
	default:
		return "A2A delegation was rejected by the durable receiver."
	}
}

func isTransientA2AStatus(status int) bool {
	switch status {
	case http.StatusRequestTimeout, http.StatusTooManyRequests,
		http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

// forward sends the original raw body to the configured private-mesh API
// receiver. It never invents a receipt and never advances replay/fencing state.
func (m *A2AManager) forward(ctx context.Context, rawBody []byte, inboundHeader http.Header, env *A2AEnvelope) (*A2ADelegateResponse, *a2aReject) {
	if m.forwardOrigin == "" {
		return nil, &a2aReject{http.StatusServiceUnavailable, "FORWARD_NOT_CONFIGURED", "A2A forwarding origin is not configured."}
	}

	target := m.forwardOrigin + "/a2a/delegate"
	var lastRej *a2aReject
	for attempt := 1; attempt <= m.forwardAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(rawBody))
		if err != nil {
			return nil, &a2aReject{http.StatusBadGateway, "UPSTREAM_UNAVAILABLE", "A2A forward request could not be constructed."}
		}
		copyA2AForwardHeaders(req.Header, inboundHeader)

		resp, err := m.httpClient.Do(req)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				lastRej = &a2aReject{http.StatusGatewayTimeout, "UPSTREAM_UNAVAILABLE", "A2A forward timed out."}
			} else {
				lastRej = &a2aReject{http.StatusBadGateway, "UPSTREAM_UNAVAILABLE", "A2A durable receiver is unavailable."}
			}
			if attempt < m.forwardAttempts && m.forwardRetryDelay >= 0 {
				select {
				case <-ctx.Done():
					return nil, lastRej
				case <-time.After(m.forwardRetryDelay):
					continue
				}
			}
			return nil, lastRej
		}

		respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, maxA2AErrorBodyBytes))
		_ = resp.Body.Close()
		if readErr != nil {
			return nil, &a2aReject{http.StatusBadGateway, "UPSTREAM_REJECTED", "A2A durable receiver response could not be read."}
		}

		if resp.StatusCode >= http.StatusMultipleChoices && resp.StatusCode < http.StatusBadRequest {
			return nil, &a2aReject{http.StatusBadGateway, "UPSTREAM_REDIRECT_REJECTED", "A2A forwarding rejects redirects."}
		}

		if resp.StatusCode == http.StatusAccepted {
			var receipt A2ADelegateResponse
			if err := json.Unmarshal(respBody, &receipt); err != nil ||
				receipt.Status != "queued" || receipt.MessageID != env.MessageID ||
				receipt.CompanyID != env.CompanyID {
				return nil, &a2aReject{http.StatusBadGateway, "UPSTREAM_REJECTED", "A2A durable receiver returned an invalid receipt."}
			}
			return &receipt, nil
		}

		reasonCode := "UPSTREAM_REJECTED"
		var upstream A2AErrorResponse
		if json.Unmarshal(respBody, &upstream) == nil && a2aKnownReasonCodes[upstream.ReasonCode] {
			reasonCode = upstream.ReasonCode
		}
		status := http.StatusBadGateway
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			status = resp.StatusCode
		}
		lastRej = &a2aReject{status, reasonCode, a2aSafeErrorForReason(reasonCode)}
		if isTransientA2AStatus(resp.StatusCode) && attempt < m.forwardAttempts {
			select {
			case <-ctx.Done():
				return nil, lastRej
			case <-time.After(m.forwardRetryDelay):
				continue
			}
		}
		return nil, lastRej
	}
	if lastRej == nil {
		lastRej = &a2aReject{http.StatusBadGateway, "UPSTREAM_UNAVAILABLE", "A2A durable receiver is unavailable."}
	}
	return nil, lastRej
}

// HandleDelegate serves POST /a2a/delegate as a thin forwarding boundary.
func (m *A2AManager) HandleDelegate() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeA2AError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "method not allowed")
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, maxA2ABodyBytes))
		if err != nil {
			writeA2AError(w, http.StatusBadRequest, "INVALID_ENVELOPE", "failed to read request body")
			return
		}

		env, rej := m.verifyRequest(body, r.RemoteAddr)
		if rej == nil {
			rej = m.verifyTransportPeer(r, env)
		}
		if rej != nil {
			redactedMsg := RedactA2ASecret(rej.message, m.signingSecret)
			log.Printf("a2a delegate rejected reason=%s remote=%s msg=%s", rej.reasonCode, SanitizeLogValue(r.RemoteAddr), SanitizeLogValue(redactedMsg))
			writeA2AError(w, rej.status, rej.reasonCode, redactedMsg)
			return
		}

		totalTimeout := m.forwardTimeout * time.Duration(m.forwardAttempts)
		ctx, cancel := context.WithTimeout(r.Context(), totalTimeout)
		defer cancel()

		receipt, fwdRej := m.forward(ctx, body, r.Header, env)
		if fwdRej != nil {
			log.Printf("a2a delegate forward failed reason=%s messageId=%s", fwdRej.reasonCode, RedactA2ASecret(env.MessageID, m.signingSecret))
			writeA2AError(w, fwdRej.status, fwdRej.reasonCode, fwdRej.message)
			return
		}

		log.Printf("a2a delegate forwarded messageId=%s companyId=%d", SanitizeLogValue(RedactA2ASecret(receipt.MessageID, m.signingSecret)), receipt.CompanyID)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(receipt)
	}
}

func writeA2AError(w http.ResponseWriter, status int, reasonCode, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(A2AErrorResponse{Error: message, ReasonCode: reasonCode})
}
