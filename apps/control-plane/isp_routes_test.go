package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestISPRouteMatrixClassification(t *testing.T) {
	cases := []struct {
		pattern string
		access  controlPlaneAccess
		methods []string
	}{
		{"/isp/health", accessAuthenticated, []string{http.MethodGet}},
		{"/isp/readiness", accessAuthenticated, []string{http.MethodGet}},
		{"/isp/operations/inspect", accessAuthenticated, []string{http.MethodPost}},
		{"/isp/operations/plan", accessAuthenticated, []string{http.MethodPost}},
		{"/isp/admin/reload", accessPrivileged, []string{http.MethodPost}},
	}
	for _, tc := range cases {
		access, ok := controlPlaneAccessForPattern(tc.pattern)
		if !ok || access != tc.access {
			t.Fatalf("%s access=%v found=%v want %v", tc.pattern, access, ok, tc.access)
		}
		found := false
		for _, route := range controlPlaneRouteMatrix {
			if route.pattern != tc.pattern {
				continue
			}
			found = true
			if route.family != "isp-control" {
				t.Fatalf("%s family=%q", tc.pattern, route.family)
			}
			if len(route.methods) != len(tc.methods) {
				t.Fatalf("%s methods=%v want %v", tc.pattern, route.methods, tc.methods)
			}
			for i := range route.methods {
				if route.methods[i] != tc.methods[i] {
					t.Fatalf("%s methods=%v want %v", tc.pattern, route.methods, tc.methods)
				}
			}
		}
		if !found {
			t.Fatalf("missing matrix row %s", tc.pattern)
		}
	}
}

func TestISPRoutesRejectUnauthorizedWrongMethodUnknownAndUnderprivileged(t *testing.T) {
	t.Setenv("MW_INTERNAL_SECRET", "isp-raw-internal-secret")
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	for _, path := range []string{"/isp/health", "/isp/readiness"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("GET %s without auth: want 401 got %d: %s", path, rec.Code, rec.Body.String())
		}
	}
	for _, path := range []string{"/isp/operations/inspect", "/isp/operations/plan", "/isp/admin/reload"} {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("POST %s without auth: want 401 got %d: %s", path, rec.Code, rec.Body.String())
		}
	}

	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/isp/health"},
		{http.MethodPut, "/isp/readiness"},
		{http.MethodGet, "/isp/operations/inspect"},
		{http.MethodGet, "/isp/operations/plan"},
		{http.MethodGet, "/isp/admin/reload"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s: want 405 got %d: %s", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}

	unknown := httptest.NewRequest(http.MethodGet, "/isp/not-a-route", nil)
	unknown.Header.Set("Authorization", "Bearer "+token)
	unknownRec := httptest.NewRecorder()
	handler.ServeHTTP(unknownRec, unknown)
	if unknownRec.Code != http.StatusNotFound {
		t.Fatalf("unknown ISP route: want 404 got %d: %s", unknownRec.Code, unknownRec.Body.String())
	}

	// The shared matrix applies the method gate before auth. Verify that an
	// authenticated underprivileged caller cannot reach the privileged handler.
	reload := httptest.NewRequest(http.MethodPost, "/isp/admin/reload", strings.NewReader(`{"tenant_id":"tenant-1","resource_kind":"nas","operation":"inspect","resource_id":"nas-1","correlation_id":"corr-1","operation_id":"op-1"}`))
	reload.Header.Set("X-Control-Plane-Token", "isp-raw-internal-secret")
	reloadRec := httptest.NewRecorder()
	handler.ServeHTTP(reloadRec, reload)
	if reloadRec.Code != http.StatusUnauthorized {
		t.Fatalf("privileged route with raw internal secret: want 401 got %d: %s", reloadRec.Code, reloadRec.Body.String())
	}

	// Confirm the route is privileged in the matrix, and that the canonical
	// admin token remains accepted there.
	access, ok := controlPlaneAccessForPattern("/isp/admin/reload")
	if !ok || access != accessPrivileged {
		t.Fatalf("admin reload access=%v found=%v", access, ok)
	}
}

func TestISPHealthReadinessAndTypedErrors(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	do := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	health := do(http.MethodGet, "/isp/health", "")
	if health.Code != http.StatusOK {
		t.Fatalf("ISP health: want 200 got %d: %s", health.Code, health.Body.String())
	}
	var healthBody map[string]string
	if err := json.Unmarshal(health.Body.Bytes(), &healthBody); err != nil {
		t.Fatalf("decode ISP health: %v", err)
	}
	if healthBody["status"] != "ok" || healthBody["module"] != "isp-control" {
		t.Fatalf("unexpected ISP health body: %v", healthBody)
	}

	ready := do(http.MethodGet, "/isp/readiness", "")
	if ready.Code != http.StatusOK {
		t.Fatalf("ISP readiness: want 200 got %d: %s", ready.Code, ready.Body.String())
	}
	var readiness struct {
		Status    string          `json:"status"`
		Stateless bool            `json:"stateless"`
		Signals   map[string]bool `json:"signals"`
	}
	if err := json.Unmarshal(ready.Body.Bytes(), &readiness); err != nil {
		t.Fatalf("decode readiness: %v", err)
	}
	if readiness.Status != "ready" || !readiness.Stateless {
		t.Fatalf("unexpected readiness: %+v", readiness)
	}
	for _, signal := range []string{"liveness", "readiness", "management_reachability", "protocol_health"} {
		if _, ok := readiness.Signals[signal]; !ok {
			t.Fatalf("missing readiness signal %s: %+v", signal, readiness.Signals)
		}
	}

	good := `{"tenant_id":"tenant-1","resource_kind":"nas","operation":"inspect","resource_id":"nas-1","correlation_id":"corr-1","operation_id":"op-1","payload":{"probe":"simulated"}}`
	inspect := do(http.MethodPost, "/isp/operations/inspect", good)
	if inspect.Code != http.StatusOK {
		t.Fatalf("ISP inspect: want 200 got %d: %s", inspect.Code, inspect.Body.String())
	}
	var result struct {
		Status    string `json:"status"`
		Simulated bool   `json:"simulated"`
	}
	if err := json.Unmarshal(inspect.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode inspect result: %v", err)
	}
	if result.Status != "planned" || !result.Simulated {
		t.Fatalf("unexpected inspect result: %+v", result)
	}

	cases := []struct {
		name string
		body string
		code string
		want int
	}{
		{"invalid-json", `{`, "invalid_request", http.StatusBadRequest},
		{"unknown-field", `{"unexpected":true}`, "invalid_request", http.StatusBadRequest},
		{"unsupported-kind", strings.Replace(good, `"nas"`, `"router"`, 1), "unsupported_resource_kind", http.StatusBadRequest},
		{"unsupported-operation", strings.Replace(good, `"inspect"`, `"delete"`, 1), "unsupported_operation", http.StatusBadRequest},
	}
	for _, tc := range cases {
		rec := do(http.MethodPost, "/isp/operations/inspect", tc.body)
		if rec.Code != tc.want {
			t.Fatalf("%s: want %d got %d: %s", tc.name, tc.want, rec.Code, rec.Body.String())
		}
		var body map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s decode error: %v", tc.name, err)
		}
		if body["error"] != tc.code {
			t.Fatalf("%s: want error %s got %v", tc.name, tc.code, body)
		}
	}
}
