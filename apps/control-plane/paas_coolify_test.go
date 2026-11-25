package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestNewPaasManagerEnvAliasesAndStaticRoutes(t *testing.T) {
	tmpDir := t.TempDir()
	caddyPath := filepath.Join(tmpDir, "Caddyfile")
	dbPath := filepath.Join(tmpDir, "cp.db")

	t.Setenv("MW_PAAS_CADDYFILE_PATH", "")
	t.Setenv("MW_PAAS_CADDYFILE", caddyPath)
	t.Setenv("MW_PAAS_DOCKER_NETWORK", "")
	t.Setenv("MW_PAAS_NETWORK", "mw-mesh-net")
	t.Setenv("MW_PAAS_CADDY_CONTAINER", "moonwitness-caddy")
	t.Setenv("MW_PAAS_CADDY_RELOAD", "")
	t.Setenv("MW_PAAS_BASE_DOMAIN", "apps.example.com")
	t.Setenv("MW_PAAS_UI_DOMAIN", "paas.example.com")
	t.Setenv("MW_PAAS_UI_UPSTREAM", "moonwitness-control-plane:3004")
	t.Setenv("MW_PAAS_STATIC_ROUTES", "docs.example.com=docs-web:8080")
	t.Setenv("MW_CONTROL_PLANE_DB_PATH", dbPath)

	var cmds []recordedCmd
	runner := func(_ context.Context, name string, args ...string) (string, error) {
		cmds = append(cmds, recordedCmd{name: name, args: append([]string(nil), args...)})
		// Simulate a failed zero-downtime `caddy reload` so the caller falls
		// back to `docker restart`, which this test asserts happens when a
		// Caddy container is configured.
		if name == "docker" && len(args) > 1 && args[0] == "exec" {
			sliceContains := func(arr []string, target string) bool {
				for _, a := range arr {
					if a == target {
						return true
					}
				}
				return false
			}
			if sliceContains(args, "caddy") && sliceContains(args, "reload") {
				return "", fmt.Errorf("caddy reload failed: exit status 1")
			}
		}
		return "", nil
	}

	db := openTestPaasDB(t)
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), nil, runner)

	if mgr.dockerNetwork != "mw-mesh-net" {
		t.Fatalf("expected fallback dockerNetwork mw-mesh-net, got %q", mgr.dockerNetwork)
	}
	if mgr.baseDomain != "apps.example.com" {
		t.Fatalf("expected baseDomain apps.example.com, got %q", mgr.baseDomain)
	}
	if mgr.dataDir != tmpDir {
		t.Fatalf("expected dataDir %q, got %q", tmpDir, mgr.dataDir)
	}
	if err := mgr.SyncCaddyRoutesOnStartup(context.Background()); err != nil {
		t.Fatalf("SyncCaddyRoutesOnStartup: %v", err)
	}

	raw, err := os.ReadFile(caddyPath)
	if err != nil {
		t.Fatalf("read Caddyfile: %v", err)
	}
	content := string(raw)
	if !strings.Contains(content, "paas.example.com {") || !strings.Contains(content, "reverse_proxy moonwitness-control-plane:3004 {") {
		t.Fatalf("missing UI static route in Caddyfile:\n%s", content)
	}
	if !strings.Contains(content, "docs.example.com {") || !strings.Contains(content, "reverse_proxy docs-web:8080 {") {
		t.Fatalf("missing extra static route in Caddyfile:\n%s", content)
	}

	foundRestart := false
	for _, c := range cmds {
		if c.name == "docker" && strings.Join(c.args, " ") == "restart moonwitness-caddy" {
			foundRestart = true
		}
	}
	if !foundRestart {
		t.Fatalf("expected docker restart moonwitness-caddy, got %+v", cmds)
	}

	if runtime.GOOS != "windows" {
		info, err := os.Stat(caddyPath)
		if err != nil {
			t.Fatalf("stat Caddyfile: %v", err)
		}
		if info.Mode().Perm() != 0o644 {
			t.Fatalf("expected Caddyfile mode 0644, got %o", info.Mode().Perm())
		}
	}
}

func TestCaddyStaticRoutesRejectPrivateServicesAndInjection(t *testing.T) {
	cm := NewCaddyManager("", "caddy", false, nil)
	badRoutes := []CaddyStaticRoute{
		{Domain: "evil.example.com", Upstream: "control-plane:3003"},
		{Domain: "evil.example.com", Upstream: "moonwitness-postgres:5432"},
		{Domain: "evil.example.com", Upstream: "postgres:5432"},
		{Domain: "evil.example.com", Upstream: "127.0.0.1:3003"},
		{Domain: "evil.example.com", Upstream: "127.0.0.1:5432"},
		{Domain: "evil.example.com", Upstream: "moonwitness-control-plane:3003"},
		{Domain: "evil.example.com", Upstream: "web:80\n{\nreverse_proxy 127.0.0.1:3003\n}"},
		{Domain: "evil.example.com", Upstream: "web:80;id"},
		{Domain: "localhost", Upstream: "web:80"},
	}
	for _, rt := range badRoutes {
		if err := cm.SetStaticRoutes([]CaddyStaticRoute{rt}); err == nil {
			t.Errorf("expected static route %+v to be rejected", rt)
		}
	}
}

func TestNormalizeAndValidateDeployRequestExtensions(t *testing.T) {
	// Direct ValidateDeployRequest must remain strict on empty TenantID.
	if err := ValidateDeployRequest(PaasDeployRequest{Slug: "web", Image: "nginx:alpine", Port: 80}); err == nil {
		t.Fatal("expected strict ValidateDeployRequest to reject empty TenantID")
	}

	// normalizeDeployRequest fills tenant & auto-domain unless NoAutoDomain.
	norm := normalizeDeployRequest(PaasDeployRequest{
		Slug:  "api",
		Image: "nginx:alpine",
		Port:  8080,
	}, "paas.example.com")
	if norm.TenantID != "default" {
		t.Fatalf("expected default tenant, got %q", norm.TenantID)
	}
	if norm.Domain != "api.paas.example.com" {
		t.Fatalf("expected auto-domain api.paas.example.com, got %q", norm.Domain)
	}

	noAuto := normalizeDeployRequest(PaasDeployRequest{
		Slug:         "worker",
		Tenant:       "acme",
		Image:        "nginx:alpine",
		Port:         8080,
		NoAutoDomain: true,
	}, "paas.example.com")
	if noAuto.TenantID != "acme" || noAuto.Domain != "" {
		t.Fatalf("unexpected noAuto normalization: %+v", noAuto)
	}

	// Valid volumes, memory, cpu
	valid := PaasDeployRequest{
		Slug:        "api",
		TenantID:    "default",
		Image:       "nginx:alpine",
		Port:        80,
		Volumes:     []string{"app_data:/data:rw", "cache-vol:/cache:ro"},
		MemoryLimit: "512m",
		CPULimit:    "1.50",
	}
	if err := ValidateDeployRequest(valid); err != nil {
		t.Fatalf("expected valid extended request, got: %v", err)
	}

	mgr := &PaasManager{dockerNetwork: "mw-net"}
	args := mgr.buildDockerRunArgs(valid, "mw-paas-api")
	joined := strings.Join(args, " ")
	for _, want := range []string{"-v app_data:/data:rw", "-v cache-vol:/cache:ro", "--memory 512m", "--cpus 1.50"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("docker run args missing %q: %s", want, joined)
		}
	}

	// Reject host bind mounts, traversal, invalid memory/cpu
	invalids := []PaasDeployRequest{
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, Volumes: []string{"/etc:/etc"}},
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, Volumes: []string{"/var/run/docker.sock:/var/run/docker.sock"}},
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, Volumes: []string{"vol:/data/../etc"}},
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, Volumes: []string{"-v:/data"}},
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, MemoryLimit: "0m"},
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, MemoryLimit: "512mb"},
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, CPULimit: "0"},
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, CPULimit: "65"},
		{Slug: "a", TenantID: "t1", Image: "nginx", Port: 80, CPULimit: "-1"},
	}
	for i, bad := range invalids {
		if err := ValidateDeployRequest(bad); err == nil {
			t.Errorf("case %d: expected validation error for %+v", i, bad)
		}
	}
}

func TestCoolifyAppEndpointsLifecycleAndAuth(t *testing.T) {
	t.Setenv("MW_INTERNAL_SECRET", "raw-internal-secret-value")
	t.Setenv("MW_CONTROL_PLANE_TOKEN", "")
	t.Setenv("MW_PAAS_BASE_DOMAIN", "apps.example.com")

	dbPath := filepath.Join(t.TempDir(), "coolify.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := initPaasSchema(db); err != nil {
		t.Fatalf("initPaasSchema: %v", err)
	}

	caddyPath := filepath.Join(t.TempDir(), "Caddyfile")
	var cmds []recordedCmd
	existing := false
	runner := func(_ context.Context, name string, args ...string) (string, error) {
		cmds = append(cmds, recordedCmd{name: name, args: append([]string(nil), args...)})
		if len(args) == 0 {
			return "", nil
		}
		switch args[0] {
		case "version":
			return "27.1.0\n", nil
		case "ps":
			for _, a := range args {
				if strings.HasPrefix(a, "name=^/") {
					if existing {
						return "cid123456789\n", nil
					}
					return "", nil
				}
			}
			if existing {
				return "mw-paas-hello\tcid123456789\trunning\n", nil
			}
			return "", nil
		case "run":
			existing = true
			return "cid123456789abcdef\n", nil
		case "rename":
			existing = true
			return "", nil
		}
		return "", nil
	}

	caddyMgr := NewCaddyManager(caddyPath, "caddy", false, runner)
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), caddyMgr, runner)
	const adminToken = "privileged-admin-token-xyz"
	mux := http.NewServeMux()
	mgr.MountRoutes(mux, adminToken)

	// POST /paas/apps must reject raw MW_INTERNAL_SECRET with 401.
	unauthReq := httptest.NewRequest(http.MethodPost, "/paas/apps", strings.NewReader(`{"slug":"hello","image":"nginx:1.27-alpine","port":80}`))
	unauthReq.Header.Set("X-Control-Plane-Token", "raw-internal-secret-value")
	unauthRec := httptest.NewRecorder()
	mux.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("POST /paas/apps with raw internal secret: expected 401, got %d", unauthRec.Code)
	}

	// POST /paas/apps with privileged token auto-fills tenant=default and domain=hello.apps.example.com.
	deployReq := httptest.NewRequest(http.MethodPost, "/paas/apps", strings.NewReader(`{
		"slug": "hello",
		"image": "nginx:1.27-alpine",
		"port": 80,
		"volumes": ["hello_data:/usr/share/nginx/html:ro"],
		"memoryLimit": "256m",
		"cpuLimit": "0.5",
		"env": {"API_SECRET": "topsecret123", "PUBLIC_VAR": "ok"}
	}`))
	deployReq.Header.Set("Authorization", "Bearer "+adminToken)
	deployRec := httptest.NewRecorder()
	mux.ServeHTTP(deployRec, deployReq)
	if deployRec.Code != http.StatusCreated {
		t.Fatalf("POST /paas/apps: expected 201, got %d: %s", deployRec.Code, deployRec.Body.String())
	}

	var depResp paasAppDeployResponse
	if err := json.Unmarshal(deployRec.Body.Bytes(), &depResp); err != nil {
		t.Fatalf("decode deploy response: %v", err)
	}
	if depResp.ID != "hello" || depResp.AppID != "hello" || depResp.DeploymentID == "" {
		t.Fatalf("missing enriched IDs in deploy response: %+v", depResp)
	}
	if depResp.TenantID != "default" || depResp.Tenant != "default" {
		t.Fatalf("expected default tenant, got %q / %q", depResp.TenantID, depResp.Tenant)
	}
	if depResp.Domain != "hello.apps.example.com" || depResp.URL != "https://hello.apps.example.com" {
		t.Fatalf("expected auto-domain URL, got domain=%q url=%q", depResp.Domain, depResp.URL)
	}

	// GET /paas/metrics
	mReq := httptest.NewRequest(http.MethodGet, "/paas/metrics", nil)
	mReq.Header.Set("Authorization", "Bearer "+adminToken)
	mRec := httptest.NewRecorder()
	mux.ServeHTTP(mRec, mReq)
	if mRec.Code != http.StatusOK {
		t.Fatalf("GET /paas/metrics: expected 200, got %d", mRec.Code)
	}
	var metrics PaasNodeMetrics
	if err := json.Unmarshal(mRec.Body.Bytes(), &metrics); err != nil {
		t.Fatalf("decode metrics: %v", err)
	}
	if metrics.TotalApps != 1 || metrics.RunningApps != 1 || metrics.BaseDomain != "apps.example.com" {
		t.Fatalf("unexpected metrics: %+v", metrics)
	}

	// GET /paas/apps/:slug
	getReq := httptest.NewRequest(http.MethodGet, "/paas/apps/hello", nil)
	getReq.Header.Set("Authorization", "Bearer "+adminToken)
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET /paas/apps/hello: expected 200, got %d", getRec.Code)
	}

	// PUT /paas/apps/:slug/env preserving [REDACTED]
	envReq := httptest.NewRequest(http.MethodPut, "/paas/apps/hello/env", strings.NewReader(`{
		"env": {"API_SECRET": "[REDACTED]", "PUBLIC_VAR": "updated", "NEW_KEY": "added"}
	}`))
	envReq.Header.Set("Authorization", "Bearer "+adminToken)
	envRec := httptest.NewRecorder()
	mux.ServeHTTP(envRec, envReq)
	if envRec.Code != http.StatusOK {
		t.Fatalf("PUT /env: expected 200, got %d: %s", envRec.Code, envRec.Body.String())
	}
	storedApp, err := mgr.getAppFromDB("hello")
	if err != nil {
		t.Fatalf("getAppFromDB: %v", err)
	}
	if storedApp.Env["API_SECRET"] != "topsecret123" {
		t.Fatalf("expected preserved API_SECRET, got %q", storedApp.Env["API_SECRET"])
	}
	if storedApp.Env["PUBLIC_VAR"] != "updated" || storedApp.Env["NEW_KEY"] != "added" {
		t.Fatalf("unexpected stored env: %+v", storedApp.Env)
	}

	// PUT /paas/apps/:slug/domain
	domReq := httptest.NewRequest(http.MethodPut, "/paas/apps/hello/domain", strings.NewReader(`{"domain":"custom.example.com"}`))
	domReq.Header.Set("Authorization", "Bearer "+adminToken)
	domRec := httptest.NewRecorder()
	mux.ServeHTTP(domRec, domReq)
	if domRec.Code != http.StatusOK {
		t.Fatalf("PUT /domain: expected 200, got %d: %s", domRec.Code, domRec.Body.String())
	}
	caddyRaw, _ := os.ReadFile(caddyPath)
	if !strings.Contains(string(caddyRaw), "custom.example.com") {
		t.Fatalf("expected custom.example.com in Caddyfile:\n%s", string(caddyRaw))
	}

	// Remove domain with empty string
	domClearReq := httptest.NewRequest(http.MethodPatch, "/paas/apps/hello/domain", strings.NewReader(`{"domain":""}`))
	domClearReq.Header.Set("Authorization", "Bearer "+adminToken)
	domClearRec := httptest.NewRecorder()
	mux.ServeHTTP(domClearRec, domClearReq)
	if domClearRec.Code != http.StatusOK {
		t.Fatalf("PATCH /domain empty: expected 200, got %d", domClearRec.Code)
	}

	// POST /paas/apps/:slug/start & /redeploy
	cmds = nil
	startReq := httptest.NewRequest(http.MethodPost, "/paas/apps/hello/start", nil)
	startReq.Header.Set("Authorization", "Bearer "+adminToken)
	startRec := httptest.NewRecorder()
	mux.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusOK {
		t.Fatalf("POST /start: expected 200, got %d", startRec.Code)
	}

	redepReq := httptest.NewRequest(http.MethodPost, "/paas/apps/hello/redeploy", nil)
	redepReq.Header.Set("Authorization", "Bearer "+adminToken)
	redepRec := httptest.NewRecorder()
	mux.ServeHTTP(redepRec, redepReq)
	if redepRec.Code != http.StatusOK {
		t.Fatalf("POST /redeploy: expected 200, got %d: %s", redepRec.Code, redepRec.Body.String())
	}
	pulled := false
	for _, c := range cmds {
		if len(c.args) >= 2 && c.args[0] == "pull" && c.args[1] == "nginx:1.27-alpine" {
			pulled = true
		}
	}
	if !pulled {
		t.Fatalf("expected docker pull nginx:1.27-alpine during redeploy, got %+v", cmds)
	}

	// GET /paas/apps/:slug/deployments
	histReq := httptest.NewRequest(http.MethodGet, "/paas/apps/hello/deployments", nil)
	histReq.Header.Set("Authorization", "Bearer "+adminToken)
	histRec := httptest.NewRecorder()
	mux.ServeHTTP(histRec, histReq)
	if histRec.Code != http.StatusOK {
		t.Fatalf("GET /deployments: expected 200, got %d", histRec.Code)
	}
	var histResp struct {
		Deployments []PaasDeployment `json:"deployments"`
	}
	if err := json.Unmarshal(histRec.Body.Bytes(), &histResp); err != nil {
		t.Fatalf("decode deployments: %v", err)
	}
	if len(histResp.Deployments) < 5 {
		t.Fatalf("expected deployment audit trail entries, got %d", len(histResp.Deployments))
	}

	// GET /paas/templates
	tplReq := httptest.NewRequest(http.MethodGet, "/paas/templates", nil)
	tplReq.Header.Set("Authorization", "Bearer "+adminToken)
	tplRec := httptest.NewRecorder()
	mux.ServeHTTP(tplRec, tplReq)
	if tplRec.Code != http.StatusOK || !strings.Contains(tplRec.Body.String(), "postgres") {
		t.Fatalf("GET /paas/templates unexpected: %d %s", tplRec.Code, tplRec.Body.String())
	}
}

func TestComposeDeployValidationAndCleanup(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("MW_CONTROL_PLANE_DB_PATH", filepath.Join(tmpDir, "cp.db"))

	var cmds []recordedCmd
	runner := func(_ context.Context, name string, args ...string) (string, error) {
		cmds = append(cmds, recordedCmd{name: name, args: append([]string(nil), args...)})
		return "", nil
	}

	db := openTestPaasDB(t)
	caddyMgr := NewCaddyManager(filepath.Join(tmpDir, "Caddyfile"), "caddy", false, runner)
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), caddyMgr, runner)
	const token = "compose-admin-token"
	mux := http.NewServeMux()
	mgr.MountRoutes(mux, token)

	badSpecs := []string{
		"services:\n  web:\n    image: nginx\n    privileged: true\n",
		"services:\n  web:\n    image: nginx\n    network_mode: host\n",
		"services:\n  web:\n    image: nginx\n    pid: host\n",
		"services:\n  web:\n    image: nginx\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
		"services:\n  web:\n    image: nginx\n    volumes:\n      - /etc:/host-etc\n",
		"services:\n  web:\n    image: nginx\n    volumes:\n      - ../secrets:/app/secrets\n",
		strings.Repeat("a", maxComposeSpecBytes+1),
	}
	for i, spec := range badSpecs {
		body, _ := json.Marshal(ComposeDeployRequest{
			Slug:        "bad-stack",
			TenantID:    "default",
			Port:        8080,
			ComposeSpec: spec,
		})
		req := httptest.NewRequest(http.MethodPost, "/paas/apps/deploy-compose", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("badSpec %d: expected 400, got %d: %s", i, rec.Code, rec.Body.String())
		}
	}

	goodSpec := "services:\n  web:\n    image: nginx:1.27-alpine\n    volumes:\n      - webdata:/usr/share/nginx/html\n"
	body, _ := json.Marshal(ComposeDeployRequest{
		Slug:        "good-stack",
		Port:        80,
		Domain:      "stack.example.com",
		ComposeSpec: goodSpec,
	})
	req := httptest.NewRequest(http.MethodPost, "/paas/apps/deploy-compose", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("compose deploy expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	composePath := filepath.Join(tmpDir, "stacks", "good-stack", "docker-compose.yml")
	if _, err := os.Stat(composePath); err != nil {
		t.Fatalf("expected compose file at %s: %v", composePath, err)
	}

	// Delete must invoke docker compose down and remove stack directory.
	cmds = nil
	delReq := httptest.NewRequest(http.MethodDelete, "/paas/apps/good-stack", nil)
	delReq.Header.Set("Authorization", "Bearer "+token)
	delRec := httptest.NewRecorder()
	mux.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete compose stack: expected 200, got %d: %s", delRec.Code, delRec.Body.String())
	}
	foundDown := false
	for _, c := range cmds {
		joined := strings.Join(c.args, " ")
		if strings.Contains(joined, "compose -p mw-paas-good-stack") && strings.Contains(joined, "down --remove-orphans") {
			foundDown = true
		}
	}
	if !foundDown {
		t.Fatalf("expected docker compose down on delete, got %+v", cmds)
	}
	if _, err := os.Stat(filepath.Join(tmpDir, "stacks", "good-stack")); !os.IsNotExist(err) {
		t.Fatalf("expected stack directory removed after delete")
	}
}

func TestPaasUIAuthGateAndHeaders(t *testing.T) {
	t.Setenv("MW_INTERNAL_SECRET", "ui-raw-internal-secret")
	db := openTestPaasDB(t)
	runner := func(_ context.Context, _ string, args ...string) (string, error) {
		if len(args) > 0 && args[0] == "version" {
			return "27.0.0\n", nil
		}
		return "", nil
	}
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
	const adminToken = "ui-privileged-admin-token"
	ui := NewPaasUIHandler(mgr, adminToken)

	// /healthz -> 200
	hReq := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	hRec := httptest.NewRecorder()
	ui.ServeHTTP(hRec, hReq)
	if hRec.Code != http.StatusOK {
		t.Fatalf("/healthz expected 200, got %d", hRec.Code)
	}

	// / -> HTML + CSP + frame headers
	idxReq := httptest.NewRequest(http.MethodGet, "/", nil)
	idxRec := httptest.NewRecorder()
	ui.ServeHTTP(idxRec, idxReq)
	if idxRec.Code != http.StatusOK {
		t.Fatalf("/ expected 200, got %d", idxRec.Code)
	}
	if !strings.Contains(idxRec.Body.String(), "MoonWitness PaaS") {
		t.Fatalf("expected embedded HTML content")
	}
	if idxRec.Header().Get("Content-Security-Policy") == "" || idxRec.Header().Get("X-Frame-Options") != "DENY" || idxRec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("missing security headers on UI HTML: %+v", idxRec.Header())
	}

	// /api/paas/* without token -> 401
	noAuthReq := httptest.NewRequest(http.MethodGet, "/api/paas/metrics", nil)
	noAuthRec := httptest.NewRecorder()
	ui.ServeHTTP(noAuthRec, noAuthReq)
	if noAuthRec.Code != http.StatusUnauthorized {
		t.Fatalf("/api/paas/metrics without token: expected 401, got %d", noAuthRec.Code)
	}

	// /api/paas/* with raw internal secret -> 401 (must require privileged token!)
	rawAuthReq := httptest.NewRequest(http.MethodGet, "/api/paas/metrics", nil)
	rawAuthReq.Header.Set("Authorization", "Bearer ui-raw-internal-secret")
	rawAuthRec := httptest.NewRecorder()
	ui.ServeHTTP(rawAuthRec, rawAuthReq)
	if rawAuthRec.Code != http.StatusUnauthorized {
		t.Fatalf("/api/paas/metrics with raw internal secret: expected 401, got %d", rawAuthRec.Code)
	}

	// /api/paas/* with privileged admin token -> 200
	okReq := httptest.NewRequest(http.MethodGet, "/api/paas/metrics", nil)
	okReq.Header.Set("Authorization", "Bearer "+adminToken)
	okRec := httptest.NewRecorder()
	ui.ServeHTTP(okRec, okReq)
	if okRec.Code != http.StatusOK {
		t.Fatalf("/api/paas/metrics with admin token: expected 200, got %d: %s", okRec.Code, okRec.Body.String())
	}
}

func TestProbeCandidateContainerUsesContainerIP(t *testing.T) {
	statusCode := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(statusCode)
	}))
	defer srv.Close()

	_, portStr, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	port, _ := strconv.Atoi(portStr)

	runner := func(_ context.Context, _ string, args ...string) (string, error) {
		if len(args) > 0 && args[0] == "inspect" {
			return "127.0.0.1 \n", nil
		}
		return "", nil
	}
	mgr := NewPaasManager(openTestPaasDB(t), "docker", NewMeshManagerFromEnv("docker"), NewCaddyManager("", "caddy", false, runner), runner)
	if err := mgr.probeCandidateContainer(context.Background(), "mw-paas-demo-bg-1", port, "/healthz"); err != nil {
		t.Fatalf("expected healthy candidate probe to pass, got: %v", err)
	}

	// Reject link-local metadata IP from docker inspect.
	metaRunner := func(_ context.Context, _ string, args ...string) (string, error) {
		if len(args) > 0 && args[0] == "inspect" {
			return "169.254.169.254 \n", nil
		}
		return "", nil
	}
	mgr.runner = metaRunner
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if err := mgr.probeCandidateContainer(ctx, "mw-paas-demo-bg-1", port, "/healthz"); err == nil {
		t.Fatal("expected metadata IP 169.254.169.254 to be rejected")
	}
}

func TestInitPaasSchemaIdempotentMigration(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	// Seed legacy paas_apps without new columns.
	if _, err := db.Exec(paasSchemaDDL); err != nil {
		t.Fatalf("seed legacy ddl: %v", err)
	}
	if err := initPaasSchema(db); err != nil {
		t.Fatalf("first migration failed: %v", err)
	}
	if err := initPaasSchema(db); err != nil {
		t.Fatalf("second idempotent migration failed: %v", err)
	}
	var cnt int
	if err := db.QueryRow(`SELECT COUNT(*) FROM paas_deployments`).Scan(&cnt); err != nil {
		t.Fatalf("expected paas_deployments table: %v", err)
	}
	if err := db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM pragma_table_info('paas_apps') WHERE name IN ('volumes_json','memory_limit','cpu_limit')")).Scan(&cnt); err != nil || cnt != 3 {
		t.Fatalf("expected 3 migrated columns, got %d (err=%v)", cnt, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM paas_ui_users`).Scan(&cnt); err != nil {
		t.Fatalf("expected paas_ui_users table: %v", err)
	}
}

func TestPaasUIFirstRunSetupLoginCookieAndHostServices(t *testing.T) {
	db := openTestPaasDB(t)
	runner := func(_ context.Context, name string, args ...string) (string, error) {
		if len(args) > 0 && args[0] == "version" {
			return "27.0.0\n", nil
		}
		if len(args) > 0 && args[0] == "ps" {
			for _, a := range args {
				if a == "--format" {
					continue
				}
			}
			return "moonwitness_board\tmoonwitness-board:vps\tUp 5 minutes\trunning\nmoonwitness_whatsapp\tmoonwitness-whatsapp:vps\tUp 5 minutes\trunning\n", nil
		}
		return "", nil
	}
	cm := NewCaddyManager("", "caddy", false, runner)
	if err := cm.SetStaticRoutes([]CaddyStaticRoute{
		{Domain: "paas.apps.moonwitness.biz.id", Upstream: "10.254.2.1:3004"},
		{Domain: "board.apps.moonwitness.biz.id", Upstream: "moonwitness_board:8080"},
		{Domain: "wa.apps.moonwitness.biz.id", Upstream: "moonwitness_whatsapp:3000"},
	}); err != nil {
		t.Fatalf("SetStaticRoutes: %v", err)
	}
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), cm, runner)
	const adminToken = "ui-session-test-admin-token"
	ui := NewPaasUIHandler(mgr, adminToken)

	// 1. Initial auth status requires setup.
	stReq := httptest.NewRequest(http.MethodGet, "/api/auth/status", nil)
	stRec := httptest.NewRecorder()
	ui.ServeHTTP(stRec, stReq)
	if stRec.Code != http.StatusOK || !strings.Contains(stRec.Body.String(), `"setupRequired":true`) {
		t.Fatalf("expected setupRequired:true, got %d %s", stRec.Code, stRec.Body.String())
	}

	// 2. First-run setup creates owner and sets HttpOnly session cookie.
	setupBody := `{"name":"Owner","email":"owner@moonwitness.biz.id","password":"StrongPassword123"}`
	setupReq := httptest.NewRequest(http.MethodPost, "/api/auth/setup", strings.NewReader(setupBody))
	setupRec := httptest.NewRecorder()
	ui.ServeHTTP(setupRec, setupReq)
	if setupRec.Code != http.StatusCreated {
		t.Fatalf("expected setup 201, got %d: %s", setupRec.Code, setupRec.Body.String())
	}
	cookies := setupRec.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == paasSessionCookieName {
			sessionCookie = c
		}
	}
	if sessionCookie == nil || !sessionCookie.HttpOnly {
		t.Fatalf("expected HttpOnly session cookie on setup, got %+v", cookies)
	}

	// 3. Second setup must fail closed with 403.
	setup2Req := httptest.NewRequest(http.MethodPost, "/api/auth/setup", strings.NewReader(setupBody))
	setup2Rec := httptest.NewRecorder()
	ui.ServeHTTP(setup2Rec, setup2Req)
	if setup2Rec.Code != http.StatusForbidden {
		t.Fatalf("expected second setup 403, got %d", setup2Rec.Code)
	}

	// 4. Session cookie grants access to /api/paas/host/services and 12 templates.
	hsReq := httptest.NewRequest(http.MethodGet, "/api/paas/host/services", nil)
	hsReq.AddCookie(sessionCookie)
	hsRec := httptest.NewRecorder()
	ui.ServeHTTP(hsRec, hsReq)
	if hsRec.Code != http.StatusOK || !strings.Contains(hsRec.Body.String(), "board.apps.moonwitness.biz.id") {
		t.Fatalf("expected host services 200 with board domain, got %d: %s", hsRec.Code, hsRec.Body.String())
	}

	tplReq := httptest.NewRequest(http.MethodGet, "/api/paas/templates", nil)
	tplReq.AddCookie(sessionCookie)
	tplRec := httptest.NewRecorder()
	ui.ServeHTTP(tplRec, tplReq)
	var tplResp struct {
		Templates []PaasTemplate `json:"templates"`
	}
	if err := json.Unmarshal(tplRec.Body.Bytes(), &tplResp); err != nil || len(tplResp.Templates) != 12 {
		t.Fatalf("expected 12 templates, got %d (err=%v)", len(tplResp.Templates), err)
	}

	// 5. Tampered cookie must fail closed with 401.
	badCookie := *sessionCookie
	badCookie.Value = sessionCookie.Value + "tampered"
	tamperReq := httptest.NewRequest(http.MethodGet, "/api/paas/metrics", nil)
	tamperReq.AddCookie(&badCookie)
	tamperRec := httptest.NewRecorder()
	ui.ServeHTTP(tamperRec, tamperReq)
	if tamperRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected tampered cookie 401, got %d", tamperRec.Code)
	}

	// 6. Login with wrong password -> 401; right password -> 200.
	badLogin := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"email":"owner@moonwitness.biz.id","password":"wrongpass"}`))
	badLoginRec := httptest.NewRecorder()
	ui.ServeHTTP(badLoginRec, badLogin)
	if badLoginRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected wrong password 401, got %d", badLoginRec.Code)
	}
	okLogin := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"email":"owner@moonwitness.biz.id","password":"StrongPassword123"}`))
	okLoginRec := httptest.NewRecorder()
	ui.ServeHTTP(okLoginRec, okLogin)
	if okLoginRec.Code != http.StatusOK {
		t.Fatalf("expected valid login 200, got %d: %s", okLoginRec.Code, okLoginRec.Body.String())
	}

	// 7. Logout clears cookie.
	outReq := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	outRec := httptest.NewRecorder()
	ui.ServeHTTP(outRec, outReq)
	if outRec.Code != http.StatusOK {
		t.Fatalf("expected logout 200, got %d", outRec.Code)
	}
}
