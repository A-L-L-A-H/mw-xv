package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStatelessAgentWithNilDB(t *testing.T) {
	dockerBin := writeDockerMock(t)
	token := "stateless-test-token"
	t.Setenv("MW_INTERNAL_SECRET", "")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("MW_CONTROL_PLANE_TOKEN", token)

	handler := buildMux(nil, dockerBin, token)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected /health 200 with nil DB, got %d: %s", rec.Code, rec.Body.String())
	}
	var health map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &health); err != nil {
		t.Fatalf("unmarshal health: %v", err)
	}
	if health["status"] != "ok" {
		t.Fatalf("expected status ok, got %v", health["status"])
	}
	if dbMap, ok := health["database"].(map[string]any); !ok || dbMap["status"] != "ok" {
		t.Fatalf("expected database status ok, got %v", health["database"])
	}
	if strings.Contains(rec.Body.String(), "sqlite") {
		t.Fatalf("health must not emit the word sqlite: %s", rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/agent/metrics", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected /agent/metrics 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var metrics AgentMetricsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &metrics); err != nil {
		t.Fatalf("unmarshal metrics: %v", err)
	}
	if !metrics.Stateless {
		t.Fatal("expected metrics.stateless to be true")
	}
	if metrics.DockerStatus != "ok" {
		t.Fatalf("expected dockerStatus ok, got %q", metrics.DockerStatus)
	}
	if metrics.DockerVersion == "" {
		t.Fatal("expected non-empty dockerVersion")
	}
}

func newAgentMux(t *testing.T, runner CommandRunner, adminToken string) http.Handler {
	t.Helper()
	caddyMgr := NewCaddyManager(filepath.Join(t.TempDir(), "Caddyfile"), "caddy", true, runner)
	caddyMgr.ConfigureContainerReload("docker", "moonwitness-caddy")
	mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), caddyMgr, runner)
	mgr.SetAdminToken(adminToken)
	mux := http.NewServeMux()
	mux.HandleFunc("/agent/caddy/reconcile", requirePrivilegedPaasAuth(adminToken, mgr.handleAgentCaddyReconcile()))
	mux.HandleFunc("/agent/compose/up", requirePrivilegedPaasAuth(adminToken, mgr.handleAgentComposeUp()))
	mux.HandleFunc("/agent/containers/", requirePaasAuth(adminToken, mgr.handleAgentContainerSubroutes()))
	mux.HandleFunc("/agent/containers/run", requirePrivilegedPaasAuth(adminToken, mgr.handleAgentContainerRun()))
	mux.HandleFunc("/agent/git/deploy", requirePrivilegedPaasAuth(adminToken, mgr.handleAgentGitDeploy()))
	mux.HandleFunc("/agent/dns/verify", requirePaasAuth(adminToken, mgr.handleAgentDnsVerify()))
	return mux
}

func doAgentRequest(t *testing.T, handler http.Handler, method, path, authz, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var reader = strings.NewReader(body)
	req := httptest.NewRequest(method, path, reader)
	if authz != "" {
		req.Header.Set("Authorization", authz)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var out map[string]any
	if len(rec.Body.Bytes()) > 0 && rec.Body.Bytes()[0] == '{' {
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
	}
	return rec, out
}

func TestAgentCaddyReconcileModesAndGuards(t *testing.T) {
	t.Run("valid bootstrap and preview renders deterministic caddy reload", func(t *testing.T) {
		var cmds []recordedCmd
		runner := func(_ context.Context, _ string, args ...string) (string, error) {
			cmds = append(cmds, recordedCmd{args: append([]string(nil), args...)})
			return "", nil
		}
		const adminToken = "test-token-reconcile"
		t.Setenv("MW_INTERNAL_SECRET", "raw-secret-value")
		handler := newAgentMux(t, runner, adminToken)

		body := `{
			"publicPort": 8000,
			"publicPortEnabled": true,
			"bootstrapUpstream": "moonwitness_board:8080",
			"previewListeners": [{"slug": "app1", "port": 8001, "upstream": "mw-paas-app1:8080"}],
			"routes": [{"slug": "app1", "tenantId": "default", "domain": "app1.example.com", "port": 8080}]
		}`
		rec, out := doAgentRequest(t, handler, http.MethodPost, "/agent/caddy/reconcile", "Bearer "+adminToken, body)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if out["ok"] != true {
			t.Fatalf("expected ok true, got %v", out["ok"])
		}

		foundReload := false
		for _, cmd := range cmds {
			if len(cmd.args) > 1 && cmd.args[0] == "exec" && cmd.args[2] == "caddy" && cmd.args[3] == "reload" {
				foundReload = true
				break
			}
		}
		if !foundReload {
			t.Fatalf("expected caddy reload to be attempted: %+v", cmds)
		}

		// Verify deterministic content in Caddyfile
		caddyManager := NewCaddyManager(filepath.Join(t.TempDir(), "Caddyfile"), "caddy", false, runner)
		content, err := caddyManager.ReconcileDeclarative(context.Background(),
			CaddyBootstrapListener{Enabled: true, Port: 8000, Upstream: "moonwitness_board:8080"},
			[]CaddyPreviewListener{{Slug: "app1", Port: 8001, Upstream: "mw-paas-app1:8080"}},
			[]CaddyRoute{{Slug: "app1", TenantID: "default", Domain: "app1.example.com", Port: 8080}})
		if err != nil {
			t.Fatalf("ReconcileDeclarative failed: %v", err)
		}
		if !strings.Contains(content, "admin localhost:2019") {
			t.Fatal("missing admin localhost:2019")
		}
		if !strings.Contains(content, ":8000 {") || !strings.Contains(content, ":8001 {") {
			t.Fatalf("missing ports in caddyfile:\n%s", content)
		}
		if !strings.Contains(content, "reverse_proxy moonwitness_board:8080") {
			t.Fatalf("missing bootstrap upstream:\n%s", content)
		}

		// Verify HTTPS lockdown (publicPortEnabled: false with routes) removes :8000 and :8001.
		lockedContent, err := caddyManager.ReconcileDeclarative(context.Background(),
			CaddyBootstrapListener{Enabled: false},
			[]CaddyPreviewListener{{Slug: "app1", Port: 8001, Upstream: "mw-paas-app1:8080"}},
			[]CaddyRoute{{Slug: "app1", TenantID: "default", Domain: "app1.example.com", Port: 8080}})
		if err != nil {
			t.Fatalf("ReconcileDeclarative lockdown failed: %v", err)
		}
		if strings.Contains(lockedContent, ":8000") || strings.Contains(lockedContent, ":8001") {
			t.Fatalf("expected :8000 and :8001 removed on lockdown:\n%s", lockedContent)
		}
		if !strings.Contains(lockedContent, "app1.example.com {") {
			t.Fatalf("expected domain route kept on lockdown:\n%s", lockedContent)
		}
	})

	t.Run("caddy reload failure falls back to docker restart", func(t *testing.T) {
		var cmds []recordedCmd
		runner := func(_ context.Context, _ string, args ...string) (string, error) {
			cmds = append(cmds, recordedCmd{args: append([]string(nil), args...)})
			if len(args) >= 4 && args[0] == "exec" && args[2] == "caddy" && args[3] == "reload" {
				return "", context.DeadlineExceeded
			}
			return "", nil
		}
		const adminToken = "test-token-fallback"
		handler := newAgentMux(t, runner, adminToken)
		body := `{"publicPort": 8000, "publicPortEnabled": true, "bootstrapUpstream": "moonwitness_board:8080"}`
		rec, _ := doAgentRequest(t, handler, http.MethodPost, "/agent/caddy/reconcile", "Bearer "+adminToken, body)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 on restart fallback, got %d: %s", rec.Code, rec.Body.String())
		}
		foundRestart := false
		for _, cmd := range cmds {
			if len(cmd.args) == 2 && cmd.args[0] == "restart" && cmd.args[1] == "moonwitness-caddy" {
				foundRestart = true
				break
			}
		}
		if !foundRestart {
			t.Fatalf("expected docker restart moonwitness-caddy fallback, got: %+v", cmds)
		}
	})

	t.Run("lockout rejects disabling bootstrap without routes", func(t *testing.T) {
		runner := func(_ context.Context, _ string, args ...string) (string, error) {
			return "", nil
		}
		const adminToken = "test-token-lockout"
		handler := newAgentMux(t, runner, adminToken)
		body := `{"publicPortEnabled": false, "routes": []}`
		rec, _ := doAgentRequest(t, handler, http.MethodPost, "/agent/caddy/reconcile", "Bearer "+adminToken, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 on lockout, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("duplicate domains are rejected", func(t *testing.T) {
		runner := func(_ context.Context, _ string, args ...string) (string, error) {
			return "", nil
		}
		const adminToken = "test-token-dup"
		handler := newAgentMux(t, runner, adminToken)
		body := `{
			"publicPortEnabled": false,
			"routes": [
				{"slug": "app1", "tenantId": "default", "domain": "dup.example.com", "port": 8080},
				{"slug": "app2", "tenantId": "default", "domain": "dup.example.com", "port": 8081}
			]
		}`
		rec, _ := doAgentRequest(t, handler, http.MethodPost, "/agent/caddy/reconcile", "Bearer "+adminToken, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 on duplicate domain, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("private upstream is rejected", func(t *testing.T) {
		runner := func(_ context.Context, _ string, args ...string) (string, error) {
			return "", nil
		}
		const adminToken = "test-token-private"
		handler := newAgentMux(t, runner, adminToken)
		body := `{
			"publicPortEnabled": true,
			"bootstrapUpstream": "control-plane:3003",
			"routes": []
		}`
		rec, _ := doAgentRequest(t, handler, http.MethodPost, "/agent/caddy/reconcile", "Bearer "+adminToken, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 on private upstream, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("raw internal secret is rejected with 401", func(t *testing.T) {
		t.Setenv("MW_INTERNAL_SECRET", "raw-internal-secret")
		runner := func(_ context.Context, _ string, args ...string) (string, error) {
			return "", nil
		}
		const adminToken = "test-token-canonical"
		handler := newAgentMux(t, runner, adminToken)
		body := `{"publicPortEnabled": true, "bootstrapUpstream": "moonwitness_board:8080"}`
		rec, _ := doAgentRequest(t, handler, http.MethodPost, "/agent/caddy/reconcile", "Bearer raw-internal-secret", body)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for raw MW_INTERNAL_SECRET, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

func TestAgentComposeUpInlineFilesAndGuards(t *testing.T) {
	t.Run("valid inline config file writes cleanly and runs compose up", func(t *testing.T) {
		var cmds []recordedCmd
		tmpDir := t.TempDir()
		dataDir := filepath.Join(tmpDir, "control-plane")
		t.Setenv("MW_CONTROL_PLANE_DB_PATH", filepath.Join(dataDir, "cp.db"))

		runner := func(_ context.Context, name string, args ...string) (string, error) {
			cmds = append(cmds, recordedCmd{name: name, args: append([]string(nil), args...)})
			if len(args) > 0 && args[0] == "compose" && args[2] == "-p" {
				// docker compose up -d --remove-orphans
				return "", nil
			}
			return "", nil
		}
		mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
		mgr.SetAdminToken("test-token-compose")

		body := `{
			"slug": "nginx-test",
			"composeSpec": "services:\n  nginx:\n    image: nginx:latest\n    ports:\n      - \"8080:80\"\n    volumes:\n      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro\n",
			"env": {"TEST_VAR": "hello"},
			"files": {"nginx/nginx.conf": "events {}\nhttp {}\n"}
		}`

		req := httptest.NewRequest(http.MethodPost, "/agent/compose/up", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token-compose")
		rec := httptest.NewRecorder()
		mgr.handleAgentComposeUp()(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
		}

		filePath := filepath.Join(dataDir, "stacks", "nginx-test", "nginx", "nginx.conf")
		if _, err := os.Stat(filePath); err != nil {
			t.Fatalf("expected nginx.conf to exist: %v", err)
		}

		foundComposeUp := false
		for _, cmd := range cmds {
			if len(cmd.args) > 1 && cmd.args[0] == "compose" && cmd.args[1] == "-p" {
				foundComposeUp = true
				break
			}
		}
		if !foundComposeUp {
			t.Fatalf("expected docker compose up to be called: %+v", cmds)
		}
	})

	t.Run("path traversal is rejected with 400", func(t *testing.T) {
		runner := func(_ context.Context, name string, args ...string) (string, error) {
			return "", nil
		}
		mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
		mgr.SetAdminToken("test-token-traversal")
		body := `{
			"slug": "evil-test",
			"composeSpec": "services:\n  app:\n    image: nginx\n    volumes:\n      - ./../evil:/host\n",
			"files": {"../evil": "escape"}
		}`
		req := httptest.NewRequest(http.MethodPost, "/agent/compose/up", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token-traversal")
		rec := httptest.NewRecorder()
		mgr.handleAgentComposeUp()(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 on traversal, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("unlisted host bind mount is rejected with 400", func(t *testing.T) {
		runner := func(_ context.Context, name string, args ...string) (string, error) {
			return "", nil
		}
		mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
		mgr.SetAdminToken("test-token-unlisted")
		body := `{
			"slug": "host-bind-test",
			"composeSpec": "services:\n  app:\n    image: nginx\n    volumes:\n      - /etc/passwd:/host\n",
			"files": {}
		}`
		req := httptest.NewRequest(http.MethodPost, "/agent/compose/up", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token-unlisted")
		rec := httptest.NewRecorder()
		mgr.handleAgentComposeUp()(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 on unlisted host bind, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("SYS_ADMIN capability is rejected with 400", func(t *testing.T) {
		runner := func(_ context.Context, name string, args ...string) (string, error) {
			return "", nil
		}
		mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
		mgr.SetAdminToken("test-token-sysadmin")
		body := `{
			"slug": "sysadmin-test",
			"composeSpec": "services:\n  app:\n    image: nginx\n    cap_add:\n      - SYS_ADMIN\n",
			"files": {}
		}`
		req := httptest.NewRequest(http.MethodPost, "/agent/compose/up", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token-sysadmin")
		rec := httptest.NewRecorder()
		mgr.handleAgentComposeUp()(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 on SYS_ADMIN, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

func TestAgentDnsVerifyStates(t *testing.T) {
	t.Run("matched status and strict tls pass", func(t *testing.T) {
		runner := func(_ context.Context, name string, args ...string) (string, error) {
			return "", nil
		}
		mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
		mgr.SetAdminToken("test-token-dns")

		mgr.dnsLookupIP = func(_ context.Context, host string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("163.61.134.104")}}, nil
		}
		mgr.httpsProbe = func(_ context.Context, rawURL string) error {
			return nil
		}

		body := `{
			"instanceDomain": "apps.moonwitness.biz.id",
			"wildcardDomain": "moonwitness.biz.id",
			"whatsappDomain": "wa.apps.moonwitness.biz.id",
			"expectedIpv4": "163.61.134.104",
			"checkHttps": true
		}`
		req := httptest.NewRequest(http.MethodPost, "/agent/dns/verify", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token-dns")
		rec := httptest.NewRecorder()
		mgr.handleAgentDnsVerify()(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if out["allMatched"] != true {
			t.Fatalf("expected allMatched true, got %v", out["allMatched"])
		}
		if httpsReady, ok := out["httpsReady"].(map[string]any); !ok || httpsReady["tlsVerified"] != true {
			t.Fatalf("expected httpsReady tlsVerified true, got %v", out["httpsReady"])
		}
	})

	t.Run("different ip sets warning and false matched", func(t *testing.T) {
		runner := func(_ context.Context, name string, args ...string) (string, error) {
			return "", nil
		}
		mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
		mgr.SetAdminToken("test-token-dns-ip")
		mgr.dnsLookupIP = func(_ context.Context, host string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("1.2.3.4")}}, nil
		}

		body := `{"instanceDomain": "apps.moonwitness.biz.id", "expectedIpv4": "163.61.134.104"}`
		req := httptest.NewRequest(http.MethodPost, "/agent/dns/verify", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token-dns-ip")
		rec := httptest.NewRecorder()
		mgr.handleAgentDnsVerify()(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if out["allMatched"] != false {
			t.Fatalf("expected allMatched false, got %v", out["allMatched"])
		}
	})

	t.Run("synthetic wildcard host is probed", func(t *testing.T) {
		var probedHosts []string
		runner := func(_ context.Context, name string, args ...string) (string, error) {
			return "", nil
		}
		mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
		mgr.SetAdminToken("test-token-synthetic")
		mgr.dnsLookupIP = func(_ context.Context, host string) ([]net.IPAddr, error) {
			probedHosts = append(probedHosts, host)
			return []net.IPAddr{{IP: net.ParseIP("163.61.134.104")}}, nil
		}

		body := `{"wildcardDomain": "moonwitness.biz.id"}`
		req := httptest.NewRequest(http.MethodPost, "/agent/dns/verify", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token-synthetic")
		rec := httptest.NewRecorder()
		mgr.handleAgentDnsVerify()(rec, req)
		if len(probedHosts) == 0 || probedHosts[0] != "mw-dns-check.moonwitness.biz.id" {
			t.Fatalf("expected synthetic mw-dns-check.moonwitness.biz.id probe, got %v", probedHosts)
		}
	})

	t.Run("unresolved domain and strict tls failure", func(t *testing.T) {
		runner := func(_ context.Context, name string, args ...string) (string, error) {
			return "", nil
		}
		mgr := NewPaasManager(nil, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
		mgr.SetAdminToken("test-token-unresolved")
		mgr.dnsLookupIP = func(_ context.Context, _ string) ([]net.IPAddr, error) {
			return nil, &net.DNSError{Err: "no such host", IsNotFound: true}
		}
		mgr.httpsProbe = func(_ context.Context, _ string) error {
			return context.DeadlineExceeded
		}

		body := `{"instanceDomain": "missing.moonwitness.biz.id", "expectedIpv4": "163.61.134.104", "checkHttps": true}`
		req := httptest.NewRequest(http.MethodPost, "/agent/dns/verify", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token-unresolved")
		rec := httptest.NewRecorder()
		mgr.handleAgentDnsVerify()(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if inst, ok := out["instance"].(map[string]any); !ok || inst["status"] != "unresolved" {
			t.Fatalf("expected unresolved status, got %v", out["instance"])
		}
		if httpsReady, ok := out["httpsReady"].(map[string]any); !ok || httpsReady["tlsVerified"] != false || httpsReady["reachable"] != false {
			t.Fatalf("expected httpsReady tlsVerified=false reachable=false, got %v", out["httpsReady"])
		}
	})
}

func TestAgentPrivilegedRoutesRejectRawInternalSecret(t *testing.T) {
	rawSecret := "raw-internal-secret-for-test"
	t.Setenv("MW_INTERNAL_SECRET", rawSecret)
	t.Setenv("MW_CONTROL_PLANE_TOKEN", "")
	canonicalToken, err := resolveAdminToken(filepath.Join(t.TempDir(), "cp.db"))
	if err != nil {
		t.Fatalf("resolveAdminToken: %v", err)
	}

	dockerBin := writeDockerMock(t)
	handler := buildMux(nil, dockerBin, canonicalToken)

	paths := []string{
		"/agent/caddy/reconcile",
		"/agent/containers/run",
		"/agent/compose/up",
		"/agent/git/deploy",
		"/agent/containers/demo-app/start",
		"/agent/containers/demo-app/delete",
	}
	for _, p := range paths {
		req := httptest.NewRequest(http.MethodPost, p, strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer "+rawSecret)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s with raw MW_INTERNAL_SECRET: expected 401, got %d: %s", p, rec.Code, rec.Body.String())
		}

		// Canonical derived token passes authentication (validation error 400 or docker error, never 401).
		authReq := httptest.NewRequest(http.MethodPost, p, strings.NewReader("{}"))
		authReq.Header.Set("Authorization", "Bearer "+canonicalToken)
		authRec := httptest.NewRecorder()
		handler.ServeHTTP(authRec, authReq)
		if authRec.Code == http.StatusUnauthorized {
			t.Fatalf("%s with canonical derived token: unexpected 401: %s", p, authRec.Body.String())
		}
	}
}
