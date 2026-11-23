package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	gitWebhookMaxBodyBytes = 1 << 20 // 1 MiB
	defaultGitBranch       = "main"
	defaultDockerfilePath  = "Dockerfile"
)

var (
	gitBranchPattern     = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$`)
	gitDockerfilePattern = regexp.MustCompile(`^[a-zA-Z0-9._/-]{1,255}$`)
	gitShortShaPattern   = regexp.MustCompile(`^[a-fA-F0-9]{7,40}$`)
)

// GitDeployRequest is the payload for POST /paas/apps/deploy-git.
type GitDeployRequest struct {
	Slug           string            `json:"slug"`
	TenantID       string            `json:"tenantId"`
	GitRepo        string            `json:"gitRepo"`
	Branch         string            `json:"branch,omitempty"`
	DockerfilePath string            `json:"dockerfilePath,omitempty"`
	Port           int               `json:"port"`
	Domain         string            `json:"domain,omitempty"`
	Env            map[string]string `json:"env,omitempty"`
}

// GitDeployResponse is returned by POST /paas/apps/deploy-git and webhook deploys.
type GitDeployResponse struct {
	Status        string `json:"status"`
	Slug          string `json:"slug"`
	Image         string `json:"image"`
	Branch        string `json:"branch"`
	CommitSHA     string `json:"commitSha"`
	ContainerName string `json:"containerName"`
	ContainerID   string `json:"containerId"`
	Domain        string `json:"domain,omitempty"`
}

type githubPushPayload struct {
	Ref        string `json:"ref"`
	After      string `json:"after"`
	Repository struct {
		CloneURL string `json:"clone_url"`
	} `json:"repository"`
}

// VerifyGitHubWebhookSignature verifies a GitHub X-Hub-Signature-256 header
// ("sha256=<hex>") using HMAC-SHA256 and constant-time comparison.
// Fails closed when secret or signature is missing or malformed.
func VerifyGitHubWebhookSignature(secret string, payload []byte, sigHeader string) bool {
	if secret == "" || !strings.HasPrefix(sigHeader, "sha256=") {
		return false
	}
	hexSig := strings.TrimPrefix(sigHeader, "sha256=")
	presented, err := hex.DecodeString(hexSig)
	if err != nil || len(presented) != sha256.Size {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(payload)
	expected := mac.Sum(nil)
	return hmac.Equal(expected, presented)
}

// isBlockedGitHost returns true if host is loopback, private, link-local,
// CGNAT, multicast, unspecified, or a local/internal hostname (SSRF protection).
func isBlockedGitHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" {
		return true
	}
	if h == "localhost" || strings.HasSuffix(h, ".localhost") ||
		strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".internal") {
		return true
	}
	ip := net.ParseIP(h)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	// Block RFC 6598 CGNAT (100.64.0.0/10) used by mesh overlays.
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return true
		}
	}
	return false
}

func validateGitRepoURL(raw string) error {
	if raw == "" {
		return errors.New("gitRepo is required")
	}
	if strings.HasPrefix(raw, "-") || strings.ContainsAny(raw, "\r\n\t \x00") {
		return fmt.Errorf("invalid gitRepo URL: %q", raw)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid gitRepo URL: %w", err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("gitRepo must use https scheme, got %q", u.Scheme)
	}
	if u.User != nil {
		return errors.New("gitRepo must not embed credentials")
	}
	host := u.Hostname()
	if isBlockedGitHost(host) {
		return fmt.Errorf("gitRepo host %q is blocked by SSRF policy", host)
	}
	if u.Path == "" || u.Path == "/" {
		return errors.New("gitRepo must include a repository path")
	}
	return nil
}

func validateGitBranch(branch string) error {
	if branch == "" {
		return nil
	}
	if strings.HasPrefix(branch, "-") || strings.Contains(branch, "..") ||
		strings.Contains(branch, "@{") || strings.HasSuffix(branch, ".") ||
		strings.HasSuffix(branch, ".lock") || strings.HasSuffix(branch, "/") ||
		!gitBranchPattern.MatchString(branch) {
		return fmt.Errorf("invalid git branch: %q", branch)
	}
	return nil
}

func validateDockerfilePath(p string) error {
	if p == "" {
		return nil
	}
	if strings.HasPrefix(p, "-") || strings.HasPrefix(p, "/") || strings.HasPrefix(p, "\\") ||
		strings.Contains(p, "\\") || strings.ContainsRune(p, 0) || filepath.IsAbs(p) {
		return fmt.Errorf("invalid dockerfilePath: %q", p)
	}
	if !gitDockerfilePattern.MatchString(p) {
		return fmt.Errorf("invalid dockerfilePath: %q", p)
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." || seg == "" {
			return fmt.Errorf("invalid dockerfilePath: %q", p)
		}
	}
	return nil
}

// ValidateGitDeployRequest validates all fields of a Git-push deploy payload fail-closed.
func ValidateGitDeployRequest(req GitDeployRequest) error {
	if err := ValidatePaasSlug(req.Slug); err != nil {
		return err
	}
	if req.TenantID == "" || !paasTenantPattern.MatchString(req.TenantID) {
		return fmt.Errorf("invalid tenantId: %q", req.TenantID)
	}
	if err := validateGitRepoURL(req.GitRepo); err != nil {
		return err
	}
	if err := validateGitBranch(req.Branch); err != nil {
		return err
	}
	if err := validateDockerfilePath(req.DockerfilePath); err != nil {
		return err
	}
	if err := ValidatePaasPort(req.Port); err != nil {
		return err
	}
	if req.Domain != "" {
		if err := ValidatePaasDomain(req.Domain); err != nil {
			return err
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

// RegisterGitBuilderRoutes mounts the Git-push auto-deploy and GitHub webhook
// endpoints onto mux.
func RegisterGitBuilderRoutes(mux *http.ServeMux, paasMgr *PaasManager, adminToken string) {
	mux.HandleFunc("/paas/apps/deploy-git", requirePaasAuth(adminToken, paasMgr.handleGitDeploy()))
	mux.HandleFunc("/paas/webhooks/github/", paasMgr.handleGitHubWebhook())
}

func (m *PaasManager) handleGitDeploy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req GitDeployRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, gitWebhookMaxBodyBytes)).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
		if err := ValidateGitDeployRequest(req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()

		resp, err := m.buildAndDeployFromGit(ctx, req)
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(req.Env)...),
			})
			return
		}
		writePaasJSON(w, http.StatusOK, resp)
	}
}

func (m *PaasManager) handleGitHubWebhook() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		slug := strings.TrimPrefix(r.URL.Path, "/paas/webhooks/github/")
		slug = strings.Trim(slug, "/")
		if err := ValidatePaasSlug(slug); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, gitWebhookMaxBodyBytes))
		if err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read webhook body"})
			return
		}

		app, err := m.getAppFromDB(slug)
		if err != nil {
			writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
			return
		}

		secret := strings.TrimSpace(app.Env["GITHUB_WEBHOOK_SECRET"])
		if secret == "" {
			secret = strings.TrimSpace(os.Getenv("MW_PAAS_GITHUB_WEBHOOK_SECRET"))
		}
		sigHeader := r.Header.Get("X-Hub-Signature-256")
		if !VerifyGitHubWebhookSignature(secret, body, sigHeader) {
			writePaasJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid webhook signature"})
			return
		}

		var payload githubPushPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid webhook json"})
			return
		}

		branch := defaultGitBranch
		if strings.HasPrefix(payload.Ref, "refs/heads/") {
			branch = strings.TrimPrefix(payload.Ref, "refs/heads/")
		}
		gitRepo := app.GitRepo
		if gitRepo == "" {
			gitRepo = payload.Repository.CloneURL
		}

		req := GitDeployRequest{
			Slug:           app.Slug,
			TenantID:       app.TenantID,
			GitRepo:        gitRepo,
			Branch:         branch,
			DockerfilePath: defaultDockerfilePath,
			Port:           app.Port,
			Domain:         app.Domain,
			Env:            app.Env,
		}
		if err := ValidateGitDeployRequest(req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()

		resp, err := m.buildAndDeployFromGit(ctx, req)
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(req.Env)...),
			})
			return
		}
		writePaasJSON(w, http.StatusOK, resp)
	}
}

func (m *PaasManager) buildAndDeployFromGit(ctx context.Context, req GitDeployRequest) (GitDeployResponse, error) {
	branch := req.Branch
	if branch == "" {
		branch = defaultGitBranch
	}
	dockerfileRel := req.DockerfilePath
	if dockerfileRel == "" {
		dockerfileRel = defaultDockerfilePath
	}

	tmpDir, err := os.MkdirTemp("", "mw-gitbuild-*")
	if err != nil {
		return GitDeployResponse{}, fmt.Errorf("create build workspace: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	gitBin := env("GIT_BIN", "git")
	if out, err := m.runner(ctx, gitBin, "clone", "--depth", "1", "--branch", branch, "--", req.GitRepo, tmpDir); err != nil {
		return GitDeployResponse{}, fmt.Errorf("git clone failed: %w (%s)", err, strings.TrimSpace(out))
	}

	shortSha := "latest"
	if shaOut, err := m.runner(ctx, gitBin, "-C", tmpDir, "rev-parse", "--short=12", "HEAD"); err == nil {
		candidate := strings.TrimSpace(shaOut)
		if gitShortShaPattern.MatchString(candidate) {
			shortSha = strings.ToLower(candidate)
		}
	}

	imageTag := fmt.Sprintf("mw-paas-%s:%s", req.Slug, shortSha)
	dockerfileFull := filepath.Join(tmpDir, filepath.FromSlash(dockerfileRel))
	if out, err := m.runner(ctx, m.dockerBin, "build", "-f", dockerfileFull, "-t", imageTag, tmpDir); err != nil {
		return GitDeployResponse{}, fmt.Errorf("docker build failed: %w (%s)", err, strings.TrimSpace(out))
	}

	deployReq := PaasDeployRequest{
		Slug:     req.Slug,
		TenantID: req.TenantID,
		Image:    imageTag,
		Port:     req.Port,
		Domain:   req.Domain,
		Env:      req.Env,
		GitRepo:  req.GitRepo,
	}
	containerName := PaasContainerName(req.Slug)
	containerID, err := m.deployContainerZeroDowntime(ctx, deployReq, containerName)
	if err != nil {
		return GitDeployResponse{}, fmt.Errorf("container deploy failed: %w", err)
	}

	envBytes, _ := json.Marshal(req.Env)
	if len(req.Env) == 0 {
		envBytes = []byte("{}")
	}
	if _, err := m.db.Exec(`
		INSERT INTO paas_apps (slug, tenant_id, image, port, domain, env_json, compose_spec, git_repo, container_name, container_id, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'running', datetime('now'))
		ON CONFLICT(slug) DO UPDATE SET
			tenant_id=excluded.tenant_id,
			image=excluded.image,
			port=excluded.port,
			domain=excluded.domain,
			env_json=excluded.env_json,
			git_repo=excluded.git_repo,
			container_name=excluded.container_name,
			container_id=excluded.container_id,
			status='running',
			updated_at=datetime('now')
	`, req.Slug, req.TenantID, imageTag, req.Port, req.Domain, string(envBytes), req.GitRepo, containerName, containerID); err != nil {
		return GitDeployResponse{}, fmt.Errorf("persist paas_apps: %w", err)
	}

	if err := m.syncCaddyRoutes(ctx); err != nil {
		return GitDeployResponse{}, fmt.Errorf("deployed container but caddy sync failed: %w", err)
	}

	return GitDeployResponse{
		Status:        "deployed",
		Slug:          req.Slug,
		Image:         imageTag,
		Branch:        branch,
		CommitSHA:     shortSha,
		ContainerName: containerName,
		ContainerID:   containerID,
		Domain:        req.Domain,
	}, nil
}
