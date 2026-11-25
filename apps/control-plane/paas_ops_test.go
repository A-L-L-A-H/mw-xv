package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestPaasOpsEnv(t *testing.T, runner CommandRunner) (*PaasManager, *http.ServeMux, string, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "paas-ops-test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := initPaasSchema(db); err != nil {
		t.Fatalf("init paas schema: %v", err)
	}

	caddyPath := filepath.Join(t.TempDir(), "Caddyfile")
	caddyMgr := NewCaddyManager(caddyPath, "caddy", false, runner)
	mgr := NewPaasManager(db, "docker", NewMeshManagerFromEnv("docker"), caddyMgr, runner)
	mgr.backupDir = filepath.Join(t.TempDir(), "backups")

	const token = "test-paas-ops-admin-token"
	mux := http.NewServeMux()
	mgr.MountRoutes(mux, token)
	RegisterGitBuilderRoutes(mux, mgr, token)
	return mgr, mux, token, caddyPath
}

func seedTestApp(t *testing.T, db *sql.DB, slug, containerName, domain string, port int, envMap map[string]string) {
	t.Helper()
	envBytes, _ := json.Marshal(envMap)
	if len(envMap) == 0 {
		envBytes = []byte("{}")
	}
	_, err := db.Exec(`
		INSERT INTO paas_apps (slug, tenant_id, image, port, domain, env_json, container_name, container_id, status)
		VALUES (?, 'tenant-1', 'nginx:alpine', ?, ?, ?, ?, 'abc123def456', 'running')
	`, slug, port, domain, string(envBytes), containerName)
	if err != nil {
		t.Fatalf("seed app: %v", err)
	}
}

func TestShouldAutostartLegacyRegistry(t *testing.T) {
	t.Setenv("MW_CONTROL_PLANE_AUTOSTART_LEGACY", "")
	if shouldAutostartLegacyRegistry() {
		t.Fatalf("expected default MW_CONTROL_PLANE_AUTOSTART_LEGACY to be false")
	}

	t.Setenv("MW_CONTROL_PLANE_AUTOSTART_LEGACY", "false")
	if shouldAutostartLegacyRegistry() {
		t.Fatalf("expected false when MW_CONTROL_PLANE_AUTOSTART_LEGACY=false")
	}

	t.Setenv("MW_CONTROL_PLANE_AUTOSTART_LEGACY", "1")
	if shouldAutostartLegacyRegistry() {
		t.Fatalf("expected false unless explicitly 'true'")
	}

	t.Setenv("MW_CONTROL_PLANE_AUTOSTART_LEGACY", "true")
	if !shouldAutostartLegacyRegistry() {
		t.Fatalf("expected true when MW_CONTROL_PLANE_AUTOSTART_LEGACY=true")
	}

	t.Setenv("MW_CONTROL_PLANE_AUTOSTART_LEGACY", "TRUE")
	if !shouldAutostartLegacyRegistry() {
		t.Fatalf("expected true when MW_CONTROL_PLANE_AUTOSTART_LEGACY=TRUE")
	}
}

func TestAppLogsStreamSSEAndRedaction(t *testing.T) {
	mgr, mux, token, _ := newTestPaasOpsEnv(t, func(ctx context.Context, name string, args ...string) (string, error) {
		return "", nil
	})
	seedTestApp(t, mgr.db, "demo-app", "mw-paas-demo-app", "demo.example.com", 8080, map[string]string{
		"API_SECRET": "super-secret-value-99",
	})

	var capturedArgs []string
	mgr.streamRunner = func(ctx context.Context, onLine func(line string) bool, name string, args ...string) error {
		capturedArgs = append([]string{name}, args...)
		lines := []string{
			"2026-11-23T03:00:00Z started server",
			"2026-11-23T03:00:01Z Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret",
			"2026-11-23T03:00:02Z DB_PASSWORD=hunter2 connected",
			"2026-11-23T03:00:03Z leaked super-secret-value-99 here",
		}
		for _, l := range lines {
			if !onLine(l) {
				break
			}
		}
		return nil
	}

	// Unauthenticated request must fail closed with 401.
	unauthReq := httptest.NewRequest(http.MethodGet, "/paas/apps/demo-app/logs/stream", nil)
	unauthRec := httptest.NewRecorder()
	mux.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", unauthRec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/paas/apps/demo-app/logs/stream?tail=25", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("expected text/event-stream, got %q", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "data: 2026-11-23T03:00:00Z started server\n\n") {
		t.Fatalf("missing expected SSE frame in body: %s", body)
	}
	if strings.Contains(body, "eyJhbGciOiJIUzI1NiJ9") || strings.Contains(body, "hunter2") || strings.Contains(body, "super-secret-value-99") {
		t.Fatalf("secret leaked in SSE stream: %s", body)
	}
	if !strings.Contains(body, "[REDACTED]") {
		t.Fatalf("expected [REDACTED] placeholder in SSE stream: %s", body)
	}
	joined := strings.Join(capturedArgs, " ")
	if joined != "docker logs --follow --timestamps --tail 25 mw-paas-demo-app" {
		t.Fatalf("unexpected docker logs args: %q", joined)
	}
}

func TestAppLogsStreamContextCancellation(t *testing.T) {
	mgr, mux, token, _ := newTestPaasOpsEnv(t, func(ctx context.Context, name string, args ...string) (string, error) {
		return "", nil
	})
	seedTestApp(t, mgr.db, "cancel-app", "mw-paas-cancel-app", "", 3000, nil)

	cancelled := false
	mgr.streamRunner = func(ctx context.Context, onLine func(line string) bool, name string, args ...string) error {
		onLine("first line")
		<-ctx.Done()
		cancelled = true
		return ctx.Err()
	}

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/paas/apps/cancel-app/logs/stream", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	go func() {
		time.Sleep(25 * time.Millisecond)
		cancel()
	}()

	mux.ServeHTTP(rec, req)
	if !cancelled {
		t.Fatalf("expected streamRunner to observe context cancellation")
	}
	if !strings.Contains(rec.Body.String(), "data: first line\n\n") {
		t.Fatalf("expected first line before cancellation, got: %s", rec.Body.String())
	}
}

func TestAppStatsParsingAndEndpoint(t *testing.T) {
	mgr, mux, token, _ := newTestPaasOpsEnv(t, func(ctx context.Context, name string, args ...string) (string, error) {
		if len(args) >= 4 && args[0] == "stats" && args[1] == "--no-stream" && args[2] == "--format" && args[3] == "json" {
			return `{"ID":"abcdef123456","Name":"mw-paas-stats-app","CPUPerc":"12.34%","MemUsage":"64.5MiB / 512MiB","MemPerc":"12.60%","NetIO":"1.2MB / 340kB","BlockIO":"4.1MB / 820kB","PIDs":"14"}`, nil
		}
		return "", errors.New("unexpected command")
	})
	seedTestApp(t, mgr.db, "stats-app", "mw-paas-stats-app", "", 3000, nil)

	req := httptest.NewRequest(http.MethodGet, "/paas/apps/stats-app/stats", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var stats PaasContainerStats
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if stats.CPUPercent != 12.34 || stats.MemUsage != "64.5MiB" || stats.MemLimit != "512MiB" || stats.PIDs != 14 {
		t.Fatalf("unexpected parsed stats: %+v", stats)
	}
	if stats.NetRx != "1.2MB" || stats.NetTx != "340kB" || stats.BlockRead != "4.1MB" || stats.BlockWrite != "820kB" {
		t.Fatalf("unexpected IO stats: %+v", stats)
	}
}

func TestPostgresBackupListAndRestore(t *testing.T) {
	mgr, mux, token, _ := newTestPaasOpsEnv(t, func(ctx context.Context, name string, args ...string) (string, error) {
		return "", nil
	})

	fakeDump := []byte("PGDMP\x01\x0e\x00custom-dump-payload-bytes")
	mgr.binaryRunner = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		return fakeDump, nil
	}

	var restoredStdin []byte
	var restoredArgs []string
	mgr.stdinRunner = func(ctx context.Context, stdin []byte, name string, args ...string) (string, error) {
		restoredStdin = append([]byte(nil), stdin...)
		restoredArgs = append([]string{name}, args...)
		return "ok", nil
	}

	// 1. Create backup
	createReq := httptest.NewRequest(http.MethodPost, "/paas/backups/postgres", strings.NewReader(`{"container":"moonwitness-postgres","user":"postgres","database":"moonwitness_db"}`))
	createReq.Header.Set("Authorization", "Bearer "+token)
	createRec := httptest.NewRecorder()
	mux.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", createRec.Code, createRec.Body.String())
	}

	var manifest BackupManifest
	if err := json.Unmarshal(createRec.Body.Bytes(), &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	expectedSum := sha256.Sum256(fakeDump)
	if manifest.SHA256 != hex.EncodeToString(expectedSum[:]) {
		t.Fatalf("checksum mismatch: got %s", manifest.SHA256)
	}

	// 2. List backups
	listReq := httptest.NewRequest(http.MethodGet, "/paas/backups", nil)
	listReq.Header.Set("Authorization", "Bearer "+token)
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", listRec.Code, listRec.Body.String())
	}
	var listResp struct {
		Backups []BackupManifest `json:"backups"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listResp.Backups) != 1 || listResp.Backups[0].ID != manifest.ID {
		t.Fatalf("unexpected backups list: %+v", listResp.Backups)
	}

	// 3. Dry-run restore (must verify checksum and NOT invoke pg_restore)
	dryBody, _ := json.Marshal(RestoreBackupRequest{ID: manifest.ID, DryRun: true})
	dryReq := httptest.NewRequest(http.MethodPost, "/paas/backups/restore", bytes.NewReader(dryBody))
	dryReq.Header.Set("Authorization", "Bearer "+token)
	dryRec := httptest.NewRecorder()
	mux.ServeHTTP(dryRec, dryReq)
	if dryRec.Code != http.StatusOK {
		t.Fatalf("expected 200 dryRun, got %d: %s", dryRec.Code, dryRec.Body.String())
	}
	if len(restoredArgs) != 0 {
		t.Fatalf("dryRun must not invoke pg_restore, got: %v", restoredArgs)
	}

	// 4. Real restore
	restoreBody, _ := json.Marshal(RestoreBackupRequest{ID: manifest.ID, DryRun: false})
	restoreReq := httptest.NewRequest(http.MethodPost, "/paas/backups/restore", bytes.NewReader(restoreBody))
	restoreReq.Header.Set("Authorization", "Bearer "+token)
	restoreRec := httptest.NewRecorder()
	mux.ServeHTTP(restoreRec, restoreReq)
	if restoreRec.Code != http.StatusOK {
		t.Fatalf("expected 200 restore, got %d: %s", restoreRec.Code, restoreRec.Body.String())
	}
	if !bytes.Equal(restoredStdin, fakeDump) {
		t.Fatalf("restored stdin bytes mismatch")
	}
	if !strings.Contains(strings.Join(restoredArgs, " "), "pg_restore -U postgres -d moonwitness_db --clean --if-exists") {
		t.Fatalf("unexpected pg_restore args: %v", restoredArgs)
	}
}

func TestRestoreBackupRejectsPathTraversalAndTamperedChecksum(t *testing.T) {
	mgr, mux, token, _ := newTestPaasOpsEnv(t, func(ctx context.Context, name string, args ...string) (string, error) {
		return "", nil
	})
	pgRestoreCalled := false
	mgr.stdinRunner = func(ctx context.Context, stdin []byte, name string, args ...string) (string, error) {
		pgRestoreCalled = true
		return "", nil
	}

	// Path traversal attempt must fail with 400
	travReq := httptest.NewRequest(http.MethodPost, "/paas/backups/restore", strings.NewReader(`{"id":"../etc/passwd"}`))
	travReq.Header.Set("Authorization", "Bearer "+token)
	travRec := httptest.NewRecorder()
	mux.ServeHTTP(travRec, travReq)
	if travRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for path traversal, got %d", travRec.Code)
	}

	// Tampered dump file must fail with 422 BEFORE pg_restore is invoked
	mgr.binaryRunner = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		return []byte("original-dump-bytes"), nil
	}
	createReq := httptest.NewRequest(http.MethodPost, "/paas/backups/postgres", strings.NewReader(`{}`))
	createReq.Header.Set("Authorization", "Bearer "+token)
	createRec := httptest.NewRecorder()
	mux.ServeHTTP(createRec, createReq)
	var manifest BackupManifest
	_ = json.Unmarshal(createRec.Body.Bytes(), &manifest)

	dumpPath := filepath.Join(mgr.backupDir, manifest.ID+".dump")
	if err := os.WriteFile(dumpPath, []byte("tampered-bytes"), 0o600); err != nil {
		t.Fatalf("tamper dump: %v", err)
	}

	restoreBody, _ := json.Marshal(RestoreBackupRequest{ID: manifest.ID})
	restoreReq := httptest.NewRequest(http.MethodPost, "/paas/backups/restore", bytes.NewReader(restoreBody))
	restoreReq.Header.Set("Authorization", "Bearer "+token)
	restoreRec := httptest.NewRecorder()
	mux.ServeHTTP(restoreRec, restoreReq)
	if restoreRec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for checksum mismatch, got %d: %s", restoreRec.Code, restoreRec.Body.String())
	}
	if pgRestoreCalled {
		t.Fatalf("pg_restore must NEVER be invoked when checksum fails")
	}
}

func TestPreviewDeployBlueGreenAtomicSwap(t *testing.T) {
	var dockerCalls []string
	mgr, mux, token, caddyPath := newTestPaasOpsEnv(t, func(ctx context.Context, name string, args ...string) (string, error) {
		dockerCalls = append(dockerCalls, name+" "+strings.Join(args, " "))
		if len(args) > 0 && args[0] == "run" {
			return "newcontainer123456", nil
		}
		return "", nil
	})

	// Seed an existing blue preview container for PR 42.
	seedTestApp(t, mgr.db, "webapp-pr-42", "mw-paas-webapp-pr-42-old", "pr-42.preview.example.com", 3000, nil)

	var probedURL string
	var caddyBeforeProbe bool
	mgr.healthProber = func(ctx context.Context, url string) error {
		probedURL = url
		// Verify Caddyfile has NOT been written before healthcheck succeeds.
		if _, err := os.Stat(caddyPath); err == nil {
			caddyBeforeProbe = true
		}
		return nil
	}

	payload := `{
		"slug": "webapp",
		"tenantId": "tenant-1",
		"prNumber": 42,
		"image": "ghcr.io/mw/webapp:pr-42",
		"port": 3000,
		"domain": "pr-42.preview.example.com",
		"healthcheckPath": "/healthz"
	}`
	req := httptest.NewRequest(http.MethodPost, "/paas/apps/preview", strings.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if caddyBeforeProbe {
		t.Fatalf("Caddyfile must NOT be written before candidate healthcheck succeeds")
	}

	var resp PreviewDeployResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.PreviewSlug != "webapp-pr-42" || resp.HealthStatus != "healthy" {
		t.Fatalf("unexpected preview response: %+v", resp)
	}
	if resp.PreviousContainer != "mw-paas-webapp-pr-42-old" {
		t.Fatalf("expected previous container to be drained, got: %q", resp.PreviousContainer)
	}
	if !strings.HasSuffix(probedURL, ":3000/healthz") || !strings.Contains(probedURL, resp.ContainerName) {
		t.Fatalf("unexpected health probe URL: %q", probedURL)
	}

	// Verify Caddyfile now routes to the new candidate container.
	caddyRaw, err := os.ReadFile(caddyPath)
	if err != nil {
		t.Fatalf("read Caddyfile: %v", err)
	}
	if !strings.Contains(string(caddyRaw), "reverse_proxy "+resp.ContainerName+":3000") {
		t.Fatalf("Caddyfile missing new candidate upstream: %s", string(caddyRaw))
	}

	// Verify old container was stopped and removed AFTER swap.
	joinedCalls := strings.Join(dockerCalls, "\n")
	if !strings.Contains(joinedCalls, "docker stop mw-paas-webapp-pr-42-old") ||
		!strings.Contains(joinedCalls, "docker rm -f mw-paas-webapp-pr-42-old") {
		t.Fatalf("expected previous container stop+rm, got calls:\n%s", joinedCalls)
	}
}

func TestPreviewDeployRollbackOnUnhealthyCandidate(t *testing.T) {
	var dockerCalls []string
	mgr, mux, token, caddyPath := newTestPaasOpsEnv(t, func(ctx context.Context, name string, args ...string) (string, error) {
		dockerCalls = append(dockerCalls, name+" "+strings.Join(args, " "))
		if len(args) > 0 && args[0] == "run" {
			return "badcandidate999", nil
		}
		return "", nil
	})

	seedTestApp(t, mgr.db, "webapp-feat-ui", "mw-paas-webapp-feat-ui-live", "feat-ui.preview.example.com", 3000, nil)

	mgr.healthProber = func(ctx context.Context, url string) error {
		return errors.New("connection refused")
	}

	payload := `{
		"slug": "webapp",
		"tenantId": "tenant-1",
		"branch": "feat/ui",
		"image": "ghcr.io/mw/webapp:broken",
		"port": 3000,
		"domain": "feat-ui.preview.example.com"
	}`
	req := httptest.NewRequest(http.MethodPost, "/paas/apps/preview", strings.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 on unhealthy candidate, got %d: %s", rec.Code, rec.Body.String())
	}

	// Caddyfile must NOT have been created/updated.
	if _, err := os.Stat(caddyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Caddyfile must not be written when candidate is unhealthy")
	}

	// Candidate must be rolled back (rm -f), and previous live container must NOT be touched.
	joinedCalls := strings.Join(dockerCalls, "\n")
	if !strings.Contains(joinedCalls, "docker rm -f mw-paas-webapp-feat-ui-bg-") {
		t.Fatalf("expected unhealthy candidate rollback rm -f, got:\n%s", joinedCalls)
	}
	if strings.Contains(joinedCalls, "mw-paas-webapp-feat-ui-live") {
		t.Fatalf("previous live container must NOT be stopped/removed on rollback:\n%s", joinedCalls)
	}
}

func newProbeTestCert(t *testing.T, dnsName string) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: dnsName},
		DNSNames:     []string{dnsName},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse cert: %v", err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, pool
}

func TestDefaultHTTPHealthProbeRejectsUnsafeURLs(t *testing.T) {
	cases := []struct {
		name string
		url  string
	}{
		{name: "http scheme", url: "http://example.com/healthz"},
		{name: "ftp scheme", url: "ftp://example.com/healthz"},
		{name: "empty host", url: "https:///healthz"},
		{name: "userinfo", url: "https://user:pass@example.com/healthz"},
		{name: "localhost", url: "https://localhost/healthz"},
		{name: "dot local", url: "https://service.local/healthz"},
		{name: "dot internal", url: "https://metadata.internal/healthz"},
		{name: "loopback v4", url: "https://127.0.0.1/healthz"},
		{name: "loopback v6", url: "https://[::1]/healthz"},
		{name: "private 10", url: "https://10.0.0.1/healthz"},
		{name: "private 172", url: "https://172.16.0.1/healthz"},
		{name: "private 192", url: "https://192.168.1.1/healthz"},
		{name: "link-local metadata", url: "https://169.254.169.254/latest/meta-data/"},
		{name: "easytier cgnat mesh", url: "https://100.64.0.1/healthz"},
		{name: "unspecified", url: "https://0.0.0.0/healthz"},
		{name: "multicast", url: "https://224.0.0.1/healthz"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := defaultHTTPHealthProbe(context.Background(), tc.url); err == nil {
				t.Fatalf("expected error for unsafe URL %q", tc.url)
			}
		})
	}
}

func TestProbeHTTPSURLRejectsDNSRebindingAndMixedIPs(t *testing.T) {
	dialCalled := false
	neverDial := func(context.Context, string, string) (net.Conn, error) {
		dialCalled = true
		return nil, errors.New("unexpected dial")
	}

	cases := []struct {
		name  string
		addrs []net.IPAddr
		err   error
	}{
		{
			name:  "lookup error",
			err:   errors.New("dns failure"),
		},
		{
			name:  "empty addrs",
			addrs: nil,
		},
		{
			name: "public plus loopback dual record",
			addrs: []net.IPAddr{
				{IP: net.ParseIP("93.184.216.34")},
				{IP: net.ParseIP("127.0.0.1")},
			},
		},
		{
			name: "public plus private mesh dual record",
			addrs: []net.IPAddr{
				{IP: net.ParseIP("93.184.216.34")},
				{IP: net.ParseIP("100.64.0.10")},
			},
		},
		{
			name: "ipv4-mapped ipv6 loopback",
			addrs: []net.IPAddr{
				{IP: net.ParseIP("::ffff:127.0.0.1")},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dialCalled = false
			lookup := func(context.Context, string) ([]net.IPAddr, error) {
				return tc.addrs, tc.err
			}
			err := probeHTTPSURL(context.Background(), "https://rebind.example.com/healthz", lookup, neverDial, nil)
			if err == nil {
				t.Fatalf("expected rejection for %s", tc.name)
			}
			if dialCalled {
				t.Fatalf("dial must not be invoked when DNS validation fails")
			}
		})
	}
}

func TestProbeHTTPSURLPinsIPPreservesHostAndBlocksRedirects(t *testing.T) {
	cert, pool := newProbeTestCert(t, "health.example.test")

	var statusToReturn int = http.StatusOK
	var gotHost, gotPath, gotQuery, gotSNI string
	var gotTLSVersion uint16
	redirectHits := 0

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect-target" {
			redirectHits++
			w.WriteHeader(http.StatusOK)
			return
		}
		gotHost = r.Host
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		if r.TLS != nil {
			gotSNI = r.TLS.ServerName
			gotTLSVersion = r.TLS.Version
		}
		if statusToReturn >= 300 && statusToReturn < 400 {
			w.Header().Set("Location", "/redirect-target")
		}
		w.WriteHeader(statusToReturn)
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
	srv.StartTLS()
	defer srv.Close()

	_, srvPort, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatalf("split server addr: %v", err)
	}

	var dialedAddr string
	lookupPublic := func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host != "health.example.test" {
			return nil, errors.New("unexpected hostname lookup")
		}
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	}
	dialPinned := func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialedAddr = addr
		return (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, network, srv.Listener.Addr().String())
	}

	target := "https://health.example.test:" + srvPort + "/healthz?check=1"
	if err := probeHTTPSURL(context.Background(), target, lookupPublic, dialPinned, pool); err != nil {
		t.Fatalf("expected 200 probe to succeed, got: %v", err)
	}
	wantPinned := "93.184.216.34:" + srvPort
	if dialedAddr != wantPinned {
		t.Fatalf("expected DialContext to receive pinned addr %q, got %q", wantPinned, dialedAddr)
	}
	if gotHost != "health.example.test:"+srvPort {
		t.Fatalf("expected Host header %q, got %q", "health.example.test:"+srvPort, gotHost)
	}
	if gotPath != "/healthz" || gotQuery != "check=1" {
		t.Fatalf("expected /healthz?check=1, got %s?%s", gotPath, gotQuery)
	}
	if gotSNI != "health.example.test" || gotTLSVersion < tls.VersionTLS12 {
		t.Fatalf("unexpected TLS state: sni=%q version=%#x", gotSNI, gotTLSVersion)
	}

	// Redirects must never be followed and must fail the probe.
	statusToReturn = http.StatusFound
	err = probeHTTPSURL(context.Background(), target, lookupPublic, dialPinned, pool)
	if err == nil || !strings.Contains(err.Error(), "302") {
		t.Fatalf("expected 302 rejection error, got: %v", err)
	}
	if redirectHits != 0 {
		t.Fatalf("redirect target was contacted %d times; redirects must be disabled", redirectHits)
	}
}
