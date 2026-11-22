package main

import (
	"bytes"
	"context"
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
)

const (
	defaultListenAddr = "0.0.0.0:3003"
)

// config holds runtime configuration read from env.
type config struct {
	listenAddr string
	dockerBin  string
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

func main() {
	cfg := config{
		listenAddr: env("MW_CONTROL_PLANE_ADDR", defaultListenAddr),
		dockerBin:  env("DOCKER_BIN", "docker"),
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

func ensureService(ctx context.Context, dockerBin, name string, meta containerMeta) error {
	// List containers (all, including stopped) matching name.
	out, err := runCmdOutput(ctx, dockerBin, "ps", "--all", "--filter", "name="+name, "--format", "{{.Names}}\t{{.ID}}\t{{.Image}}\t{{.Status}}")
	if err != nil {
		return fmt.Errorf("list containers: %w", err)
	}

	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) >= 1 && parts[0] == "/"+name || parts[0] == name {
			// Already exists; check if running.
			status := parts[3]
			if !strings.Contains(status, "Up") {
				if _, err := runCmdOutput(ctx, dockerBin, "start", name); err != nil {
					return fmt.Errorf("start container %s: %w", name, err)
				}
				log.Printf("started existing container %s", name)
			}
			return nil
		}
	}

	// Create and start.
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

	if _, err := runCmdOutput(ctx, dockerBin, args...); err != nil {
		return fmt.Errorf("run container: %w", err)
	}
	log.Printf("created and started container %s", name)
	return nil
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
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
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

		name := meta.Image // fallback
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

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
