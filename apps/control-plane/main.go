package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
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
)

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

	srv := &http.Server{
		Addr:    cfg.listenAddr,
		Handler: buildMux(DB, cfg.dockerBin, adminToken),
	}

	go func() {
		log.Printf("control-plane listening on %s", cfg.listenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
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

// buildMux wires the full HTTP router for the control plane. Every route
// except GET /health requires Bearer auth with the resolved admin token.
func buildMux(db *sql.DB, dockerBin, adminToken string) http.Handler {
	mux := http.NewServeMux()

	// Health stays unauthenticated for container/orchestrator liveness probes.
	mux.HandleFunc("/health", handleHealth(db, dockerBin))
	mux.HandleFunc("/mesh/status", requireBearerAuth(adminToken, handleMeshStatus(NewMeshManagerFromEnv(dockerBin))))
	mux.HandleFunc("/services", requireBearerAuth(adminToken, handleServices(dockerBin)))
	mux.HandleFunc("/services/", requireBearerAuth(adminToken, handleService(dockerBin)))
	mux.HandleFunc("/deploy", requireBearerAuth(adminToken, handleDeploy(db, dockerBin)))

	// New API endpoints backed by SQLite (preferred for UI integration).
	mux.HandleFunc("/api/services", requireBearerAuth(adminToken, handleApiServices(db)))
	mux.HandleFunc("/api/services/", requireBearerAuth(adminToken, handleApiService(db)))
	mux.HandleFunc("/api/deploy", requireBearerAuth(adminToken, handleApiDeploy(db, dockerBin)))
	mux.HandleFunc("/api/deployments", requireBearerAuth(adminToken, handleApiDeployments(db)))
	mux.HandleFunc("/api/deployments/", requireBearerAuth(adminToken, handleApiDeployment(db)))
	mux.HandleFunc("/api/containers/", requireBearerAuth(adminToken, handleContainerSubroutes(dockerBin)))

	// PaaS node agent endpoints (authenticated via X-Control-Plane-Token or Bearer).
	paasMgr := NewPaasManager(db, dockerBin, NewMeshManagerFromEnv(dockerBin), nil, nil)
	paasMgr.MountRoutes(mux, adminToken)
	RegisterGitBuilderRoutes(mux, paasMgr, adminToken)

	// A2A peer-to-peer mesh federation endpoint (authenticated via HMAC-SHA256 envelope + private mesh IP).
	a2aMgr := NewA2AManagerFromEnv()
	mux.HandleFunc("/a2a/delegate", a2aMgr.HandleDelegate())

	return mux
}

// requireBearerAuth enforces `Authorization: Bearer <token>` using a
// constant-time comparison. Missing or invalid credentials fail closed with
// 401 Unauthorized.
func requireBearerAuth(token string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authz := r.Header.Get("Authorization")
		ok := false
		if strings.HasPrefix(authz, "Bearer ") {
			presented := authz[len("Bearer "):]
			// Constant-time compare to avoid leaking token prefixes; equal
			// lengths are required for a match (1 returned by ConstantTimeCompare).
			ok = len(presented) == len(token) &&
				subtle.ConstantTimeCompare([]byte(presented), []byte(token)) == 1
		}
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
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
	const domainLabel = "moonwitness-control-plane-admin-v1"

	if token := strings.TrimSpace(os.Getenv("MW_CONTROL_PLANE_TOKEN")); token != "" {
		return token, nil
	}

	secret := strings.TrimSpace(os.Getenv("MW_INTERNAL_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("JWT_SECRET"))
	}
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(domainLabel))
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

func handleHealth(db *sql.DB, dockerBin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		dbErr := db.Ping()
		dockerStatus := "unknown"
		if _, err := runCmdOutput(r.Context(), dockerBin, "version", "--format", "{{.Server.Version}}"); err == nil {
			dockerStatus = "ok"
		}

		health := map[string]interface{}{
			"status": "ok",
			"database": map[string]interface{}{"status": func() string {
				if dbErr != nil {
					return "error"
				}
				return "ok"
			}()},
			"docker": dockerStatus,
		}
		if dbErr != nil {
			health["status"] = "degraded"
			health["database"] = map[string]interface{}{"status": "error", "error": dbErr.Error()}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(health)
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
