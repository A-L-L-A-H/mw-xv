package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	paasMaxLogLines     = 500
	paasDefaultLogLines = 100
)

var (
	paasTenantPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
	paasEnvKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
	paasImagePattern  = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,254}$`)
	paasGitPattern    = regexp.MustCompile(`^https://[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=-]+$`)

	bearerTokenLogPattern = regexp.MustCompile(`(?i)(Bearer\s+)([^\s"']+)`)
	secretAssignPattern   = regexp.MustCompile(`(?i)\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASS|API_KEY|PRIVATE_KEY|DSN)[A-Z0-9_]*)=([^\s"']+)`)
)

// CommandRunner abstracts exec.CommandContext for deterministic unit testing.
// Production code always uses runCmdOutput (arg slices only, zero shell interpolation).
type CommandRunner func(ctx context.Context, name string, args ...string) (string, error)

const paasSchemaDDL = `
CREATE TABLE IF NOT EXISTS paas_apps (
    slug TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    image TEXT NOT NULL,
    port INTEGER NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    env_json TEXT NOT NULL DEFAULT '{}',
    compose_spec TEXT NOT NULL DEFAULT '',
    git_repo TEXT NOT NULL DEFAULT '',
    container_name TEXT NOT NULL,
    container_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'deploying',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

// initPaasSchema ensures the paas_apps SQLite table exists.
func initPaasSchema(db *sql.DB) error {
	_, err := db.Exec(paasSchemaDDL)
	return err
}

// PaasApp represents a deployed PaaS application persisted in SQLite and
// enriched with live Docker container state.
type PaasApp struct {
	Slug           string            `json:"slug"`
	TenantID       string            `json:"tenantId"`
	Image          string            `json:"image"`
	Port           int               `json:"port"`
	Domain         string            `json:"domain,omitempty"`
	Env            map[string]string `json:"env,omitempty"`
	ComposeSpec    string            `json:"composeSpec,omitempty"`
	GitRepo        string            `json:"gitRepo,omitempty"`
	ContainerName  string            `json:"containerName"`
	ContainerID    string            `json:"containerId,omitempty"`
	Status         string            `json:"status"`
	ContainerState string            `json:"containerState,omitempty"`
	CreatedAt      string            `json:"createdAt"`
	UpdatedAt      string            `json:"updatedAt"`
}

// PaasDeployRequest is the payload for POST /paas/apps/deploy.
type PaasDeployRequest struct {
	Slug        string            `json:"slug"`
	TenantID    string            `json:"tenantId"`
	Image       string            `json:"image"`
	Port        int               `json:"port"`
	Domain      string            `json:"domain,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	ComposeSpec string            `json:"composeSpec,omitempty"`
	GitRepo     string            `json:"gitRepo,omitempty"`
}

// PaasNodeMetrics is the payload returned by GET /paas/node/metrics.
type PaasNodeMetrics struct {
	CPUCores      int        `json:"cpuCores"`
	OS            string     `json:"os"`
	Arch          string     `json:"arch"`
	UptimeSeconds int64      `json:"uptimeSeconds"`
	DockerStatus  string     `json:"dockerStatus"`
	DockerVersion string     `json:"dockerVersion,omitempty"`
	Mesh          MeshStatus `json:"mesh"`
}

// PaasManager orchestrates PaaS app lifecycles over Docker, SQLite, and Caddy.
type PaasManager struct {
	db            *sql.DB
	dockerBin     string
	dockerNetwork string
	backupDir     string
	meshMgr       *MeshManager
	caddyMgr      *CaddyManager
	runner        CommandRunner
	streamRunner  StreamCommandRunner
	binaryRunner  BinaryCommandRunner
	stdinRunner   StdinCommandRunner
	healthProber  HealthProber
	startedAt     time.Time
}

// NewPaasManager creates a PaasManager with sensible defaults from environment.
func NewPaasManager(db *sql.DB, dockerBin string, meshMgr *MeshManager, caddyMgr *CaddyManager, runner CommandRunner) *PaasManager {
	if runner == nil {
		runner = runCmdOutput
	}
	if meshMgr == nil {
		meshMgr = NewMeshManagerFromEnv(dockerBin)
	}
	if caddyMgr == nil {
		caddyPath := strings.TrimSpace(os.Getenv("MW_PAAS_CADDYFILE_PATH"))
		caddyBin := env("CADDY_BIN", "caddy")
		reloadEnabled := parseBoolEnv(os.Getenv("MW_PAAS_CADDY_RELOAD"))
		caddyMgr = NewCaddyManager(caddyPath, caddyBin, reloadEnabled, runner)
	}
	return &PaasManager{
		db:            db,
		dockerBin:     dockerBin,
		dockerNetwork: strings.TrimSpace(os.Getenv("MW_PAAS_DOCKER_NETWORK")),
		backupDir:     env("MW_PAAS_BACKUP_DIR", "./backups"),
		meshMgr:       meshMgr,
		caddyMgr:      caddyMgr,
		runner:        runner,
		streamRunner:  runCmdStreamLines,
		binaryRunner:  runCmdBinaryOutput,
		stdinRunner:   runCmdWithStdin,
		healthProber:  defaultHTTPHealthProbe,
		startedAt:     time.Now().UTC(),
	}
}

// requirePaasAuth enforces internal authentication on /paas/* endpoints using
// either `X-Control-Plane-Token` or `Authorization: Bearer <token>`.
// Both the resolved control-plane admin token and raw MW_INTERNAL_SECRET (if
// configured) are accepted via constant-time comparison. Fails closed (401).
func requirePaasAuth(adminToken string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		presented := strings.TrimSpace(r.Header.Get("X-Control-Plane-Token"))
		if presented == "" {
			authz := r.Header.Get("Authorization")
			if strings.HasPrefix(authz, "Bearer ") {
				presented = strings.TrimSpace(authz[len("Bearer "):])
			}
		}

		ok := false
		if presented != "" {
			if adminToken != "" && constantTimeEquals(presented, adminToken) {
				ok = true
			}
			if internalSecret := strings.TrimSpace(os.Getenv("MW_INTERNAL_SECRET")); internalSecret != "" {
				if constantTimeEquals(presented, internalSecret) {
					ok = true
				}
			}
		}

		if !ok {
			writePaasJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func constantTimeEquals(a, b string) bool {
	if len(a) != len(b) || len(a) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// isSensitiveEnvKey returns true if an environment variable name likely holds a secret.
func isSensitiveEnvKey(key string) bool {
	upper := strings.ToUpper(key)
	for _, needle := range []string{
		"SECRET", "TOKEN", "PASSWORD", "PASS", "KEY",
		"CREDENTIAL", "AUTH", "PRIVATE", "DSN", "DATABASE_URL",
	} {
		if strings.Contains(upper, needle) {
			return true
		}
	}
	return false
}

// RedactEnvMap returns a shallow copy of env with sensitive values replaced by [REDACTED].
func RedactEnvMap(env map[string]string) map[string]string {
	if len(env) == 0 {
		return nil
	}
	out := make(map[string]string, len(env))
	for k, v := range env {
		if isSensitiveEnvKey(k) {
			out[k] = redactedPlaceholder
		} else {
			out[k] = v
		}
	}
	return out
}

// RedactPaasText scrubs known secret values, Bearer tokens, and secret env
// assignments from logs or error messages before returning them.
func RedactPaasText(text string, secrets ...string) string {
	out := text
	for _, sec := range secrets {
		if trimmed := strings.TrimSpace(sec); trimmed != "" {
			out = strings.ReplaceAll(out, trimmed, redactedPlaceholder)
		}
	}
	if internalSecret := strings.TrimSpace(os.Getenv("MW_INTERNAL_SECRET")); internalSecret != "" {
		out = strings.ReplaceAll(out, internalSecret, redactedPlaceholder)
	}
	out = bearerTokenLogPattern.ReplaceAllString(out, "${1}"+redactedPlaceholder)
	out = secretAssignPattern.ReplaceAllString(out, "${1}="+redactedPlaceholder)
	return out
}

// ValidateDeployRequest validates all fields of a PaaS deploy payload fail-closed.
func ValidateDeployRequest(req PaasDeployRequest) error {
	if err := ValidatePaasSlug(req.Slug); err != nil {
		return err
	}
	if req.TenantID == "" || !paasTenantPattern.MatchString(req.TenantID) {
		return fmt.Errorf("invalid tenantId: %q", req.TenantID)
	}
	if req.Image == "" {
		return errors.New("image is required")
	}
	if strings.HasPrefix(req.Image, "-") || strings.ContainsAny(req.Image, "\r\n\t \x00") || !paasImagePattern.MatchString(req.Image) {
		return fmt.Errorf("invalid image reference: %q", req.Image)
	}
	if err := ValidatePaasPort(req.Port); err != nil {
		return err
	}
	if req.Domain != "" {
		if err := ValidatePaasDomain(req.Domain); err != nil {
			return err
		}
	}
	if req.GitRepo != "" {
		if strings.HasPrefix(req.GitRepo, "-") || strings.ContainsAny(req.GitRepo, "\r\n\t \x00") || !paasGitPattern.MatchString(req.GitRepo) {
			return fmt.Errorf("invalid gitRepo URL: %q", req.GitRepo)
		}
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

// MountRoutes registers all /paas/* routes on mux with internal auth enforcement.
func (m *PaasManager) MountRoutes(mux *http.ServeMux, adminToken string) {
	mux.HandleFunc("/paas/node/metrics", requirePaasAuth(adminToken, m.handleNodeMetrics()))
	mux.HandleFunc("/paas/apps", requirePaasAuth(adminToken, m.handleApps()))
	mux.HandleFunc("/paas/apps/deploy", requirePaasAuth(adminToken, m.handleDeploy()))
	mux.HandleFunc("/paas/apps/", requirePaasAuth(adminToken, m.handleAppSubroutes()))
	mux.HandleFunc("/paas/backups/postgres", requirePaasAuth(adminToken, m.handleBackupPostgres()))
	mux.HandleFunc("/paas/backups", requirePaasAuth(adminToken, m.handleListBackups()))
	mux.HandleFunc("/paas/backups/restore", requirePaasAuth(adminToken, m.handleRestoreBackup()))
}

func (m *PaasManager) handleNodeMetrics() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		dockerStatus := "unavailable"
		dockerVersion := ""
		if out, err := m.runner(ctx, m.dockerBin, "version", "--format", "{{.Server.Version}}"); err == nil {
			dockerStatus = "ok"
			dockerVersion = strings.TrimSpace(out)
		}

		metrics := PaasNodeMetrics{
			CPUCores:      runtime.NumCPU(),
			OS:            runtime.GOOS,
			Arch:          runtime.GOARCH,
			UptimeSeconds: int64(time.Since(m.startedAt).Seconds()),
			DockerStatus:  dockerStatus,
			DockerVersion: dockerVersion,
			Mesh:          m.meshMgr.Status(ctx),
		}
		writePaasJSON(w, http.StatusOK, metrics)
	}
}

func (m *PaasManager) handleApps() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		apps, err := m.listAppsFromDB()
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		liveStates := m.inspectLiveContainers(ctx)
		for i := range apps {
			if st, ok := liveStates[apps[i].ContainerName]; ok {
				apps[i].ContainerState = st.state
				if st.id != "" {
					apps[i].ContainerID = st.id
				}
			} else {
				apps[i].ContainerState = "not_found"
			}
			apps[i].Env = RedactEnvMap(apps[i].Env)
		}

		writePaasJSON(w, http.StatusOK, map[string]interface{}{
			"apps": apps,
		})
	}
}

type liveContainerState struct {
	id    string
	state string
}

func (m *PaasManager) inspectLiveContainers(ctx context.Context) map[string]liveContainerState {
	result := make(map[string]liveContainerState)
	out, err := m.runner(ctx, m.dockerBin, "ps", "--all", "--filter", "label=mw.paas.app", "--format", "{{.Names}}\t{{.ID}}\t{{.State}}")
	if err != nil {
		return result
	}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 3 {
			continue
		}
		name := strings.TrimPrefix(parts[0], "/")
		id := parts[1]
		if len(id) > 12 {
			id = id[:12]
		}
		result[name] = liveContainerState{id: id, state: parts[2]}
	}
	return result
}

func (m *PaasManager) handleDeploy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req PaasDeployRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
		if err := ValidateDeployRequest(req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()

		containerName := PaasContainerName(req.Slug)
		containerID, err := m.deployContainerZeroDowntime(ctx, req, containerName)
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(req.Env)...),
			})
			return
		}

		envBytes, _ := json.Marshal(req.Env)
		if len(req.Env) == 0 {
			envBytes = []byte("{}")
		}
		if _, err := m.db.Exec(`
			INSERT INTO paas_apps (slug, tenant_id, image, port, domain, env_json, compose_spec, git_repo, container_name, container_id, status, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', datetime('now'))
			ON CONFLICT(slug) DO UPDATE SET
				tenant_id=excluded.tenant_id,
				image=excluded.image,
				port=excluded.port,
				domain=excluded.domain,
				env_json=excluded.env_json,
				compose_spec=excluded.compose_spec,
				git_repo=excluded.git_repo,
				container_name=excluded.container_name,
				container_id=excluded.container_id,
				status='running',
				updated_at=datetime('now')
		`, req.Slug, req.TenantID, req.Image, req.Port, req.Domain, string(envBytes), req.ComposeSpec, req.GitRepo, containerName, containerID); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := m.syncCaddyRoutes(ctx); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "deployed container but caddy sync failed: " + err.Error()})
			return
		}

		writePaasJSON(w, http.StatusCreated, PaasApp{
			Slug:          req.Slug,
			TenantID:      req.TenantID,
			Image:         req.Image,
			Port:          req.Port,
			Domain:        req.Domain,
			Env:           RedactEnvMap(req.Env),
			ComposeSpec:   req.ComposeSpec,
			GitRepo:       req.GitRepo,
			ContainerName: containerName,
			ContainerID:   containerID,
			Status:        "running",
		})
	}
}

// deployContainerZeroDowntime starts the new container before stopping/removing
// the old container (when an existing container is present), then renames the
// replacement to the canonical `mw-paas-<slug>` name.
func (m *PaasManager) deployContainerZeroDowntime(ctx context.Context, req PaasDeployRequest, containerName string) (string, error) {
	existingOut, _ := m.runner(ctx, m.dockerBin, "ps", "--all", "--filter", "name=^/"+containerName+"$", "-q")
	hasExisting := strings.TrimSpace(existingOut) != ""

	runName := containerName
	if hasExisting {
		runName = fmt.Sprintf("%s-next-%d", containerName, time.Now().UTC().UnixNano())
	}

	args := m.buildDockerRunArgs(req, runName)
	out, err := m.runner(ctx, m.dockerBin, args...)
	if err != nil {
		return "", fmt.Errorf("docker run failed: %w", err)
	}
	containerID := strings.TrimSpace(out)
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	if hasExisting {
		_, _ = m.runner(ctx, m.dockerBin, "stop", containerName)
		_, _ = m.runner(ctx, m.dockerBin, "rm", "-f", containerName)
		if _, err := m.runner(ctx, m.dockerBin, "rename", runName, containerName); err != nil {
			return containerID, fmt.Errorf("docker rename failed: %w", err)
		}
	}

	return containerID, nil
}

func (m *PaasManager) buildDockerRunArgs(req PaasDeployRequest, containerName string) []string {
	args := []string{
		"run", "-d",
		"--name", containerName,
		"--restart", "unless-stopped",
		"--label", "mw.paas.app=" + req.Slug,
		"--label", "mw.paas.tenant=" + req.TenantID,
		"--label", "mw.paas.managed=true",
	}
	if m.dockerNetwork != "" {
		args = append(args, "--network", m.dockerNetwork)
	}
	// Deterministic env flag ordering.
	keys := make([]string, 0, len(req.Env))
	for k := range req.Env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		args = append(args, "-e", k+"="+req.Env[k])
	}
	args = append(args, req.Image)
	return args
}

func (m *PaasManager) handleAppSubroutes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub := strings.TrimPrefix(r.URL.Path, "/paas/apps/")
		if sub == "" {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "missing app slug"})
			return
		}
		parts := strings.Split(sub, "/")
		slug := parts[0]
		if err := ValidatePaasSlug(slug); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		// DELETE /paas/apps/:slug
		if len(parts) == 1 {
			if r.Method == http.MethodDelete {
				m.handleDeleteApp(w, r, slug)
				return
			}
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		if len(parts) == 3 && parts[1] == "logs" && parts[2] == "stream" {
			if r.Method != http.MethodGet {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppLogsStream(w, r, slug)
			return
		}

		if len(parts) != 2 {
			writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}

		action := parts[1]
		switch action {
		case "logs":
			if r.Method != http.MethodGet {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppLogs(w, r, slug)
		case "stats":
			if r.Method != http.MethodGet {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppStats(w, r, slug)
		case "restart":
			if r.Method != http.MethodPost {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppRestart(w, r, slug)
		case "stop":
			if r.Method != http.MethodPost {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppStop(w, r, slug)
		default:
			writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "unsupported action"})
		}
	}
}

func (m *PaasManager) handleAppLogs(w http.ResponseWriter, r *http.Request, slug string) {
	tail := paasDefaultLogLines
	if raw := strings.TrimSpace(r.URL.Query().Get("tail")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "tail must be a positive integer (max 500)"})
			return
		}
		if n > paasMaxLogLines {
			n = paasMaxLogLines
		}
		tail = n
	}

	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	out, err := m.runner(ctx, m.dockerBin, "logs", "--timestamps", "--tail", strconv.Itoa(tail), app.ContainerName)
	if err != nil {
		writePaasJSON(w, http.StatusBadGateway, map[string]string{
			"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
		})
		return
	}

	redacted := RedactPaasText(out, collectEnvSecrets(app.Env)...)
	writePaasJSON(w, http.StatusOK, map[string]interface{}{
		"slug": slug,
		"tail": tail,
		"logs": redacted,
	})
}

func (m *PaasManager) handleAppRestart(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	if _, err := m.runner(ctx, m.dockerBin, "restart", app.ContainerName); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{
			"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
		})
		return
	}
	_, _ = m.db.Exec(`UPDATE paas_apps SET status='running', updated_at=datetime('now') WHERE slug=?`, slug)
	writePaasJSON(w, http.StatusOK, map[string]string{"slug": slug, "status": "restarted"})
}

func (m *PaasManager) handleAppStop(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	if _, err := m.runner(ctx, m.dockerBin, "stop", app.ContainerName); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{
			"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
		})
		return
	}
	_, _ = m.db.Exec(`UPDATE paas_apps SET status='stopped', updated_at=datetime('now') WHERE slug=?`, slug)
	writePaasJSON(w, http.StatusOK, map[string]string{"slug": slug, "status": "stopped"})
}

func (m *PaasManager) handleDeleteApp(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	_, _ = m.runner(ctx, m.dockerBin, "rm", "-f", app.ContainerName)
	if _, err := m.db.Exec(`DELETE FROM paas_apps WHERE slug=?`, slug); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := m.syncCaddyRoutes(ctx); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "deleted app but caddy sync failed: " + err.Error()})
		return
	}
	writePaasJSON(w, http.StatusOK, map[string]string{"slug": slug, "status": "deleted"})
}

func (m *PaasManager) syncCaddyRoutes(ctx context.Context) error {
	apps, err := m.listAppsFromDB()
	if err != nil {
		return err
	}
	routes := make([]CaddyRoute, 0, len(apps))
	for _, app := range apps {
		if app.Domain == "" {
			continue
		}
		routes = append(routes, CaddyRoute{
			Slug:         app.Slug,
			TenantID:     app.TenantID,
			Domain:       app.Domain,
			Port:         app.Port,
			UpstreamHost: app.ContainerName,
		})
	}
	_, err = m.caddyMgr.Sync(ctx, routes)
	return err
}

func (m *PaasManager) listAppsFromDB() ([]PaasApp, error) {
	rows, err := m.db.Query(`
		SELECT slug, tenant_id, image, port, domain, env_json, compose_spec, git_repo, container_name, container_id, status, created_at, updated_at
		FROM paas_apps
		ORDER BY slug ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	apps := make([]PaasApp, 0)
	for rows.Next() {
		var app PaasApp
		var envJSON string
		if err := rows.Scan(
			&app.Slug, &app.TenantID, &app.Image, &app.Port, &app.Domain,
			&envJSON, &app.ComposeSpec, &app.GitRepo, &app.ContainerName,
			&app.ContainerID, &app.Status, &app.CreatedAt, &app.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if envJSON != "" && envJSON != "{}" {
			_ = json.Unmarshal([]byte(envJSON), &app.Env)
		}
		apps = append(apps, app)
	}
	return apps, rows.Err()
}

func (m *PaasManager) getAppFromDB(slug string) (PaasApp, error) {
	var app PaasApp
	var envJSON string
	err := m.db.QueryRow(`
		SELECT slug, tenant_id, image, port, domain, env_json, compose_spec, git_repo, container_name, container_id, status, created_at, updated_at
		FROM paas_apps WHERE slug = ?
	`, slug).Scan(
		&app.Slug, &app.TenantID, &app.Image, &app.Port, &app.Domain,
		&envJSON, &app.ComposeSpec, &app.GitRepo, &app.ContainerName,
		&app.ContainerID, &app.Status, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		return app, err
	}
	if envJSON != "" && envJSON != "{}" {
		_ = json.Unmarshal([]byte(envJSON), &app.Env)
	}
	return app, nil
}

func collectEnvSecrets(env map[string]string) []string {
	var secrets []string
	for k, v := range env {
		if isSensitiveEnvKey(k) && strings.TrimSpace(v) != "" {
			secrets = append(secrets, v)
		}
	}
	return secrets
}

func writePaasJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
