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
