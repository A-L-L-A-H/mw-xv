package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultUpdateRepo        = "A-L-L-A-H/mw-xv"
	defaultUpdateAPIBase     = "https://api.github.com"
	defaultUpdateComposeFile = "deploy/compose/docker-compose.production.yml"
	defaultUpdateCacheTTL    = 5 * time.Minute
	maxSelfUpdateLogBytes    = 16 * 1024
)

var releaseSemverPattern = regexp.MustCompile(`^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$`)

type parsedSemver struct {
	Major      int
	Minor      int
	Patch      int
	Prerelease int // -1 for stable
}

func parseReleaseSemver(raw string) (parsedSemver, string, error) {
	trimmed := strings.TrimSpace(raw)
	m := releaseSemverPattern.FindStringSubmatch(trimmed)
	if m == nil {
		return parsedSemver{}, "", fmt.Errorf("invalid release version %q", raw)
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])
	pre := -1
	canonical := fmt.Sprintf("v%d.%d.%d", major, minor, patch)
	if m[4] != "" {
		pre, _ = strconv.Atoi(m[4])
		canonical = fmt.Sprintf("%s-rc.%d", canonical, pre)
	}
	return parsedSemver{Major: major, Minor: minor, Patch: patch, Prerelease: pre}, canonical, nil
}

// compareReleaseSemver returns -1 if a < b, 0 if a == b, +1 if a > b.
func compareReleaseSemver(a, b parsedSemver) int {
	if a.Major != b.Major {
		if a.Major < b.Major {
			return -1
		}
		return 1
	}
	if a.Minor != b.Minor {
		if a.Minor < b.Minor {
			return -1
		}
		return 1
	}
	if a.Patch != b.Patch {
		if a.Patch < b.Patch {
			return -1
		}
		return 1
	}
	if a.Prerelease == b.Prerelease {
		return 0
	}
	// Stable (-1) is always newer than any prerelease of the same major.minor.patch.
	if a.Prerelease == -1 {
		return 1
	}
	if b.Prerelease == -1 {
		return -1
	}
	if a.Prerelease < b.Prerelease {
		return -1
	}
	return 1
}

// SelfUpdateStatus is the Coolify-style platform update state returned by
// GET /paas/system/update and POST /paas/system/update/apply.
type SelfUpdateStatus struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	Channel         string `json:"channel"`
	ReleaseURL      string `json:"releaseUrl,omitempty"`
	PublishedAt     string `json:"publishedAt,omitempty"`
	ReleaseNotes    string `json:"releaseNotes,omitempty"`
	CheckedAt       string `json:"checkedAt,omitempty"`
	Status          string `json:"status"` // idle | updating | restarting | succeeded | failed
	TargetVersion   string `json:"targetVersion,omitempty"`
	LastUpdateLog   string `json:"lastUpdateLog,omitempty"`
	LastError       string `json:"lastError,omitempty"`
	ComposeFile     string `json:"composeFile"`
	CanApply        bool   `json:"canApply"`
}

type githubReleaseEntry struct {
	TagName     string `json:"tag_name"`
	HTMLURL     string `json:"html_url"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
	PublishedAt string `json:"published_at"`
	Body        string `json:"body"`
}

// envCommandRunner executes a command with extra environment variables (zero shell interpolation).
type envCommandRunner func(ctx context.Context, extraEnv []string, name string, args ...string) (string, error)

func runCmdWithExtraEnv(ctx context.Context, extraEnv []string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	if len(extraEnv) > 0 {
		cmd.Env = append(os.Environ(), extraEnv...)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

type selfUpdater struct {
	mu             sync.Mutex
	currentVersion string
	repo           string
	apiBase        string
	channel        string
	githubToken    string
	composeFile    string
	updateScript   string
	dockerBin      string
	httpClient     *http.Client
	runCmd         envCommandRunner
	cacheTTL       time.Duration

	lastCheckAt  time.Time
	latestTag    string
	releaseURL   string
	publishedAt  string
	releaseNotes string
	checkError   string

	status        string
	targetVersion string
	lastUpdateLog string
	lastError     string
}

func detectRunningVersion() string {
	for _, key := range []string{"MW_VERSION", "MOONWITNESS_VERSION"} {
		if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
			if _, canonical, err := parseReleaseSemver(raw); err == nil {
				return canonical
			}
		}
	}
	if data, err := os.ReadFile("package.json"); err == nil {
		var pkg struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(data, &pkg) == nil {
			if _, canonical, err := parseReleaseSemver(pkg.Version); err == nil {
				return canonical
			}
		}
	}
	return "v1.0.0-rc.1"
}

func newSelfUpdaterFromEnv(dockerBin string) *selfUpdater {
	current := detectRunningVersion()
	channel := strings.ToLower(strings.TrimSpace(env("MW_UPDATE_CHANNEL", "auto")))
	if channel != "stable" && channel != "rc" && channel != "auto" {
		channel = "auto"
	}
	return &selfUpdater{
		currentVersion: current,
		repo:           env("MW_UPDATE_REPO", defaultUpdateRepo),
		apiBase:        strings.TrimRight(env("MW_UPDATE_API_BASE", defaultUpdateAPIBase), "/"),
		channel:        channel,
		githubToken:    strings.TrimSpace(os.Getenv("MW_UPDATE_GITHUB_TOKEN")),
		composeFile:    env("MW_COMPOSE_FILE", defaultUpdateComposeFile),
		updateScript:   strings.TrimSpace(os.Getenv("MW_SELF_UPDATE_SCRIPT")),
		dockerBin:      dockerBin,
		httpClient:     &http.Client{Timeout: 10 * time.Second},
		runCmd:         runCmdWithExtraEnv,
		cacheTTL:       defaultUpdateCacheTTL,
		status:         "idle",
	}
}

func (u *selfUpdater) snapshotLocked() SelfUpdateStatus {
	curParsed, curCanon, curErr := parseReleaseSemver(u.currentVersion)
	if curErr != nil {
		curCanon = u.currentVersion
	}
	latestCanon := u.latestTag
	updateAvailable := false
	if latestCanon != "" && curErr == nil {
		if latestParsed, norm, err := parseReleaseSemver(latestCanon); err == nil {
			latestCanon = norm
			updateAvailable = compareReleaseSemver(latestParsed, curParsed) > 0
		}
	}
	lastErr := u.lastError
	if lastErr == "" && u.checkError != "" {
		lastErr = u.checkError
	}
	return SelfUpdateStatus{
		CurrentVersion:  curCanon,
		LatestVersion:   latestCanon,
		UpdateAvailable: updateAvailable,
		Channel:         u.channel,
		ReleaseURL:      u.releaseURL,
		PublishedAt:     u.publishedAt,
		ReleaseNotes:    u.releaseNotes,
		CheckedAt:       formatOptionalTime(u.lastCheckAt),
		Status:          u.status,
		TargetVersion:   u.targetVersion,
		LastUpdateLog:   u.lastUpdateLog,
		LastError:       lastErr,
		ComposeFile:     u.composeFile,
		CanApply:        u.status != "updating" && u.status != "restarting",
	}
}

func formatOptionalTime(ts time.Time) string {
	if ts.IsZero() {
		return ""
	}
	return ts.UTC().Format(time.RFC3339)
}

func (u *selfUpdater) selectBestRelease(entries []githubReleaseEntry, current parsedSemver) *githubReleaseEntry {
	includePrerelease := u.channel == "rc" || (u.channel == "auto" && current.Prerelease >= 0)
	var bestStable *githubReleaseEntry
	var bestStableVer parsedSemver
	var bestAny *githubReleaseEntry
	var bestAnyVer parsedSemver

	for i := range entries {
		entry := &entries[i]
		if entry.Draft {
			continue
		}
		ver, _, err := parseReleaseSemver(entry.TagName)
		if err != nil {
			continue
		}
		if !entry.Prerelease && ver.Prerelease == -1 {
			if bestStable == nil || compareReleaseSemver(ver, bestStableVer) > 0 {
				bestStable = entry
				bestStableVer = ver
			}
		}
		if bestAny == nil || compareReleaseSemver(ver, bestAnyVer) > 0 {
			bestAny = entry
			bestAnyVer = ver
		}
	}

	if u.channel == "stable" {
		return bestStable
	}
	if includePrerelease || bestStable == nil {
		return bestAny
	}
	return bestStable
}

func (u *selfUpdater) Check(ctx context.Context, force bool) SelfUpdateStatus {
	u.mu.Lock()
	if !force && !u.lastCheckAt.IsZero() && time.Since(u.lastCheckAt) < u.cacheTTL {
		snap := u.snapshotLocked()
		u.mu.Unlock()
		return snap
	}
	repo := u.repo
	apiBase := u.apiBase
	token := u.githubToken
	client := u.httpClient
	curVer, _, _ := parseReleaseSemver(u.currentVersion)
	u.mu.Unlock()

	endpoint := fmt.Sprintf("%s/repos/%s/releases?per_page=15", apiBase, repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		u.mu.Lock()
		u.checkError = err.Error()
		snap := u.snapshotLocked()
		u.mu.Unlock()
		return snap
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "moonwitness-control-plane")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		u.mu.Lock()
		u.checkError = fmt.Sprintf("release check failed: %v", err)
		snap := u.snapshotLocked()
		u.mu.Unlock()
		return snap
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if readErr != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		u.mu.Lock()
		if readErr != nil {
			u.checkError = fmt.Sprintf("read release response: %v", readErr)
		} else {
			u.checkError = fmt.Sprintf("github releases returned HTTP %d", resp.StatusCode)
		}
		snap := u.snapshotLocked()
		u.mu.Unlock()
		return snap
	}

	var entries []githubReleaseEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		u.mu.Lock()
		u.checkError = fmt.Sprintf("parse github releases: %v", err)
		snap := u.snapshotLocked()
		u.mu.Unlock()
		return snap
	}

	best := u.selectBestRelease(entries, curVer)
	u.mu.Lock()
	u.lastCheckAt = time.Now().UTC()
	u.checkError = ""
	if best != nil {
		_, canonical, err := parseReleaseSemver(best.TagName)
		if err == nil {
			u.latestTag = canonical
		} else {
			u.latestTag = best.TagName
		}
		u.releaseURL = best.HTMLURL
		u.publishedAt = best.PublishedAt
		notes := strings.TrimSpace(best.Body)
		if len(notes) > 1200 {
			notes = notes[:1200] + "..."
		}
		u.releaseNotes = notes
	} else {
		u.latestTag = ""
		u.releaseURL = ""
		u.publishedAt = ""
		u.releaseNotes = ""
	}
	snap := u.snapshotLocked()
	u.mu.Unlock()
	return snap
}

func truncateUpdateLog(raw string) string {
	clean := RedactPaasText(raw)
	if len(clean) <= maxSelfUpdateLogBytes {
		return clean
	}
	return "...(truncated)\n" + clean[len(clean)-maxSelfUpdateLogBytes:]
}

func (u *selfUpdater) Apply(ctx context.Context, requestedVersion string) (SelfUpdateStatus, int, error) {
	var targetTag string
	if strings.TrimSpace(requestedVersion) != "" {
		_, canonical, err := parseReleaseSemver(requestedVersion)
		if err != nil {
			return SelfUpdateStatus{}, http.StatusBadRequest, err
		}
		targetTag = canonical
	} else {
		checked := u.Check(ctx, false)
		if checked.LatestVersion == "" {
			return checked, http.StatusConflict, errors.New("no published release detected yet; wait for release or specify a version")
		}
		targetTag = checked.LatestVersion
	}

	u.mu.Lock()
	if u.status == "updating" || u.status == "restarting" {
		snap := u.snapshotLocked()
		u.mu.Unlock()
		return snap, http.StatusConflict, errors.New("a system update is already in progress")
	}
	u.status = "updating"
	u.targetVersion = targetTag
	u.lastError = ""
	u.lastUpdateLog = fmt.Sprintf("[%s] Starting MoonWitness self-update to %s...\n", time.Now().UTC().Format(time.RFC3339), targetTag)
	snap := u.snapshotLocked()
	u.mu.Unlock()

	go u.executeUpdate(targetTag)
	return snap, http.StatusAccepted, nil
}

func (u *selfUpdater) appendLog(line string) {
	u.mu.Lock()
	u.lastUpdateLog = truncateUpdateLog(u.lastUpdateLog + line)
	u.mu.Unlock()
}

func (u *selfUpdater) executeUpdate(targetTag string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	extraEnv := []string{
		"MW_TARGET_VERSION=" + targetTag,
		"MW_IMAGE_TAG=" + targetTag,
		"MW_VERSION=" + targetTag,
	}

	if u.updateScript != "" {
		u.appendLog(fmt.Sprintf("Running custom updater script %s for %s...\n", u.updateScript, targetTag))
		out, err := u.runCmd(ctx, extraEnv, u.updateScript, targetTag)
		if out != "" {
			u.appendLog(out + "\n")
		}
		u.finishUpdate(targetTag, err)
		return
	}

	u.appendLog(fmt.Sprintf("Pulling release images for %s via %s...\n", targetTag, u.composeFile))
	pullOut, err := u.runCmd(ctx, extraEnv, u.dockerBin, "compose", "-f", u.composeFile, "pull")
	if pullOut != "" {
		u.appendLog(pullOut + "\n")
	}
	if err != nil {
		u.finishUpdate(targetTag, fmt.Errorf("docker compose pull failed: %w", err))
		return
	}

	u.mu.Lock()
	u.status = "restarting"
	u.mu.Unlock()
	u.appendLog("Recreating and restarting services via docker compose up -d --remove-orphans...\n")

	upOut, err := u.runCmd(ctx, extraEnv, u.dockerBin, "compose", "-f", u.composeFile, "up", "-d", "--remove-orphans")
	if upOut != "" {
		u.appendLog(upOut + "\n")
	}
	if err != nil {
		u.finishUpdate(targetTag, fmt.Errorf("docker compose up failed: %w", err))
		return
	}

	u.finishUpdate(targetTag, nil)
}

func (u *selfUpdater) finishUpdate(targetTag string, err error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if err != nil {
		u.status = "failed"
		u.lastError = RedactPaasText(err.Error())
		u.lastUpdateLog = truncateUpdateLog(u.lastUpdateLog + "ERROR: " + u.lastError + "\n")
		return
	}
	u.currentVersion = targetTag
	u.status = "succeeded"
	u.lastError = ""
	u.lastUpdateLog = truncateUpdateLog(u.lastUpdateLog + fmt.Sprintf("[%s] Update to %s completed.\n", time.Now().UTC().Format(time.RFC3339), targetTag))
}

func (u *selfUpdater) handleStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		force := r.URL.Query().Get("force") == "true" || r.URL.Query().Get("force") == "1"
		status := u.Check(r.Context(), force)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(status)
	}
}

func (u *selfUpdater) handleApply() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Version string `json:"version"`
		}
		if r.Body != nil {
			dec := json.NewDecoder(io.LimitReader(r.Body, 4096))
			if err := dec.Decode(&body); err != nil && !errors.Is(err, io.EOF) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON body"})
				return
			}
		}
		status, code, err := u.Apply(r.Context(), body.Version)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(code)
		if err != nil {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error":  err.Error(),
				"status": status,
			})
			return
		}
		_ = json.NewEncoder(w).Encode(status)
	}
}
