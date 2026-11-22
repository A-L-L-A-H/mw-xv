package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	// modernc.org/sqlite is a pure-Go SQLite driver; no CGO/gcc required.
	_ "modernc.org/sqlite"
)

const (
	defaultListenAddr = "0.0.0.0:3003"
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
	Image      string   `json:"image"`
	Command    []string `json:"command,omitempty"`
	Env        []string `json:"env,omitempty"`
	Ports      []string `json:"ports,omitempty"`
	Volumes    []string `json:"volumes,omitempty"`
	Restart    string   `json:"restart,omitempty"`
	DependsOn  []string `json:"depends_on,omitempty"`
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

	// Ensure all registry services are running at startup.
	for name, meta := range registry {
		if err := ensureService(ctx, cfg.dockerBin, name, meta); err != nil {
			log.Printf("warning: could not ensure service %s: %v", name, err)
		}
	}

	// HTTP API for the control plane.
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/services", handleServices(cfg.dockerBin))
	mux.HandleFunc("/services/", handleService(cfg.dockerBin))
	mux.HandleFunc("/deploy", handleDeploy(cfg.dockerBin))

	// New API endpoints backed by SQLite (preferred for UI integration).
	mux.HandleFunc("/api/services", handleApiServices)
	mux.HandleFunc("/api/services/", handleApiService)
	mux.HandleFunc("/api/deploy", handleApiDeploy)
	mux.HandleFunc("/api/deployments", handleApiDeployments)
	mux.HandleFunc("/api/deployments/", handleApiDeployment)

	srv := &http.Server{
		Addr:    cfg.listenAddr,
		Handler: mux,
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

func initSchema() error {
	schema := `
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
	_, err := DB.Exec(schema)
	return err
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
	ID           int    `json:"id"`
	ServiceName  string `json:"service_name"`
	Image        string `json:"image"`
	Status       string `json:"status"`
	ContainerID  string `json:"container_id,omitempty"`
	Error        string `json:"error,omitempty"`
	CreatedAt    string `json:"created_at"`
	CompletedAt  string `json:"completed_at,omitempty"`
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

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	dbErr := DB.Ping()
	dockerStatus := "unknown"
	if _, err := runCmdOutput(r.Context(), env("DOCKER_BIN", "docker"), "version", "--format", "{{.Server.Version}}"); err == nil {
		dockerStatus = "ok"
	}

	health := map[string]interface{}{
		"status":   "ok",
		"database": map[string]interface{}{"status": func() string { if dbErr != nil { return "error" }; return "ok" }()},
		"docker":   dockerStatus,
	}
	if dbErr != nil {
		health["status"] = "degraded"
		health["database"] = map[string]interface{}{"status": "error", "error": dbErr.Error()}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(health)
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

func handleDeploy(dockerBin string) http.HandlerFunc {
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

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		name := meta.Image
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

		if _, err := runCmdOutput(ctx, dockerBin, args...); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"name": name})
	}
}

// API: /api/services

func handleApiServices(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listApiServices(w, r)
	case http.MethodPost:
		createApiService(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func listApiServices(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query("SELECT id, name, image, command, env, ports, volumes, restart, created_at, updated_at FROM services ORDER BY created_at DESC")
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
	Name     string `json:"name"`
	Image    string `json:"image"`
	Command  string `json:"command,omitempty"`
	Env      string `json:"env,omitempty"`
	Ports    string `json:"ports,omitempty"`
	Volumes  string `json:"volumes,omitempty"`
	Restart  string `json:"restart,omitempty"`
}

func createApiService(w http.ResponseWriter, r *http.Request) {
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

	_, err := DB.Exec(`
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

func handleApiService(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Path[len("/api/services/"):]
	if name == "" {
		http.Error(w, "missing service name", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		getApiService(w, name)
	case http.MethodDelete:
		deleteApiService(w, name)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func getApiService(w http.ResponseWriter, name string) {
	var s serviceRow
	err := DB.QueryRow(`
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

func deleteApiService(w http.ResponseWriter, name string) {
	_, err := DB.Exec("DELETE FROM services WHERE name = ?", name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"name": name, "status": "unregistered"})
}

// API: /api/deploy

func handleApiDeploy(w http.ResponseWriter, r *http.Request) {
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
	name := meta.Image

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	// Record deployment start.
	deployID := 0
	_ = DB.QueryRow(`
		INSERT INTO deployments (service_name, image, status)
		VALUES (?, ?, 'pending')
		RETURNING id
	`, name, meta.Image).Scan(&deployID)

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

	out, err := runCmdOutput(ctx, env("DOCKER_BIN", "docker"), args...)
	if err != nil {
		_, _ = DB.Exec(`UPDATE deployments SET status='failed', error=?, completed_at=datetime('now') WHERE id=?`, err.Error(), deployID)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	containerID := strings.TrimSpace(out)

	_, _ = DB.Exec(`UPDATE deployments SET status='success', container_id=?, completed_at=datetime('now') WHERE id=?`, containerID, deployID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"id":            containerID[:12],
		"name":          name,
		"deployment_id": fmt.Sprintf("%d", deployID),
		"status":        "success",
	})
}

// API: /api/deployments

func handleApiDeployments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := DB.Query(`SELECT id, service_name, image, status, container_id, error, created_at, completed_at FROM deployments ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var list []deploymentRow
	for rows.Next() {
		var d deploymentRow
		if err := rows.Scan(&d.ID, &d.ServiceName, &d.Image, &d.Status, &d.ContainerID, &d.Error, &d.CreatedAt, &d.CompletedAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		list = append(list, d)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(list)
}

func handleApiDeployment(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Path[len("/api/deployments/"):]
	if id == "" {
		http.Error(w, "missing deployment id", http.StatusBadRequest)
		return
	}
	var d deploymentRow
	err := DB.QueryRow(`SELECT id, service_name, image, status, container_id, error, created_at, completed_at FROM deployments WHERE id = ?`, id).Scan(&d.ID, &d.ServiceName, &d.Image, &d.Status, &d.ContainerID, &d.Error, &d.CreatedAt, &d.CompletedAt)
	if err != nil {
		http.Error(w, "deployment not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(d)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
