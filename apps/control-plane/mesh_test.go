package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMeshRegistryHasEasytierManifest(t *testing.T) {
	meta, ok := registry["easytier"]
	if !ok {
		t.Fatal("expected easytier entry in registry")
	}
	if meta.Image != "easytier/easytier:latest" {
		t.Fatalf("expected image easytier/easytier:latest, got %q", meta.Image)
	}
	if meta.Restart != "unless-stopped" {
		t.Fatalf("expected restart unless-stopped, got %q", meta.Restart)
	}
}

func TestMeshConfigDisabledByDefault(t *testing.T) {
	t.Setenv("MW_MESH_ENABLED", "")
	t.Setenv("MW_MESH_NETWORK_NAME", "")
	t.Setenv("MW_MESH_NETWORK_SECRET", "")

	cfg, err := LoadMeshConfigFromEnv()
	if err != nil {
		t.Fatalf("expected no error when mesh disabled, got: %v", err)
	}
	if cfg.Enabled {
		t.Fatal("expected mesh to be disabled")
	}
}

func TestMeshConfigFailClosedValidation(t *testing.T) {
	cases := []struct {
		name   string
		envMap map[string]string
	}{
		{
			name: "missing network name",
			envMap: map[string]string{
				"MW_MESH_ENABLED":        "true",
				"MW_MESH_NETWORK_NAME":   "",
				"MW_MESH_NETWORK_SECRET": "super-secret-mesh-key",
			},
		},
		{
			name: "missing network secret",
			envMap: map[string]string{
				"MW_MESH_ENABLED":        "true",
				"MW_MESH_NETWORK_NAME":   "mw-prod-mesh",
				"MW_MESH_NETWORK_SECRET": "",
			},
		},
		{
			name: "invalid ipv4",
			envMap: map[string]string{
				"MW_MESH_ENABLED":        "1",
				"MW_MESH_NETWORK_NAME":   "mw-prod-mesh",
				"MW_MESH_NETWORK_SECRET": "super-secret-mesh-key",
				"MW_MESH_IPV4":           "not-an-ip",
			},
		},
		{
			name: "flag injection in peer",
			envMap: map[string]string{
				"MW_MESH_ENABLED":        "true",
				"MW_MESH_NETWORK_NAME":   "mw-prod-mesh",
				"MW_MESH_NETWORK_SECRET": "super-secret-mesh-key",
				"MW_MESH_PEERS":          "--privileged,tcp://1.2.3.4:11010",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("MW_MESH_ENABLED", tc.envMap["MW_MESH_ENABLED"])
			t.Setenv("MW_MESH_NETWORK_NAME", tc.envMap["MW_MESH_NETWORK_NAME"])
			t.Setenv("MW_MESH_NETWORK_SECRET", tc.envMap["MW_MESH_NETWORK_SECRET"])
			t.Setenv("MW_MESH_PEERS", tc.envMap["MW_MESH_PEERS"])
			t.Setenv("MW_MESH_HOSTNAME", tc.envMap["MW_MESH_HOSTNAME"])
			t.Setenv("MW_MESH_IPV4", tc.envMap["MW_MESH_IPV4"])

			if _, err := LoadMeshConfigFromEnv(); err == nil {
				t.Fatalf("expected fail-closed validation error for %s", tc.name)
			}
		})
	}
}

func TestEasytierContainerMetaAndSecretRedaction(t *testing.T) {
	const rawSecret = "ultra-secret-easytier-passphrase-999"
	t.Setenv("MW_MESH_ENABLED", "true")
	t.Setenv("MW_MESH_NETWORK_NAME", "moonwitness-fleet")
	t.Setenv("MW_MESH_NETWORK_SECRET", rawSecret)
	t.Setenv("MW_MESH_PEERS", "tcp://public.easytier.top:11010, udp://peer2.internal:11010")
	t.Setenv("MW_MESH_HOSTNAME", "vps-sg-01")
	t.Setenv("MW_MESH_IPV4", "10.144.144.10")

	cfg, err := LoadMeshConfigFromEnv()
	if err != nil {
		t.Fatalf("LoadMeshConfigFromEnv: %v", err)
	}
	meta := EasytierContainerMeta(cfg)
	if meta.Image != "easytier/easytier:latest" {
		t.Fatalf("unexpected image: %q", meta.Image)
	}
	joined := strings.Join(meta.Command, " ")
	for _, want := range []string{
		"--network-name moonwitness-fleet",
		"--network-secret " + rawSecret,
		"--hostname vps-sg-01",
		"--ipv4 10.144.144.10",
		"--peers tcp://public.easytier.top:11010",
		"--peers udp://peer2.internal:11010",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("expected %q in easytier command %q", want, joined)
		}
	}

	// Config JSON serialization must never leak raw secret.
	cfgBytes, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal cfg: %v", err)
	}
	if strings.Contains(string(cfgBytes), rawSecret) {
		t.Fatalf("MeshConfig JSON leaked raw secret: %s", string(cfgBytes))
	}

	// RedactedSummary must never leak raw secret.
	mgr := NewMeshManagerFromEnv("nonexistent-docker-bin")
	summary := mgr.RedactedSummary()
	if strings.Contains(summary, rawSecret) {
		t.Fatalf("RedactedSummary leaked raw secret: %s", summary)
	}
	if !strings.Contains(summary, redactedPlaceholder) {
		t.Fatalf("expected redacted placeholder in summary: %s", summary)
	}

	// RedactMeshSecret must scrub raw secret, flag values, and env values.
	leaked := "failed: easytier --network-secret " + rawSecret + " MW_MESH_NETWORK_SECRET=other-secret"
	redacted := RedactMeshSecret(leaked, rawSecret)
	if strings.Contains(redacted, rawSecret) || strings.Contains(redacted, "other-secret") {
		t.Fatalf("RedactMeshSecret failed to scrub secrets: %s", redacted)
	}
}

func TestMeshStatusEndpointAuthAndRedaction(t *testing.T) {
	const rawSecret = "do-not-leak-this-mesh-secret-42"
	t.Setenv("MW_MESH_ENABLED", "true")
	t.Setenv("MW_MESH_NETWORK_NAME", "moonwitness-mesh")
	t.Setenv("MW_MESH_NETWORK_SECRET", rawSecret)
	t.Setenv("MW_MESH_HOSTNAME", "vps-eu-01")
	t.Setenv("MW_MESH_IPV4", "10.144.144.2")
	t.Setenv("MW_MESH_PEERS", "tcp://peer1:11010")

	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	// Unauthenticated must fail closed with 401.
	unauthReq := httptest.NewRequest(http.MethodGet, "/mesh/status", nil)
	unauthRec := httptest.NewRecorder()
	handler.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without auth, got %d", unauthRec.Code)
	}

	// Authenticated GET /mesh/status returns 200 with redacted secret.
	req := httptest.NewRequest(http.MethodGet, "/mesh/status", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	bodyStr := rec.Body.String()
	if strings.Contains(bodyStr, rawSecret) {
		t.Fatalf("GET /mesh/status leaked raw secret: %s", bodyStr)
	}

	var status MeshStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode MeshStatus: %v", err)
	}
	if !status.Enabled {
		t.Fatal("expected enabled=true")
	}
	if status.Backend != "easytier" {
		t.Fatalf("expected backend=easytier, got %q", status.Backend)
	}
	if !status.SecretConfigured || status.NetworkSecret != redactedPlaceholder {
		t.Fatalf("expected secret_configured=true and network_secret=%s, got %+v", redactedPlaceholder, status)
	}
	if status.NetworkName != "moonwitness-mesh" || status.IPv4 != "10.144.144.2" {
		t.Fatalf("unexpected mesh status metadata: %+v", status)
	}

	// Non-GET must return 405.
	postReq := httptest.NewRequest(http.MethodPost, "/mesh/status", nil)
	postReq.Header.Set("Authorization", "Bearer "+token)
	postRec := httptest.NewRecorder()
	handler.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for POST /mesh/status, got %d", postRec.Code)
	}
}

func TestMeshStatusMisconfiguredFailClosed(t *testing.T) {
	t.Setenv("MW_MESH_ENABLED", "true")
	t.Setenv("MW_MESH_NETWORK_NAME", "moonwitness-mesh")
	t.Setenv("MW_MESH_NETWORK_SECRET", "")

	mgr := NewMeshManagerFromEnv("docker")
	st := mgr.Status(context.Background())
	if st.Status != "misconfigured" {
		t.Fatalf("expected status=misconfigured, got %q", st.Status)
	}
	if st.Error == "" {
		t.Fatal("expected non-empty error for misconfigured mesh")
	}
}
