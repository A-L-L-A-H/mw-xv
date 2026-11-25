package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	// modernc.org/sqlite is a pure-Go SQLite driver; no CGO/gcc required.
	_ "modernc.org/sqlite"
)

const (
	defaultListenAddr = "127.0.0.1:3003"
	defaultDbPath     = "control-plane.db"

	// controlPlaneAuthDomain is the audience/service identity shared with the
	// token issuer in packages/orm-cloud/src/auth.ts
	// (CONTROL_PLANE_INTERNAL_AUTH_DOMAIN). The HMAC derivation domain-separates
	// this service's credential from every other derived internal token.
	controlPlaneAuthDomain = "moonwitness-control-plane-admin-v1"
)

// controlPlaneAccess is the authorization class assigned to every registered
// route in controlPlaneRouteMatrix.
type controlPlaneAccess uint8

const (
	accessPublic           controlPlaneAccess = iota // intentionally public, non-sensitive
	accessAuthenticated                             // canonical admin bearer token
	accessPrivileged                                // admin bearer token + explicit method gate
	accessA2APeer                                   // A2A envelope + verified peer transport identity
	accessWebhookSignature                          // provider HMAC signature, never a service token
)

// controlPlaneRoute is one row of the explicit Control Plane route matrix.
// The matrix is the single registration source used by buildMux, so a route
// cannot silently bypass an authorization class.
type controlPlaneRoute struct {
	pattern string
	family  string
	access  controlPlaneAccess
	methods []string // empty means any method
}

// controlPlaneRouteMatrix documents public, authenticated, privileged and
// A2A-peer endpoints. GET /health is the only public row and returns bounded,
// non-sensitive status only.
var controlPlaneRouteMatrix = []controlPlaneRoute{
	{pattern: "/health", family: "health", access: accessPublic, methods: []string{http.MethodGet}},
	{pattern: "/mesh/status", family: "mesh", access: accessAuthenticated},
	{pattern: "/services", family: "legacy-services", access: accessAuthenticated},
	{pattern: "/services/", family: "legacy-services", access: accessAuthenticated},
	{pattern: "/deploy", family: "legacy-deploy", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/api/services", family: "api-services", access: accessAuthenticated},
	{pattern: "/api/services/", family: "api-services", access: accessAuthenticated},
	{pattern: "/api/deploy", family: "api-deploy", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/api/deployments", family: "api-deployments", access: accessAuthenticated},
	{pattern: "/api/deployments/", family: "api-deployments", access: accessAuthenticated},
	{pattern: "/api/containers/", family: "container-logs", access: accessPrivileged},
	{pattern: "/paas/node/metrics", family: "paas-ops", access: accessAuthenticated},
	{pattern: "/paas/metrics", family: "paas-ops", access: accessAuthenticated, methods: []string{http.MethodGet}},
	{pattern: "/paas/templates", family: "paas-coolify", access: accessAuthenticated, methods: []string{http.MethodGet}},
	{pattern: "/paas/apps", family: "paas-apps", access: accessAuthenticated},
	{pattern: "/paas/apps/deploy", family: "paas-apps", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/paas/apps/deploy-compose", family: "paas-coolify", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/paas/apps/", family: "paas-apps", access: accessPrivileged},
	{pattern: "/paas/backups/postgres", family: "paas-backups", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/paas/backups", family: "paas-backups", access: accessAuthenticated},
	{pattern: "/paas/backups/restore", family: "paas-backups", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/paas/cluster/nodes", family: "paas-cluster", access: accessAuthenticated},
	{pattern: "/paas/cluster/nodes/join", family: "paas-cluster", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/paas/cluster/ha/status", family: "paas-cluster", access: accessAuthenticated},
	{pattern: "/paas/apps/deploy-git", family: "git-builder", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/paas/apps/preview", family: "git-builder", access: accessPrivileged, methods: []string{http.MethodPost}},
	{pattern: "/paas/webhooks/github/", family: "git-webhook", access: accessWebhookSignature, methods: []string{http.MethodPost}},
	{pattern: "/a2a/delegate", family: "a2a-federation", access: accessA2APeer, methods: []string{http.MethodPost}},
}

func controlPlaneAccessForPattern(pattern string) (controlPlaneAccess, bool) {
	for _, route := range controlPlaneRouteMatrix {
		if route.pattern == pattern {
			return route.access, true
		}
	}
	return accessPublic, false
}

// config holds runtime configuration read from env.
type config struct {
	listenAddr string
	dockerBin  string
	dbPath     string
}

// containerMeta mirrors the MoonWitness container manifest used by the agent.
type containerMeta struct {
	Image     string   `json:"image"`
	Name      string   `json:"name,omitempty"`
	Command   []string `json:"command,omitempty"`
	Env       []string `json:"env,omitempty"`
	Ports     []string `json:"ports,omitempty"`
	Volumes   []string `json:"volumes,omitempty"`
	Restart   string   `json:"restart,omitempty"`
	DependsOn []string `json:"depends_on,omitempty"`
}

// registry maps service name -> manifest for the control plane.
var registry = map[string]containerMeta{
	"moonwitness-postgres": {
		Image:   "postgres:16-alpine",
		Env:     []string{"POSTGRES_USER=postgres", "POSTGRES_PASSWORD=postgres", "POSTGRES_DB=moonwitness_db"},
		Ports:   []string{"127.0.0.1:5432:5432"},
		Restart: "unless-stopped",
	},
	"moonwitness-gowa": {
		Image:   "aldinokemal2104/go-whatsapp-web-multidevice:v9.6.0",
		Command: []string{"rest", "--basic-auth=moonwitness:moonwitness", "--port=3000"},
		Ports:   []string{"127.0.0.1:3001:3000"},
		Restart: "unless-stopped",
		Volumes: []string{"gowa_data:/app/storages"},
	},
	"moonwitness-isp": {
		Image:   "mw-xv-isp:latest",
		Ports:   []string{"1812:1812/udp", "1813:1813/udp", "3002:3000"},
		Env:     []string{"MW_ISP_DB_PATH=/data/isp.db", "MW_ISP_RADIUS_SECRET=testing123", "MW_ISP_ADMIN_TOKEN=moonwitness-isp-admin", "RUST_LOG=info"},
		Restart: "unless-stopped",
		Volumes: []string{"isp_data:/data"},
	},
	"easytier": {
		Image:   easytierImage,
		Restart: "unless-stopped",
	},
}

// DB is the global SQLite handle for control-plane metadata.
var DB *sql.DB

func main() {
	cfg := config{
		listenAddr: env("MW_CONTROL_PLANE_ADDR", defaultListenAddr),
		dockerBin:  env("DOCKER_BIN", "docker"),
		dbPath:     env("MW_CONTROL_PLANE_DB_PATH", defaultDbPath),
	}

	var err error
	DB, err = sql.Open("sqlite", cfg.dbPath)
	if err != nil {
		log.Fatalf("failed to open sqlite: %v", err)
	}
	defer DB.Close()

	if err := DB.Ping(); err != nil {
		log.Fatalf("failed to ping sqlite: %v", err)
	}

	if err := initSchema(); err != nil {
		log.Fatalf("failed to init schema: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	adminToken, err := resolveAdminToken(cfg.dbPath)
	if err != nil {
		log.Fatalf("failed to resolve admin token: %v", err)
	}

	meshMgr := NewMeshManagerFromEnv(cfg.dockerBin)
	log.Printf("mesh config: %s", meshMgr.RedactedSummary())
	if meshMgr.configErr != nil {
		log.Printf("warning: mesh configuration invalid (fail-closed): %s", RedactMeshSecret(meshMgr.configErr.Error(), meshMgr.cfg.NetworkSecret))
	}

	// Gate legacy registry auto-start behind MW_CONTROL_PLANE_AUTOSTART_LEGACY=true
	// so VPS Compose deployments never collide with rogue legacy containers on restart.
	if shouldAutostartLegacyRegistry() {
		for name, meta := range registry {
			if name == easytierServiceName {
				if !meshMgr.cfg.Enabled || meshMgr.configErr != nil {
					continue
				}
				meta = EasytierContainerMeta(meshMgr.cfg)
			}
			if err := ensureService(ctx, cfg.dockerBin, name, meta); err != nil {
				log.Printf("warning: could not ensure service %s: %s", name, RedactMeshSecret(err.Error(), meshMgr.cfg.NetworkSecret))
			}
		}
	} else {
		log.Printf("legacy registry auto-start disabled (set MW_CONTROL_PLANE_AUTOSTART_LEGACY=true to enable)")
	}

	paasMgr := NewPaasManager(DB, cfg.dockerBin, meshMgr, nil, nil)
	paasMgr.SetAdminToken(adminToken)
	if err := paasMgr.SyncCaddyRoutesOnStartup(ctx); err != nil {
		log.Printf("warning: initial caddy route sync failed: %v", err)
	}

	var uiSrv *http.Server
	if uiAddr := strings.TrimSpace(os.Getenv("MW_PAAS_UI_ADDR")); uiAddr != "" {
		uiSrv = &http.Server{
			Addr:    uiAddr,
			Handler: NewPaasUIHandler(paasMgr, adminToken),
		}
		go func() {
			log.Printf("paas web console listening on %s", uiAddr)
			if uiErr := uiSrv.ListenAndServe(); uiErr != nil && uiErr != http.ErrServerClosed {
				log.Printf("warning: paas web console error: %v", uiErr)
			}
		}()
	}

	srv := &http.Server{
		Addr:    cfg.listenAddr,
		Handler: buildMux(DB, cfg.dockerBin, adminToken),
	}
	mtlsCert, mtlsKey, err := configureA2AMTLS(srv)
	if err != nil {
		log.Fatalf("invalid A2A mTLS configuration (fail-closed): %v", err)
	}

	go func() {
		log.Printf("control-plane listening on %s", cfg.listenAddr)
		var serveErr error
		if srv.TLSConfig != nil {
			serveErr = srv.ListenAndServeTLS(mtlsCert, mtlsKey)
		} else {
			serveErr = srv.ListenAndServe()
		}
		if serveErr != nil && serveErr != http.ErrServerClosed {
			log.Fatalf("http server error: %v", serveErr)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if uiSrv != nil {
		_ = uiSrv.Shutdown(shutdownCtx)
	}
	_ = srv.Shutdown(shutdownCtx)
	log.Println("control-plane stopped")
}

// shouldAutostartLegacyRegistry returns true only when
// MW_CONTROL_PLANE_AUTOSTART_LEGACY is explicitly set to "true".
// Defaults to false so VPS Compose deployments never collide with legacy
// registry containers on startup.
func shouldAutostartLegacyRegistry() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("MW_CONTROL_PLANE_AUTOSTART_LEGACY")), "true")
}

// configureA2AMTLS opt-in terminates mTLS on the Control Plane listener and
// requires a client certificate signed by the configured peer CA. All three
// settings must be present together; a partial configuration is a startup
// error. Without them the A2A handler still fails closed because no verified
// peer certificate can be present on a plaintext connection.
func configureA2AMTLS(srv *http.Server) (string, string, error) {
	certFile := strings.TrimSpace(os.Getenv("MW_A2A_MTLS_CERT_FILE"))
	keyFile := strings.TrimSpace(os.Getenv("MW_A2A_MTLS_KEY_FILE"))
	caFile := strings.TrimSpace(os.Getenv("MW_A2A_PEER_CA_FILE"))
	if certFile == "" && keyFile == "" && caFile == "" {
		return "", "", nil
	}
	if certFile == "" || keyFile == "" || caFile == "" {
		return "", "", errors.New("MW_A2A_MTLS_CERT_FILE, MW_A2A_MTLS_KEY_FILE and MW_A2A_PEER_CA_FILE must be set together")
	}
	pemData, err := os.ReadFile(caFile)
	if err != nil {
		return "", "", fmt.Errorf("read A2A peer CA file: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pemData) {
		return "", "", errors.New("A2A peer CA file contains no valid certificates")
	}
	srv.TLSConfig = &tls.Config{
		MinVersion: tls.VersionTLS12,
		ClientAuth: tls.RequireAndVerifyClientCert,
		ClientCAs:  pool,
	}
	return certFile, keyFile, nil
}

// buildMux wires the full HTTP router from controlPlaneRouteMatrix. Every row
// is registered with the authorization class declared in the matrix, so no
// handler can accidentally be exposed without its intended middleware.
func buildMux(db *sql.DB, dockerBin, adminToken string) http.Handler {
	mux := http.NewServeMux()
	paasMgr := NewPaasManager(db, dockerBin, NewMeshManagerFromEnv(dockerBin), nil, nil)
	paasMgr.SetAdminToken(adminToken)
	a2aMgr := NewA2AManagerFromEnv()

	raw := map[string]http.HandlerFunc{
		"/health":                     handleHealth(db, dockerBin),
		"/mesh/status":                handleMeshStatus(NewMeshManagerFromEnv(dockerBin)),
		"/services":                   handleServices(dockerBin),
		"/services/":                  handleService(dockerBin),
		"/deploy":                     handleDeploy(db, dockerBin),
		"/api/services":               handleApiServices(db),
		"/api/services/":              handleApiService(db),
		"/api/deploy":                 handleApiDeploy(db, dockerBin),
		"/api/deployments":            handleApiDeployments(db),
		"/api/deployments/":           handleApiDeployment(db),
		"/api/containers/":            handleContainerSubroutes(dockerBin),
		"/paas/node/metrics":          paasMgr.handleNodeMetrics(),
		"/paas/metrics":               paasMgr.handleNodeMetrics(),
		"/paas/templates":             paasMgr.handleTemplates(),
		"/paas/apps":                  paasMgr.handleApps(),
		"/paas/apps/deploy":           paasMgr.handleDeploy(),
		"/paas/apps/deploy-compose":   paasMgr.handleComposeDeploy(),
		"/paas/apps/":                 paasMgr.handleAppSubroutes(),
		"/paas/backups/postgres":      paasMgr.handleBackupPostgres(),
		"/paas/backups":               paasMgr.handleListBackups(),
		"/paas/backups/restore":       paasMgr.handleRestoreBackup(),
		"/paas/cluster/nodes":         paasMgr.handleClusterNodes(),
		"/paas/cluster/nodes/join":    paasMgr.handleClusterJoin(),
		"/paas/cluster/ha/status":     paasMgr.handleHAStatus(),
		"/paas/apps/deploy-git":       paasMgr.handleGitDeploy(),
		"/paas/apps/preview":          paasMgr.handlePreviewDeploy(),
		"/paas/webhooks/github/":      paasMgr.handleGitHubWebhook(),
		"/a2a/delegate":               a2aMgr.HandleDelegate(),
	}

	for _, route := range controlPlaneRouteMatrix {
		handler, ok := raw[route.pattern]
		if !ok {
			panic("control plane route matrix has no handler for " + route.pattern)
		}
		switch route.access {
		case accessPublic, accessWebhookSignature, accessA2APeer:
			// Public liveness, provider HMAC and A2A peer identity are enforced
			// by their own handlers, never by a service bearer token.
		case accessAuthenticated:
			if strings.HasPrefix(route.pattern, "/paas/") {
				handler = requirePaasAuth(adminToken, handler)
			} else {
				handler = requireBearerAuth(adminToken, handler)
			}
		case accessPrivileged:
			if strings.HasPrefix(route.pattern, "/paas/") {
				handler = requirePrivilegedPaasAuth(adminToken, handler)
			} else {
				handler = requireAccessBearerAuth(adminToken, accessPrivileged, handler)
			}
		}
		if len(route.methods) > 0 {
			handler = requireMethods(route.methods, handler)
		}
		mux.HandleFunc(route.pattern, handler)
	}
	return mux
}

// requireBearerAuth enforces the canonical audience-bound admin bearer token.
func requireBearerAuth(token string, next http.HandlerFunc) http.HandlerFunc {
	return requireAccessBearerAuth(token, accessAuthenticated, next)
}

// requireAccessBearerAuth rejects missing, malformed, wrong-audience and
// rotated-out credentials. The comparison is constant time and the response is
// generic: no presented credential is ever logged or echoed.
func requireAccessBearerAuth(token string, access controlPlaneAccess, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validServiceBearer(r.Header.Get("Authorization"), token) {
			w.Header().Set("Cache-Control", "no-store")
			writeUnauthorized(w)
			return
		}
		_ = access // access class is recorded in the matrix and enforced by method gating
		next(w, r)
	}
}

func validServiceBearer(authz, expected string) bool {
	if expected == "" || strings.Count(authz, " ") != 1 {
		return false
	}
	idx := strings.IndexByte(authz, ' ')
	if idx < 0 || authz[:idx] != "Bearer" {
		return false
	}
	presented := authz[idx+1:]
	if presented == "" || len(presented) != len(expected) {
		return false
	}
	for _, ch := range presented {
		if ch <= ' ' || ch == 0x7f {
			return false
		}
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(expected)) == 1
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
}

func requireMethods(methods []string, next http.HandlerFunc) http.HandlerFunc {
	allowed := make(map[string]bool, len(methods))
	for _, method := range methods {
		allowed[method] = true
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowed[r.Method] {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
			return
		}
		next(w, r)
	}
}

// resolveAdminToken derives the internal admin Bearer token used by the
// control plane. Precedence:
//  1. Explicit service override: MW_CONTROL_PLANE_TOKEN (trimmed non-empty).
//  2. Shared secret derivation: HMAC-SHA256 over
//     "moonwitness-control-plane-admin-v1" keyed with MW_INTERNAL_SECRET
//     (falling back to JWT_SECRET), hex-encoded.
//  3. Standalone fallback: read or auto-generate .admin-token next to the
//     SQLite DB path (32 CSPRNG bytes -> 64 hex chars, written with 0600).
func resolveAdminToken(dbPath string) (string, error) {
	if token := strings.TrimSpace(os.Getenv("MW_CONTROL_PLANE_TOKEN")); token != "" {
		return token, nil
	}

	secret := strings.TrimSpace(os.Getenv("MW_INTERNAL_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("JWT_SECRET"))
	}
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(controlPlaneAuthDomain))
		return hex.EncodeToString(mac.Sum(nil)), nil
	}

	tokenPath := filepath.Join(filepath.Dir(dbPath), ".admin-token")
	if data, err := os.ReadFile(tokenPath); err == nil {
		if token := strings.TrimSpace(string(data)); token != "" {
			return token, nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("read admin token file: %w", err)
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate admin token: %w", err)
	}
	token := hex.EncodeToString(buf)
	if err := os.WriteFile(tokenPath, []byte(token+"\n"), 0o600); err != nil {
		return "", fmt.Errorf("persist admin token: %w", err)
	}
	return token, nil
}

// schemaDDL holds the SQLite DDL for the control-plane metadata tables.
const schemaDDL = `
CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    image TEXT NOT NULL,
    command TEXT,
    env TEXT,
    ports TEXT,
    volumes TEXT,
    restart TEXT DEFAULT 'unless-stopped',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT NOT NULL,
    image TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    container_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS service_status (
    name TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    last_check TEXT NOT NULL,
    container_id TEXT,
    error TEXT
);
`

func initSchema() error {
	if _, err := DB.Exec(schemaDDL); err != nil {
		return err
	}
	return initPaasSchema(DB)
}

// serviceRow mirrors the services table.
type serviceRow struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Image     string `json:"image"`
	Command   string `json:"command,omitempty"`
	Env       string `json:"env,omitempty"`
	Ports     string `json:"ports,omitempty"`
	Volumes   string `json:"volumes,omitempty"`
	Restart   string `json:"restart,omitempty"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// deploymentRow mirrors the deployments table.
type deploymentRow struct {
	ID          int    `json:"id"`
	ServiceName string `json:"service_name"`
	Image       string `json:"image"`
	Status      string `json:"status"`
	ContainerID string `json:"container_id,omitempty"`
	Error       string `json:"error,omitempty"`
	CreatedAt   string `json:"created_at"`
	CompletedAt string `json:"completed_at,omitempty"`
}

// deploymentStatusRow mirrors the service_status table.
type deploymentStatusRow struct {
	Name        string `json:"name"`
	Status      string `json:"status"`
	LastCheck   string `json:"last_check"`
	ContainerID string `json:"container_id,omitempty"`
	Error       string `json:"error,omitempty"`
}

func ensureService(ctx context.Context, dockerBin, name string, meta containerMeta) error {
	out, err := runCmdOutput(ctx, dockerBin, "ps", "--all", "--filter", "name="+name, "--format", "{{.Names}}\t{{.ID}}\t{{.Image}}\t{{.Status}}")
	if err != nil {
		return fmt.Errorf("list containers: %w", err)
	}

	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) >= 1 && (parts[0] == "/"+name || parts[0] == name) {
			status := parts[3]
			if !strings.Contains(status, "Up") {
				if _, err := runCmdOutput(ctx, dockerBin, "start", name); err != nil {
					return fmt.Errorf("start container %s: %w", name, err)
				}
				log.Printf("started existing container %s", name)
				recordStatus(name, "running", "", "")
			} else {
				recordStatus(name, "running", parts[1], "")
			}
			return nil
		}
	}

	log.Printf("creating container %s from image %s", name, meta.Image)
	args := []string{"run", "-d", "--name", name, "--restart", meta.Restart}
	for _, p := range meta.Ports {
		args = append(args, "-p", p)
	}
	for _, v := range meta.Volumes {
		args = append(args, "-v", v)
	}
	for _, e := range meta.Env {
		args = append(args, "-e", e)
	}
	args = append(args, meta.Image)
	args = append(args, meta.Command...)

	out, err = runCmdOutput(ctx, dockerBin, args...)
	if err != nil {
		recordStatus(name, "failed", "", err.Error())
		return fmt.Errorf("run container: %w", err)
	}
	containerID := strings.TrimSpace(out)
	log.Printf("created and started container %s (%s)", name, containerID[:12])
	recordStatus(name, "running", containerID[:12], "")
	return nil
}

func recordStatus(name, status, containerID, errMsg string) {
	now := time.Now().UTC().Format(time.RFC3339)
	_, _ = DB.Exec(`
		INSERT INTO service_status (name, status, last_check, container_id, error)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			status=excluded.status,
			last_check=excluded.last_check,
			container_id=excluded.container_id,
			error=excluded.error
	`, name, status, now, containerID, errMsg)
}

func runCmdOutput(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s: %s", err.Error(), strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

// handleHealth is the only intentionally public route. Its payload is a fixed
// shape of bounded status values: no error text, versions, addresses, container
// details, configuration or credentials are ever exposed.
func handleHealth(db *sql.DB, dockerBin string) http.HandlerFunc {
	type componentStatus struct {
		Status string `json:"status"`
	}
	type healthPayload struct {
		Status   string          `json:"status"`
		Database componentStatus `json:"database"`
		Docker   string          `json:"docker"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		dbStatus := "ok"
		if db.Ping() != nil {
			dbStatus = "error"
		}
		dockerStatus := "unknown"
		if _, err := runCmdOutput(r.Context(), dockerBin, "version", "--format", "{{.Server.Version}}"); err == nil {
			dockerStatus = "ok"
		}

		status := "ok"
		if dbStatus != "ok" {
			status = "degraded"
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(healthPayload{
			Status:   status,
			Database: componentStatus{Status: dbStatus},
			Docker:   dockerStatus,
		})
	}
}

func handleServices(dockerBin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		out, err := runCmdOutput(ctx, dockerBin, "ps", "--all", "--format", "{{.Names}}\t{{.ID}}\t{{.Image}}\t{{.State}}\t{{.Status}}")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		type svc struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Image  string `json:"image"`
			State  string `json:"state"`
			Status string `json:"status"`
		}
		var outSvcs []svc
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			if line == "" {
				continue
			}
			parts := strings.SplitN(line, "\t", 5)
			if len(parts) < 5 {
				continue
			}
			name := parts[0]
			if len(name) > 0 && name[0] == '/' {
				name = name[1:]
			}
			outSvcs = append(outSvcs, svc{
				ID:     parts[1][:12],
				Name:   name,
				Image:  parts[2],
				State:  parts[3],
				Status: parts[4],
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(outSvcs)
	}
}

func handleService(dockerBin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Path[len("/services/"):]
		if name == "" {
			http.Error(w, "missing service name", http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		out, err := runCmdOutput(ctx, dockerBin, "ps", "--all", "--filter", "name="+name, "--format", "{{.Names}}\t{{.ID}}\t{{.Image}}\t{{.State}}\t{{.Status}}")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		lines := strings.Split(strings.TrimSpace(out), "\n")
		if len(lines) == 0 || lines[0] == "" {
			http.Error(w, "service not found", http.StatusNotFound)
			return
		}
		parts := strings.SplitN(lines[0], "\t", 5)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"id":     parts[1][:12],
			"name":   parts[0],
			"image":  parts[2],
			"state":  parts[3],
			"status": parts[4],
		})
	}
}

// dockerNamePattern validates Docker container names: starts with an
// alphanumeric character, followed by up to 62 characters in the allowed set.
var dockerNamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$`)

// maxContainerNameLen mirrors the Docker daemon limit of 63 characters.
const maxContainerNameLen = 63

// sanitizeContainerName derives a safe Docker container name from an optional
// user-supplied name or the image reference. It rejects empty or flag-like
// images, normalizes disallowed characters, guarantees the `mw-`/`moonwitness-`
// prefix, truncates to 63 characters, and validates the final result.
func sanitizeContainerName(requestedName, image string) (string, error) {
	image = strings.TrimSpace(image)
	if image == "" {
		return "", errors.New("image is required")
	}
	if strings.HasPrefix(image, "-") {
		return "", fmt.Errorf("image must not start with '-': %q", image)
	}

	base := strings.TrimSpace(requestedName)
	if base == "" {
		// Derive a readable base from the image: strip the registry host and
		// tag/digest, keeping the repository path segments.
		ref := image
		if idx := strings.LastIndex(ref, "@"); idx >= 0 {
			ref = ref[:idx]
		}
		if idx := strings.LastIndex(ref, ":"); idx >= 0 {
			// Avoid mangling registry ports like localhost:5000/repo.
			if !strings.Contains(ref[idx:], "/") {
				ref = ref[:idx]
			}
		}
		base = ref
	}

	// Replace anything outside the Docker-safe set with '-'.
	base = regexp.MustCompile(`[^a-zA-Z0-9_.-]+`).ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")

	if !strings.HasPrefix(base, "mw-") && !strings.HasPrefix(base, "moonwitness-") {
		base = "mw-" + base
	}
	if len(base) > maxContainerNameLen {
		base = base[:maxContainerNameLen]
	}
	base = strings.TrimRight(base, "-.")

	if !dockerNamePattern.MatchString(base) {
		return "", fmt.Errorf("could not derive a valid container name from %q (image %q)", requestedName, image)
	}
	return base, nil
}

// dockerArgsFromMeta builds the docker run argument list for a deployment,
// using the sanitized container name and validating flag-injection-prone
// fields before they are passed to the docker CLI.
func dockerArgsFromMeta(meta containerMeta, safeName string) ([]string, error) {
	if meta.Image == "" {
		return nil, errors.New("image is required")
	}
	if strings.HasPrefix(meta.Image, "-") {
		return nil, fmt.Errorf("image must not start with '-': %q", meta.Image)
	}
	for _, group := range [][]string{meta.Ports, meta.Volumes, meta.Env} {
		for _, entry := range group {
			if strings.HasPrefix(entry, "-") {
				return nil, fmt.Errorf("argument must not start with '-': %q", entry)
			}
			if strings.ContainsRune(entry, 0) {
				return nil, fmt.Errorf("argument must not contain NUL bytes: %q", entry)
			}
		}
	}

	args := []string{"run", "-d", "--name", safeName, "--restart", meta.Restart}
	for _, p := range meta.Ports {
		args = append(args, "-p", p)
	}
	for _, v := range meta.Volumes {
		args = append(args, "-v", v)
	}
	for _, e := range meta.Env {
		args = append(args, "-e", e)
	}
	args = append(args, meta.Image)
	args = append(args, meta.Command...)
	return args, nil
}

// removeExistingContainer force-removes any container named safeName so a
// redeploy can replace it, ignoring "No such container" errors.
func removeExistingContainer(ctx context.Context, dockerBin, safeName string) {
	out, err := runCmdOutput(ctx, dockerBin, "ps", "--all", "--filter", "name=^/"+safeName+"$", "-q")
	if err != nil {
		// Best effort: fall through and try to remove by name.
		_, _ = runCmdOutput(ctx, dockerBin, "rm", "-f", safeName)
		return
	}
	if strings.TrimSpace(out) == "" {
		return
	}
	_, _ = runCmdOutput(ctx, dockerBin, "rm", "-f", safeName)
}

func handleDeploy(db *sql.DB, dockerBin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var meta containerMeta
		if err := json.Unmarshal(body, &meta); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if meta.Image == "" {
			http.Error(w, "image is required", http.StatusBadRequest)
			return
		}

		safeName, err := sanitizeContainerName(meta.Name, meta.Image)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		args, err := dockerArgsFromMeta(meta, safeName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		removeExistingContainer(ctx, dockerBin, safeName)

		if _, err := runCmdOutput(ctx, dockerBin, args...); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"name": safeName})
	}
}

// API: /api/services

func handleApiServices(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			listApiServices(w, r, db)
		case http.MethodPost:
			createApiService(w, r, db)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func listApiServices(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	rows, err := db.Query("SELECT id, name, image, command, env, ports, volumes, restart, created_at, updated_at FROM services ORDER BY created_at DESC")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var services []serviceRow
	for rows.Next() {
		var s serviceRow
		if err := rows.Scan(&s.ID, &s.Name, &s.Image, &s.Command, &s.Env, &s.Ports, &s.Volumes, &s.Restart, &s.CreatedAt, &s.UpdatedAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		services = append(services, s)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(services)
}

type createServiceRequest struct {
	Name    string `json:"name"`
	Image   string `json:"image"`
	Command string `json:"command,omitempty"`
	Env     string `json:"env,omitempty"`
	Ports   string `json:"ports,omitempty"`
	Volumes string `json:"volumes,omitempty"`
	Restart string `json:"restart,omitempty"`
}

func createApiService(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	var req createServiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.Image == "" {
		http.Error(w, "name and image are required", http.StatusBadRequest)
		return
	}
	if req.Restart == "" {
		req.Restart = "unless-stopped"
	}

	_, err := db.Exec(`
		INSERT INTO services (name, image, command, env, ports, volumes, restart)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, req.Name, req.Image, req.Command, req.Env, req.Ports, req.Volumes, req.Restart)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"name": req.Name, "status": "registered"})
}

func handleApiService(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Path[len("/api/services/"):]
		if name == "" {
			http.Error(w, "missing service name", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodGet:
			getApiService(w, name, db)
		case http.MethodDelete:
			deleteApiService(w, name, db)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func getApiService(w http.ResponseWriter, name string, db *sql.DB) {
	var s serviceRow
	err := db.QueryRow(`
		SELECT id, name, image, command, env, ports, volumes, restart, created_at, updated_at
		FROM services WHERE name = ?
	`, name).Scan(&s.ID, &s.Name, &s.Image, &s.Command, &s.Env, &s.Ports, &s.Volumes, &s.Restart, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		http.Error(w, "service not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s)
}

func deleteApiService(w http.ResponseWriter, name string, db *sql.DB) {
	_, err := db.Exec("DELETE FROM services WHERE name = ?", name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"name": name, "status": "unregistered"})
}

// API: /api/deploy

func handleApiDeploy(db *sql.DB, dockerBin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var meta containerMeta
		if err := json.NewDecoder(r.Body).Decode(&meta); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if meta.Image == "" {
			http.Error(w, "image is required", http.StatusBadRequest)
			return
		}

		safeName, err := sanitizeContainerName(meta.Name, meta.Image)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		args, err := dockerArgsFromMeta(meta, safeName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()

		// Record deployment start.
		deployID := 0
		_ = db.QueryRow(`
			INSERT INTO deployments (service_name, image, status)
			VALUES (?, ?, 'pending')
			RETURNING id
		`, safeName, meta.Image).Scan(&deployID)

		removeExistingContainer(ctx, dockerBin, safeName)

		out, err := runCmdOutput(ctx, dockerBin, args...)
		if err != nil {
			_, _ = db.Exec(`UPDATE deployments SET status='failed', error=?, completed_at=datetime('now') WHERE id=?`, err.Error(), deployID)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		containerID := strings.TrimSpace(out)

		_, _ = db.Exec(`UPDATE deployments SET status='success', container_id=?, completed_at=datetime('now') WHERE id=?`, containerID, deployID)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"id":            containerID[:12],
			"name":          safeName,
			"deployment_id": fmt.Sprintf("%d", deployID),
			"status":        "success",
		})
	}
}

// API: /api/deployments

func handleApiDeployments(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		rows, err := db.Query(`SELECT id, service_name, image, status, container_id, error, created_at, completed_at FROM deployments ORDER BY created_at DESC LIMIT 50`)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var list []deploymentRow
		for rows.Next() {
			var d deploymentRow
			var errorStr, completedAt sql.NullString
			if err := rows.Scan(&d.ID, &d.ServiceName, &d.Image, &d.Status, &d.ContainerID, &errorStr, &d.CreatedAt, &completedAt); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			d.Error = errorStr.String
			d.CompletedAt = completedAt.String
			list = append(list, d)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(list)
	}
}

func handleApiDeployment(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Path[len("/api/deployments/"):]
		if id == "" {
			http.Error(w, "missing deployment id", http.StatusBadRequest)
			return
		}
		var d deploymentRow
		var errorStr, completedAt sql.NullString
		err := db.QueryRow(`SELECT id, service_name, image, status, container_id, error, created_at, completed_at FROM deployments WHERE id = ?`, id).Scan(&d.ID, &d.ServiceName, &d.Image, &d.Status, &d.ContainerID, &errorStr, &d.CreatedAt, &completedAt)
		d.Error = errorStr.String
		d.CompletedAt = completedAt.String
		if err != nil {
			http.Error(w, "deployment not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(d)
	}
}

// API: /api/containers/{id}/logs

// containerSubroutePath extracts the resource path after /api/containers/,
// e.g. "/api/containers/abc123/logs" -> "abc123/logs".
func containerSubroutePath(r *http.Request) string {
	return strings.TrimPrefix(r.URL.Path, "/api/containers/")
}

var containerIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

func handleContainerSubroutes(dockerBin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub := containerSubroutePath(r)
		parts := strings.Split(sub, "/")
		if len(parts) != 2 || parts[0] == "" {
			http.Error(w, "invalid container route", http.StatusBadRequest)
			return
		}
		id := parts[0]
		action := parts[1]

		if action != "logs" {
			http.Error(w, "unsupported container action", http.StatusNotFound)
			return
		}
		if !containerIDPattern.MatchString(id) {
			http.Error(w, "invalid container id", http.StatusBadRequest)
			return
		}

		tail := 200
		if raw := r.URL.Query().Get("tail"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > 2000 {
				http.Error(w, "tail must be an integer between 1 and 2000", http.StatusBadRequest)
				return
			}
			tail = n
		}
		tailStr := strconv.Itoa(tail)

		follow := r.URL.Query().Get("follow")
		if follow == "true" || follow == "1" {
			streamContainerLogs(w, r, dockerBin, id, tailStr)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		out, err := runCmdOutput(ctx, dockerBin, "logs", "--timestamps", "--tail", tailStr, id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"id": id, "logs": out})
	}
}

// streamContainerLogs tails `docker logs --follow` output and streams each
// line as an SSE `log` event. It exits cleanly when the client disconnects
// or the docker command exits.
func streamContainerLogs(w http.ResponseWriter, r *http.Request, dockerBin, id, tailStr string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	cmd := exec.CommandContext(r.Context(), dockerBin, "logs", "--timestamps", "--tail", tailStr, "--follow", id)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	cmd.Stderr = cmd.Stdout // merge stderr into the same stream
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(w, "event: error\ndata: {\"error\":%q}\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		select {
		case <-r.Context().Done():
			return
		default:
		}
		line := scanner.Text()
		payload, err := json.Marshal(map[string]string{"line": line})
		if err != nil {
			continue
		}
		fmt.Fprintf(w, "event: log\ndata: %s\n\n", payload)
		flusher.Flush()
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
