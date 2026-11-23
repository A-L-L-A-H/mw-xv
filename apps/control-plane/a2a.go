package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
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
	"sync"
	"time"
)

const (
	a2aProtocolVersion    = "a2a.v1"
	maxA2ADelegationDepth = 3
	maxA2ATTLMs           = 300_000
	defaultA2AClockSkewMs = 30_000
	maxA2ABodyBytes       = 1 << 20 // 1 MiB
)

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

// A2ADelegateResponse is returned by POST /a2a/delegate on success.
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

// A2ANonceCache tracks seen nonces within their TTL window to prevent replay attacks.
type A2ANonceCache struct {
	mu      sync.Mutex
	entries map[string]int64 // nonce -> expiresAtMs
}

// NewA2ANonceCache creates an empty replay nonce cache.
func NewA2ANonceCache() *A2ANonceCache {
	return &A2ANonceCache{
		entries: make(map[string]int64),
	}
}

// CheckAndRecord prunes expired nonces, returns false if nonce was already seen,
// and records the nonce otherwise.
func (c *A2ANonceCache) CheckAndRecord(nonce string, expiresAtMs, nowMs int64) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	for k, exp := range c.entries {
		if nowMs > exp {
			delete(c.entries, k)
		}
	}
	if _, exists := c.entries[nonce]; exists {
		return false
	}
	c.entries[nonce] = expiresAtMs
	return true
}

// A2AFencingTracker enforces strictly monotonic fencingToken values per company+sourceAgent.
type A2AFencingTracker struct {
	mu       sync.Mutex
	lastSeen map[string]int64
}

// NewA2AFencingTracker creates an empty fencing token tracker.
func NewA2AFencingTracker() *A2AFencingTracker {
	return &A2AFencingTracker{
		lastSeen: make(map[string]int64),
	}
}

// CheckAndAdvance verifies token > lastSeen for (companyID, sourceAgentID) and advances it.
func (f *A2AFencingTracker) CheckAndAdvance(companyID int64, sourceAgentID string, token int64) bool {
	f.mu.Lock()
	defer f.mu.Unlock()

	key := fmt.Sprintf("%d::%s", companyID, sourceAgentID)
	if prev, ok := f.lastSeen[key]; ok && token <= prev {
		return false
	}
	f.lastSeen[key] = token
	return true
}

// A2AManager verifies inbound A2A delegation envelopes over the private EasyTier mesh.
type A2AManager struct {
	signingSecret     string
	expectedCompanyID int64
	nonceCache        *A2ANonceCache
	fencing           *A2AFencingTracker
	nowFunc           func() time.Time
}

// NewA2AManager creates an A2AManager with explicit configuration.
func NewA2AManager(signingSecret string, expectedCompanyID int64) *A2AManager {
	return &A2AManager{
		signingSecret:     strings.TrimSpace(signingSecret),
		expectedCompanyID: expectedCompanyID,
		nonceCache:        NewA2ANonceCache(),
		fencing:           NewA2AFencingTracker(),
		nowFunc:           time.Now,
	}
}

// NewA2AManagerFromEnv creates an A2AManager from MW_A2A_SIGNING_SECRET and MW_A2A_COMPANY_ID.
func NewA2AManagerFromEnv() *A2AManager {
	secret := strings.TrimSpace(os.Getenv("MW_A2A_SIGNING_SECRET"))
	var companyID int64
	if raw := strings.TrimSpace(os.Getenv("MW_A2A_COMPANY_ID")); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			companyID = parsed
		}
	}
	return NewA2AManager(secret, companyID)
}

// IsPrivateMeshHost returns true only for private EasyTier P2P mesh IP ranges:
// 10.0.0.0/8, 100.64.0.0/10, 172.16.0.0/12, 192.168.0.0/16, and fd00::/8.
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

	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}

	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 10 {
			return true // 10.0.0.0/8
		}
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return true // 100.64.0.0/10 (RFC 6598 / EasyTier)
		}
		if ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31 {
			return true // 172.16.0.0/12
		}
		if ip4[0] == 192 && ip4[1] == 168 {
			return true // 192.168.0.0/16
		}
		return false
	}

	// IPv6 ULA fd00::/8 (reject IPv4-mapped IPv6 addresses since To4() == nil already)
	return len(ip) == net.IPv6len && ip[0] == 0xfd
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

	if !m.nonceCache.CheckAndRecord(env.Nonce, env.ExpiresAt, nowMs) {
		return nil, &a2aReject{
			status:     http.StatusConflict,
			reasonCode: "REPLAY_NONCE_DETECTED",
			message:    "A2A envelope nonce has already been processed.",
		}
	}

	if !m.fencing.CheckAndAdvance(env.CompanyID, env.SourceAgentID, env.FencingToken) {
		return nil, &a2aReject{
			status:     http.StatusConflict,
			reasonCode: "STALE_FENCING_TOKEN",
			message:    "A2A fencingToken must be strictly monotonic.",
		}
	}

	return &env, nil
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

// HandleDelegate serves POST /a2a/delegate.
func (m *A2AManager) HandleDelegate() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			_ = json.NewEncoder(w).Encode(A2AErrorResponse{
				Error:      "method not allowed",
				ReasonCode: "METHOD_NOT_ALLOWED",
			})
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, maxA2ABodyBytes))
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(A2AErrorResponse{
				Error:      RedactA2ASecret("failed to read request body", m.signingSecret),
				ReasonCode: "INVALID_ENVELOPE",
			})
			return
		}

		env, rej := m.verifyRequest(body, r.RemoteAddr)
		if rej != nil {
			redactedMsg := RedactA2ASecret(rej.message, m.signingSecret)
			log.Printf("a2a delegate rejected reason=%s remote=%s msg=%s", rej.reasonCode, r.RemoteAddr, redactedMsg)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(rej.status)
			_ = json.NewEncoder(w).Encode(A2AErrorResponse{
				Error:      redactedMsg,
				ReasonCode: rej.reasonCode,
			})
			return
		}

		log.Printf(
			"a2a delegate queued messageId=%s companyId=%d depth=%d fencingToken=%d remote=%s",
			RedactA2ASecret(env.MessageID, m.signingSecret),
			env.CompanyID,
			env.DelegationDepth,
			env.FencingToken,
			r.RemoteAddr,
		)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(A2ADelegateResponse{
			Status:          "queued",
			MessageID:       env.MessageID,
			CompanyID:       env.CompanyID,
			DelegationDepth: env.DelegationDepth,
			FencingToken:    env.FencingToken,
			ReceivedAt:      m.nowFunc().UTC().Format(time.RFC3339),
		})
	}
}
