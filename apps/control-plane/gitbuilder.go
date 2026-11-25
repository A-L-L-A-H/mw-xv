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
	"strconv"
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
	Tenant         string            `json:"tenant,omitempty"`
	GitRepo        string            `json:"gitRepo"`
	Branch         string            `json:"branch,omitempty"`
	DockerfilePath string            `json:"dockerfilePath,omitempty"`
	Port           int               `json:"port"`
	Domain         string            `json:"domain,omitempty"`
	NoAutoDomain   bool              `json:"noAutoDomain,omitempty"`
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

// isBlockedGitHost returns true if host is loopback, in the canonical private
// mesh range list, link-local, multicast, unspecified, or a local/internal
// hostname (SSRF protection). The private/mesh ranges come from the single
// canonical privateMeshCIDRs declaration in a2a.go, shared with A2A admission.
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
	if IsPrivateMeshIP(ip) {
		return true
	}
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified()
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

// RegisterGitBuilderRoutes mounts the Git-push auto-deploy, preview deploy,
// and GitHub webhook endpoints onto mux.
func RegisterGitBuilderRoutes(mux *http.ServeMux, paasMgr *PaasManager, adminToken string) {
	mux.HandleFunc("/paas/apps/deploy-git", requirePaasAuth(adminToken, paasMgr.handleGitDeploy()))
	mux.HandleFunc("/paas/apps/preview", requirePaasAuth(adminToken, paasMgr.handlePreviewDeploy()))
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
		if req.TenantID == "" {
			req.TenantID = strings.TrimSpace(req.Tenant)
		}
		if req.TenantID == "" {
			req.TenantID = "default"
		}
		if req.Domain == "" && !req.NoAutoDomain && m.baseDomain != "" && req.Slug != "" {
			req.Domain = req.Slug + "." + m.baseDomain
		}
		if err := ValidateGitDeployRequest(req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()

		resp, err := m.buildAndDeployFromGit(ctx, req)
		if err != nil {
			m.recordDeployment(req.Slug, "git_deploy", req.GitRepo, "failed", err.Error())
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(req.Env)...),
			})
			return
		}
		m.recordDeployment(req.Slug, "git_deploy", resp.Image, "success", "git deploy "+resp.Branch+"@"+resp.CommitSHA)
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

var (
	previewNonAlnumPattern = regexp.MustCompile(`[^a-z0-9]+`)
	errPreviewUnhealthy    = errors.New("candidate container failed healthcheck")
)

// PreviewDeployRequest is the payload for POST /paas/apps/preview.
type PreviewDeployRequest struct {
	Slug            string            `json:"slug"`
	TenantID        string            `json:"tenantId"`
	PRNumber        int               `json:"prNumber,omitempty"`
	Branch          string            `json:"branch,omitempty"`
	GitRepo         string            `json:"gitRepo,omitempty"`
	Image           string            `json:"image,omitempty"`
	DockerfilePath  string            `json:"dockerfilePath,omitempty"`
	Port            int               `json:"port"`
	Domain          string            `json:"domain,omitempty"`
	HealthcheckPath string            `json:"healthcheckPath,omitempty"`
	Env             map[string]string `json:"env,omitempty"`
}

// PreviewDeployResponse is returned by POST /paas/apps/preview.
type PreviewDeployResponse struct {
	Status            string `json:"status"`
	PreviewSlug       string `json:"previewSlug"`
	Image             string `json:"image"`
	Branch            string `json:"branch,omitempty"`
	PRNumber          int    `json:"prNumber,omitempty"`
	ContainerName     string `json:"containerName"`
	ContainerID       string `json:"containerId"`
	PreviousContainer string `json:"previousContainer,omitempty"`
	HealthStatus      string `json:"healthStatus"`
	Domain            string `json:"domain,omitempty"`
}

// SanitizePreviewSlug builds a strict RFC-safe PaaS slug for a PR or branch preview.
func SanitizePreviewSlug(baseSlug, branch string, prNumber int) (string, error) {
	if err := ValidatePaasSlug(baseSlug); err != nil {
		return "", err
	}
	var suffix string
	if prNumber > 0 {
		suffix = fmt.Sprintf("pr-%d", prNumber)
	} else {
		cleaned := strings.ToLower(strings.TrimSpace(branch))
		cleaned = previewNonAlnumPattern.ReplaceAllString(cleaned, "-")
		cleaned = strings.Trim(cleaned, "-")
		if cleaned == "" {
			return "", errors.New("either prNumber or branch is required for preview deploy")
		}
		suffix = cleaned
	}

	combined := baseSlug + "-" + suffix
	if len(combined) > 48 {
		combined = strings.TrimRight(combined[:48], "-")
	}
	if err := ValidatePaasSlug(combined); err != nil {
		return "", fmt.Errorf("sanitized preview slug invalid: %w", err)
	}
	return combined, nil
}

// ValidatePreviewDeployRequest validates all fields of a preview deploy payload fail-closed.
func ValidatePreviewDeployRequest(req PreviewDeployRequest) (string, error) {
	previewSlug, err := SanitizePreviewSlug(req.Slug, req.Branch, req.PRNumber)
	if err != nil {
		return "", err
	}
	if req.TenantID == "" || !paasTenantPattern.MatchString(req.TenantID) {
		return "", fmt.Errorf("invalid tenantId: %q", req.TenantID)
	}
	if req.GitRepo == "" && req.Image == "" {
		return "", errors.New("either gitRepo or image is required")
	}
	if req.GitRepo != "" {
		if err := validateGitRepoURL(req.GitRepo); err != nil {
			return "", err
		}
	}
	if req.Image != "" {
		if strings.HasPrefix(req.Image, "-") || strings.ContainsAny(req.Image, "\r\n\t \x00") || !paasImagePattern.MatchString(req.Image) {
			return "", fmt.Errorf("invalid image reference: %q", req.Image)
		}
	}
	if err := validateGitBranch(req.Branch); err != nil {
		return "", err
	}
	if err := validateDockerfilePath(req.DockerfilePath); err != nil {
		return "", err
	}
	if err := ValidatePaasPort(req.Port); err != nil {
		return "", err
	}
	if req.Domain != "" {
		if err := ValidatePaasDomain(req.Domain); err != nil {
			return "", err
		}
	}
	if req.HealthcheckPath != "" {
		if !strings.HasPrefix(req.HealthcheckPath, "/") || strings.ContainsAny(req.HealthcheckPath, "\r\n\t \x00") {
			return "", fmt.Errorf("invalid healthcheckPath: %q", req.HealthcheckPath)
		}
	}
	for k, v := range req.Env {
		if !paasEnvKeyPattern.MatchString(k) {
			return "", fmt.Errorf("invalid env key: %q", k)
		}
		if strings.ContainsRune(v, 0) {
			return "", fmt.Errorf("env value for %q must not contain NUL bytes", k)
		}
	}
	return previewSlug, nil
}

func (m *PaasManager) handlePreviewDeploy() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req PreviewDeployRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, gitWebhookMaxBodyBytes)).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
		previewSlug, err := ValidatePreviewDeployRequest(req)
		if err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()

		resp, err := m.deployPreviewBlueGreen(ctx, req, previewSlug)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errPreviewUnhealthy) {
				status = http.StatusBadGateway
			}
			writePaasJSON(w, status, map[string]string{
				"error": RedactPaasText(err.Error(), collectEnvSecrets(req.Env)...),
			})
			return
		}
		writePaasJSON(w, http.StatusOK, resp)
	}
}

// deployPreviewBlueGreen builds/tags the preview image, starts a candidate container,
// runs an HTTP healthcheck probe BEFORE atomically swapping Caddy upstream routes,
// and drains/removes the previous container only after healthcheck + Caddy sync succeed.
// If the candidate is unhealthy, it is immediately rolled back without touching Caddy.
func (m *PaasManager) deployPreviewBlueGreen(ctx context.Context, req PreviewDeployRequest, previewSlug string) (PreviewDeployResponse, error) {
	imageTag := req.Image
	branch := req.Branch
	if branch == "" {
		branch = defaultGitBranch
	}

	if req.GitRepo != "" {
		dockerfileRel := req.DockerfilePath
		if dockerfileRel == "" {
			dockerfileRel = defaultDockerfilePath
		}
		tmpDir, err := os.MkdirTemp("", "mw-preview-*")
		if err != nil {
			return PreviewDeployResponse{}, fmt.Errorf("create preview build workspace: %w", err)
		}
		defer os.RemoveAll(tmpDir)

		gitBin := env("GIT_BIN", "git")
		if out, err := m.runner(ctx, gitBin, "clone", "--depth", "1", "--branch", branch, "--", req.GitRepo, tmpDir); err != nil {
			return PreviewDeployResponse{}, fmt.Errorf("git clone failed: %w (%s)", err, strings.TrimSpace(out))
		}

		shortSha := "preview"
		if shaOut, err := m.runner(ctx, gitBin, "-C", tmpDir, "rev-parse", "--short=12", "HEAD"); err == nil {
			candidate := strings.TrimSpace(shaOut)
			if gitShortShaPattern.MatchString(candidate) {
				shortSha = strings.ToLower(candidate)
			}
		}

		imageTag = fmt.Sprintf("mw-paas-%s:%s", previewSlug, shortSha)
		dockerfileFull := filepath.Join(tmpDir, filepath.FromSlash(dockerfileRel))
		if out, err := m.runner(ctx, m.dockerBin, "build", "-f", dockerfileFull, "-t", imageTag, tmpDir); err != nil {
			return PreviewDeployResponse{}, fmt.Errorf("docker build failed: %w (%s)", err, strings.TrimSpace(out))
		}
	}

	prevApp, hasPrevErr := m.getAppFromDB(previewSlug)
	hasPrev := hasPrevErr == nil

	// Candidate container name stays within 64 chars.
	suffix := fmt.Sprintf("-bg-%d", time.Now().UTC().Unix()%1000000)
	baseName := PaasContainerName(previewSlug)
	if len(baseName)+len(suffix) > 64 {
		baseName = strings.TrimRight(baseName[:64-len(suffix)], "-")
	}
	candidateName := baseName + suffix

	deployReq := PaasDeployRequest{
		Slug:     previewSlug,
		TenantID: req.TenantID,
		Image:    imageTag,
		Port:     req.Port,
		Domain:   req.Domain,
		Env:      req.Env,
		GitRepo:  req.GitRepo,
	}
	runArgs := m.buildDockerRunArgs(deployReq, candidateName)
	runArgs = append(runArgs[:len(runArgs)-1], "--label", "mw.paas.preview=true", runArgs[len(runArgs)-1])

	out, err := m.runner(ctx, m.dockerBin, runArgs...)
	if err != nil {
		return PreviewDeployResponse{}, fmt.Errorf("candidate docker run failed: %w", err)
	}
	candidateID := strings.TrimSpace(out)
	if len(candidateID) > 12 {
		candidateID = candidateID[:12]
	}

	healthPath := req.HealthcheckPath
	if healthPath == "" {
		healthPath = "/health"
	}
	if m.healthProber != nil {
		probeURL := fmt.Sprintf("http://%s:%d%s", candidateName, req.Port, healthPath)
		if err := m.healthProber(ctx, probeURL); err != nil {
			// Rollback unhealthy candidate immediately without touching DB or Caddy.
			_, _ = m.runner(ctx, m.dockerBin, "rm", "-f", candidateName)
			return PreviewDeployResponse{}, fmt.Errorf("%w (%s): %v", errPreviewUnhealthy, probeURL, err)
		}
	} else {
		if err := m.probeCandidateContainer(ctx, candidateName, req.Port, healthPath); err != nil {
			// Rollback unhealthy candidate immediately without touching DB or Caddy.
			_, _ = m.runner(ctx, m.dockerBin, "rm", "-f", candidateName)
			return PreviewDeployResponse{}, fmt.Errorf("%w (%s): %v", errPreviewUnhealthy, candidateName, err)
		}
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
	`, previewSlug, req.TenantID, imageTag, req.Port, req.Domain, string(envBytes), req.GitRepo, candidateName, candidateID); err != nil {
		_, _ = m.runner(ctx, m.dockerBin, "rm", "-f", candidateName)
		return PreviewDeployResponse{}, fmt.Errorf("persist preview paas_apps: %w", err)
	}

	if err := m.syncCaddyRoutes(ctx); err != nil {
		// Rollback candidate container if Caddy atomic swap fails.
		_, _ = m.runner(ctx, m.dockerBin, "rm", "-f", candidateName)
		if hasPrev {
			prevEnvBytes, _ := json.Marshal(prevApp.Env)
			if len(prevApp.Env) == 0 {
				prevEnvBytes = []byte("{}")
			}
			_, _ = m.db.Exec(`
				UPDATE paas_apps SET image=?, port=?, domain=?, env_json=?, container_name=?, container_id=?, status=?, updated_at=datetime('now')
				WHERE slug=?
			`, prevApp.Image, prevApp.Port, prevApp.Domain, string(prevEnvBytes), prevApp.ContainerName, prevApp.ContainerID, prevApp.Status, previewSlug)
		} else {
			_, _ = m.db.Exec(`DELETE FROM paas_apps WHERE slug=?`, previewSlug)
		}
		return PreviewDeployResponse{}, fmt.Errorf("caddy atomic swap failed (rolled back candidate): %w", err)
	}

	// Drain and remove previous container only AFTER healthcheck + Caddy swap succeeded.
	var prevContainer string
	if hasPrev && prevApp.ContainerName != "" && prevApp.ContainerName != candidateName {
		prevContainer = prevApp.ContainerName
		_, _ = m.runner(ctx, m.dockerBin, "stop", prevContainer)
		_, _ = m.runner(ctx, m.dockerBin, "rm", "-f", prevContainer)
	}

	return PreviewDeployResponse{
		Status:            "deployed",
		PreviewSlug:       previewSlug,
		Image:             imageTag,
		Branch:            req.Branch,
		PRNumber:          req.PRNumber,
		ContainerName:     candidateName,
		ContainerID:       candidateID,
		PreviousContainer: prevContainer,
		HealthStatus:      "healthy",
		Domain:            req.Domain,
	}, nil
}

func (m *PaasManager) probeCandidateContainer(ctx context.Context, candidateName string, port int, healthPath string) error {
	client := &http.Client{
		Timeout: 2 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	deadline := time.Now().Add(8 * time.Second)
	var lastErr error

	for {
		out, err := m.runner(ctx, m.dockerBin, "inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", candidateName)
		if err != nil {
			lastErr = fmt.Errorf("inspect candidate IP: %w", err)
		} else {
			var targetIP net.IP
			for _, field := range strings.Fields(out) {
				ip := net.ParseIP(strings.TrimSpace(field))
				if ip == nil || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
					continue
				}
				if ip.IsPrivate() || ip.IsLoopback() || IsPrivateMeshIP(ip) {
					targetIP = ip
					break
				}
			}
			if targetIP == nil {
				lastErr = errors.New("candidate container has no private network IP")
			} else {
				targetURL := fmt.Sprintf("http://%s%s", net.JoinHostPort(targetIP.String(), strconv.Itoa(port)), healthPath)
				req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
				if reqErr != nil {
					return reqErr
				}
				resp, doErr := client.Do(req)
				if doErr != nil {
					lastErr = doErr
				} else {
					_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
					_ = resp.Body.Close()
					if resp.StatusCode >= 200 && resp.StatusCode < 300 {
						return nil
					}
					lastErr = fmt.Errorf("candidate returned status %d", resp.StatusCode)
				}
			}
		}

		if time.Now().After(deadline) {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(400 * time.Millisecond):
		}
	}
	if lastErr == nil {
		lastErr = errors.New("candidate healthcheck timed out")
	}
	return lastErr
}
