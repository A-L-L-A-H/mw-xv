package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestA2ADelegateValidAndReplayRejection(t *testing.T) {
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	mgr := NewA2AManager(testA2ASecret, 42)
	mgr.nowFunc = func() time.Time { return now }
	handler := mgr.HandleDelegate()

	body := buildSignedTestEnvelope(t, nil, testA2ASecret, now)

	// 1. Valid request over private EasyTier mesh IP
	req := httptest.NewRequest(http.MethodPost, "/a2a/delegate", bytes.NewReader(body))
	req.RemoteAddr = "100.64.0.10:54321"
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 Accepted, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp A2ADelegateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Status != "queued" || resp.MessageID != "msg-a2a-001" || resp.CompanyID != 42 {
		t.Fatalf("unexpected response: %+v", resp)
	}

	// 2. Replay with identical nonce must fail with 409 REPLAY_NONCE_DETECTED
	reqReplay := httptest.NewRequest(http.MethodPost, "/a2a/delegate", bytes.NewReader(body))
	reqReplay.RemoteAddr = "100.64.0.10:54322"
	recReplay := httptest.NewRecorder()
	handler(recReplay, reqReplay)

	if recReplay.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on replay, got %d: %s", recReplay.Code, recReplay.Body.String())
	}
	var errResp A2AErrorResponse
	_ = json.Unmarshal(recReplay.Body.Bytes(), &errResp)
	if errResp.ReasonCode != "REPLAY_NONCE_DETECTED" {
		t.Fatalf("expected REPLAY_NONCE_DETECTED, got %q", errResp.ReasonCode)
	}

	// 3. Stale fencingToken with fresh nonce must fail with 409 STALE_FENCING_TOKEN
	staleBody := buildSignedTestEnvelope(t, map[string]any{
		"nonce":        "fedcba9876543210fedcba9876543210",
		"fencingToken": int64(7),
	}, testA2ASecret, now)
	reqStale := httptest.NewRequest(http.MethodPost, "/a2a/delegate", bytes.NewReader(staleBody))
	reqStale.RemoteAddr = "100.64.0.10:54323"
	recStale := httptest.NewRecorder()
	handler(recStale, reqStale)

	if recStale.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on stale fencingToken, got %d: %s", recStale.Code, recStale.Body.String())
	}
	_ = json.Unmarshal(recStale.Body.Bytes(), &errResp)
	if errResp.ReasonCode != "STALE_FENCING_TOKEN" {
		t.Fatalf("expected STALE_FENCING_TOKEN, got %q", errResp.ReasonCode)
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
			mgr := NewA2AManager(testA2ASecret, 42)
			mgr.nowFunc = func() time.Time { return now }
			handler := mgr.HandleDelegate()

			body := buildSignedTestEnvelope(t, tc.overrides, tc.signSecret, now)
			req := httptest.NewRequest(http.MethodPost, "/a2a/delegate", bytes.NewReader(body))
			req.RemoteAddr = tc.remoteAddr
			rec := httptest.NewRecorder()
			handler(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", tc.wantStatus, rec.Code, rec.Body.String())
			}
			var errResp A2AErrorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &errResp); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if errResp.ReasonCode != tc.wantCode {
				t.Fatalf("expected reasonCode %q, got %q", tc.wantCode, errResp.ReasonCode)
			}
			if strings.Contains(rec.Body.String(), testA2ASecret) {
				t.Fatalf("response leaked signing secret")
			}
		})
	}
}
