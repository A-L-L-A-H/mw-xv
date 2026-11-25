package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const maxComposeSpecBytes = 128 * 1024 // 128 KiB

var (
	composePrivilegedPattern  = regexp.MustCompile(`(?i)^\s*privileged\s*:\s*["']?true["']?\s*$`)
	composeHostModePattern    = regexp.MustCompile(`(?i)^\s*(?:network_mode|pid|ipc|uts)\s*:\s*["']?host["']?\s*$`)
	composeBindTypePattern    = regexp.MustCompile(`(?i)^\s*type\s*:\s*["']?bind["']?\s*$`)
	composeBindSourcePattern  = regexp.MustCompile(`(?i)^\s*source\s*:\s*["']?(?:/|\.\.|~)`)
	composeVolumeBindPattern  = regexp.MustCompile(`^\s*-\s*["']?(?:/|\.\.|~|[A-Za-z]:[/\\])`)
	composeDockerSockPattern  = regexp.MustCompile(`(?i)docker\.sock`)
	composeDangerousCapRegexp = regexp.MustCompile(`(?i)^\s*-\s*["']?(?:SYS_ADMIN|ALL|SYS_PTRACE|SYS_MODULE)["']?\s*$`)
)

// PaasDeployment represents an audit entry in paas_deployments.
type PaasDeployment struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Action    string `json:"action"`
	Image     string `json:"image,omitempty"`
	Status    string `json:"status"`
	Message   string `json:"message,omitempty"`
	CreatedAt string `json:"createdAt"`
}

// PaasTemplate describes a one-click Coolify-style application template.
type PaasTemplate struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Category    string            `json:"category"`
	Description string            `json:"description"`
	Image       string            `json:"image"`
	Port        int               `json:"port"`
	Volumes     []string          `json:"volumes,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
}

// ComposeDeployRequest is the payload for POST /paas/apps/deploy-compose.
type ComposeDeployRequest struct {
	Slug         string            `json:"slug"`
	TenantID     string            `json:"tenantId"`
	Tenant       string            `json:"tenant,omitempty"`
	ComposeSpec  string            `json:"composeSpec"`
	Port         int               `json:"port"`
	Domain       string            `json:"domain,omitempty"`
	NoAutoDomain bool              `json:"noAutoDomain,omitempty"`
	ServiceName  string            `json:"serviceName,omitempty"`
	Env          map[string]string `json:"env,omitempty"`
}

func (m *PaasManager) recordDeployment(slug, action, image, status, message string) string {
	if m.db == nil {
		return ""
	}
	buf := make([]byte, 4)
	_, _ = rand.Read(buf)
	id := fmt.Sprintf("dep-%d-%s", time.Now().UTC().UnixNano(), hex.EncodeToString(buf))
	safeMsg := SanitizeLogValue(RedactPaasText(message))
	_, _ = m.db.Exec(`
		INSERT INTO paas_deployments (id, slug, action, image, status, message)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, slug, action, image, status, safeMsg)
	return id
}

// SyncCaddyRoutesOnStartup synchronizes Caddyfile routes on control-plane startup.
func (m *PaasManager) SyncCaddyRoutesOnStartup(ctx context.Context) error {
	if m == nil || m.caddyMgr == nil || m.db == nil {
		return nil
	}
	return m.syncCaddyRoutes(ctx)
}

func (m *PaasManager) composeStackDir(slug string) string {
	base := m.dataDir
	if strings.TrimSpace(base) == "" || base == "." {
		base = "."
	}
	return filepath.Join(base, "stacks", slug)
}

func (m *PaasManager) cleanupComposeStack(ctx context.Context, slug string) {
	stackDir := m.composeStackDir(slug)
	composeFile := filepath.Join(stackDir, "docker-compose.yml")
	if _, err := os.Stat(composeFile); err == nil {
		_, _ = m.runner(ctx, m.dockerBin, "compose", "-p", PaasContainerName(slug), "-f", composeFile, "down", "--remove-orphans")
	}
	_ = os.RemoveAll(stackDir)
}

// ValidateComposeSpec enforces strict fail-closed checks on Compose YAML specs.
func ValidateComposeSpec(spec string) error {
	if strings.TrimSpace(spec) == "" {
		return errors.New("composeSpec is required")
	}
	if len(spec) > maxComposeSpecBytes {
		return fmt.Errorf("composeSpec exceeds %d bytes", maxComposeSpecBytes)
	}
	if strings.ContainsRune(spec, 0) {
		return errors.New("composeSpec must not contain NUL bytes")
	}
	for _, rawLine := range strings.Split(spec, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if idx := strings.Index(line, " #"); idx >= 0 {
			line = line[:idx]
		}
		if composeDockerSockPattern.MatchString(line) {
			return errors.New("composeSpec must not mount docker.sock")
		}
		if composePrivilegedPattern.MatchString(line) {
			return errors.New("composeSpec must not set privileged: true")
		}
		if composeHostModePattern.MatchString(line) {
			return errors.New("composeSpec must not use host namespace modes")
		}
		if composeBindTypePattern.MatchString(line) || composeBindSourcePattern.MatchString(line) || composeVolumeBindPattern.MatchString(line) {
			return errors.New("composeSpec must not use host bind mounts")
		}
		if composeDangerousCapRegexp.MatchString(line) {
			return errors.New("composeSpec must not request dangerous Linux capabilities")
		}
		if strings.Contains(trimmed, "..") && strings.Contains(trimmed, ":") {
			return errors.New("composeSpec volume path must not contain traversal")
		}
	}
	return nil
}

// ValidateComposeDeployRequest validates a Compose deployment payload fail-closed.
func ValidateComposeDeployRequest(req ComposeDeployRequest) error {
	if err := ValidatePaasSlug(req.Slug); err != nil {
		return err
	}
	if req.TenantID == "" || !paasTenantPattern.MatchString(req.TenantID) {
		return fmt.Errorf("invalid tenantId: %q", req.TenantID)
	}
	if err := ValidatePaasPort(req.Port); err != nil {
		return err
	}
	if req.Domain != "" {
		if err := ValidatePaasDomain(req.Domain); err != nil {
			return err
		}
	}
	if req.ServiceName != "" {
		if err := ValidateContainerName(req.ServiceName); err != nil {
			return err
		}
	}
	if err := ValidateComposeSpec(req.ComposeSpec); err != nil {
		return err
	}
	for k, v := range req.Env {
		if !paasEnvKeyPattern.MatchString(k) {
			return fmt.Errorf("invalid env key: %q", k)
		}
		if strings.ContainsRune(v, 0) {
			return fmt.Errorf("env value for %q must not contain NUL bytes", k)
		}
	}
	return nil
}

func (m *PaasManager) handleAppGet(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	liveStates := m.inspectLiveContainers(ctx)
	if st, ok := liveStates[app.ContainerName]; ok {
		app.ContainerState = st.state
		if st.id != "" {
			app.ContainerID = st.id
		}
	} else {
		app.ContainerState = "not_found"
	}
	app.Env = RedactEnvMap(app.Env)
	enrichPaasApp(&app)
	writePaasJSON(w, http.StatusOK, app)
}

func (m *PaasManager) handleAppStart(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	if app.ComposeSpec != "" {
		composeFile := filepath.Join(m.composeStackDir(slug), "docker-compose.yml")
		if _, statErr := os.Stat(composeFile); statErr == nil {
			if _, err := m.runner(ctx, m.dockerBin, "compose", "-p", PaasContainerName(slug), "-f", composeFile, "up", "-d"); err != nil {
				m.recordDeployment(slug, "start", app.Image, "failed", err.Error())
				writePaasJSON(w, http.StatusInternalServerError, map[string]string{
					"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
				})
				return
			}
		} else if _, err := m.runner(ctx, m.dockerBin, "start", app.ContainerName); err != nil {
			m.recordDeployment(slug, "start", app.Image, "failed", err.Error())
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
			})
			return
		}
	} else {
		if _, err := m.runner(ctx, m.dockerBin, "start", app.ContainerName); err != nil {
			m.recordDeployment(slug, "start", app.Image, "failed", err.Error())
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
			})
			return
		}
	}
	_, _ = m.db.Exec(`UPDATE paas_apps SET status='running', updated_at=datetime('now') WHERE slug=?`, slug)
	m.recordDeployment(slug, "start", app.Image, "success", "container started")
	writePaasJSON(w, http.StatusOK, map[string]string{"slug": slug, "status": "running"})
}

func (m *PaasManager) handleAppRedeploy(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}

	var body struct {
		Image string `json:"image,omitempty"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
	}

	targetImage := app.Image
	if strings.TrimSpace(body.Image) != "" {
		targetImage = strings.TrimSpace(body.Image)
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	if app.ComposeSpec != "" {
		if err := m.runComposeUp(ctx, slug, app.ComposeSpec, app.Env); err != nil {
			m.recordDeployment(slug, "redeploy", "compose", "failed", err.Error())
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
			})
			return
		}
		_, _ = m.db.Exec(`UPDATE paas_apps SET status='running', updated_at=datetime('now') WHERE slug=?`, slug)
		_ = m.syncCaddyRoutes(ctx)
		depID := m.recordDeployment(slug, "redeploy", "compose", "success", "compose stack redeployed")
		updated, _ := m.getAppFromDB(slug)
		updated.Env = RedactEnvMap(updated.Env)
		writePaasJSON(w, http.StatusOK, paasAppDeployResponse{
			PaasApp:      updated,
			AppID:        updated.Slug,
			DeploymentID: depID,
			Message:      "redeployed",
		})
		return
	}

	req := PaasDeployRequest{
		Slug:        app.Slug,
		TenantID:    app.TenantID,
		Image:       targetImage,
		Port:        app.Port,
		Domain:      app.Domain,
		Env:         app.Env,
		Volumes:     app.Volumes,
		MemoryLimit: app.MemoryLimit,
		CPULimit:    app.CPULimit,
		GitRepo:     app.GitRepo,
	}
	if err := ValidateDeployRequest(req); err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	if !strings.HasPrefix(targetImage, "mw-paas-") {
		_, _ = m.runner(ctx, m.dockerBin, "pull", targetImage)
	}

	containerID, err := m.deployContainerZeroDowntime(ctx, req, app.ContainerName)
	if err != nil {
		m.recordDeployment(slug, "redeploy", targetImage, "failed", err.Error())
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{
			"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
		})
		return
	}

	if _, err := m.db.Exec(`
		UPDATE paas_apps SET image=?, container_id=?, status='running', updated_at=datetime('now') WHERE slug=?
	`, targetImage, containerID, slug); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := m.syncCaddyRoutes(ctx); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "redeployed container but caddy sync failed: " + err.Error()})
		return
	}

	depID := m.recordDeployment(slug, "redeploy", targetImage, "success", "container redeployed")
	updated, _ := m.getAppFromDB(slug)
	updated.Env = RedactEnvMap(updated.Env)
	writePaasJSON(w, http.StatusOK, paasAppDeployResponse{
		PaasApp:      updated,
		AppID:        updated.Slug,
		DeploymentID: depID,
		Message:      "redeployed",
	})
}

func (m *PaasManager) handleAppUpdateEnv(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}

	rawBytes, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read request body"})
		return
	}

	var envelope struct {
		Env      map[string]string `json:"env"`
		Redeploy *bool             `json:"redeploy,omitempty"`
	}
	if err := json.Unmarshal(rawBytes, &envelope); err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	incomingEnv := envelope.Env
	if incomingEnv == nil {
		var rawMap map[string]json.RawMessage
		if err := json.Unmarshal(rawBytes, &rawMap); err == nil {
			if _, hasEnvKey := rawMap["env"]; !hasEnvKey {
				var flat map[string]string
				if err := json.Unmarshal(rawBytes, &flat); err == nil {
					incomingEnv = flat
				}
			}
		}
	}
	if incomingEnv == nil {
		incomingEnv = map[string]string{}
	}

	merged := make(map[string]string, len(incomingEnv))
	for k, v := range incomingEnv {
		if !paasEnvKeyPattern.MatchString(k) {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid env key: %q", k)})
			return
		}
		if strings.ContainsRune(v, 0) {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("env value for %q must not contain NUL bytes", k)})
			return
		}
		if v == redactedPlaceholder {
			if existing, ok := app.Env[k]; ok {
				merged[k] = existing
			} else {
				writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("cannot preserve unknown redacted key %q", k)})
				return
			}
		} else {
			merged[k] = v
		}
	}

	envBytes, _ := json.Marshal(merged)
	if len(merged) == 0 {
		envBytes = []byte("{}")
	}
	if _, err := m.db.Exec(`UPDATE paas_apps SET env_json=?, updated_at=datetime('now') WHERE slug=?`, string(envBytes), slug); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	shouldRedeploy := envelope.Redeploy != nil && *envelope.Redeploy
	if shouldRedeploy && app.ComposeSpec == "" {
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		req := PaasDeployRequest{
			Slug:        app.Slug,
			TenantID:    app.TenantID,
			Image:       app.Image,
			Port:        app.Port,
			Domain:      app.Domain,
			Env:         merged,
			Volumes:     app.Volumes,
			MemoryLimit: app.MemoryLimit,
			CPULimit:    app.CPULimit,
			GitRepo:     app.GitRepo,
		}
		if cid, err := m.deployContainerZeroDowntime(ctx, req, app.ContainerName); err != nil {
			m.recordDeployment(slug, "env_update", app.Image, "failed", err.Error())
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(merged)...),
			})
			return
		} else if cid != "" {
			_, _ = m.db.Exec(`UPDATE paas_apps SET container_id=?, status='running', updated_at=datetime('now') WHERE slug=?`, cid, slug)
		}
	}

	m.recordDeployment(slug, "env_update", app.Image, "success", fmt.Sprintf("updated %d environment variables", len(merged)))
	updated, _ := m.getAppFromDB(slug)
	updated.Env = RedactEnvMap(updated.Env)
	writePaasJSON(w, http.StatusOK, updated)
}

func (m *PaasManager) handleAppUpdateDomain(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}

	var body struct {
		Domain string `json:"domain"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body); err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}
	if body.Domain != "" {
		if err := ValidatePaasDomain(body.Domain); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	prevDomain := app.Domain
	if _, err := m.db.Exec(`UPDATE paas_apps SET domain=?, updated_at=datetime('now') WHERE slug=?`, body.Domain, slug); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := m.syncCaddyRoutes(ctx); err != nil {
		_, _ = m.db.Exec(`UPDATE paas_apps SET domain=?, updated_at=datetime('now') WHERE slug=?`, prevDomain, slug)
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "caddy sync failed: " + err.Error()})
		return
	}

	msg := "domain removed"
	if body.Domain != "" {
		msg = "domain updated to " + body.Domain
	}
	m.recordDeployment(slug, "domain_update", app.Image, "success", msg)
	updated, _ := m.getAppFromDB(slug)
	updated.Env = RedactEnvMap(updated.Env)
	writePaasJSON(w, http.StatusOK, updated)
}

func (m *PaasManager) handleAppDeployments(w http.ResponseWriter, r *http.Request, slug string) {
	if _, err := m.getAppFromDB(slug); err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}
	rows, err := m.db.Query(`
		SELECT id, slug, action, image, status, message, created_at
		FROM paas_deployments
		WHERE slug = ?
		ORDER BY created_at DESC, rowid DESC
		LIMIT 50
	`, slug)
	if err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := make([]PaasDeployment, 0)
	for rows.Next() {
		var d PaasDeployment
		if err := rows.Scan(&d.ID, &d.Slug, &d.Action, &d.Image, &d.Status, &d.Message, &d.CreatedAt); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		list = append(list, d)
	}
	if err := rows.Err(); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writePaasJSON(w, http.StatusOK, map[string]interface{}{
		"slug":        slug,
		"deployments": list,
	})
}

func (m *PaasManager) handleTemplates() http.HandlerFunc {
	templates := []PaasTemplate{
		{
			ID:          "nginx-web",
			Name:        "Nginx Web Server",
			Category:    "Web",
			Description: "High-performance reverse proxy and static site server",
			Image:       "nginx:1.27-alpine",
			Port:        80,
		},
		{
			ID:          "static-site",
			Name:        "Static Site (Caddy)",
			Category:    "Web",
			Description: "Lightweight Caddy 2 static web server",
			Image:       "caddy:2-alpine",
			Port:        80,
		},
		{
			ID:          "node-api",
			Name:        "Node.js 22 API",
			Category:    "API",
			Description: "Node.js 22 Alpine runtime for REST & microservice backends",
			Image:       "node:22-alpine",
			Port:        3000,
			Env:         map[string]string{"NODE_ENV": "production", "PORT": "3000"},
		},
		{
			ID:          "postgres-16",
			Name:        "PostgreSQL 16",
			Category:    "Database",
			Description: "Production PostgreSQL 16 database with persistent volume storage",
			Image:       "postgres:16-alpine",
			Port:        5432,
			Volumes:     []string{"pgdata:/var/lib/postgresql/data"},
			Env:         map[string]string{"POSTGRES_DB": "app_db", "POSTGRES_USER": "postgres"},
		},
		{
			ID:          "redis-7",
			Name:        "Redis 7",
			Category:    "Cache",
			Description: "In-memory Redis 7 cache and message broker",
			Image:       "redis:7-alpine",
			Port:        6379,
			Volumes:     []string{"redisdata:/data"},
			Env:         map[string]string{"REDIS_APPENDONLY": "yes"},
		},
		{
			ID:          "n8n",
			Name:        "n8n Automation",
			Category:    "Workflow",
			Description: "Visual workflow automation & integration engine",
			Image:       "n8nio/n8n:latest",
			Port:        5678,
			Volumes:     []string{"n8ndata:/home/node/.n8n"},
		},
		{
			ID:          "uptime-kuma",
			Name:        "Uptime Kuma",
			Category:    "Monitoring",
			Description: "Self-hosted service uptime & TLS monitor",
			Image:       "louislam/uptime-kuma:1",
			Port:        3001,
			Volumes:     []string{"kumadata:/app/data"},
		},
		{
			ID:          "minio",
			Name:        "MinIO Object Storage",
			Category:    "Storage",
			Description: "S3-compatible object storage server",
			Image:       "minio/minio:latest",
			Port:        9000,
			Volumes:     []string{"miniodata:/data"},
		},
		{
			ID:          "ghost",
			Name:        "Ghost Publishing",
			Category:    "CMS",
			Description: "Modern headless CMS and publication platform",
			Image:       "ghost:5-alpine",
			Port:        2368,
			Volumes:     []string{"ghostcontent:/var/lib/ghost/content"},
		},
		{
			ID:          "ollama-local",
			Name:        "Ollama Local LLM",
			Category:    "AI",
			Description: "Self-hosted Ollama local inference server",
			Image:       "ollama/ollama:0.6.5",
			Port:        11434,
			Volumes:     []string{"ollamadata:/root/.ollama"},
			Env:         map[string]string{"OLLAMA_HOST": "0.0.0.0:11434"},
		},
		{
			ID:          "moonwitness-whatsapp",
			Name:        "MoonWitness WhatsApp",
			Category:    "Platform",
			Description: "Standalone Fastify + Baileys + @fastify/vite WhatsApp gateway",
			Image:       "moonwitness-whatsapp:vps",
			Port:        3000,
			Volumes:     []string{"whatsapp_auth_data:/var/lib/moonwitness/whatsapp-auth"},
			Env:         map[string]string{"NODE_ENV": "production", "WHATSAPP_DRIVER": "baileys"},
		},
		{
			ID:          "moonwitness-tenant",
			Name:        "MoonWitness Tenant Stack",
			Category:    "Platform",
			Description: "Isolated MoonWitness sovereign board & API runtime",
			Image:       "moonwitness-api:vps",
			Port:        3000,
			Env:         map[string]string{"NODE_ENV": "production", "MW_TENANT_MODE": "isolated"},
		},
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		writePaasJSON(w, http.StatusOK, map[string]interface{}{
			"templates": templates,
		})
	}
}

// HostContainerInfo summarizes any Docker container running on the host VPS.
type HostContainerInfo struct {
	Name    string `json:"name"`
	Image   string `json:"image"`
	Status  string `json:"status"`
	State   string `json:"state"`
	Managed bool   `json:"managed"`
	URL     string `json:"url,omitempty"`
}

// PlatformRouteInfo describes an active Caddy public reverse-proxy route.
type PlatformRouteInfo struct {
	Domain   string `json:"domain"`
	URL      string `json:"url"`
	Upstream string `json:"upstream"`
	Kind     string `json:"kind"`
}

// handleHostServices handles GET /paas/host/services by inspecting all Docker
// containers on the VPS and correlating them with configured Caddy routes.
func (m *PaasManager) handleHostServices() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		routes := make([]PlatformRouteInfo, 0)
		urlByUpstreamHost := make(map[string]string)

		if m.caddyMgr != nil {
			for _, srt := range m.caddyMgr.StaticRoutes() {
				u := "https://" + srt.Domain
				routes = append(routes, PlatformRouteInfo{
					Domain:   srt.Domain,
					URL:      u,
					Upstream: srt.Upstream,
					Kind:     "platform",
				})
				host := srt.Upstream
				if idx := strings.LastIndex(host, ":"); idx > 0 {
					host = host[:idx]
				}
				if _, exists := urlByUpstreamHost[host]; !exists {
					urlByUpstreamHost[host] = u
				}
				if strings.HasPrefix(srt.Domain, "paas.") && urlByUpstreamHost["moonwitness-control-plane"] == "" {
					urlByUpstreamHost["moonwitness-control-plane"] = u
				}
			}
		}

		managedSet := make(map[string]bool)
		if m.db != nil {
			if apps, err := m.listAppsFromDB(); err == nil {
				for _, app := range apps {
					managedSet[app.ContainerName] = true
					if app.Domain != "" {
						u := "https://" + app.Domain
						routes = append(routes, PlatformRouteInfo{
							Domain:   app.Domain,
							URL:      u,
							Upstream: fmt.Sprintf("%s:%d", app.ContainerName, app.Port),
							Kind:     "paas-app",
						})
						if _, exists := urlByUpstreamHost[app.ContainerName]; !exists {
							urlByUpstreamHost[app.ContainerName] = u
						}
					}
				}
			}
		}

		containers := make([]HostContainerInfo, 0)
		if out, err := m.runner(ctx, m.dockerBin, "ps", "-a", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}"); err == nil {
			for _, rawLine := range strings.Split(strings.TrimSpace(out), "\n") {
				if rawLine == "" {
					continue
				}
				parts := strings.SplitN(rawLine, "\t", 4)
				if len(parts) < 4 {
					continue
				}
				name := strings.TrimPrefix(strings.TrimSpace(parts[0]), "/")
				c := HostContainerInfo{
					Name:    name,
					Image:   strings.TrimSpace(parts[1]),
					Status:  strings.TrimSpace(parts[2]),
					State:   strings.TrimSpace(parts[3]),
					Managed: managedSet[name] || strings.HasPrefix(name, paasContainerPrefix),
					URL:     urlByUpstreamHost[name],
				}
				containers = append(containers, c)
			}
		}

		writePaasJSON(w, http.StatusOK, map[string]interface{}{
			"baseDomain": m.baseDomain,
			"containers": containers,
			"routes":     routes,
		})
	}
}

func (m *PaasManager) runComposeUp(ctx context.Context, slug, composeSpec string, envMap map[string]string) error {
	stackDir := m.composeStackDir(slug)
	if err := os.MkdirAll(stackDir, 0o750); err != nil {
		return fmt.Errorf("create stack dir: %w", err)
	}
	composeFile := filepath.Join(stackDir, "docker-compose.yml")
	if err := writeFileAtomic(composeFile, []byte(composeSpec), 0o600); err != nil {
		return fmt.Errorf("write compose file: %w", err)
	}
	if len(envMap) > 0 {
		var envBuf strings.Builder
		for k, v := range envMap {
			envBuf.WriteString(k)
			envBuf.WriteByte('=')
			envBuf.WriteString(strings.ReplaceAll(v, "\n", ""))
			envBuf.WriteByte('\n')
		}
		if err := writeFileAtomic(filepath.Join(stackDir, ".env"), []byte(envBuf.String()), 0o600); err != nil {
			return fmt.Errorf("write compose env file: %w", err)
		}
	}
	if _, err := m.runner(ctx, m.dockerBin, "compose", "-p", PaasContainerName(slug), "-f", composeFile, "up", "-d", "--remove-orphans"); err != nil {
		return fmt.Errorf("docker compose up failed: %w", err)
	}
	return nil
}

func (m *PaasManager) handleComposeDeploy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req ComposeDeployRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 256*1024)).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
		if req.TenantID == "" {
			req.TenantID = strings.TrimSpace(req.Tenant)
		}
		if req.TenantID == "" {
			req.TenantID = "default"
		}
		if req.Domain == "" && !req.NoAutoDomain && m.baseDomain != "" && req.Slug != "" {
			req.Domain = req.Slug + "." + m.baseDomain
		}
		if err := ValidateComposeDeployRequest(req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()

		if err := m.runComposeUp(ctx, req.Slug, req.ComposeSpec, req.Env); err != nil {
			m.recordDeployment(req.Slug, "compose_deploy", "compose", "failed", err.Error())
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(req.Env)...),
			})
			return
		}

		containerName := PaasContainerName(req.Slug)
		if req.ServiceName != "" {
			containerName = req.ServiceName
		}

		envBytes, _ := json.Marshal(req.Env)
		if len(req.Env) == 0 {
			envBytes = []byte("{}")
		}
		if _, err := m.db.Exec(`
			INSERT INTO paas_apps (slug, tenant_id, image, port, domain, env_json, volumes_json, memory_limit, cpu_limit, compose_spec, git_repo, container_name, container_id, status, updated_at)
			VALUES (?, ?, 'compose', ?, ?, ?, '[]', '', '', ?, '', ?, '', 'running', datetime('now'))
			ON CONFLICT(slug) DO UPDATE SET
				tenant_id=excluded.tenant_id,
				image='compose',
				port=excluded.port,
				domain=excluded.domain,
				env_json=excluded.env_json,
				compose_spec=excluded.compose_spec,
				container_name=excluded.container_name,
				status='running',
				updated_at=datetime('now')
		`, req.Slug, req.TenantID, req.Port, req.Domain, string(envBytes), req.ComposeSpec, containerName); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := m.syncCaddyRoutes(ctx); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "deployed compose stack but caddy sync failed: " + err.Error()})
			return
		}

		depID := m.recordDeployment(req.Slug, "compose_deploy", "compose", "success", "compose stack deployed")
		app, _ := m.getAppFromDB(req.Slug)
		app.Env = RedactEnvMap(app.Env)
		writePaasJSON(w, http.StatusCreated, paasAppDeployResponse{
			PaasApp:      app,
			AppID:        app.Slug,
			DeploymentID: depID,
			Message:      "compose deployed",
		})
	}
}
