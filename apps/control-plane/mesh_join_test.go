package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleMeshJoinAndLeaveAuth(t *testing.T) {
	mgr := &MeshManager{dockerBin: "docker"}
	token := "mesh-admin-token"
	joinHandler := handleMeshJoin(mgr, token)
	leaveHandler := handleMeshLeave(mgr, token)

	// Unauthenticated join must be rejected.
	req := httptest.NewRequest(http.MethodPost, "/mesh/join", bytes.NewBufferString(`{"network_name":"mw-net","network_secret":"topsecret"}`))
	rec := httptest.NewRecorder()
	joinHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated join: got %d, want 401", rec.Code)
	}

	// Authenticated join succeeds and updates manager state.
	req = httptest.NewRequest(http.MethodPost, "/mesh/join", bytes.NewBufferString(`{"network_name":"mw-net","network_secret":"topsecret","ipv4":"10.144.0.10","peers":["tcp://1.2.3.4:11010"]}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	joinHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated join: got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if !mgr.cfg.Enabled || mgr.cfg.NetworkName != "mw-net" || len(mgr.cfg.Peers) != 1 {
		t.Fatalf("unexpected mesh config after join: %+v", mgr.cfg)
	}

	// Authenticated leave disables mesh and clears peers.
	req = httptest.NewRequest(http.MethodPost, "/mesh/leave", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	leaveHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated leave: got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if mgr.cfg.Enabled || len(mgr.cfg.Peers) != 0 {
		t.Fatalf("expected mesh disabled after leave, got %+v", mgr.cfg)
	}
}
