package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func signGitHubPayload(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyGitHubWebhookSignature(t *testing.T) {
	secret := "whsec_test_moonwitness_2026"
	payload := []byte(`{"ref":"refs/heads/main","after":"abc1234567890"}`)
	validSig := signGitHubPayload(secret, payload)

	if !VerifyGitHubWebhookSignature(secret, payload, validSig) {
		t.Fatal("expected valid HMAC-SHA256 signature to pass")
	}
	if VerifyGitHubWebhookSignature("", payload, validSig) {
		t.Fatal("expected empty secret to fail closed")
	}
	if VerifyGitHubWebhookSignature(secret, payload, "") {
		t.Fatal("expected empty signature header to fail closed")
	}
	if VerifyGitHubWebhookSignature(secret, payload, strings.TrimPrefix(validSig, "sha256=")) {
		t.Fatal("expected missing sha256= prefix to fail closed")
	}
	if VerifyGitHubWebhookSignature(secret, payload, "sha256=not-hex!!") {
		t.Fatal("expected malformed hex signature to fail closed")
	}
	if VerifyGitHubWebhookSignature(secret, []byte(`{"ref":"refs/heads/evil"}`), validSig) {
		t.Fatal("expected tampered payload to fail closed")
	}
	if VerifyGitHubWebhookSignature("wrong-secret", payload, validSig) {
		t.Fatal("expected wrong secret to fail closed")
	}
}

func TestValidateGitDeployRequest(t *testing.T) {
	base := GitDeployRequest{
		Slug:           "demo-api",
		TenantID:       "tenant-1",
		GitRepo:        "https://github.com/moonwitness/demo-api.git",
		Branch:         "main",
		DockerfilePath: "Dockerfile",
		Port:           8080,
		Domain:         "demo.example.com",
		Env:            map[string]string{"NODE_ENV": "production"},
	}

	if err := ValidateGitDeployRequest(base); err != nil {
		t.Fatalf("expected valid request, got error: %v", err)
	}

	cases := []struct {
		name   string
		mutate func(*GitDeployRequest)
	}{
		{"http scheme", func(r *GitDeployRequest) { r.GitRepo = "http://github.com/org/repo.git" }},
		{"file scheme", func(r *GitDeployRequest) { r.GitRepo = "file:///etc/passwd" }},
		{"ssh scheme", func(r *GitDeployRequest) { r.GitRepo = "ssh://git@github.com/org/repo.git" }},
		{"embedded creds", func(r *GitDeployRequest) { r.GitRepo = "https://user:pass@github.com/org/repo.git" }},
		{"localhost ssrf", func(r *GitDeployRequest) { r.GitRepo = "https://localhost/org/repo.git" }},
		{"loopback ipv4 ssrf", func(r *GitDeployRequest) { r.GitRepo = "https://127.0.0.1/org/repo.git" }},
		{"private 10.x ssrf", func(r *GitDeployRequest) { r.GitRepo = "https://10.0.0.1/org/repo.git" }},
		{"private 192.168 ssrf", func(r *GitDeployRequest) { r.GitRepo = "https://192.168.1.5/org/repo.git" }},
		{"cgnat 100.64 ssrf", func(r *GitDeployRequest) { r.GitRepo = "https://100.64.0.1/org/repo.git" }},
		{"link-local metadata ssrf", func(r *GitDeployRequest) { r.GitRepo = "https://169.254.169.254/latest/meta-data" }},
		{"ipv6 loopback ssrf", func(r *GitDeployRequest) { r.GitRepo = "https://[::1]/org/repo.git" }},
		{"branch leading dash", func(r *GitDeployRequest) { r.Branch = "--upload-pack=sh" }},
		{"branch double dot", func(r *GitDeployRequest) { r.Branch = "main..evil" }},
		{"branch lock suffix", func(r *GitDeployRequest) { r.Branch = "main.lock" }},
		{"dockerfile traversal", func(r *GitDeployRequest) { r.DockerfilePath = "../Dockerfile" }},
		{"dockerfile nested traversal", func(r *GitDeployRequest) { r.DockerfilePath = "apps/../../Dockerfile" }},
		{"dockerfile absolute", func(r *GitDeployRequest) { r.DockerfilePath = "/etc/Dockerfile" }},
		{"invalid slug", func(r *GitDeployRequest) { r.Slug = "../bad" }},
		{"invalid port", func(r *GitDeployRequest) { r.Port = 0 }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := base
			tc.mutate(&req)
			if err := ValidateGitDeployRequest(req); err == nil {
				t.Fatalf("expected validation error for case %q, got nil", tc.name)
			}
		})
	}
}

func newTestGitBuilderSetup(t *testing.T) (*http.ServeMux, *sql.DB, *[]recordedCmd, string) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := initPaasSchema(db); err != nil {
		t.Fatalf("init paas schema: %v", err)
	}

	var cmds []recordedCmd
	runner := func(ctx context.Context, name string, args ...string) (string, error) {
		cmds = append(cmds, recordedCmd{name: name, args: append([]string(nil), args...)})
		if name == "git" && len(args) >= 4 && args[2] == "rev-parse" {
			return "a1b2c3d4e5f6\n", nil
		}
		if name == "docker" && len(args) > 0 && args[0] == "run" {
			return "deadbeef1234567890\n", nil
		}
		return "", nil
	}

	caddyPath := filepath.Join(t.TempDir(), "Caddyfile")
	caddyMgr := NewCaddyManager(caddyPath, "caddy", false, runner)
	paasMgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), caddyMgr, runner)

	mux := http.NewServeMux()
	adminToken := "test-admin-token-gitbuilder"
	RegisterGitBuilderRoutes(mux, paasMgr, adminToken)
	return mux, db, &cmds, adminToken
}

func TestGitDeployEndpointAndWebhook(t *testing.T) {
	mux, _, cmds, adminToken := newTestGitBuilderSetup(t)

	// 1. Unauthenticated deploy-git must fail closed (401).
	unauthReq := httptest.NewRequest(http.MethodPost, "/paas/apps/deploy-git", bytes.NewBufferString(`{}`))
	unauthRec := httptest.NewRecorder()
	mux.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated deploy-git, got %d", unauthRec.Code)
	}

	// 2. Authenticated deploy-git executes git clone + rev-parse + docker build + deploy + caddy sync.
	deployPayload := GitDeployRequest{
		Slug:           "web-app",
		TenantID:       "tenant-alpha",
		GitRepo:        "https://github.com/moonwitness/web-app.git",
		Branch:         "release/v1",
		DockerfilePath: "docker/Dockerfile.prod",
		Port:           3000,
		Domain:         "web.example.com",
		Env: map[string]string{
			"GITHUB_WEBHOOK_SECRET": "whsec_app_secret_123",
		},
	}
	bodyBytes, _ := json.Marshal(deployPayload)
	req := httptest.NewRequest(http.MethodPost, "/paas/apps/deploy-git", bytes.NewReader(bodyBytes))
	req.Header.Set("X-Control-Plane-Token", adminToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from deploy-git, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp GitDeployResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Image != "mw-paas-web-app:a1b2c3d4e5f6" {
		t.Fatalf("unexpected image tag: %q", resp.Image)
	}
	if resp.CommitSHA != "a1b2c3d4e5f6" {
		t.Fatalf("unexpected commitSha: %q", resp.CommitSHA)
	}

	// Verify arg-slice git clone & docker build commands were invoked.
	foundClone := false
	foundBuild := false
	for _, c := range *cmds {
		joined := strings.Join(c.args, " ")
		if c.name == "git" && strings.Contains(joined, "clone --depth 1 --branch release/v1 -- https://github.com/moonwitness/web-app.git") {
			foundClone = true
		}
		if c.name == "docker" && strings.Contains(joined, "build -f") && strings.Contains(joined, "-t mw-paas-web-app:a1b2c3d4e5f6") {
			foundBuild = true
		}
	}
	if !foundClone {
		t.Fatalf("expected git clone --depth 1 --branch command, got %+v", *cmds)
	}
	if !foundBuild {
		t.Fatalf("expected docker build -t mw-paas-web-app:a1b2c3d4e5f6 command, got %+v", *cmds)
	}

	// 3. GitHub webhook with invalid signature must fail closed (401).
	hookBody := []byte(`{"ref":"refs/heads/main","after":"a1b2c3d4e5f6","repository":{"clone_url":"https://github.com/moonwitness/web-app.git"}}`)
	badHookReq := httptest.NewRequest(http.MethodPost, "/paas/webhooks/github/web-app", bytes.NewReader(hookBody))
	badHookReq.Header.Set("X-Hub-Signature-256", "sha256=0000000000000000000000000000000000000000000000000000000000000000")
	badHookRec := httptest.NewRecorder()
	mux.ServeHTTP(badHookRec, badHookReq)
	if badHookRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid webhook signature, got %d", badHookRec.Code)
	}

	// 4. GitHub webhook with valid HMAC-SHA256 signature triggers rebuild & deploy (200).
	goodHookReq := httptest.NewRequest(http.MethodPost, "/paas/webhooks/github/web-app", bytes.NewReader(hookBody))
	goodHookReq.Header.Set("X-Hub-Signature-256", signGitHubPayload("whsec_app_secret_123", hookBody))
	goodHookRec := httptest.NewRecorder()
	mux.ServeHTTP(goodHookRec, goodHookReq)
	if goodHookRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid webhook signature, got %d: %s", goodHookRec.Code, goodHookRec.Body.String())
	}
}
