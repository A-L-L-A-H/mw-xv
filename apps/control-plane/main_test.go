package main

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// dockerMockSource is a tiny standalone fake of the docker CLI used to back
// handler tests without a real docker daemon. It is compiled once per test
// that needs it (via writeDockerMock) and invoked by absolute path.
const dockerMockSource = `package main

import (
	"fmt"
	"os"
	"time"
)

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		os.Exit(2)
	}
	switch args[0] {
	case "ps":
		fmt.Fprint(os.Stdout, "")
	case "rm":
		fmt.Fprint(os.Stdout, "")
	case "run":
		fmt.Fprint(os.Stdout, "abc123def456abc123def456abc123def456abc123def456\n")
	case "logs":
		follow := false
		for _, a := range args {
			if a == "--follow" {
				follow = true
			}
		}
		if !follow {
			fmt.Fprintln(os.Stdout, "2024-01-01T00:00:00Z line-one")
			fmt.Fprintln(os.Stdout, "2024-01-01T00:00:01Z line-two")
			return
		}
		for i := 0; i < 3; i++ {
			fmt.Fprintf(os.Stdout, "2024-01-01T00:00:0%dZ streamed-line-%d\n", i, i)
			os.Stdout.Sync()
			time.Sleep(50 * time.Millisecond)
		}
	case "version":
		fmt.Fprintln(os.Stdout, "27.0.0")
	}
}
`

func writeDockerMock(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	name := "docker-mock-test"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(dir, name)
	src := filepath.Join(dir, "main.go")
	if err := os.WriteFile(src, []byte(dockerMockSource), 0o644); err != nil {
		t.Fatalf("write mock source: %v", err)
	}
	cmd := exec.Command("go", "build", "-o", path, src)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GO111MODULE=off")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build docker mock: %v\n%s", err, out)
	}
	return path
}

// newTestServer builds a temporary SQLite-backed mux wired with the mock
// docker binary and a fixed admin token.
func newTestServer(t *testing.T, dockerBin string) (http.Handler, string) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "control-plane.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("ping sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if err := initSchemaFor(db); err != nil {
		t.Fatalf("init schema: %v", err)
	}

	const token = "test-admin-token"
	handler := buildMux(db, dockerBin, token)
	return handler, token
}

// initSchemaFor runs the schema DDL against an explicit DB handle.
func initSchemaFor(db *sql.DB) error {
	if _, err := db.Exec(schemaDDL); err != nil {
		return err
	}
	return initPaasSchema(db)
}

// ---------------------------------------------------------------------------
// resolveAdminToken
// ---------------------------------------------------------------------------

func TestResolveAdminTokenExplicitOverrideWins(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "control-plane.db")

	t.Setenv("MW_CONTROL_PLANE_TOKEN", "  explicit-token  ")
	t.Setenv("MW_INTERNAL_SECRET", "shared-secret")
	t.Setenv("JWT_SECRET", "jwt-secret")

	token, err := resolveAdminToken(dbPath)
	if err != nil {
		t.Fatalf("resolveAdminToken: %v", err)
	}
	if token != "explicit-token" {
		t.Fatalf("expected trimmed explicit override, got %q", token)
	}
}

func TestResolveAdminTokenDerivedFromInternalSecret(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "control-plane.db")

	t.Setenv("MW_CONTROL_PLANE_TOKEN", "")
	t.Setenv("MW_INTERNAL_SECRET", "shared-secret")
	t.Setenv("JWT_SECRET", "jwt-secret")

	token, err := resolveAdminToken(dbPath)
	if err != nil {
		t.Fatalf("resolveAdminToken: %v", err)
	}

	mac := hmac.New(sha256.New, []byte("shared-secret"))
	mac.Write([]byte("moonwitness-control-plane-admin-v1"))
	expected := hex.EncodeToString(mac.Sum(nil))
	if token != expected {
		t.Fatalf("expected HMAC-SHA256 token %q, got %q", expected, token)
	}
}

func TestResolveAdminTokenDerivedFromJWTSecretFallback(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "control-plane.db")

	t.Setenv("MW_CONTROL_PLANE_TOKEN", "")
	t.Setenv("MW_INTERNAL_SECRET", "")
	t.Setenv("JWT_SECRET", "jwt-secret")

	token, err := resolveAdminToken(dbPath)
	if err != nil {
		t.Fatalf("resolveAdminToken: %v", err)
	}

	mac := hmac.New(sha256.New, []byte("jwt-secret"))
	mac.Write([]byte("moonwitness-control-plane-admin-v1"))
	expected := hex.EncodeToString(mac.Sum(nil))
	if token != expected {
		t.Fatalf("expected HMAC-SHA256 token %q, got %q", expected, token)
	}
}

func TestResolveAdminTokenFileFallbackPersistsToken(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "control-plane.db")

	t.Setenv("MW_CONTROL_PLANE_TOKEN", "")
	t.Setenv("MW_INTERNAL_SECRET", "")
	t.Setenv("JWT_SECRET", "")

	token, err := resolveAdminToken(dbPath)
	if err != nil {
		t.Fatalf("resolveAdminToken: %v", err)
	}
	if len(token) != 64 {
		t.Fatalf("expected 64 hex chars, got %d (%q)", len(token), token)
	}
	if _, err := hex.DecodeString(token); err != nil {
		t.Fatalf("expected hex-encoded token, got %q: %v", token, err)
	}

	tokenPath := filepath.Join(dir, ".admin-token")
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		t.Fatalf("expected persisted .admin-token: %v", err)
	}
	if strings.TrimSpace(string(data)) != token {
		t.Fatalf("persisted token mismatch: file=%q resolved=%q", strings.TrimSpace(string(data)), token)
	}
	if runtime.GOOS == "windows" {
		t.Log("skipping 0600 permission assertion on windows")
	} else {
		info, err := os.Stat(tokenPath)
		if err != nil {
			t.Fatalf("stat token file: %v", err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("expected 0600 permissions, got %o", info.Mode().Perm())
		}
	}

	// Second call must return the same persisted token (no regeneration).
	again, err := resolveAdminToken(dbPath)
	if err != nil {
		t.Fatalf("resolveAdminToken (second): %v", err)
	}
	if again != token {
		t.Fatalf("expected stable persisted token, got %q then %q", token, again)
	}
}

// ---------------------------------------------------------------------------
// HTTP auth middleware
// ---------------------------------------------------------------------------

func TestHealthEndpointUnauthenticated(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, _ := newTestServer(t, dockerBin)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for GET /health without auth, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestProtectedEndpointsRequireBearerAuth(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/services"},
		{http.MethodPost, "/api/deploy"},
		{http.MethodGet, "/api/containers/abc123/logs"},
		{http.MethodGet, "/services"},
		{http.MethodGet, "/api/deployments"},
	}

	for _, tc := range cases {
		for _, authz := range []string{"", "Bearer wrong-token", "Basic " + token} {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			if authz != "" {
				req.Header.Set("Authorization", authz)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s %s with Authorization=%q: expected 401, got %d: %s", tc.method, tc.path, authz, rec.Code, rec.Body.String())
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("expected JSON body: %v", err)
			}
			if body["error"] != "unauthorized" {
				t.Fatalf("expected error=unauthorized, got %v", body)
			}
		}

		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code == http.StatusUnauthorized {
			t.Fatalf("%s %s with valid token: unexpected 401: %s", tc.method, tc.path, rec.Body.String())
		}
	}
}

// ---------------------------------------------------------------------------
// sanitizeContainerName
// ---------------------------------------------------------------------------

func TestSanitizeContainerNameRejectsFlagInjection(t *testing.T) {
	if _, err := sanitizeContainerName("", "-evil-image"); err == nil {
		t.Fatal("expected error for image starting with '-'")
	}
	if _, err := sanitizeContainerName("", ""); err == nil {
		t.Fatal("expected error for empty image")
	}
	if _, err := sanitizeContainerName("", "nginx"); err != nil {
		t.Fatalf("valid image should not be rejected: %v", err)
	}
}

func TestSanitizeContainerNameFromImage(t *testing.T) {
	got, err := sanitizeContainerName("", "mw-xv-isp:latest")
	if err != nil {
		t.Fatalf("sanitizeContainerName: %v", err)
	}
	if got != "mw-xv-isp" {
		t.Fatalf("expected mw-xv-isp (already mw- prefixed), got %q", got)
	}
	if !dockerNamePattern.MatchString(got) {
		t.Fatalf("sanitized name %q does not satisfy docker name pattern", got)
	}
}

func TestSanitizeContainerNamePrefixesAndTrims(t *testing.T) {
	cases := []struct {
		name     string
		image    string
		expected string
	}{
		{"my-app", "postgres:16-alpine", "mw-my-app"},
		{"", "ghcr.io/moonwitness/web:v1.2.3", "mw-ghcr.io-moonwitness-web"},
		{"  ", "registry:5000/team/svc@sha256:abc", "mw-registry-5000-team-svc"},
		{"moonwitness-keep", "nginx", "moonwitness-keep"},
		{"MW-APP", "nginx", "mw-MW-APP"},
	}
	for _, tc := range cases {
		got, err := sanitizeContainerName(tc.name, tc.image)
		if err != nil {
			t.Fatalf("sanitizeContainerName(%q, %q): %v", tc.name, tc.image, err)
		}
		if got != tc.expected {
			t.Fatalf("sanitizeContainerName(%q, %q) = %q, want %q", tc.name, tc.image, got, tc.expected)
		}
	}
}

func TestSanitizeContainerNameTruncatesTo63(t *testing.T) {
	long := strings.Repeat("a", 200)
	got, err := sanitizeContainerName(long, "nginx:latest")
	if err != nil {
		t.Fatalf("sanitizeContainerName: %v", err)
	}
	if len(got) > 63 {
		t.Fatalf("expected max 63 chars, got %d", len(got))
	}
	if !dockerNamePattern.MatchString(got) {
		t.Fatalf("truncated name %q does not satisfy docker name pattern", got)
	}
	if !strings.HasPrefix(got, "mw-") {
		t.Fatalf("expected mw- prefix, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// Deploy flows (replace-on-redeploy)
// ---------------------------------------------------------------------------

func deployRequest(t *testing.T, handler http.Handler, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/deploy", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestApiDeployUsesSafeNameAndRecordsDeployment(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	rec := deployRequest(t, handler, token, `{"image":"mw-xv-isp:latest","ports":["3002:3000"],"restart":"unless-stopped"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["name"] != "mw-xv-isp" {
		t.Fatalf("expected sanitized name in response, got %q", resp["name"])
	}
	if resp["status"] != "success" {
		t.Fatalf("expected success, got %v", resp)
	}

	// Deployment record must use the safe service_name, not the raw image.
	depReq := httptest.NewRequest(http.MethodGet, "/api/deployments", nil)
	depReq.Header.Set("Authorization", "Bearer "+token)
	depRec := httptest.NewRecorder()
	handler.ServeHTTP(depRec, depReq)
	if depRec.Code != http.StatusOK {
		t.Fatalf("list deployments: expected 200, got %d: %s", depRec.Code, depRec.Body.String())
	}
	var deps []deploymentRow
	if err := json.Unmarshal(depRec.Body.Bytes(), &deps); err != nil {
		t.Fatalf("decode deployments: %v", err)
	}
	if len(deps) != 1 {
		t.Fatalf("expected 1 deployment row, got %d: %s", len(deps), depRec.Body.String())
	}
	if deps[0].ServiceName != "mw-xv-isp" {
		t.Fatalf("expected deployments.service_name=mw-xv-isp, got %q", deps[0].ServiceName)
	}
}

func TestApiDeployRejectsFlagLikeArguments(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	cases := []string{
		`{"image":"nginx","env":["--privileged"]}`,
		`{"image":"nginx","ports":["-p","80:80"]}`,
		`{"image":"nginx","volumes":["-v","/etc:/etc"]}`,
	}
	for _, body := range cases {
		rec := deployRequest(t, handler, token, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %s: expected 400, got %d: %s", body, rec.Code, rec.Body.String())
		}
	}
}

// ---------------------------------------------------------------------------
// Container logs
// ---------------------------------------------------------------------------

func TestContainerLogsInvalidIDRejected(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	cases := []string{
		"/api/containers/-bad/logs",
		"/api/containers/bad@id/logs",
		"/api/containers/" + strings.Repeat("a", 200) + "/logs",
	}
	for _, path := range cases {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d", path, rec.Code)
		}
	}
}

func TestContainerLogsTailValidation(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	for _, tail := range []string{"0", "-1", "2001", "abc"} {
		req := httptest.NewRequest(http.MethodGet, "/api/containers/abc/logs?tail="+tail, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("tail=%s: expected 400, got %d: %s", tail, rec.Code, rec.Body.String())
		}
	}
}

func TestContainerLogsFollowFalse(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	req := httptest.NewRequest(http.MethodGet, "/api/containers/abc123/logs?tail=50&follow=false", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		ID   string `json:"id"`
		Logs string `json:"logs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode logs response: %v", err)
	}
	if resp.ID != "abc123" {
		t.Fatalf("expected id=abc123, got %q", resp.ID)
	}
	if !strings.Contains(resp.Logs, "line-one") || !strings.Contains(resp.Logs, "line-two") {
		t.Fatalf("expected combined log lines, got %q", resp.Logs)
	}
}

func TestContainerLogsFollowTrueSSE(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	// Use a real httptest server so we can read the streaming body.
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/containers/abc123/logs?follow=true&tail=10", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("stream request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("expected text/event-stream, got %q", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("expected no-cache, got %q", cc)
	}

	scanner := bufio.NewScanner(resp.Body)
	var events []string
	deadline := time.Now().Add(8 * time.Second)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			events = append(events, strings.TrimSpace(strings.TrimPrefix(line, "event:")))
		}
		if strings.Contains(line, "streamed-line-2") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timeout waiting for streamed lines; events=%v", events)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan stream: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("expected at least one SSE event")
	}
	for _, ev := range events {
		if ev != "log" {
			t.Fatalf("expected event: log, got %q", ev)
		}
	}
}

// ---------------------------------------------------------------------------
// replace-on-redeploy with invocation log
// ---------------------------------------------------------------------------

// queryServiceNames returns the service_name column of deployments, newest first.
func queryServiceNames(t *testing.T) []string {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "cp-query.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_ = initSchemaFor(db)

	rows, err := db.Query(`SELECT service_name FROM deployments ORDER BY created_at DESC`)
	if err != nil {
		t.Fatalf("query deployments: %v", err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan deployment: %v", err)
		}
		names = append(names, name)
	}
	return names
}

// ---------------------------------------------------------------------------
// replace-on-redeploy with invocation log
// ---------------------------------------------------------------------------

// TestDeployReplacesExistingContainerOnRedeploy uses a docker mock that
// records each invocation so we can assert the rm -f + run sequence and the
// sanitized --name flag.
func TestDeployReplacesExistingContainerOnRedeploy(t *testing.T) {
	callLog := filepath.Join(t.TempDir(), "calls.log")

	dockerDir := t.TempDir()
	name := "docker-mock-logging"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dockerBin := filepath.Join(dockerDir, name)
	src := filepath.Join(dockerDir, "main.go")

	mockSrc := "package main\n" + fmt.Sprintf(`
import (
	"fmt"
	"os"
	"strings"
)

func main() {
	args := os.Args[1:]
	f, _ := os.OpenFile(%q, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	defer f.Close()
	fmt.Fprintln(f, strings.Join(args, " "))
	switch {
	case len(args) > 0 && args[0] == "ps":
		fmt.Fprintln(os.Stdout, "/mw-xv-isp\tabc123def456\tmw-xv-isp:latest\tUp")
	case len(args) > 0 && args[0] == "run":
		fmt.Fprint(os.Stdout, "abc123def456abc123def456abc123def456abc123def456\n")
	}
}
`, filepath.ToSlash(callLog))

	if err := os.WriteFile(src, []byte(mockSrc), 0o644); err != nil {
		t.Fatalf("write mock source: %v", err)
	}
	cmd := exec.Command("go", "build", "-o", dockerBin, src)
	cmd.Dir = dockerDir
	cmd.Env = append(os.Environ(), "GO111MODULE=off")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build logging docker mock: %v\n%s", err, out)
	}

	handler, token := newTestServer(t, dockerBin)
	body := `{"image":"mw-xv-isp:latest","restart":"unless-stopped"}`

	for i := 0; i < 2; i++ {
		rec := deployRequest(t, handler, token, body)
		if rec.Code != http.StatusCreated {
			t.Fatalf("deploy %d: expected 201, got %d: %s", i, rec.Code, rec.Body.String())
		}
	}

	data, err := os.ReadFile(callLog)
	if err != nil {
		t.Fatalf("read call log: %v", err)
	}
	calls := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(calls) != 6 { // 2x (ps + rm + run) per redeploy
		t.Fatalf("expected 6 docker invocations, got %d:\n%s", len(calls), string(data))
	}
	for _, c := range calls {
		if strings.Contains(c, "--name mw-xv-isp:latest") || strings.Contains(c, "mw-xv-isp:latest --name") {
			t.Fatalf("expected safe name in args, got %q", c)
		}
	}
	// Both run invocations must use the sanitized --name (replace-on-redeploy).
	for _, c := range calls {
		if strings.HasPrefix(c, "run") {
			if !strings.Contains(c, "--name mw-xv-isp") {
				t.Fatalf("expected sanitized --name in run args, got %q", c)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// misc helpers
// ---------------------------------------------------------------------------

func TestDeployLegacyEndpointUsesSafeName(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	req := httptest.NewRequest(http.MethodPost, "/deploy", strings.NewReader(`{"image":"example.com/team/app:v1"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["name"] != "mw-example.com-team-app" {
		t.Fatalf("expected sanitized name, got %q", resp["name"])
	}
}

func TestDockerArgsBuiltFromMeta(t *testing.T) {
	meta := containerMeta{
		Image:   "nginx:latest",
		Name:    "web",
		Ports:   []string{"8080:80"},
		Volumes: []string{"data:/data"},
		Env:     []string{"A=b"},
		Command: []string{"nginx", "-g", "daemon off;"},
	}
	args, err := dockerArgsFromMeta(meta, "mw-web")
	if err != nil {
		t.Fatalf("dockerArgsFromMeta: %v", err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--name mw-web") {
		t.Fatalf("expected safe name in args, got %q", joined)
	}
	if !strings.HasSuffix(joined, "nginx:latest nginx -g daemon off;") {
		t.Fatalf("unexpected args tail: %q", joined)
	}
}

func TestRemoveExistingContainerIgnoresMissing(t *testing.T) {
	dockerBin := writeDockerMock(t)
	removeExistingContainer(context.Background(), dockerBin, "mw-nonexistent")
}

// ---------------------------------------------------------------------------
// CF-003: explicit route matrix, token contract and bounded health
// ---------------------------------------------------------------------------

func TestControlPlaneRouteMatrix(t *testing.T) {
	seen := make(map[string]bool)
	publicCount := 0
	for _, route := range controlPlaneRouteMatrix {
		if seen[route.pattern] {
			t.Fatalf("duplicate route in matrix: %s", route.pattern)
		}
		seen[route.pattern] = true
		if route.family == "" {
			t.Fatalf("route %s has no family", route.pattern)
		}
		if route.access == accessPublic {
			publicCount++
			if route.pattern != "/health" {
				t.Fatalf("unexpected public route: %s", route.pattern)
			}
			if len(route.methods) != 1 || route.methods[0] != http.MethodGet {
				t.Fatalf("public health must be GET-only, got %v", route.methods)
			}
		}
	}
	if publicCount != 1 {
		t.Fatalf("expected exactly one public route, got %d", publicCount)
	}
	for _, tc := range []struct {
		pattern string
		access  controlPlaneAccess
	}{
		{"/api/deploy", accessPrivileged},
		{"/api/containers/", accessPrivileged},
		{"/paas/backups/restore", accessPrivileged},
		{"/paas/apps/deploy-git", accessPrivileged},
		{"/mesh/status", accessAuthenticated},
		{"/api/services", accessAuthenticated},
		{"/paas/webhooks/github/", accessWebhookSignature},
		{"/a2a/delegate", accessA2APeer},
	} {
		got, ok := controlPlaneAccessForPattern(tc.pattern)
		if !ok || got != tc.access {
			t.Fatalf("%s access = %v (found=%v), want %v", tc.pattern, got, ok, tc.access)
		}
	}
}

func TestProtectedRouteFamiliesRejectMalformedAndWrongAudienceCredentials(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, token := newTestServer(t, dockerBin)

	families := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/mesh/status"},
		{http.MethodGet, "/services"},
		{http.MethodPost, "/deploy"},
		{http.MethodGet, "/api/services"},
		{http.MethodPost, "/api/deploy"},
		{http.MethodGet, "/api/deployments"},
		{http.MethodGet, "/api/containers/abc123/logs"},
		{http.MethodGet, "/paas/apps"},
		{http.MethodPost, "/paas/apps/deploy"},
		{http.MethodPost, "/paas/apps/deploy-git"},
		{http.MethodPost, "/paas/backups/restore"},
		{http.MethodGet, "/agent/metrics"},
		{http.MethodPost, "/agent/caddy/reconcile"},
		{http.MethodPost, "/agent/containers/run"},
		{http.MethodPost, "/agent/compose/up"},
	}

	wrongAudience := func(secret, domainLabel string) string {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(domainLabel))
		return hex.EncodeToString(mac.Sum(nil))
	}

	badAuth := []string{
		"",
		"Bearer wrong-token",
		"bearer " + token,
		"Bearer " + token + " extra",
		"Bearer  " + token,
		"Bearer" + token,
		"Basic " + token,
		"Bearer " + wrongAudience("shared-secret", "moonwitness-other-service-v1"),
		"Bearer " + wrongAudience("shared-secret", "moonwitness-control-plane-admin-v0"),
	}

	for _, family := range families {
		for _, authz := range badAuth {
			req := httptest.NewRequest(family.method, family.path, nil)
			if authz != "" {
				req.Header.Set("Authorization", authz)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s %s with Authorization=%q: expected 401, got %d: %s", family.method, family.path, authz, rec.Code, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), token) {
				t.Fatalf("%s %s echoed the credential: %s", family.method, family.path, rec.Body.String())
			}
		}

		req := httptest.NewRequest(family.method, family.path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code == http.StatusUnauthorized {
			t.Fatalf("%s %s with canonical token: unexpected 401: %s", family.method, family.path, rec.Body.String())
		}
	}
}

func TestIssuerConsumerAgreementAndRotation(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "control-plane.db")
	t.Setenv("MW_CONTROL_PLANE_TOKEN", "")
	t.Setenv("MW_INTERNAL_SECRET", "secret-v1")
	t.Setenv("JWT_SECRET", "")

	current, err := resolveAdminToken(dbPath)
	if err != nil {
		t.Fatalf("resolveAdminToken: %v", err)
	}
	mac := hmac.New(sha256.New, []byte("secret-v1"))
	mac.Write([]byte(controlPlaneAuthDomain))
	if current != hex.EncodeToString(mac.Sum(nil)) {
		t.Fatalf("issuer/consumer derivation diverged: got %q", current)
	}
	if !validServiceBearer("Bearer "+current, current) {
		t.Fatal("canonical token was rejected")
	}

	// Rotating the shared secret makes tokens derived from the previous secret
	// (the equivalent of an expired service credential) invalid.
	t.Setenv("MW_INTERNAL_SECRET", "secret-v2")
	rotated, err := resolveAdminToken(dbPath)
	if err != nil {
		t.Fatalf("resolveAdminToken after rotation: %v", err)
	}
	if rotated == current {
		t.Fatal("rotation did not change the derived token")
	}
	if validServiceBearer("Bearer "+current, rotated) {
		t.Fatal("rotated-out credential was accepted")
	}
	if !validServiceBearer("Bearer "+rotated, rotated) {
		t.Fatal("new credential was rejected")
	}
}

func TestHealthPayloadIsBoundedAndMethodGated(t *testing.T) {
	dockerBin := writeDockerMock(t)
	handler, _ := newTestServer(t, dockerBin)

	postReq := httptest.NewRequest(http.MethodPost, "/health", nil)
	postRec := httptest.NewRecorder()
	handler.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /health: expected 405, got %d", postRec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /health: expected 200, got %d", rec.Code)
	}
	var payload struct {
		Status   string `json:"status"`
		Database struct {
			Status string `json:"status"`
			Error  string `json:"error"`
		} `json:"database"`
		Docker string `json:"docker"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	if payload.Status != "ok" && payload.Status != "degraded" {
		t.Fatalf("unbounded health status: %q", payload.Status)
	}
	if payload.Database.Status != "ok" && payload.Database.Status != "error" {
		t.Fatalf("unbounded database status: %q", payload.Database.Status)
	}
	if payload.Database.Error != "" {
		t.Fatalf("health leaked database error text: %q", payload.Database.Error)
	}
	if payload.Docker != "ok" && payload.Docker != "unknown" {
		t.Fatalf("unbounded docker status: %q", payload.Docker)
	}
	if strings.Contains(strings.ToLower(rec.Body.String()), "sqlite") ||
		strings.Contains(strings.ToLower(rec.Body.String()), "password") {
		t.Fatalf("health leaked operational detail: %s", rec.Body.String())
	}
}

func TestPrivilegedPaasRoutesRejectRawInternalSecret(t *testing.T) {
	dockerBin := writeDockerMock(t)
	t.Setenv("MW_INTERNAL_SECRET", "super-internal-secret-value")
	t.Setenv("MW_CONTROL_PLANE_TOKEN", "")

	dbPath := filepath.Join(t.TempDir(), "control-plane.db")
	adminToken, err := resolveAdminToken(dbPath)
	if err != nil {
		t.Fatalf("resolveAdminToken: %v", err)
	}
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "privileged.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()
	if err := initSchemaFor(db); err != nil {
		t.Fatalf("init schema: %v", err)
	}
	handler := buildMux(db, dockerBin, adminToken)

	for _, path := range []string{"/paas/apps/deploy-git", "/paas/backups/restore"} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{}"))
		req.Header.Set("X-Control-Plane-Token", "super-internal-secret-value")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s accepted raw internal secret as privileged credential: %d", path, rec.Code)
		}

		req = httptest.NewRequest(http.MethodPost, path, strings.NewReader("{}"))
		req.Header.Set("X-Control-Plane-Token", adminToken)
		rec = httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code == http.StatusUnauthorized {
			t.Fatalf("%s rejected canonical privileged token: %s", path, rec.Body.String())
		}
	}
}
