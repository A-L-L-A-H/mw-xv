package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

// AgentCaddyReconcileRequest describes the declarative Caddy configuration
// pushed by the PostgreSQL-backed API service to the stateless control-plane agent.
type AgentCaddyReconcileRequest struct {
	PublicPort        int                    `json:"publicPort"`
	PublicPortEnabled bool                   `json:"publicPortEnabled"`
	BootstrapUpstream string                 `json:"bootstrapUpstream,omitempty"`
	PreviewListeners  []CaddyPreviewListener `json:"previewListeners,omitempty"`
	Routes            []CaddyRoute           `json:"routes,omitempty"`
}

// AgentMetricsResponse extends PaasNodeMetrics with stateless-agent metadata.
type AgentMetricsResponse struct {
	PaasNodeMetrics
	PublicIPv4 string `json:"publicIpv4,omitempty"`
	Stateless  bool   `json:"stateless"`
}

func countNonEmptyLines(out string) int {
	count := 0
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}

func (m *PaasManager) handleAgentCaddyReconcile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if m == nil || m.caddyMgr == nil {
			writePaasJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "caddy manager is not configured"})
			return
		}

		var req AgentCaddyReconcileRequest
		dec := json.NewDecoder(io.LimitReader(r.Body, 512*1024))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request JSON: " + err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()

		bootstrap := CaddyBootstrapListener{
			Enabled:  req.PublicPortEnabled,
			Port:     req.PublicPort,
			Upstream: strings.TrimSpace(req.BootstrapUpstream),
		}

		content, err := m.caddyMgr.ReconcileDeclarative(ctx, bootstrap, req.PreviewListeners, req.Routes)
		if err != nil {
			if content != "" || strings.Contains(err.Error(), "caddy reload failed") || strings.Contains(err.Error(), "caddyfile") {
				writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		effectivePort := req.PublicPort
		if req.PublicPortEnabled && effectivePort == 0 {
			effectivePort = 8000
		}

		writePaasJSON(w, http.StatusOK, map[string]any{
			"ok":                true,
			"publicPort":        effectivePort,
			"publicPortEnabled": req.PublicPortEnabled,
			"previewCount":      len(req.PreviewListeners),
			"routeCount":        len(req.Routes),
		})
	}
}

func (m *PaasManager) handleAgentMetrics() http.HandlerFunc {
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

		runningApps := 0
		if out, err := m.runner(ctx, m.dockerBin, "ps", "--filter", "label=mw.paas.managed=true", "--filter", "status=running", "-q"); err == nil {
			runningApps = countNonEmptyLines(out)
		}

		totalApps := 0
		if out, err := m.runner(ctx, m.dockerBin, "ps", "-a", "--filter", "label=mw.paas.managed=true", "-q"); err == nil {
			totalApps = countNonEmptyLines(out)
		}

		cpuCores := runtime.NumCPU()
		cpuPct, memUsedMB, memTotalMB, memPct := readHostResourceMetrics(cpuCores)

		var meshStatus MeshStatus
		if m.meshMgr != nil {
			meshStatus = m.meshMgr.Status(ctx)
		}

		nodeID, _ := os.Hostname()
		if envHost := strings.TrimSpace(os.Getenv("MW_MESH_HOSTNAME")); envHost != "" {
			nodeID = envHost
		}

		resp := AgentMetricsResponse{
			PaasNodeMetrics: PaasNodeMetrics{
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
			},
			PublicIPv4: strings.TrimSpace(os.Getenv("MW_PUBLIC_IPV4")),
			Stateless:  true,
		}
		writePaasJSON(w, http.StatusOK, resp)
	}
}

// AgentContainerInfo describes a live container discovered via docker ps without DB access.
type AgentContainerInfo struct {
	Name        string            `json:"name"`
	ContainerID string            `json:"containerId"`
	Image       string            `json:"image"`
	State       string            `json:"state"`
	Status      string            `json:"status"`
	Slug        string            `json:"slug,omitempty"`
	Service     string            `json:"service,omitempty"`
	TenantID    string            `json:"tenantId,omitempty"`
	Managed     bool              `json:"managed"`
	Labels      map[string]string `json:"labels,omitempty"`
}

func parseDockerLabels(raw string) map[string]string {
	labels := make(map[string]string)
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) != 2 {
			continue
		}
		k := strings.TrimSpace(parts[0])
		if k != "" {
			labels[k] = strings.TrimSpace(parts[1])
		}
	}
	return labels
}

func (m *PaasManager) handleAgentContainers() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		out, err := m.runner(ctx, m.dockerBin, "ps", "-a", "--format", "{{.Names}}\t{{.ID}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Labels}}")
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		containers := parseDockerPsOutput(out)

		writePaasJSON(w, http.StatusOK, map[string]any{
			"containers": containers,
		})
	}
}

func parseDockerPsOutput(out string) []AgentContainerInfo {
	containers := make([]AgentContainerInfo, 0)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 6)
		if len(parts) < 4 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		cid := strings.TrimSpace(parts[1])
		image := strings.TrimSpace(parts[2])
		state := strings.TrimSpace(parts[3])
		status := ""
		if len(parts) >= 5 {
			status = strings.TrimSpace(parts[4])
		}
		var rawLabels string
		if len(parts) >= 6 {
			rawLabels = parts[5]
		}
		labels := parseDockerLabels(rawLabels)
		containers = append(containers, AgentContainerInfo{
			Name:        name,
			ContainerID: cid,
			Image:       image,
			State:       state,
			Status:      status,
			Slug:        labels["mw.paas.app"],
			Service:     labels["mw.paas.service"],
			TenantID:    labels["mw.paas.tenant"],
			Managed:     strings.EqualFold(labels["mw.paas.managed"], "true"),
			Labels:      labels,
		})
	}
	return containers
}

func (m *PaasManager) handleAgentContainerRun() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		var req PaasDeployRequest
		dec := json.NewDecoder(io.LimitReader(r.Body, 512*1024))
		if err := dec.Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request JSON: " + err.Error()})
			return
		}

		req = normalizeDeployRequest(req, "")
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

		writePaasJSON(w, http.StatusCreated, map[string]any{
			"ok":            true,
			"slug":          req.Slug,
			"containerName": containerName,
			"containerId":   containerID,
			"status":        "running",
		})
	}
}

func (m *PaasManager) stackComposeFileIfExists(slug string) (stackDir string, composeFile string, isCompose bool) {
	stackDir = m.composeStackDir(slug)
	composeFile = filepath.Join(stackDir, "docker-compose.yml")
	if info, err := os.Stat(composeFile); err == nil && !info.IsDir() {
		return stackDir, composeFile, true
	}
	return stackDir, composeFile, false
}

func collectStackEnvFileSecrets(stackDir string) []string {
	data, err := os.ReadFile(filepath.Join(stackDir, ".env"))
	if err != nil {
		return nil
	}
	var secrets []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		if isSensitiveEnvKey(strings.TrimSpace(parts[0])) {
			val := strings.TrimSpace(parts[1])
			if val != "" {
				secrets = append(secrets, val)
			}
		}
	}
	return secrets
}

func parseTailQueryParam(r *http.Request) (int, error) {
	tail := paasDefaultLogLines
	if raw := strings.TrimSpace(r.URL.Query().Get("tail")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return 0, errors.New("tail must be a positive integer (max 500)")
		}
		if n > paasMaxLogLines {
			n = paasMaxLogLines
		}
		tail = n
	}
	return tail, nil
}

func (m *PaasManager) handleAgentContainerSubroutes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub := strings.TrimPrefix(r.URL.Path, "/agent/containers/")
		if sub == "" {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "missing container slug"})
			return
		}
		parts := strings.Split(sub, "/")
		slug := parts[0]
		if err := ValidatePaasSlug(slug); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		// GET /agent/containers/{slug}/logs/stream
		if len(parts) == 3 && parts[1] == "logs" && parts[2] == "stream" {
			if r.Method != http.MethodGet {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAgentContainerLogsStream(w, r, slug)
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
			m.handleAgentContainerLogs(w, r, slug)
		case "stats":
			if r.Method != http.MethodGet {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			m.handleAgentContainerStats(w, r, slug)
		case "start", "stop", "restart", "delete":
			if r.Method != http.MethodPost {
				writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			// Privileged mutations MUST check canonical m.adminToken (reject raw MW_INTERNAL_SECRET).
			presented := paasCredentialFromRequest(r)
			if m.adminToken == "" || !constantTimeEquals(presented, m.adminToken) {
				writePaasJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			m.handleAgentContainerAction(w, r, slug, action)
		default:
			writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "unsupported action"})
		}
	}
}

func (m *PaasManager) handleAgentContainerLogs(w http.ResponseWriter, r *http.Request, slug string) {
	tail, err := parseTailQueryParam(r)
	if err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	stackDir, composeFile, isCompose := m.stackComposeFileIfExists(slug)
	secrets := collectStackEnvFileSecrets(stackDir)

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var args []string
	if isCompose {
		args = []string{"compose", "-p", PaasContainerName(slug), "-f", composeFile, "logs", "--timestamps", "--tail", strconv.Itoa(tail)}
	} else {
		args = []string{"logs", "--timestamps", "--tail", strconv.Itoa(tail), PaasContainerName(slug)}
	}

	out, err := m.runner(ctx, m.dockerBin, args...)
	if err != nil {
		writePaasJSON(w, http.StatusBadGateway, map[string]string{
			"error": RedactPaasText(err.Error(), secrets...),
		})
		return
	}

	writePaasJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"slug": slug,
		"tail": tail,
		"logs": RedactPaasText(out, secrets...),
	})
}

func (m *PaasManager) handleAgentContainerLogsStream(w http.ResponseWriter, r *http.Request, slug string) {
	tail, err := parseTailQueryParam(r)
	if err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
		return
	}

	stackDir, composeFile, isCompose := m.stackComposeFileIfExists(slug)
	secrets := collectStackEnvFileSecrets(stackDir)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	runner := m.streamRunner
	if runner == nil {
		runner = runCmdStreamLines
	}

	var args []string
	if isCompose {
		args = []string{"compose", "-p", PaasContainerName(slug), "-f", composeFile, "logs", "--follow", "--timestamps", "--tail", strconv.Itoa(tail)}
	} else {
		args = []string{"logs", "--follow", "--timestamps", "--tail", strconv.Itoa(tail), PaasContainerName(slug)}
	}

	streamErr := runner(r.Context(), func(line string) bool {
		redacted := RedactPaasText(line, secrets...)
		if _, writeErr := fmt.Fprintf(w, "data: %s\n\n", redacted); writeErr != nil {
			return false
		}
		flusher.Flush()
		return true
	}, m.dockerBin, args...)

	if streamErr != nil && r.Context().Err() == nil {
		redactedErr := RedactPaasText(streamErr.Error(), secrets...)
		_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", redactedErr)
		flusher.Flush()
	}
}

func (m *PaasManager) handleAgentContainerStats(w http.ResponseWriter, r *http.Request, slug string) {
	containerName := PaasContainerName(slug)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	out, err := m.runner(ctx, m.dockerBin, "stats", "--no-stream", "--format", "json", containerName)
	if err != nil {
		writePaasJSON(w, http.StatusBadGateway, map[string]string{
			"error": RedactPaasText(err.Error()),
		})
		return
	}

	stats, err := parseDockerStatsJSON(slug, containerName, out)
	if err != nil {
		writePaasJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writePaasJSON(w, http.StatusOK, stats)
}

func (m *PaasManager) handleAgentContainerAction(w http.ResponseWriter, r *http.Request, slug, action string) {
	stackDir, composeFile, isCompose := m.stackComposeFileIfExists(slug)
	secrets := collectStackEnvFileSecrets(stackDir)
	containerName := PaasContainerName(slug)

	pruneVolumes := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("pruneVolumes")), "true")
	if !pruneVolumes && r.Body != nil {
		var body struct {
			PruneVolumes bool `json:"pruneVolumes"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 16*1024)).Decode(&body); err == nil && body.PruneVolumes {
			pruneVolumes = true
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	var args []string
	var nextStatus string
	if isCompose {
		switch action {
		case "start":
			args = []string{"compose", "-p", containerName, "-f", composeFile, "up", "-d"}
			nextStatus = "running"
		case "stop":
			args = []string{"compose", "-p", containerName, "-f", composeFile, "stop"}
			nextStatus = "stopped"
		case "restart":
			args = []string{"compose", "-p", containerName, "-f", composeFile, "restart"}
			nextStatus = "running"
		case "delete":
			args = []string{"compose", "-p", containerName, "-f", composeFile, "down", "--remove-orphans"}
			if pruneVolumes {
				args = append(args, "--volumes")
			}
			nextStatus = "deleted"
		}
	} else {
		switch action {
		case "start":
			args = []string{"start", containerName}
			nextStatus = "running"
		case "stop":
			args = []string{"stop", containerName}
			nextStatus = "stopped"
		case "restart":
			args = []string{"restart", containerName}
			nextStatus = "running"
		case "delete":
			args = []string{"rm", "-f", containerName}
			nextStatus = "deleted"
		}
	}

	if _, err := m.runner(ctx, m.dockerBin, args...); err != nil {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{
			"error": RedactPaasText(err.Error(), secrets...),
		})
		return
	}

	if isCompose && action == "delete" {
		_ = os.RemoveAll(stackDir)
	}

	writePaasJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"slug":   slug,
		"action": action,
		"status": nextStatus,
	})
}

const (
	maxInlineComposeFiles     = 20
	maxInlineComposeFileBytes = 256 * 1024
)

var (
	composeSourceFieldPattern      = regexp.MustCompile(`(?i)^\s*source\s*:\s*(.+?)\s*$`)
	composeShortVolumeEntryPattern = regexp.MustCompile(`^\s*-\s*["']?([^"'\s:#]+):([^"'\s#]+)(?::[^"'\s#]+)?["']?\s*$`)
)

// AgentComposeUpRequest is the payload for POST /agent/compose/up.
type AgentComposeUpRequest struct {
	Slug        string            `json:"slug"`
	ComposeSpec string            `json:"composeSpec"`
	Env         map[string]string `json:"env,omitempty"`
	Files       map[string]string `json:"files,omitempty"`
}

func validateAndNormalizeInlineFiles(stackDir string, files map[string]string) (map[string]string, map[string]bool, error) {
	if len(files) > maxInlineComposeFiles {
		return nil, nil, fmt.Errorf("too many inline files (max %d)", maxInlineComposeFiles)
	}
	normalized := make(map[string]string, len(files))
	allowed := make(map[string]bool, len(files))

	for rawPath, content := range files {
		if len(content) > maxInlineComposeFileBytes {
			return nil, nil, fmt.Errorf("inline file %q exceeds %d bytes", rawPath, maxInlineComposeFileBytes)
		}
		if strings.ContainsRune(content, 0) {
			return nil, nil, fmt.Errorf("inline file %q must not contain NUL bytes", rawPath)
		}
		for _, r := range rawPath {
			if r < 0x20 || r == 0x7f {
				return nil, nil, fmt.Errorf("inline file path contains control characters: %q", rawPath)
			}
		}
		if strings.Contains(rawPath, `\`) {
			return nil, nil, fmt.Errorf("inline file path must use forward slashes only: %q", rawPath)
		}
		trimmed := strings.TrimPrefix(rawPath, "./")
		if trimmed == "" || strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "~") || strings.Contains(trimmed, "..") {
			return nil, nil, fmt.Errorf("inline file path must be relative within stack directory: %q", rawPath)
		}
		if len(trimmed) >= 2 && trimmed[1] == ':' {
			return nil, nil, fmt.Errorf("inline file path must not contain a drive letter: %q", rawPath)
		}
		cleaned := path.Clean(trimmed)
		if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || strings.HasPrefix(cleaned, "/") {
			return nil, nil, fmt.Errorf("inline file path escapes stack directory: %q", rawPath)
		}
		lowerBase := strings.ToLower(cleaned)
		if lowerBase == "docker-compose.yml" || lowerBase == "docker-compose.yaml" || lowerBase == ".env" {
			return nil, nil, fmt.Errorf("inline file path cannot overwrite %q", cleaned)
		}

		target := filepath.Join(stackDir, filepath.FromSlash(cleaned))
		rel, err := filepath.Rel(stackDir, target)
		if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
			return nil, nil, fmt.Errorf("inline file path escapes stack directory: %q", rawPath)
		}
		if _, dup := normalized[cleaned]; dup {
			return nil, nil, fmt.Errorf("duplicate inline file path %q", cleaned)
		}
		normalized[cleaned] = content
		allowed[cleaned] = true
	}

	return normalized, allowed, nil
}

func stripYAMLQuotes(raw string) string {
	s := strings.TrimSpace(raw)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

func isAllowedRelativeInlinePath(rawSource string, allowedRelPaths map[string]bool) bool {
	s := stripYAMLQuotes(rawSource)
	if s == "" || strings.Contains(s, `\`) || strings.Contains(s, "..") || strings.HasPrefix(s, "/") || strings.HasPrefix(s, "~") {
		return false
	}
	if len(s) >= 2 && s[1] == ':' {
		return false
	}
	if !strings.HasPrefix(s, "./") {
		return false
	}
	cleaned := path.Clean(strings.TrimPrefix(s, "./"))
	return allowedRelPaths[cleaned]
}

// ValidateComposeSpecWithAllowedFiles enforces all fail-closed Compose security
// policies while permitting relative bind mounts ONLY when their path matches
// an inline file materialized inside the stack directory.
func ValidateComposeSpecWithAllowedFiles(spec string, allowedRelPaths map[string]bool) error {
	if strings.TrimSpace(spec) == "" {
		return errors.New("composeSpec is required")
	}
	if len(spec) > maxComposeSpecBytes {
		return fmt.Errorf("composeSpec exceeds %d bytes", maxComposeSpecBytes)
	}
	if strings.ContainsRune(spec, 0) {
		return errors.New("composeSpec must not contain NUL bytes")
	}

	sawBindType := false
	sawAllowedBindSource := false

	for _, rawLine := range strings.Split(spec, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if idx := strings.Index(line, " #"); idx >= 0 {
			line = line[:idx]
			trimmed = strings.TrimSpace(line)
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
		if composeDangerousCapRegexp.MatchString(line) {
			return errors.New("composeSpec must not request dangerous Linux capabilities")
		}
		if strings.Contains(trimmed, "..") && (strings.Contains(trimmed, ":") || strings.Contains(trimmed, "source")) {
			return errors.New("composeSpec volume path must not contain traversal")
		}

		if composeBindTypePattern.MatchString(line) {
			if len(allowedRelPaths) == 0 {
				return errors.New("composeSpec must not use host bind mounts")
			}
			sawBindType = true
			continue
		}

		if m := composeSourceFieldPattern.FindStringSubmatch(line); len(m) == 2 {
			if composeBindSourcePattern.MatchString(line) || !isAllowedRelativeInlinePath(m[1], allowedRelPaths) {
				return errors.New("composeSpec must not use host bind mounts")
			}
			sawAllowedBindSource = true
			continue
		}

		if m := composeShortVolumeEntryPattern.FindStringSubmatch(line); len(m) == 3 {
			src := m[1]
			if strings.HasPrefix(src, "./") {
				if !isAllowedRelativeInlinePath(src, allowedRelPaths) {
					return errors.New("composeSpec bind mount target is not in allowed inline files")
				}
				continue
			}
			if composeVolumeBindPattern.MatchString(line) || strings.HasPrefix(src, "/") || strings.HasPrefix(src, "~") || strings.Contains(src, "..") || strings.Contains(src, `\`) {
				return errors.New("composeSpec must not use host bind mounts")
			}
			continue
		}

		if composeBindSourcePattern.MatchString(line) || composeVolumeBindPattern.MatchString(line) {
			return errors.New("composeSpec must not use host bind mounts")
		}
	}

	if sawBindType && !sawAllowedBindSource {
		return errors.New("composeSpec bind mount requires an allowed inline source file")
	}
	return nil
}

func (m *PaasManager) handleAgentComposeUp() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		var req AgentComposeUpRequest
		dec := json.NewDecoder(io.LimitReader(r.Body, 4*1024*1024))
		if err := dec.Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request JSON: " + err.Error()})
			return
		}

		if err := ValidatePaasSlug(req.Slug); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		for k, v := range req.Env {
			if !paasEnvKeyPattern.MatchString(k) {
				writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid env key: %q", k)})
				return
			}
			if strings.ContainsRune(v, 0) {
				writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("env value for %q must not contain NUL bytes", k)})
				return
			}
		}

		stackDir := m.composeStackDir(req.Slug)
		normalizedFiles, allowedRelPaths, err := validateAndNormalizeInlineFiles(stackDir, req.Files)
		if err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := ValidateComposeSpecWithAllowedFiles(req.ComposeSpec, allowedRelPaths); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		if err := os.MkdirAll(stackDir, 0o750); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("create stack dir: %v", err)})
			return
		}

		// Write inline config files atomically (0644) in sorted path order.
		filePaths := make([]string, 0, len(normalizedFiles))
		for relPath := range normalizedFiles {
			filePaths = append(filePaths, relPath)
		}
		sort.Strings(filePaths)
		for _, relPath := range filePaths {
			target := filepath.Join(stackDir, filepath.FromSlash(relPath))
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("create inline file dir: %v", err)})
				return
			}
			if err := writeFileAtomic(target, []byte(normalizedFiles[relPath]), 0o644); err != nil {
				writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("write inline file %s: %v", relPath, err)})
				return
			}
		}

		composeFile := filepath.Join(stackDir, "docker-compose.yml")
		if err := writeFileAtomic(composeFile, []byte(req.ComposeSpec), 0o600); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("write compose file: %v", err)})
			return
		}

		envPath := filepath.Join(stackDir, ".env")
		if len(req.Env) > 0 {
			envKeys := make([]string, 0, len(req.Env))
			for k := range req.Env {
				envKeys = append(envKeys, k)
			}
			sort.Strings(envKeys)
			var envBuf strings.Builder
			for _, k := range envKeys {
				val := strings.NewReplacer("\r", "", "\n", "").Replace(req.Env[k])
				envBuf.WriteString(k)
				envBuf.WriteByte('=')
				envBuf.WriteString(val)
				envBuf.WriteByte('\n')
			}
			if err := writeFileAtomic(envPath, []byte(envBuf.String()), 0o600); err != nil {
				writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("write compose env file: %v", err)})
				return
			}
		} else {
			_ = os.Remove(envPath)
		}

		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()

		project := PaasContainerName(req.Slug)
		if _, err := m.runner(ctx, m.dockerBin, "compose", "-p", project, "-f", composeFile, "up", "-d", "--remove-orphans"); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(req.Env)...),
			})
			return
		}

		containers := make([]AgentContainerInfo, 0)
		if out, psErr := m.runner(ctx, m.dockerBin, "ps", "-a", "--filter", "label=com.docker.compose.project="+project, "--format", "{{.Names}}\t{{.ID}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Labels}}"); psErr == nil {
			containers = parseDockerPsOutput(out)
		}

		writePaasJSON(w, http.StatusCreated, map[string]any{
			"ok":         true,
			"slug":       req.Slug,
			"containers": containers,
		})
	}
}
