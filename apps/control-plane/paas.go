package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
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
	paasTenantPattern      = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
	paasEnvKeyPattern      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
	paasImagePattern       = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,254}$`)
	paasGitPattern         = regexp.MustCompile(`^https://[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=-]+$`)
	paasNamedVolumePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}:/[a-zA-Z0-9._/-]{1,128}(?::(ro|rw))?$`)
	paasMemoryLimitPattern = regexp.MustCompile(`^[1-9][0-9]{0,5}[kKmMgG]$`)
	paasCPULimitPattern    = regexp.MustCompile(`^(?:[1-5]?[0-9]|6[0-4]|0\.[0-9]{1,2}|[1-9]\.[0-9]{1,2}|[1-5][0-9]\.[0-9]{1,2})$`)

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

const paasDeploymentsDDL = `
CREATE TABLE IF NOT EXISTS paas_deployments (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    action TEXT NOT NULL,
    image TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

// initPaasSchema ensures the paas_apps and paas_deployments SQLite tables exist
// and idempotently applies schema migrations.
func initPaasSchema(db *sql.DB) error {
	if _, err := db.Exec(paasSchemaDDL); err != nil {
		return err
	}
	if _, err := db.Exec(paasDeploymentsDDL); err != nil {
		return err
	}
	cols := make(map[string]bool)
	rows, err := db.Query(`PRAGMA table_info(paas_apps)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		cols[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	migrations := []struct {
		col string
		ddl string
	}{
		{"volumes_json", `ALTER TABLE paas_apps ADD COLUMN volumes_json TEXT NOT NULL DEFAULT '[]'`},
		{"memory_limit", `ALTER TABLE paas_apps ADD COLUMN memory_limit TEXT NOT NULL DEFAULT ''`},
		{"cpu_limit", `ALTER TABLE paas_apps ADD COLUMN cpu_limit TEXT NOT NULL DEFAULT ''`},
	}
	for _, mig := range migrations {
		if !cols[mig.col] {
			if _, err := db.Exec(mig.ddl); err != nil {
				return err
			}
		}
	}
	return nil
}

// PaasApp represents a deployed PaaS application persisted in SQLite and
// enriched with live Docker container state.
type PaasApp struct {
	ID             string            `json:"id"`
	Slug           string            `json:"slug"`
	TenantID       string            `json:"tenantId"`
	Tenant         string            `json:"tenant,omitempty"`
	Image          string            `json:"image"`
	Port           int               `json:"port"`
	Domain         string            `json:"domain,omitempty"`
	URL            string            `json:"url,omitempty"`
	Env            map[string]string `json:"env,omitempty"`
	Volumes        []string          `json:"volumes,omitempty"`
	MemoryLimit    string            `json:"memoryLimit,omitempty"`
	CPULimit       string            `json:"cpuLimit,omitempty"`
	ComposeSpec    string            `json:"composeSpec,omitempty"`
	GitRepo        string            `json:"gitRepo,omitempty"`
	ContainerName  string            `json:"containerName"`
	ContainerID    string            `json:"containerId,omitempty"`
	Status         string            `json:"status"`
	ContainerState string            `json:"containerState,omitempty"`
	CreatedAt      string            `json:"createdAt"`
	UpdatedAt      string            `json:"updatedAt"`
}

func enrichPaasApp(app *PaasApp) {
	app.ID = app.Slug
	app.Tenant = app.TenantID
	if app.Domain != "" {
		app.URL = "https://" + app.Domain
	} else {
		app.URL = ""
	}
}

// PaasDeployRequest is the payload for POST /paas/apps/deploy and POST /paas/apps.
type PaasDeployRequest struct {
	Slug         string            `json:"slug"`
	TenantID     string            `json:"tenantId"`
	Tenant       string            `json:"tenant,omitempty"`
	Image        string            `json:"image"`
	Port         int               `json:"port"`
	Domain       string            `json:"domain,omitempty"`
	NoAutoDomain bool              `json:"noAutoDomain,omitempty"`
	Env          map[string]string `json:"env,omitempty"`
	Volumes      []string          `json:"volumes,omitempty"`
	MemoryLimit  string            `json:"memoryLimit,omitempty"`
	CPULimit     string            `json:"cpuLimit,omitempty"`
	ComposeSpec  string            `json:"composeSpec,omitempty"`
	GitRepo      string            `json:"gitRepo,omitempty"`
}

// PaasNodeMetrics is the payload returned by GET /paas/node/metrics and GET /paas/metrics.
type PaasNodeMetrics struct {
	NodeID        string     `json:"nodeId,omitempty"`
	MeshIP        string     `json:"meshIp,omitempty"`
	CPUCores      int        `json:"cpuCores"`
	CPUPercent    float64    `json:"cpuPercent"`
	MemoryUsedMB  int64      `json:"memoryUsedMB"`
	MemoryTotalMB int64      `json:"memoryTotalMB"`
	MemoryPercent float64    `json:"memoryPercent"`
	RunningApps   int        `json:"runningApps"`
	TotalApps     int        `json:"totalApps"`
	BaseDomain    string     `json:"baseDomain,omitempty"`
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
	baseDomain    string
	dataDir       string
	adminToken    string
	meshMgr       *MeshManager
	caddyMgr      *CaddyManager
	runner        CommandRunner
	streamRunner  StreamCommandRunner
	binaryRunner  BinaryCommandRunner
	stdinRunner   StdinCommandRunner
	healthProber  HealthProber
	startedAt     time.Time
}

// SetAdminToken stores the canonical control-plane admin token on PaasManager.
func (m *PaasManager) SetAdminToken(token string) {
	m.adminToken = token
}

func parseStaticRoutesFromEnv() []CaddyStaticRoute {
	var routes []CaddyStaticRoute
	seen := make(map[string]bool)
	uiDomain := strings.TrimSpace(os.Getenv("MW_PAAS_UI_DOMAIN"))
	uiUpstream := strings.TrimSpace(os.Getenv("MW_PAAS_UI_UPSTREAM"))
	if uiDomain != "" && uiUpstream != "" {
		routes = append(routes, CaddyStaticRoute{Domain: uiDomain, Upstream: uiUpstream})
		seen[uiDomain] = true
	}
	rawStatic := strings.TrimSpace(os.Getenv("MW_PAAS_STATIC_ROUTES"))
	if rawStatic != "" {
		for _, entry := range strings.Split(rawStatic, ",") {
			trimmed := strings.TrimSpace(entry)
			if trimmed == "" {
				continue
			}
			parts := strings.SplitN(trimmed, "=", 2)
			if len(parts) != 2 {
				log.Printf("warning: ignoring malformed MW_PAAS_STATIC_ROUTES entry %q", SanitizeLogValue(trimmed))
				continue
			}
			dom := strings.TrimSpace(parts[0])
			up := strings.TrimSpace(parts[1])
			if dom == "" || up == "" || seen[dom] {
				continue
			}
			seen[dom] = true
			routes = append(routes, CaddyStaticRoute{Domain: dom, Upstream: up})
		}
	}
	return routes
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
		if caddyPath == "" {
			caddyPath = strings.TrimSpace(os.Getenv("MW_PAAS_CADDYFILE"))
		}
		caddyBin := env("CADDY_BIN", "caddy")
		reloadRaw := strings.TrimSpace(os.Getenv("MW_PAAS_CADDY_RELOAD"))
		reloadEnabled := parseBoolEnv(reloadRaw)
		caddyMgr = NewCaddyManager(caddyPath, caddyBin, reloadEnabled, runner)
		caddyContainer := strings.TrimSpace(os.Getenv("MW_PAAS_CADDY_CONTAINER"))
		if caddyContainer != "" && !strings.EqualFold(reloadRaw, "false") {
			caddyMgr.ConfigureContainerReload(dockerBin, caddyContainer)
		}
		if staticRoutes := parseStaticRoutesFromEnv(); len(staticRoutes) > 0 {
			if err := caddyMgr.SetStaticRoutes(staticRoutes); err != nil {
				log.Printf("warning: invalid static caddy routes ignored: %v", err)
			}
		}
	}
	dockerNetwork := strings.TrimSpace(os.Getenv("MW_PAAS_DOCKER_NETWORK"))
	if dockerNetwork == "" {
		dockerNetwork = strings.TrimSpace(os.Getenv("MW_PAAS_NETWORK"))
	}
	baseDomain := strings.TrimSpace(os.Getenv("MW_PAAS_BASE_DOMAIN"))
	if baseDomain != "" {
		if err := ValidatePaasDomain(baseDomain); err != nil {
			log.Printf("warning: invalid MW_PAAS_BASE_DOMAIN ignored: %v", err)
			baseDomain = ""
		}
	}
	dbPath := env("MW_CONTROL_PLANE_DB_PATH", defaultDbPath)
	return &PaasManager{
		db:            db,
		dockerBin:     dockerBin,
		dockerNetwork: dockerNetwork,
		backupDir:     env("MW_PAAS_BACKUP_DIR", "./backups"),
		baseDomain:    baseDomain,
		dataDir:       filepath.Dir(dbPath),
		meshMgr:       meshMgr,
		caddyMgr:      caddyMgr,
		runner:        runner,
		streamRunner:  runCmdStreamLines,
		binaryRunner:  runCmdBinaryOutput,
		stdinRunner:   runCmdWithStdin,
		healthProber:  nil,
		startedAt:     time.Now().UTC(),
	}
}

// requirePaasAuth enforces internal authentication on /paas/* endpoints using
// either `X-Control-Plane-Token` or `Authorization: Bearer <token>`.
// Both the resolved control-plane admin token and raw MW_INTERNAL_SECRET (if
// configured) are accepted via constant-time comparison. Fails closed (401).
func requirePaasAuth(adminToken string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		presented := paasCredentialFromRequest(r)

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

// paasCredentialFromRequest accepts exactly one well-formed credential header.
// Missing, malformed or whitespace-padded values are rejected rather than
// trimmed into a valid token.
func paasCredentialFromRequest(r *http.Request) string {
	if header := r.Header.Get("X-Control-Plane-Token"); header != "" {
		if !wellFormedToken(header) {
			return ""
		}
		return header
	}
	authz := r.Header.Get("Authorization")
	if strings.Count(authz, " ") != 1 {
		return ""
	}
	idx := strings.IndexByte(authz, ' ')
	if idx < 0 || authz[:idx] != "Bearer" {
		return ""
	}
	presented := authz[idx+1:]
	if !wellFormedToken(presented) {
		return ""
	}
	return presented
}

func wellFormedToken(token string) bool {
	if token == "" || strings.TrimSpace(token) != token {
		return false
	}
	for _, ch := range token {
		if ch <= ' ' || ch == 0x7f {
			return false
		}
	}
	return true
}

// requirePrivilegedPaasAuth is the stronger variant used by privileged /paas/*
// rows of the control-plane route matrix. It accepts the same two header forms
// as requirePaasAuth but only the canonical audience-bound admin token; the raw
// MW_INTERNAL_SECRET is not a privileged credential.
func requirePrivilegedPaasAuth(adminToken string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		presented := paasCredentialFromRequest(r)
		if adminToken == "" || !constantTimeEquals(presented, adminToken) {
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

// normalizeDeployRequest applies tenant and baseDomain defaults before validation.
func normalizeDeployRequest(req PaasDeployRequest, baseDomain string) PaasDeployRequest {
	if req.TenantID == "" {
		req.TenantID = strings.TrimSpace(req.Tenant)
	}
	if req.TenantID == "" {
		req.TenantID = "default"
	}
	if req.Domain == "" && !req.NoAutoDomain && baseDomain != "" && req.Slug != "" {
		req.Domain = req.Slug + "." + baseDomain
	}
	return req
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
	for _, vol := range req.Volumes {
		if strings.HasPrefix(vol, "-") || strings.HasPrefix(vol, "/") || strings.Contains(vol, "..") || strings.ContainsRune(vol, 0) || !paasNamedVolumePattern.MatchString(vol) {
			return fmt.Errorf("invalid volume mount (named volumes only): %q", vol)
		}
	}
	if req.MemoryLimit != "" && !paasMemoryLimitPattern.MatchString(req.MemoryLimit) {
		return fmt.Errorf("invalid memoryLimit: %q", req.MemoryLimit)
	}
	if req.CPULimit != "" {
		if !paasCPULimitPattern.MatchString(req.CPULimit) {
			return fmt.Errorf("invalid cpuLimit: %q", req.CPULimit)
		}
		cpus, err := strconv.ParseFloat(req.CPULimit, 64)
		if err != nil || cpus <= 0 || cpus > 64 {
			return fmt.Errorf("invalid cpuLimit range: %q", req.CPULimit)
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
	m.SetAdminToken(adminToken)
	mux.HandleFunc("/paas/node/metrics", requirePaasAuth(adminToken, m.handleNodeMetrics()))
	mux.HandleFunc("/paas/metrics", requirePaasAuth(adminToken, m.handleNodeMetrics()))
	mux.HandleFunc("/paas/templates", requirePaasAuth(adminToken, m.handleTemplates()))
	mux.HandleFunc("/paas/apps", requirePaasAuth(adminToken, m.handleApps()))
	mux.HandleFunc("/paas/apps/deploy", requirePaasAuth(adminToken, m.handleDeploy()))
	mux.HandleFunc("/paas/apps/deploy-compose", requirePrivilegedPaasAuth(adminToken, m.handleComposeDeploy()))
	mux.HandleFunc("/paas/apps/", requirePaasAuth(adminToken, m.handleAppSubroutes()))
	mux.HandleFunc("/paas/backups/postgres", requirePaasAuth(adminToken, m.handleBackupPostgres()))
	mux.HandleFunc("/paas/backups", requirePaasAuth(adminToken, m.handleListBackups()))
	mux.HandleFunc("/paas/backups/restore", requirePaasAuth(adminToken, m.handleRestoreBackup()))
	mux.HandleFunc("/paas/cluster/nodes", requirePaasAuth(adminToken, m.handleClusterNodes()))
	mux.HandleFunc("/paas/cluster/nodes/join", requirePaasAuth(adminToken, m.handleClusterJoin()))
	mux.HandleFunc("/paas/cluster/ha/status", requirePaasAuth(adminToken, m.handleHAStatus()))
}

func readHostResourceMetrics(cpuCores int) (cpuPercent float64, memUsedMB, memTotalMB int64, memPercent float64) {
	if runtime.GOOS != "linux" {
		return 0, 0, 0, 0
	}
	if rawMem, err := os.ReadFile("/proc/meminfo"); err == nil {
		var totalKB, availKB, freeKB int64
		for _, line := range strings.Split(string(rawMem), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			val, err := strconv.ParseInt(fields[1], 10, 64)
			if err != nil {
				continue
			}
			switch fields[0] {
			case "MemTotal:":
				totalKB = val
			case "MemAvailable:":
				availKB = val
			case "MemFree:":
				freeKB = val
			}
		}
		if availKB == 0 {
			availKB = freeKB
		}
		if totalKB > 0 {
			memTotalMB = totalKB / 1024
			usedKB := totalKB - availKB
			if usedKB < 0 {
				usedKB = 0
			}
			memUsedMB = usedKB / 1024
			memPercent = float64(int(float64(usedKB)*10000/float64(totalKB))) / 100
		}
	}
	if rawLoad, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(rawLoad))
		if len(fields) > 0 && cpuCores > 0 {
			if load1, err := strconv.ParseFloat(fields[0], 64); err == nil && load1 >= 0 {
				pct := (load1 / float64(cpuCores)) * 100
				if pct > 100 {
					pct = 100
				}
				cpuPercent = float64(int(pct*100)) / 100
			}
		}
	}
	return cpuPercent, memUsedMB, memTotalMB, memPercent
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

		cpuCores := runtime.NumCPU()
		cpuPct, memUsedMB, memTotalMB, memPct := readHostResourceMetrics(cpuCores)
		meshStatus := m.meshMgr.Status(ctx)

		nodeID, _ := os.Hostname()
		if envHost := strings.TrimSpace(os.Getenv("MW_MESH_HOSTNAME")); envHost != "" {
			nodeID = envHost
		}

		totalApps := 0
		runningApps := 0
		if apps, err := m.listAppsFromDB(); err == nil {
			totalApps = len(apps)
			liveStates := m.inspectLiveContainers(ctx)
			for _, app := range apps {
				if st, ok := liveStates[app.ContainerName]; ok && strings.EqualFold(st.state, "running") {
					runningApps++
				}
			}
		}

		metrics := PaasNodeMetrics{
			NodeID:        nodeID,
			MeshIP:        meshStatus.IPv4,
			CPUCores:      cpuCores,
			CPUPercent:    cpuPct,
			MemoryUsedMB:  memUsedMB,
			MemoryTotalMB: memTotalMB,
			MemoryPercent: memPct,
			RunningApps:   runningApps,
			TotalApps:     totalApps,
			BaseDomain:    m.baseDomain,
			OS:            runtime.GOOS,
			Arch:          runtime.GOARCH,
			UptimeSeconds: int64(time.Since(m.startedAt).Seconds()),
			DockerStatus:  dockerStatus,
			DockerVersion: dockerVersion,
			Mesh:          meshStatus,
		}
		writePaasJSON(w, http.StatusOK, metrics)
	}
}

func (m *PaasManager) handleApps() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
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
				enrichPaasApp(&apps[i])
			}

			writePaasJSON(w, http.StatusOK, map[string]interface{}{
				"apps": apps,
			})
		case http.MethodPost:
			if m.adminToken == "" || !constantTimeEquals(paasCredentialFromRequest(r), m.adminToken) {
				writePaasJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			m.handleDeployPayload(w, r)
		default:
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
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

type paasAppDeployResponse struct {
	PaasApp
	AppID        string `json:"appId,omitempty"`
	DeploymentID string `json:"deploymentId,omitempty"`
	Message      string `json:"message,omitempty"`
}

func (m *PaasManager) handleDeploy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		m.handleDeployPayload(w, r)
	}
}

func (m *PaasManager) handleDeployPayload(w http.ResponseWriter, r *http.Request) {
	var req PaasDeployRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}
	req = normalizeDeployRequest(req, m.baseDomain)
	if err := ValidateDeployRequest(req); err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	containerName := PaasContainerName(req.Slug)
	containerID, err := m.deployContainerZeroDowntime(ctx, req, containerName)
	if err != nil {
		m.recordDeployment(req.Slug, "deploy", req.Image, "failed", err.Error())
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{
			"error": RedactPaasText(err.Error(), collectEnvSecrets(req.Env)...),
		})
		return
	}

	envBytes, _ := json.Marshal(req.Env)
	if len(req.Env) == 0 {
		envBytes = []byte("{}")
	}
	volBytes, _ := json.Marshal(req.Volumes)
	if len(req.Volumes) == 0 {
		volBytes = []byte("[]")
	}
	if _, err := m.db.Exec(`
		INSERT INTO paas_apps (slug, tenant_id, image, port, domain, env_json, volumes_json, memory_limit, cpu_limit, compose_spec, git_repo, container_name, container_id, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', datetime('now'))
		ON CONFLICT(slug) DO UPDATE SET
			tenant_id=excluded.tenant_id,
			image=excluded.image,
			port=excluded.port,
			domain=excluded.domain,
			env_json=excluded.env_json,
			volumes_json=excluded.volumes_json,
			memory_limit=excluded.memory_limit,
			cpu_limit=excluded.cpu_limit,
			compose_spec=excluded.compose_spec,
			git_repo=excluded.git_repo,
			container_name=excluded.container_name,
			container_id=excluded.container_id,
			status='running',
			updated_at=datetime('now')
	`, req.Slug, req.TenantID, req.Image, req.Port, req.Domain, string(envBytes), string(volBytes), req.MemoryLimit, req.CPULimit, req.ComposeSpec, req.GitRepo, containerName, containerID); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if err := m.syncCaddyRoutes(ctx); err != nil {
		m.recordDeployment(req.Slug, "deploy", req.Image, "degraded", "deployed container but caddy sync failed: "+err.Error())
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "deployed container but caddy sync failed: " + err.Error()})
		return
	}

	depID := m.recordDeployment(req.Slug, "deploy", req.Image, "success", "container deployed")
	app := PaasApp{
		Slug:          req.Slug,
		TenantID:      req.TenantID,
		Image:         req.Image,
		Port:          req.Port,
		Domain:        req.Domain,
		Env:           RedactEnvMap(req.Env),
		Volumes:       req.Volumes,
		MemoryLimit:   req.MemoryLimit,
		CPULimit:      req.CPULimit,
		ComposeSpec:   req.ComposeSpec,
		GitRepo:       req.GitRepo,
		ContainerName: containerName,
		ContainerID:   containerID,
		Status:        "running",
	}
	enrichPaasApp(&app)
	writePaasJSON(w, http.StatusCreated, paasAppDeployResponse{
		PaasApp:      app,
		AppID:        app.Slug,
		DeploymentID: depID,
		Message:      "deployed",
	})
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
	for _, vol := range req.Volumes {
		args = append(args, "-v", vol)
	}
	if req.MemoryLimit != "" {
		args = append(args, "--memory", req.MemoryLimit)
	}
	if req.CPULimit != "" {
		args = append(args, "--cpus", req.CPULimit)
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

		// GET or DELETE /paas/apps/:slug
		if len(parts) == 1 {
			switch r.Method {
			case http.MethodGet:
				m.handleAppGet(w, r, slug)
			case http.MethodDelete:
				m.handleDeleteApp(w, r, slug)
			default:
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			}
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
		case "deployments":
			if r.Method != http.MethodGet {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppDeployments(w, r, slug)
		case "start":
			if r.Method != http.MethodPost {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppStart(w, r, slug)
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
		case "redeploy":
			if r.Method != http.MethodPost {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppRedeploy(w, r, slug)
		case "env":
			if r.Method != http.MethodPut && r.Method != http.MethodPatch {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppUpdateEnv(w, r, slug)
		case "domain":
			if r.Method != http.MethodPut && r.Method != http.MethodPatch {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAppUpdateDomain(w, r, slug)
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
		m.recordDeployment(slug, "restart", app.Image, "failed", err.Error())
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{
			"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
		})
		return
	}
	_, _ = m.db.Exec(`UPDATE paas_apps SET status='running', updated_at=datetime('now') WHERE slug=?`, slug)
	m.recordDeployment(slug, "restart", app.Image, "success", "container restarted")
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
		m.recordDeployment(slug, "stop", app.Image, "failed", err.Error())
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{
			"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
		})
		return
	}
	_, _ = m.db.Exec(`UPDATE paas_apps SET status='stopped', updated_at=datetime('now') WHERE slug=?`, slug)
	m.recordDeployment(slug, "stop", app.Image, "success", "container stopped")
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

	if app.ComposeSpec != "" {
		m.cleanupComposeStack(ctx, slug)
	}
	_, _ = m.runner(ctx, m.dockerBin, "rm", "-f", app.ContainerName)
	if _, err := m.db.Exec(`DELETE FROM paas_apps WHERE slug=?`, slug); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	m.recordDeployment(slug, "delete", app.Image, "success", "app deleted")
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
		SELECT slug, tenant_id, image, port, domain, env_json, volumes_json, memory_limit, cpu_limit, compose_spec, git_repo, container_name, container_id, status, created_at, updated_at
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
		var envJSON, volumesJSON string
		if err := rows.Scan(
			&app.Slug, &app.TenantID, &app.Image, &app.Port, &app.Domain,
			&envJSON, &volumesJSON, &app.MemoryLimit, &app.CPULimit,
			&app.ComposeSpec, &app.GitRepo, &app.ContainerName,
			&app.ContainerID, &app.Status, &app.CreatedAt, &app.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if envJSON != "" && envJSON != "{}" {
			_ = json.Unmarshal([]byte(envJSON), &app.Env)
		}
		if volumesJSON != "" && volumesJSON != "[]" {
			_ = json.Unmarshal([]byte(volumesJSON), &app.Volumes)
		}
		enrichPaasApp(&app)
		apps = append(apps, app)
	}
	return apps, rows.Err()
}

func (m *PaasManager) getAppFromDB(slug string) (PaasApp, error) {
	var app PaasApp
	var envJSON, volumesJSON string
	err := m.db.QueryRow(`
		SELECT slug, tenant_id, image, port, domain, env_json, volumes_json, memory_limit, cpu_limit, compose_spec, git_repo, container_name, container_id, status, created_at, updated_at
		FROM paas_apps WHERE slug = ?
	`, slug).Scan(
		&app.Slug, &app.TenantID, &app.Image, &app.Port, &app.Domain,
		&envJSON, &volumesJSON, &app.MemoryLimit, &app.CPULimit,
		&app.ComposeSpec, &app.GitRepo, &app.ContainerName,
		&app.ContainerID, &app.Status, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		return app, err
	}
	if envJSON != "" && envJSON != "{}" {
		_ = json.Unmarshal([]byte(envJSON), &app.Env)
	}
	if volumesJSON != "" && volumesJSON != "[]" {
		_ = json.Unmarshal([]byte(volumesJSON), &app.Volumes)
	}
	enrichPaasApp(&app)
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

// PaasClusterNode represents a mesh node in the cluster view.
type PaasClusterNode struct {
	Hostname       string `json:"hostname"`
	IPv4           string `json:"ipv4,omitempty"`
	ContainerState string `json:"containerState,omitempty"`
	Status         string `json:"status,omitempty"`
	IsLocal        bool   `json:"isLocal,omitempty"`
}

// handleClusterNodes handles GET /paas/cluster/nodes.
func (m *PaasManager) handleClusterNodes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		meshStatus := m.meshMgr.Status(ctx)
		hostname, _ := os.Hostname()
		if envHost := strings.TrimSpace(os.Getenv("MW_MESH_HOSTNAME")); envHost != "" {
			hostname = envHost
		}

		var nodes []PaasClusterNode
		// Local node first
		nodes = append(nodes, PaasClusterNode{
			Hostname:       hostname,
			IPv4:           meshStatus.IPv4,
			ContainerState: meshStatus.ContainerState,
			Status:         meshStatus.Status,
			IsLocal:        true,
		})

		// Peer nodes from mesh
		for _, peer := range meshStatus.Peers {
			nodes = append(nodes, PaasClusterNode{
				Hostname: peer,
				Status:   "peer",
				IsLocal:  false,
			})
		}

		writePaasJSON(w, http.StatusOK, map[string]interface{}{"nodes": nodes})
	}
}

// ClusterJoinRequest is the payload for POST /paas/cluster/nodes/join.
type ClusterJoinRequest struct {
	Peer string `json:"peer"`
}

// handleClusterJoin handles POST /paas/cluster/nodes/join.
func (m *PaasManager) handleClusterJoin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		var req ClusterJoinRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}

		peer := strings.TrimSpace(req.Peer)
		if peer == "" {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "peer is required"})
			return
		}
		if strings.HasPrefix(peer, "-") || strings.ContainsAny(peer, "\r\n\t \x00") {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid peer format"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		meshStatus := m.meshMgr.Status(ctx)
		if !meshStatus.Enabled {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "mesh not enabled"})
			return
		}
		if meshStatus.NetworkSecret == "" && meshStatus.SecretConfigured {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "network secret not available"})
			return
		}

		// Build easytier join command args - no shell interpolation
		args := []string{
			"exec", meshStatus.ContainerID,
			"easytier-cli", "join",
			"--network-name", meshStatus.NetworkName,
			"--network-secret", meshStatus.NetworkSecret,
			"--peers", peer,
		}

		runner := m.runner
		if runner == nil {
			runner = runCmdOutput
		}

		_, err := runner(ctx, m.dockerBin, args...)
		if err != nil {
			redactedErr := RedactMeshSecret(err.Error(), meshStatus.NetworkSecret)
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "join failed: " + redactedErr})
			return
		}

		writePaasJSON(w, http.StatusOK, map[string]string{"status": "joined", "peer": peer})
	}
}

// HAStatusResponse represents the HA cluster status payload.
type HAStatusResponse struct {
	Mesh      MeshStatus `json:"mesh"`
	LocalNode struct {
		Hostname string `json:"hostname"`
		IPv4     string `json:"ipv4,omitempty"`
		Role     string `json:"role"`
	} `json:"localNode"`
	PeerCount int `json:"peerCount"`
}

// handleHAStatus handles GET /paas/cluster/ha/status.
func (m *PaasManager) handleHAStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		meshStatus := m.meshMgr.Status(ctx)
		hostname, _ := os.Hostname()
		if envHost := strings.TrimSpace(os.Getenv("MW_MESH_HOSTNAME")); envHost != "" {
			hostname = envHost
		}

		role := strings.ToLower(strings.TrimSpace(os.Getenv("MW_PAAS_HA_ROLE")))
		if role == "" {
			role = "unknown"
		}

		resp := HAStatusResponse{
			Mesh:      meshStatus,
			PeerCount: len(meshStatus.Peers),
		}
		resp.LocalNode.Hostname = hostname
		resp.LocalNode.IPv4 = meshStatus.IPv4
		resp.LocalNode.Role = role

		// Redact mesh secret in the response
		if resp.Mesh.SecretConfigured {
			resp.Mesh.NetworkSecret = redactedPlaceholder
		}

		writePaasJSON(w, http.StatusOK, resp)
	}
}
