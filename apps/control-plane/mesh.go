package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	easytierServiceName = "easytier"
	easytierImage       = "easytier/easytier:latest"
	redactedPlaceholder = "[REDACTED]"
)

var (
	meshSecretFlagPattern = regexp.MustCompile(`(--network-secret(?:=|\s+))([^\s"']+)`)
	meshSecretEnvPattern  = regexp.MustCompile(`(MW_MESH_NETWORK_SECRET=)([^\s"']+)`)
)

// MeshConfig holds EasyTier P2P mesh configuration loaded from environment variables.
type MeshConfig struct {
	Enabled       bool     `json:"enabled"`
	NetworkName   string   `json:"network_name,omitempty"`
	NetworkSecret string   `json:"-"` // Never serialize raw secret
	Peers         []string `json:"peers,omitempty"`
	Hostname      string   `json:"hostname,omitempty"`
	IPv4          string   `json:"ipv4,omitempty"`
}

// MeshStatus is the sanitized, secret-redacted status payload returned by GET /mesh/status.
type MeshStatus struct {
	Enabled          bool     `json:"enabled"`
	Backend          string   `json:"backend"`
	Status           string   `json:"status"`
	NetworkName      string   `json:"network_name,omitempty"`
	SecretConfigured bool     `json:"secret_configured"`
	NetworkSecret    string   `json:"network_secret,omitempty"`
	Hostname         string   `json:"hostname,omitempty"`
	IPv4             string   `json:"ipv4,omitempty"`
	Peers            []string `json:"peers,omitempty"`
	ContainerID      string   `json:"container_id,omitempty"`
	ContainerState   string   `json:"container_state,omitempty"`
	Error            string   `json:"error,omitempty"`
}

// MeshManager manages EasyTier mesh configuration validation, container manifest
// generation, and secret-redacted runtime status inspection.
type MeshManager struct {
	cfg       MeshConfig
	configErr error
	dockerBin string
}

// parseBoolEnv parses common boolean env values.
func parseBoolEnv(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// LoadMeshConfigFromEnv reads MW_MESH_* variables and validates them fail-closed.
func LoadMeshConfigFromEnv() (MeshConfig, error) {
	cfg := MeshConfig{
		Enabled:       parseBoolEnv(os.Getenv("MW_MESH_ENABLED")),
		NetworkName:   strings.TrimSpace(os.Getenv("MW_MESH_NETWORK_NAME")),
		NetworkSecret: strings.TrimSpace(os.Getenv("MW_MESH_NETWORK_SECRET")),
		Hostname:      strings.TrimSpace(os.Getenv("MW_MESH_HOSTNAME")),
		IPv4:          strings.TrimSpace(os.Getenv("MW_MESH_IPV4")),
	}

	rawPeers := strings.TrimSpace(os.Getenv("MW_MESH_PEERS"))
	if rawPeers != "" {
		for _, p := range strings.Split(rawPeers, ",") {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				cfg.Peers = append(cfg.Peers, trimmed)
			}
		}
	}

	if err := cfg.Validate(); err != nil {
		return cfg, err
	}
	return cfg, nil
}

// Validate enforces fail-closed rules when the mesh is enabled.
func (c MeshConfig) Validate() error {
	if !c.Enabled {
		return nil
	}
	if c.NetworkName == "" {
		return errors.New("MW_MESH_NETWORK_NAME is required when MW_MESH_ENABLED is true")
	}
	if c.NetworkSecret == "" {
		return errors.New("MW_MESH_NETWORK_SECRET is required when MW_MESH_ENABLED is true")
	}
	for label, val := range map[string]string{
		"MW_MESH_NETWORK_NAME":   c.NetworkName,
		"MW_MESH_NETWORK_SECRET": c.NetworkSecret,
		"MW_MESH_HOSTNAME":       c.Hostname,
		"MW_MESH_IPV4":           c.IPv4,
	} {
		if val == "" {
			continue
		}
		if strings.HasPrefix(val, "-") {
			return fmt.Errorf("%s must not start with '-'", label)
		}
		if strings.ContainsRune(val, 0) {
			return fmt.Errorf("%s must not contain NUL bytes", label)
		}
	}
	for _, peer := range c.Peers {
		if strings.HasPrefix(peer, "-") {
			return fmt.Errorf("MW_MESH_PEERS entry must not start with '-': %q", peer)
		}
		if strings.ContainsRune(peer, 0) {
			return errors.New("MW_MESH_PEERS entry must not contain NUL bytes")
		}
	}
	if c.IPv4 != "" {
		ip := net.ParseIP(c.IPv4)
		if ip == nil || ip.To4() == nil {
			return fmt.Errorf("MW_MESH_IPV4 must be a valid IPv4 address: %q", c.IPv4)
		}
	}
	return nil
}

// RedactMeshSecret removes any occurrence of the raw network secret and known
// CLI/env secret flags from logs or status error messages.
func RedactMeshSecret(text, secret string) string {
	out := text
	if trimmed := strings.TrimSpace(secret); trimmed != "" {
		out = strings.ReplaceAll(out, trimmed, redactedPlaceholder)
	}
	out = meshSecretFlagPattern.ReplaceAllString(out, "${1}"+redactedPlaceholder)
	out = meshSecretEnvPattern.ReplaceAllString(out, "${1}"+redactedPlaceholder)
	return out
}

// SanitizeLogValue strips control characters (including newline injection)
// and caps the length before a user-influenced value is written to a log.
func SanitizeLogValue(value string) string {
	var b strings.Builder
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(r)
	}
	out := b.String()
	out = strings.ReplaceAll(strings.ReplaceAll(out, "\r", " "), "\n", " ")
	if len(out) > 512 {
		out = out[:512]
	}
	return out
}

// EasytierContainerMeta builds the Docker container manifest for EasyTier
// so any VPS running control-plane can auto-join the encrypted P2P mesh.
func EasytierContainerMeta(cfg MeshConfig) containerMeta {
	cmd := []string{
		"--network-name", cfg.NetworkName,
		"--network-secret", cfg.NetworkSecret,
	}
	if cfg.Hostname != "" {
		cmd = append(cmd, "--hostname", cfg.Hostname)
	}
	if cfg.IPv4 != "" {
		cmd = append(cmd, "--ipv4", cfg.IPv4)
	} else {
		cmd = append(cmd, "-d")
	}
	for _, peer := range cfg.Peers {
		cmd = append(cmd, "--peers", peer)
	}
	return containerMeta{
		Image:   easytierImage,
		Name:    easytierServiceName,
		Command: cmd,
		Restart: "unless-stopped",
	}
}

// NewMeshManagerFromEnv creates a MeshManager from current environment variables.
func NewMeshManagerFromEnv(dockerBin string) *MeshManager {
	cfg, err := LoadMeshConfigFromEnv()
	return &MeshManager{
		cfg:       cfg,
		configErr: err,
		dockerBin: dockerBin,
	}
}

// RedactedSummary returns a safe log line describing the mesh configuration
// with the network secret strictly redacted.
func (m *MeshManager) RedactedSummary() string {
	if !m.cfg.Enabled {
		return "mesh=disabled backend=easytier"
	}
	secretState := "unset"
	if m.cfg.NetworkSecret != "" {
		secretState = redactedPlaceholder
	}
	return fmt.Sprintf(
		"mesh=enabled backend=easytier network=%s secret=%s hostname=%s ipv4=%s peers=%d",
		m.cfg.NetworkName,
		secretState,
		m.cfg.Hostname,
		m.cfg.IPv4,
		len(m.cfg.Peers),
	)
}

// Status returns the current EasyTier mesh status with strict secret redaction.
func (m *MeshManager) Status(ctx context.Context) MeshStatus {
	st := MeshStatus{
		Enabled:          m.cfg.Enabled,
		Backend:          easytierServiceName,
		NetworkName:      m.cfg.NetworkName,
		SecretConfigured: m.cfg.NetworkSecret != "",
		Hostname:         m.cfg.Hostname,
		IPv4:             m.cfg.IPv4,
		Peers:            m.cfg.Peers,
	}
	if st.SecretConfigured {
		st.NetworkSecret = redactedPlaceholder
	}

	if !m.cfg.Enabled {
		st.Status = "disabled"
		return st
	}
	if m.configErr != nil {
		st.Status = "misconfigured"
		st.Error = RedactMeshSecret(m.configErr.Error(), m.cfg.NetworkSecret)
		return st
	}

	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	out, err := runCmdOutput(
		queryCtx,
		m.dockerBin,
		"ps", "--all",
		"--filter", "name="+easytierServiceName,
		"--format", "{{.Names}}\t{{.ID}}\t{{.State}}\t{{.Status}}",
	)
	if err != nil {
		st.Status = "degraded"
		st.Error = RedactMeshSecret(err.Error(), m.cfg.NetworkSecret)
		return st
	}

	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 4 {
			continue
		}
		name := strings.TrimPrefix(parts[0], "/")
		if name == easytierServiceName {
			id := parts[1]
			if len(id) > 12 {
				id = id[:12]
			}
			st.ContainerID = id
			st.ContainerState = parts[2]
			if strings.EqualFold(parts[2], "running") || strings.Contains(parts[3], "Up") {
				st.Status = "running"
			} else {
				st.Status = "stopped"
			}
			return st
		}
	}

	st.Status = "stopped"
	return st
}

// handleMeshStatus serves GET /mesh/status.
func handleMeshStatus(mgr *MeshManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		status := mgr.Status(r.Context())
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(status)
	}
}

// MeshJoinRequest configures and joins an EasyTier P2P mesh network.
type MeshJoinRequest struct {
	NetworkName   string   `json:"network_name"`
	NetworkSecret string   `json:"network_secret"`
	Peers         []string `json:"peers,omitempty"`
	Hostname      string   `json:"hostname,omitempty"`
	IPv4          string   `json:"ipv4,omitempty"`
}

// Join validates the mesh configuration and updates the manager state.
func (m *MeshManager) Join(_ context.Context, req MeshJoinRequest) error {
	cfg := MeshConfig{
		Enabled:       true,
		NetworkName:   strings.TrimSpace(req.NetworkName),
		NetworkSecret: strings.TrimSpace(req.NetworkSecret),
		Peers:         req.Peers,
		Hostname:      strings.TrimSpace(req.Hostname),
		IPv4:          strings.TrimSpace(req.IPv4),
	}
	if err := cfg.Validate(); err != nil {
		return err
	}
	m.cfg = cfg
	m.configErr = nil
	return nil
}

// Leave disables the mesh configuration on the manager.
func (m *MeshManager) Leave(_ context.Context) error {
	m.cfg.Enabled = false
	m.cfg.Peers = nil
	return nil
}

// handleMeshJoin serves POST /mesh/join with bearer authentication.
func handleMeshJoin(mgr *MeshManager, adminToken string) http.HandlerFunc {
	return requirePaasAuth(adminToken, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req MeshJoinRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
		if err := mgr.Join(r.Context(), req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writePaasJSON(w, http.StatusOK, map[string]any{
			"joined":       true,
			"network_name": mgr.cfg.NetworkName,
		})
	})
}

// handleMeshLeave serves POST /mesh/leave with bearer authentication.
func handleMeshLeave(mgr *MeshManager, adminToken string) http.HandlerFunc {
	return requirePaasAuth(adminToken, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if err := mgr.Leave(r.Context()); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writePaasJSON(w, http.StatusOK, map[string]any{
			"left":    true,
			"enabled": false,
		})
	})
}
