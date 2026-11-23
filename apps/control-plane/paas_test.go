package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func openTestPaasDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := initPaasSchema(db); err != nil {
		t.Fatalf("init paas schema: %v", err)
	}
	return db
}

type recordedCmd struct {
	name string
	args []string
}

func TestValidatePaasSlugAndDomainRejection(t *testing.T) {
	badSlugs := []string{
		"",
		"-leading-dash",
		"trailing-dash-",
		"UPPERCASE",
		"has space",
		"line\nbreak",
		"brace{inject}",
		"semi;rm -rf /",
		"../etc/passwd",
		"control-plane",
		"postgres",
		"moonwitness-postgres",
		"easytier",
		"caddy",
	}
	for _, s := range badSlugs {
		if err := ValidatePaasSlug(s); err == nil {
			t.Errorf("expected slug %q to be rejected", s)
		}
	}

	goodSlugs := []string{"a", "my-app-1", "billing-api-v2"}
	for _, s := range goodSlugs {
		if err := ValidatePaasSlug(s); err != nil {
			t.Errorf("expected slug %q to be valid, got: %v", s, err)
		}
	}

	badDomains := []string{
		"",
		"localhost",
		"api.localhost",
		"db.internal",
		"node.local",
		"127.0.0.1",
		"10.0.0.1",
		"EXAMPLE.COM",
		"https://app.example.com",
		"app.example.com:8080",
		"app.example.com\n{\nreverse_proxy 127.0.0.1:3003\n}",
		"app.example.com { reverse_proxy postgres:5432 }",
		"*.example.com",
		"singlelabel",
		"-bad.example.com",
	}
	for _, d := range badDomains {
		if err := ValidatePaasDomain(d); err == nil {
			t.Errorf("expected domain %q to be rejected", d)
		}
	}

	goodDomains := []string{"app.example.com", "sub-1.tenant.moonwitness.io"}
	for _, d := range goodDomains {
		if err := ValidatePaasDomain(d); err != nil {
			t.Errorf("expected domain %q to be valid, got: %v", d, err)
		}
	}
}

func TestGenerateCaddyfileDeterministicAndPrivateMeshIsolated(t *testing.T) {
	routes := []CaddyRoute{
		{Slug: "zeta-web", TenantID: "t2", Domain: "zeta.example.com", Port: 8080},
		{Slug: "alpha-api", TenantID: "t1", Domain: "alpha.example.com", Port: 3000},
	}

	first, err := GenerateCaddyfile(routes)
	if err != nil {
		t.Fatalf("GenerateCaddyfile failed: %v", err)
	}
	// Reversed order must yield byte-identical output.
	second, err := GenerateCaddyfile([]CaddyRoute{routes[1], routes[0]})
	if err != nil {
		t.Fatalf("GenerateCaddyfile reversed failed: %v", err)
	}
	if first != second {
		t.Fatalf("expected deterministic output:\n---first---\n%s\n---second---\n%s", first, second)
	}

	if !strings.Contains(first, "alpha.example.com {\n") || !strings.Contains(first, "reverse_proxy mw-paas-alpha-api:3000 {") {
		t.Errorf("missing alpha route in Caddyfile:\n%s", first)
	}
	if !strings.Contains(first, "zeta.example.com {\n") || !strings.Contains(first, "reverse_proxy mw-paas-zeta-web:8080 {") {
		t.Errorf("missing zeta route in Caddyfile:\n%s", first)
	}
	if strings.Index(first, "alpha.example.com") > strings.Index(first, "zeta.example.com") {
		t.Errorf("expected alpha.example.com before zeta.example.com")
	}
	// Ensure private mesh services are never proxied.
	if strings.Contains(first, "reverse_proxy control-plane") || strings.Contains(first, "reverse_proxy moonwitness-postgres") || strings.Contains(first, "127.0.0.1:3003") || strings.Contains(first, "127.0.0.1:5432") {
		t.Errorf("private mesh service leaked into Caddyfile:\n%s", first)
	}

	// Duplicate domain must fail.
	_, err = GenerateCaddyfile([]CaddyRoute{
		{Slug: "app-one", TenantID: "t1", Domain: "dup.example.com", Port: 3000},
		{Slug: "app-two", TenantID: "t2", Domain: "dup.example.com", Port: 4000},
	})
	if err == nil {
		t.Fatal("expected duplicate domain error")
	}
}

func TestPaasAuthEnforcement(t *testing.T) {
	t.Setenv("MW_INTERNAL_SECRET", "super-internal-secret-xyz")
	db := openTestPaasDB(t)
	runner := func(_ context.Context, _ string, args ...string) (string, error) {
		if len(args) > 0 && args[0] == "version" {
			return "27.0.0\n", nil
		}
		return "", nil
	}
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
	mux := http.NewServeMux()
	mgr.MountRoutes(mux, "admin-token-abc")

	// Missing auth -> 401
	req := httptest.NewRequest(http.MethodGet, "/paas/node/metrics", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without auth, got %d", rec.Code)
	}

	// Wrong token -> 401
	req = httptest.NewRequest(http.MethodGet, "/paas/node/metrics", nil)
	req.Header.Set("X-Control-Plane-Token", "wrong-token")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with wrong token, got %d", rec.Code)
	}

	// Valid Authorization: Bearer <adminToken> -> 200
	req = httptest.NewRequest(http.MethodGet, "/paas/node/metrics", nil)
	req.Header.Set("Authorization", "Bearer admin-token-abc")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with Bearer adminToken, got %d", rec.Code)
	}

	// Valid X-Control-Plane-Token: <MW_INTERNAL_SECRET> -> 200
	req = httptest.NewRequest(http.MethodGet, "/paas/node/metrics", nil)
	req.Header.Set("X-Control-Plane-Token", "super-internal-secret-xyz")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with X-Control-Plane-Token, got %d", rec.Code)
	}
}

func TestPaasLifecycleDeployListLogsRestartStopDelete(t *testing.T) {
	db := openTestPaasDB(t)
	tmpDir := t.TempDir()
	caddyPath := filepath.Join(tmpDir, "Caddyfile")

	var cmds []recordedCmd
	existingContainer := false

	runner := func(_ context.Context, name string, args ...string) (string, error) {
		cmds = append(cmds, recordedCmd{name: name, args: append([]string(nil), args...)})
		if len(args) == 0 {
			return "", nil
		}
		switch args[0] {
		case "ps":
			// Check if querying existing container by name filter
			for _, a := range args {
				if strings.HasPrefix(a, "name=^/") {
					if existingContainer {
						return "abcdef123456\n", nil
					}
					return "", nil
				}
			}
			// List label=mw.paas.app
			if existingContainer {
				return "mw-paas-demo-web\tabcdef1234567890\trunning\n", nil
			}
			return "", nil
		case "run":
			existingContainer = true
			return "abcdef1234567890fedcba\n", nil
		case "logs":
			return "2026-01-01T00:00:00Z boot ok API_SECRET=topsecret999 Bearer jwt-secret-123\n", nil
		case "restart", "stop":
			return "mw-paas-demo-web\n", nil
		case "rename":
			existingContainer = true
			return "mw-paas-demo-web\n", nil
		case "rm":
			existingContainer = false
			return "mw-paas-demo-web\n", nil
		case "version":
			return "27.1.1\n", nil
		default:
			return "", nil
		}
	}

	caddyMgr := NewCaddyManager(caddyPath, "caddy", false, runner)
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), caddyMgr, runner)
	mux := http.NewServeMux()
	mgr.MountRoutes(mux, "test-token")

	doReq := func(method, path string, body interface{}) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, path, &buf)
		req.Header.Set("X-Control-Plane-Token", "test-token")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	// 1. Deploy new app
	rec := doReq(http.MethodPost, "/paas/apps/deploy", PaasDeployRequest{
		Slug:     "demo-web",
		TenantID: "tenant-42",
		Image:    "nginx:1.27-alpine",
		Port:     80,
		Domain:   "demo.example.com",
		Env: map[string]string{
			"NODE_ENV":   "production",
			"API_SECRET": "topsecret999",
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("deploy expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var deployed PaasApp
	if err := json.Unmarshal(rec.Body.Bytes(), &deployed); err != nil {
		t.Fatalf("unmarshal deploy response: %v", err)
	}
	if deployed.ContainerName != "mw-paas-demo-web" {
		t.Errorf("expected container mw-paas-demo-web, got %q", deployed.ContainerName)
	}
	if deployed.Env["API_SECRET"] != redactedPlaceholder {
		t.Errorf("expected API_SECRET redacted, got %q", deployed.Env["API_SECRET"])
	}
	if deployed.Env["NODE_ENV"] != "production" {
		t.Errorf("expected NODE_ENV preserved, got %q", deployed.Env["NODE_ENV"])
	}

	// Verify docker run included required labels.
	foundRun := false
	for _, c := range cmds {
		if len(c.args) > 0 && c.args[0] == "run" {
			foundRun = true
			joined := strings.Join(c.args, " ")
			if !strings.Contains(joined, "--label mw.paas.app=demo-web") || !strings.Contains(joined, "--label mw.paas.tenant=tenant-42") {
				t.Errorf("docker run missing required labels: %s", joined)
			}
		}
	}
	if !foundRun {
		t.Fatal("expected docker run command to be invoked")
	}

	// Verify Caddyfile was written with the domain.
	caddyBytes, err := os.ReadFile(caddyPath)
	if err != nil {
		t.Fatalf("read Caddyfile: %v", err)
	}
	if !strings.Contains(string(caddyBytes), "demo.example.com") || !strings.Contains(string(caddyBytes), "mw-paas-demo-web:80") {
		t.Errorf("unexpected Caddyfile contents:\n%s", string(caddyBytes))
	}

	// 2. Redeploy (zero-downtime recreate: run -next -> stop -> rm -> rename)
	cmds = nil
	rec = doReq(http.MethodPost, "/paas/apps/deploy", PaasDeployRequest{
		Slug:     "demo-web",
		TenantID: "tenant-42",
		Image:    "nginx:1.27.1-alpine",
		Port:     80,
		Domain:   "demo.example.com",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("redeploy expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var seq []string
	for _, c := range cmds {
		if len(c.args) > 0 {
			seq = append(seq, c.args[0])
		}
	}
	seqStr := strings.Join(seq, ",")
	if !strings.Contains(seqStr, "run,stop,rm,rename") {
		t.Errorf("expected zero-downtime sequence run,stop,rm,rename; got %s", seqStr)
	}

	// 3. List apps (SQLite + live container state)
	rec = doReq(http.MethodGet, "/paas/apps", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list apps expected 200, got %d", rec.Code)
	}
	var listResp struct {
		Apps []PaasApp `json:"apps"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal list response: %v", err)
	}
	if len(listResp.Apps) != 1 || listResp.Apps[0].ContainerState != "running" {
		t.Fatalf("expected 1 running app, got %+v", listResp.Apps)
	}

	// 4. Logs (clamped to max 500 + secret redaction)
	rec = doReq(http.MethodGet, "/paas/apps/demo-web/logs?tail=9999", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("logs expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var logsResp struct {
		Slug string `json:"slug"`
		Tail int    `json:"tail"`
		Logs string `json:"logs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &logsResp); err != nil {
		t.Fatalf("unmarshal logs: %v", err)
	}
	if logsResp.Tail != 500 {
		t.Errorf("expected tail clamped to 500, got %d", logsResp.Tail)
	}
	if strings.Contains(logsResp.Logs, "topsecret999") || strings.Contains(logsResp.Logs, "jwt-secret-123") {
		t.Errorf("secrets leaked in logs: %s", logsResp.Logs)
	}

	// 5. Restart
	rec = doReq(http.MethodPost, "/paas/apps/demo-web/restart", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("restart expected 200, got %d", rec.Code)
	}

	// 6. Stop
	rec = doReq(http.MethodPost, "/paas/apps/demo-web/stop", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("stop expected 200, got %d", rec.Code)
	}
	var dbStatus string
	if err := db.QueryRow("SELECT status FROM paas_apps WHERE slug='demo-web'").Scan(&dbStatus); err != nil || dbStatus != "stopped" {
		t.Errorf("expected DB status 'stopped', got %q (err=%v)", dbStatus, err)
	}

	// 7. Delete
	rec = doReq(http.MethodDelete, "/paas/apps/demo-web", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete expected 200, got %d", rec.Code)
	}
	var count int
	_ = db.QueryRow("SELECT COUNT(*) FROM paas_apps").Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 apps after delete, got %d", count)
	}
	caddyBytes, _ = os.ReadFile(caddyPath)
	if strings.Contains(string(caddyBytes), "demo.example.com") {
		t.Errorf("expected demo.example.com removed from Caddyfile:\n%s", string(caddyBytes))
	}
}

func TestPaasDeployRejectsInjection(t *testing.T) {
	db := openTestPaasDB(t)
	runner := func(_ context.Context, _ string, _ ...string) (string, error) {
		t.Fatal("docker runner must not be called on invalid payload")
		return "", nil
	}
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
	mux := http.NewServeMux()
	mgr.MountRoutes(mux, "test-token")

	badPayloads := []PaasDeployRequest{
		{Slug: "bad;id", TenantID: "t1", Image: "nginx:latest", Port: 80},
		{Slug: "ok-app", TenantID: "t1", Image: "--privileged", Port: 80},
		{Slug: "ok-app", TenantID: "t1", Image: "nginx:latest", Port: 80, Domain: "a.com\n{\nreverse_proxy 127.0.0.1:3003\n}"},
		{Slug: "ok-app", TenantID: "t1", Image: "nginx:latest", Port: 0},
		{Slug: "ok-app", TenantID: "t1", Image: "nginx:latest", Port: 80, Env: map[string]string{"BAD-KEY": "val"}},
	}

	for i, p := range badPayloads {
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(p)
		req := httptest.NewRequest(http.MethodPost, "/paas/apps/deploy", &buf)
		req.Header.Set("X-Control-Plane-Token", "test-token")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("case %d: expected 400, got %d: %s", i, rec.Code, rec.Body.String())
		}
	}
}
