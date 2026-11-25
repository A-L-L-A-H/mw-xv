package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"runtime"
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

		writePaasJSON(w, http.StatusOK, map[string]any{
			"containers": containers,
		})
	}
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
