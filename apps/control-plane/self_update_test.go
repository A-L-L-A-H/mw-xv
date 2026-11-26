package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCompareReleaseSemver(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v1.0.0-rc.1", "v1.0.0-rc.2", -1},
		{"v1.0.0-rc.2", "v1.0.0", -1},
		{"v1.0.0", "v1.0.0-rc.9", 1},
		{"v1.0.0", "v1.0.1", -1},
		{"1.2.0", "v1.2.0", 0},
		{"v2.0.0-rc.1", "v1.9.9", 1},
	}
	for _, tc := range cases {
		pa, _, err := parseReleaseSemver(tc.a)
		if err != nil {
			t.Fatalf("parse(%s): %v", tc.a, err)
		}
		pb, _, err := parseReleaseSemver(tc.b)
		if err != nil {
			t.Fatalf("parse(%s): %v", tc.b, err)
		}
		if got := compareReleaseSemver(pa, pb); got != tc.want {
			t.Fatalf("compare(%s, %s) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
	if _, _, err := parseReleaseSemver("v1.0.0; rm -rf /"); err == nil {
		t.Fatal("expected shell injection version to be rejected")
	}
}

func TestSelfUpdaterDetectsUpdateAndCaches(t *testing.T) {
	hits := 0
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]githubReleaseEntry{
			{TagName: "v1.0.0-rc.1", Prerelease: true, HTMLURL: "https://github.com/A-L-L-A-H/mw-xv/releases/tag/v1.0.0-rc.1"},
			{TagName: "v1.0.0", Prerelease: false, HTMLURL: "https://github.com/A-L-L-A-H/mw-xv/releases/tag/v1.0.0", Body: "First stable release"},
			{TagName: "v1.1.0-rc.1", Draft: true, Prerelease: true},
		})
	}))
	defer gh.Close()

	u := &selfUpdater{
		currentVersion: "v1.0.0-rc.1",
		repo:           "A-L-L-A-H/mw-xv",
		apiBase:        gh.URL,
		channel:        "auto",
		composeFile:    defaultUpdateComposeFile,
		dockerBin:      "docker",
		httpClient:     gh.Client(),
		cacheTTL:       5 * time.Minute,
		status:         "idle",
	}

	first := u.Check(context.Background(), false)
	if !first.UpdateAvailable || first.LatestVersion != "v1.0.0" {
		t.Fatalf("expected v1.0.0 update available, got %+v", first)
	}
	_ = u.Check(context.Background(), false)
	if hits != 1 {
		t.Fatalf("expected cached check (1 hit), got %d", hits)
	}
	_ = u.Check(context.Background(), true)
	if hits != 2 {
		t.Fatalf("expected force check to bypass cache (2 hits), got %d", hits)
	}
}

func TestSelfUpdaterApplyPullsAndRestartsAndPreventsConcurrency(t *testing.T) {
	var mu sync.Mutex
	var calls [][]string
	gate := make(chan struct{})

	u := &selfUpdater{
		currentVersion: "v1.0.0-rc.1",
		repo:           "A-L-L-A-H/mw-xv",
		channel:        "auto",
		composeFile:    "deploy/compose/docker-compose.production.yml",
		dockerBin:      "docker",
		cacheTTL:       5 * time.Minute,
		status:         "idle",
		runCmd: func(ctx context.Context, extraEnv []string, name string, args ...string) (string, error) {
			<-gate
			mu.Lock()
			calls = append(calls, append([]string{name}, args...))
			mu.Unlock()
			return "ok " + strings.Join(args, " "), nil
		},
	}

	// Reject malformed version
	if _, code, err := u.Apply(context.Background(), "bad;tag"); err == nil || code != http.StatusBadRequest {
		t.Fatalf("expected 400 on malformed version, got code=%d err=%v", code, err)
	}

	snap, code, err := u.Apply(context.Background(), "v1.0.0")
	if err != nil || code != http.StatusAccepted || snap.Status != "updating" {
		t.Fatalf("expected 202 updating, got code=%d status=%s err=%v", code, snap.Status, err)
	}

	// Concurrent second apply must return 409 Conflict
	if _, conflictCode, conflictErr := u.Apply(context.Background(), "v1.0.0"); conflictErr == nil || conflictCode != http.StatusConflict {
		t.Fatalf("expected 409 conflict during in-flight update, got code=%d err=%v", conflictCode, conflictErr)
	}

	close(gate)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		u.mu.Lock()
		st := u.status
		cur := u.currentVersion
		u.mu.Unlock()
		if st == "succeeded" {
			if cur != "v1.0.0" {
				t.Fatalf("expected currentVersion v1.0.0, got %s", cur)
			}
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 2 {
		t.Fatalf("expected 2 docker compose calls (pull + up), got %d: %v", len(calls), calls)
	}
	if strings.Join(calls[0], " ") != "docker compose -f deploy/compose/docker-compose.production.yml pull" {
		t.Fatalf("unexpected pull args: %v", calls[0])
	}
	if strings.Join(calls[1], " ") != "docker compose -f deploy/compose/docker-compose.production.yml up -d --remove-orphans" {
		t.Fatalf("unexpected up args: %v", calls[1])
	}
}

func TestSystemUpdateRoutesRequireAuth(t *testing.T) {
	mux, token := newTestServer(t, "docker")

	req := httptest.NewRequest(http.MethodGet, "/paas/system/update", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /paas/system/update unauth = %d, want 401", rec.Code)
	}

	postReq := httptest.NewRequest(http.MethodPost, "/paas/system/update/apply", bytes.NewBufferString(`{"version":"bad"}`))
	postRec := httptest.NewRecorder()
	mux.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusUnauthorized {
		t.Fatalf("POST /paas/system/update/apply unauth = %d, want 401", postRec.Code)
	}

	// Authenticated malformed version returns 400
	authedReq := httptest.NewRequest(http.MethodPost, "/paas/system/update/apply", bytes.NewBufferString(`{"version":"bad;cmd"}`))
	authedReq.Header.Set("Authorization", "Bearer "+token)
	authedRec := httptest.NewRecorder()
	mux.ServeHTTP(authedRec, authedReq)
	if authedRec.Code != http.StatusBadRequest {
		t.Fatalf("POST /paas/system/update/apply bad version = %d, want 400", authedRec.Code)
	}
}
