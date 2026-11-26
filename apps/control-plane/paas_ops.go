package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	pgIdentifierPattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$`)
	backupIDPattern     = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
)

// StreamCommandRunner invokes an external command and streams combined stdout/stderr
// line-by-line to onLine until EOF or context cancellation.
type StreamCommandRunner func(ctx context.Context, onLine func(line string) bool, name string, args ...string) error

// BinaryCommandRunner invokes an external command and returns raw stdout bytes.
type BinaryCommandRunner func(ctx context.Context, name string, args ...string) ([]byte, error)

// StdinCommandRunner invokes an external command with raw bytes piped to stdin.
type StdinCommandRunner func(ctx context.Context, stdin []byte, name string, args ...string) (string, error)

// HealthProber performs an HTTP healthcheck probe against a candidate container URL.
type HealthProber func(ctx context.Context, url string) error

// runCmdStreamLines runs a command with exec.CommandContext (zero shell interpolation)
// and streams combined stdout/stderr lines to onLine until completion or ctx cancellation.
func runCmdStreamLines(ctx context.Context, onLine func(line string) bool, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	pr, pw, err := os.Pipe()
	if err != nil {
		return fmt.Errorf("create pipe: %w", err)
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		_ = pr.Close()
		_ = pw.Close()
		return fmt.Errorf("start %s: %w", name, err)
	}
	_ = pw.Close()

	scanner := bufio.NewScanner(pr)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		if ctx.Err() != nil {
			break
		}
		if !onLine(scanner.Text()) {
			break
		}
	}
	_ = pr.Close()
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if scanErr := scanner.Err(); scanErr != nil {
		return scanErr
	}
	return waitErr
}

// runCmdBinaryOutput executes a command and returns raw stdout bytes, capturing stderr on error.
func runCmdBinaryOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return nil, fmt.Errorf("%w: %s", err, msg)
		}
		return nil, err
	}
	return stdout.Bytes(), nil
}

// runCmdWithStdin executes a command with stdin piped from memory.
func runCmdWithStdin(ctx context.Context, stdin []byte, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = bytes.NewReader(stdin)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// defaultHTTPHealthProbe probes rawURL with HTTP GET and requires a 2xx response.
// rawURL must be a valid, absolute HTTPS URL pointing exclusively to public,
// non-loopback, non-internal addresses, with DNS resolution pinned to the
// validated IP at dial time and redirects disabled.
func defaultHTTPHealthProbe(ctx context.Context, rawURL string) error {
	return probeHTTPSURL(
		ctx,
		rawURL,
		net.DefaultResolver.LookupIPAddr,
		(&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		nil,
	)
}

func probeHTTPSURL(
	ctx context.Context,
	rawURL string,
	lookupIP func(context.Context, string) ([]net.IPAddr, error),
	dialContext func(context.Context, string, string) (net.Conn, error),
	rootCAs *x509.CertPool,
) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if parsed.Scheme != "https" {
		return fmt.Errorf("healthcheck URL must use HTTPS scheme")
	}
	if parsed.User != nil {
		return fmt.Errorf("healthcheck URL must not contain userinfo")
	}
	if parsed.Host == "" {
		return fmt.Errorf("healthcheck URL must include a host")
	}
	hostname := parsed.Hostname()
	if hostname == "" || isBlockedProbeHostname(hostname) {
		return fmt.Errorf("healthcheck URL must not target internal addresses")
	}

	verifiedIP, err := resolveVerifiedPublicIP(ctx, hostname, lookupIP)
	if err != nil {
		return err
	}

	port := "443"
	if rawPort := parsed.Port(); rawPort != "" {
		portNum, convErr := strconv.Atoi(rawPort)
		if convErr != nil || portNum < 1 || portNum > 65535 {
			return fmt.Errorf("healthcheck URL has invalid port")
		}
		port = strconv.Itoa(portNum)
	}

	pinnedAddr := net.JoinHostPort(verifiedIP.String(), port)
	transport := &http.Transport{
		DialContext: func(dialCtx context.Context, network, _ string) (net.Conn, error) {
			return dialContext(dialCtx, network, pinnedAddr)
		},
		TLSClientConfig: &tls.Config{
			ServerName: hostname,
			MinVersion: tls.VersionTLS12,
			RootCAs:    rootCAs,
		},
		DisableKeepAlives: true,
	}
	defer transport.CloseIdleConnections()

	client := &http.Client{
		Timeout:   5 * time.Second,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	targetURL := url.URL{
		Scheme:   "https",
		Host:     pinnedAddr,
		Path:     parsed.Path,
		RawPath:  parsed.RawPath,
		RawQuery: parsed.RawQuery,
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL.String(), nil)
	if err != nil {
		return err
	}
	req.Host = parsed.Host

	resp, err := client.Do(req) // lgtm[go/request-forgery]
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("healthcheck returned status %d", resp.StatusCode)
	}
	return nil
}

func isBlockedProbeHostname(hostname string) bool {
	h := strings.ToLower(strings.TrimSpace(hostname))
	return h == "" ||
		h == "localhost" ||
		strings.HasSuffix(h, ".localhost") ||
		strings.HasSuffix(h, ".local") ||
		strings.HasSuffix(h, ".internal")
}

func resolveVerifiedPublicIP(
	ctx context.Context,
	hostname string,
	lookupIP func(context.Context, string) ([]net.IPAddr, error),
) (net.IP, error) {
	addrs, err := lookupIP(ctx, hostname)
	if err != nil || len(addrs) == 0 {
		return nil, fmt.Errorf("healthcheck URL must not target internal addresses")
	}
	var verifiedIP net.IP
	for _, addr := range addrs {
		ip := addr.IP
		if isDisallowedProbeIP(ip) {
			return nil, fmt.Errorf("healthcheck URL must not target internal addresses")
		}
		if ip4 := ip.To4(); ip4 != nil {
			ip = ip4
		}
		if verifiedIP == nil {
			verifiedIP = ip
		}
	}
	if verifiedIP == nil {
		return nil, fmt.Errorf("healthcheck URL must not target internal addresses")
	}
	return verifiedIP, nil
}

// isDisallowedProbeIP returns true for any non-public IP address including
// loopback, link-local, private RFC 1918 / RFC 4193, unspecified, multicast,
// and canonical private EasyTier mesh ranges.
func isDisallowedProbeIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() ||
		ip.IsUnspecified() ||
		ip.IsMulticast() ||
		IsPrivateMeshIP(ip)
}

// handleAppLogsStream streams `docker logs --follow --timestamps --tail N <container>`
// as Server-Sent Events (text/event-stream) with secret redaction and context cancellation.
func (m *PaasManager) handleAppLogsStream(w http.ResponseWriter, r *http.Request, slug string) {
	tail := paasDefaultLogLines
	if raw := strings.TrimSpace(r.URL.Query().Get("tail")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "tail must be a positive integer (max 500)"})
			return
		}
		if n > paasMaxLogLines {
			n = paasMaxLogLines
		}
		tail = n
	}

	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}
	if err := ValidateContainerName(app.ContainerName); err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	secrets := collectEnvSecrets(app.Env)
	runner := m.streamRunner
	if runner == nil {
		runner = runCmdStreamLines
	}

	streamErr := runner(r.Context(), func(line string) bool {
		redacted := RedactPaasText(line, secrets...)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", redacted); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}, m.dockerBin, "logs", "--follow", "--timestamps", "--tail", strconv.Itoa(tail), app.ContainerName)

	if streamErr != nil && r.Context().Err() == nil {
		redactedErr := RedactPaasText(streamErr.Error(), secrets...)
		_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", redactedErr)
		flusher.Flush()
	}
}

// PaasContainerStats holds parsed live resource usage metrics for a PaaS container.
type PaasContainerStats struct {
	Slug          string  `json:"slug"`
	ContainerName string  `json:"containerName"`
	ContainerID   string  `json:"containerId,omitempty"`
	CPUPercent    float64 `json:"cpuPercent"`
	CPUPercRaw    string  `json:"cpuPercRaw"`
	MemUsage      string  `json:"memUsage"`
	MemLimit      string  `json:"memLimit"`
	MemPercent    float64 `json:"memPercent"`
	NetRx         string  `json:"netRx"`
	NetTx         string  `json:"netTx"`
	NetIO         string  `json:"netIO"`
	BlockRead     string  `json:"blockRead"`
	BlockWrite    string  `json:"blockWrite"`
	BlockIO       string  `json:"blockIO"`
	PIDs          int     `json:"pids"`
}

type dockerStatsRaw struct {
	ID       string `json:"ID"`
	Name     string `json:"Name"`
	CPUPerc  string `json:"CPUPerc"`
	MemUsage string `json:"MemUsage"`
	MemPerc  string `json:"MemPerc"`
	NetIO    string `json:"NetIO"`
	BlockIO  string `json:"BlockIO"`
	PIDs     string `json:"PIDs"`
}

func parsePercentField(raw string) float64 {
	cleaned := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), "%"))
	v, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return 0
	}
	return v
}

func splitPairField(raw string) (string, string) {
	parts := strings.SplitN(raw, "/", 2)
	if len(parts) != 2 {
		return strings.TrimSpace(raw), ""
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
}

// parseDockerStatsJSON parses a single JSON line from `docker stats --no-stream --format json`.
func parseDockerStatsJSON(slug, containerName, raw string) (PaasContainerStats, error) {
	line := strings.TrimSpace(raw)
	if idx := strings.IndexByte(line, '\n'); idx >= 0 {
		line = strings.TrimSpace(line[:idx])
	}
	if line == "" {
		return PaasContainerStats{}, errors.New("empty docker stats output")
	}
	var parsed dockerStatsRaw
	if err := json.Unmarshal([]byte(line), &parsed); err != nil {
		return PaasContainerStats{}, fmt.Errorf("parse docker stats json: %w", err)
	}
	memUsed, memLimit := splitPairField(parsed.MemUsage)
	netRx, netTx := splitPairField(parsed.NetIO)
	blockRead, blockWrite := splitPairField(parsed.BlockIO)
	pids, _ := strconv.Atoi(strings.TrimSpace(parsed.PIDs))

	return PaasContainerStats{
		Slug:          slug,
		ContainerName: containerName,
		ContainerID:   strings.TrimSpace(parsed.ID),
		CPUPercent:    parsePercentField(parsed.CPUPerc),
		CPUPercRaw:    strings.TrimSpace(parsed.CPUPerc),
		MemUsage:      memUsed,
		MemLimit:      memLimit,
		MemPercent:    parsePercentField(parsed.MemPerc),
		NetRx:         netRx,
		NetTx:         netTx,
		NetIO:         strings.TrimSpace(parsed.NetIO),
		BlockRead:     blockRead,
		BlockWrite:    blockWrite,
		BlockIO:       strings.TrimSpace(parsed.BlockIO),
		PIDs:          pids,
	}, nil
}

// handleAppStats handles GET /paas/apps/{slug}/stats.
func (m *PaasManager) handleAppStats(w http.ResponseWriter, r *http.Request, slug string) {
	app, err := m.getAppFromDB(slug)
	if err != nil {
		writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "app not found"})
		return
	}
	if err := ValidateContainerName(app.ContainerName); err != nil {
		writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	out, err := m.runner(ctx, m.dockerBin, "stats", "--no-stream", "--format", "json", app.ContainerName)
	if err != nil {
		writePaasJSON(w, http.StatusBadGateway, map[string]string{
			"error": RedactPaasText(err.Error(), collectEnvSecrets(app.Env)...),
		})
		return
	}

	stats, err := parseDockerStatsJSON(slug, app.ContainerName, out)
	if err != nil {
		writePaasJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writePaasJSON(w, http.StatusOK, stats)
}

// BackupPostgresRequest is the optional payload for POST /paas/backups/postgres.
type BackupPostgresRequest struct {
	Container string `json:"container,omitempty"`
	User      string `json:"user,omitempty"`
	Database  string `json:"database,omitempty"`
}

// BackupManifest describes a stored PostgreSQL backup archive and its SHA-256 digest.
type BackupManifest struct {
	ID        string `json:"id"`
	Container string `json:"container"`
	User      string `json:"user"`
	Database  string `json:"database"`
	Format    string `json:"format"`
	SizeBytes int64  `json:"sizeBytes"`
	SHA256    string `json:"sha256"`
	CreatedAt string `json:"createdAt"`
	Filename  string `json:"filename"`
}

// RestoreBackupRequest is the payload for POST /paas/backups/restore.
type RestoreBackupRequest struct {
	ID        string `json:"id"`
	Container string `json:"container,omitempty"`
	User      string `json:"user,omitempty"`
	Database  string `json:"database,omitempty"`
	DryRun    bool   `json:"dryRun,omitempty"`
}

func validatePgIdentifier(field, value string) error {
	if value == "" {
		return fmt.Errorf("%s is required", field)
	}
	if !pgIdentifierPattern.MatchString(value) {
		return fmt.Errorf("invalid %s: %q", field, value)
	}
	return nil
}

// ValidateBackupID enforces strict backup ID validation with zero path traversal.
func ValidateBackupID(id string) error {
	if id == "" {
		return errors.New("backup id is required")
	}
	if strings.Contains(id, "..") || strings.ContainsAny(id, `/\`) || strings.HasPrefix(id, ".") {
		return fmt.Errorf("invalid backup id: %q", id)
	}
	if !backupIDPattern.MatchString(id) {
		return fmt.Errorf("invalid backup id: %q", id)
	}
	return nil
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	// Guard against path injection: the resolved path must be absolute and
	// must not escape its directory via ".." segments.
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) || strings.Contains(clean, "..") {
		return fmt.Errorf("refusing to write outside resolved path: %s", path)
	}
	path = clean
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create dir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("chmod temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("close temp file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp file: %w", err)
	}
	return nil
}

func (m *PaasManager) resolvedBackupDir() string {
	if strings.TrimSpace(m.backupDir) != "" {
		return m.backupDir
	}
	return env("MW_PAAS_BACKUP_DIR", "./backups")
}

// handleBackupPostgres handles POST /paas/backups/postgres.
func (m *PaasManager) handleBackupPostgres() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		var req BackupPostgresRequest
		if r.Body != nil {
			if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
				writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
				return
			}
		}

		container := strings.TrimSpace(req.Container)
		if container == "" {
			container = env("MW_PAAS_PG_CONTAINER", "moonwitness-postgres")
		}
		pgUser := strings.TrimSpace(req.User)
		if pgUser == "" {
			pgUser = env("MW_PAAS_PG_USER", "postgres")
		}
		pgDB := strings.TrimSpace(req.Database)
		if pgDB == "" {
			pgDB = env("MW_PAAS_PG_DB", "moonwitness_db")
		}

		if err := ValidateContainerName(container); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := validatePgIdentifier("user", pgUser); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := validatePgIdentifier("database", pgDB); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()

		binRunner := m.binaryRunner
		if binRunner == nil {
			binRunner = runCmdBinaryOutput
		}

		dumpBytes, err := binRunner(ctx, m.dockerBin, "exec", container, "pg_dump", "-U", pgUser, "-d", pgDB, "--format=custom")
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "pg_dump failed: " + RedactPaasText(err.Error()),
			})
			return
		}
		if len(dumpBytes) == 0 {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "pg_dump produced empty output"})
			return
		}

		sum := sha256.Sum256(dumpBytes)
		checksum := hex.EncodeToString(sum[:])

		now := time.Now().UTC()
		randBuf := make([]byte, 4)
		_, _ = rand.Read(randBuf)
		backupID := fmt.Sprintf("pg-%s-%s-%s", pgDB, now.Format("20060102T150405Z"), hex.EncodeToString(randBuf))

		backupDir := m.resolvedBackupDir()
		dumpFilename := backupID + ".dump"
		dumpPath := filepath.Join(backupDir, dumpFilename)
		metaPath := filepath.Join(backupDir, backupID+".meta.json")

		manifest := BackupManifest{
			ID:        backupID,
			Container: container,
			User:      pgUser,
			Database:  pgDB,
			Format:    "custom",
			SizeBytes: int64(len(dumpBytes)),
			SHA256:    checksum,
			CreatedAt: now.Format(time.RFC3339),
			Filename:  dumpFilename,
		}
		metaBytes, err := json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := writeFileAtomic(dumpPath, dumpBytes, 0o600); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "write dump failed: " + err.Error()})
			return
		}
		if err := writeFileAtomic(metaPath, append(metaBytes, '\n'), 0o600); err != nil {
			_ = os.Remove(dumpPath)
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "write manifest failed: " + err.Error()})
			return
		}

		writePaasJSON(w, http.StatusCreated, manifest)
	}
}

// handleListBackups handles GET /paas/backups.
func (m *PaasManager) handleListBackups() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		backupDir := m.resolvedBackupDir()
		entries, err := os.ReadDir(backupDir)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				writePaasJSON(w, http.StatusOK, map[string]interface{}{"backups": []BackupManifest{}})
				return
			}
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		manifests := make([]BackupManifest, 0)
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".meta.json") {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(backupDir, entry.Name()))
			if err != nil {
				continue
			}
			var mf BackupManifest
			if err := json.Unmarshal(raw, &mf); err != nil {
				continue
			}
			manifests = append(manifests, mf)
		}

		sort.Slice(manifests, func(i, j int) bool {
			if manifests[i].CreatedAt != manifests[j].CreatedAt {
				return manifests[i].CreatedAt > manifests[j].CreatedAt
			}
			return manifests[i].ID > manifests[j].ID
		})

		writePaasJSON(w, http.StatusOK, map[string]interface{}{"backups": manifests})
	}
}

// handleRestoreBackup handles POST /paas/backups/restore.
func (m *PaasManager) handleRestoreBackup() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		var req RestoreBackupRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
		if err := ValidateBackupID(req.ID); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		backupDir := m.resolvedBackupDir()
		metaPath := filepath.Join(backupDir, req.ID+".meta.json")
		dumpPath := filepath.Join(backupDir, req.ID+".dump")

		metaRaw, err := os.ReadFile(metaPath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "backup manifest not found"})
				return
			}
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		var manifest BackupManifest
		if err := json.Unmarshal(metaRaw, &manifest); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "corrupt backup manifest"})
			return
		}

		dumpBytes, err := os.ReadFile(dumpPath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "backup dump file not found"})
				return
			}
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// Verify SHA-256 checksum BEFORE invoking pg_restore.
		sum := sha256.Sum256(dumpBytes)
		actualSHA := hex.EncodeToString(sum[:])
		if len(actualSHA) != len(manifest.SHA256) || subtle.ConstantTimeCompare([]byte(actualSHA), []byte(manifest.SHA256)) != 1 {
			writePaasJSON(w, http.StatusUnprocessableEntity, map[string]string{
				"error": "backup checksum mismatch: refusing to restore",
			})
			return
		}

		container := strings.TrimSpace(req.Container)
		if container == "" {
			container = manifest.Container
		}
		pgUser := strings.TrimSpace(req.User)
		if pgUser == "" {
			pgUser = manifest.User
		}
		pgDB := strings.TrimSpace(req.Database)
		if pgDB == "" {
			pgDB = manifest.Database
		}

		if err := ValidateContainerName(container); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := validatePgIdentifier("user", pgUser); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := validatePgIdentifier("database", pgDB); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		if req.DryRun {
			writePaasJSON(w, http.StatusOK, map[string]interface{}{
				"status":    "verified",
				"dryRun":    true,
				"id":        manifest.ID,
				"container": container,
				"database":  pgDB,
				"sha256":    actualSHA,
				"sizeBytes": len(dumpBytes),
			})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()

		stdinRunner := m.stdinRunner
		if stdinRunner == nil {
			stdinRunner = runCmdWithStdin
		}
		if _, err := stdinRunner(ctx, dumpBytes, m.dockerBin, "exec", "-i", container, "pg_restore", "-U", pgUser, "-d", pgDB, "--clean", "--if-exists"); err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "pg_restore failed: " + RedactPaasText(err.Error()),
			})
			return
		}

		writePaasJSON(w, http.StatusOK, map[string]interface{}{
			"status":    "restored",
			"dryRun":    false,
			"id":        manifest.ID,
			"container": container,
			"database":  pgDB,
			"sha256":    actualSHA,
			"sizeBytes": len(dumpBytes),
		})
	}
}
