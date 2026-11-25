package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	paasContainerPrefix = "mw-paas-"
)

var (
	// paasSlugPattern allows lowercase alphanumeric and hyphens, 1..48 chars,
	// starting and ending with an alphanumeric character.
	paasSlugPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$`)

	// dnsLabelPattern validates a single RFC 1123 DNS label (1..63 chars).
	dnsLabelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

	// paasContainerNamePattern validates Docker container names strictly.
	paasContainerNamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`)

	// reservedPaasSlugs protects private mesh services from ever being
	// aliased or exposed through the public PaaS reverse proxy.
	reservedPaasSlugs = map[string]bool{
		"control-plane":        true,
		"moonwitness-postgres": true,
		"postgres":             true,
		"easytier":             true,
		"caddy":                true,
		"admin":                true,
		"internal":             true,
	}

	// reservedPrivatePorts prevents accidentally proxying private control-plane
	// or database ports unless explicitly bound to an app container.
	// Note: container-internal ports are isolated per container, but we still
	// guard against exposing known private infrastructure hostnames.
	reservedPrivateDomains = []string{
		"localhost",
		".localhost",
		".local",
		".internal",
		".mesh",
		".easytier",
	}
)

// CaddyRoute represents a single public HTTPS reverse-proxy route from a
// validated domain to a private PaaS container upstream on the Docker network.
type CaddyRoute struct {
	Slug         string `json:"slug"`
	TenantID     string `json:"tenantId"`
	Domain       string `json:"domain"`
	Port         int    `json:"port"`
	UpstreamHost string `json:"upstreamHost,omitempty"`
}

// CaddyStaticRoute represents a static public HTTPS reverse-proxy route
// (such as the PaaS Web UI) appended after dynamic app routes.
type CaddyStaticRoute struct {
	Domain   string `json:"domain"`
	Upstream string `json:"upstream"`
}

func validateStaticRoute(rt CaddyStaticRoute) error {
	if err := ValidatePaasDomain(rt.Domain); err != nil {
		return fmt.Errorf("invalid static route domain: %w", err)
	}
	upstream := rt.Upstream
	if upstream == "" {
		return errors.New("static route upstream is required")
	}
	for _, r := range upstream {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("static route upstream contains control characters: %q", upstream)
		}
	}
	if strings.ContainsAny(upstream, " \t\r\n{}();#\"'`$\\/?@*") || strings.Contains(upstream, "..") {
		return fmt.Errorf("static route upstream contains forbidden characters: %q", upstream)
	}
	host, portStr, err := net.SplitHostPort(upstream)
	if err != nil {
		return fmt.Errorf("static route upstream must be host:port: %q", upstream)
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return fmt.Errorf("static route upstream host is empty: %q", upstream)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("static route upstream has invalid port: %q", upstream)
	}
	hostLower := strings.ToLower(host)
	switch hostLower {
	case "control-plane", "moonwitness-postgres", "postgres":
		return fmt.Errorf("static route upstream %q targets private mesh service", upstream)
	}
	if hostLower == "moonwitness-control-plane" && port == 3003 {
		return fmt.Errorf("static route upstream %q targets private control-plane API port", upstream)
	}
	if (hostLower == "127.0.0.1" || hostLower == "localhost" || hostLower == "::1") && (port == 3003 || port == 5432) {
		return fmt.Errorf("static route upstream %q targets private loopback service", upstream)
	}
	return nil
}

func renderCaddySiteBlock(b *strings.Builder, domain, upstream string) {
	b.WriteString("\n")
	b.WriteString(domain)
	b.WriteString(" {\n")
	b.WriteString("\tencode zstd gzip\n")
	b.WriteString("\treverse_proxy ")
	b.WriteString(upstream)
	b.WriteString(" {\n")
	b.WriteString("\t\theader_up X-Forwarded-Proto {scheme}\n")
	b.WriteString("\t\theader_up X-Real-IP {remote_host}\n")
	b.WriteString("\t}\n")
	b.WriteString("}\n")
}

// ValidateContainerName validates a Docker container name strictly against
// ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$ to prevent injection or traversal.
func ValidateContainerName(name string) error {
	if name == "" {
		return errors.New("container name is required")
	}
	if !paasContainerNamePattern.MatchString(name) {
		return fmt.Errorf("invalid container name: %q", name)
	}
	return nil
}

// ValidatePaasSlug enforces strict slug syntax to prevent container name,
// shell, path-traversal, or Caddyfile config injection.
func ValidatePaasSlug(slug string) error {
	if slug == "" {
		return errors.New("slug is required")
	}
	if strings.ContainsAny(slug, "\r\n\t \x00{}();\"'`$\\/") {
		return fmt.Errorf("slug contains forbidden characters: %q", slug)
	}
	if !paasSlugPattern.MatchString(slug) {
		return fmt.Errorf("slug must match ^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$: %q", slug)
	}
	if reservedPaasSlugs[slug] {
		return fmt.Errorf("slug %q is reserved for private mesh infrastructure", slug)
	}
	return nil
}

// ValidatePaasDomain enforces strict public DNS hostname validation and rejects
// newlines, Caddyfile directives/braces, IP literals, schemes, ports, and
// private/local domains.
func ValidatePaasDomain(domain string) error {
	if domain == "" {
		return errors.New("domain is required")
	}
	if len(domain) > 253 {
		return fmt.Errorf("domain exceeds 253 characters: %q", domain)
	}
	if strings.ContainsAny(domain, "\r\n\t \x00{}();:#\"'`$\\/?@*[]") {
		return fmt.Errorf("domain contains forbidden characters: %q", domain)
	}
	if domain != strings.ToLower(domain) {
		return fmt.Errorf("domain must be lowercase: %q", domain)
	}
	if net.ParseIP(domain) != nil {
		return fmt.Errorf("domain must be a hostname, not an IP address: %q", domain)
	}
	for _, suffix := range reservedPrivateDomains {
		if domain == suffix || strings.HasSuffix(domain, suffix) {
			return fmt.Errorf("domain %q is reserved for private/local use", domain)
		}
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return fmt.Errorf("domain must be a fully-qualified hostname with at least two labels: %q", domain)
	}
	for _, lbl := range labels {
		if !dnsLabelPattern.MatchString(lbl) {
			return fmt.Errorf("domain contains invalid DNS label %q in %q", lbl, domain)
		}
	}
	return nil
}

// ValidatePaasPort validates a container target port.
func ValidatePaasPort(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535, got %d", port)
	}
	return nil
}

// PaasContainerName returns the canonical Docker container name for a PaaS app.
func PaasContainerName(slug string) string {
	return paasContainerPrefix + slug
}

// GenerateCaddyfile deterministically renders a Caddyfile with automatic HTTPS
// for all validated public PaaS routes. Private mesh services (control-plane
// :3003 and postgres :5432) are never emitted.
func GenerateCaddyfile(routes []CaddyRoute) (string, error) {
	sorted := make([]CaddyRoute, 0, len(routes))
	seenDomains := make(map[string]string, len(routes))

	for _, rt := range routes {
		if err := ValidatePaasSlug(rt.Slug); err != nil {
			return "", fmt.Errorf("invalid route slug: %w", err)
		}
		if err := ValidatePaasDomain(rt.Domain); err != nil {
			return "", fmt.Errorf("invalid route domain: %w", err)
		}
		if err := ValidatePaasPort(rt.Port); err != nil {
			return "", fmt.Errorf("invalid route port: %w", err)
		}
		if rt.UpstreamHost != "" {
			if err := ValidateContainerName(rt.UpstreamHost); err != nil {
				return "", fmt.Errorf("invalid route upstream host: %w", err)
			}
		}
		if prev, exists := seenDomains[rt.Domain]; exists {
			return "", fmt.Errorf("duplicate domain %q claimed by %q and %q", rt.Domain, prev, rt.Slug)
		}
		seenDomains[rt.Domain] = rt.Slug
		sorted = append(sorted, rt)
	}

	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Domain != sorted[j].Domain {
			return sorted[i].Domain < sorted[j].Domain
		}
		return sorted[i].Slug < sorted[j].Slug
	})

	var b strings.Builder
	b.WriteString("# Auto-generated by MoonWitness PaaS Control Plane.\n")
	b.WriteString("# Control-plane (:3003) and Postgres (:5432) remain strictly private on EasyTier mesh.\n\n")
	b.WriteString("{\n")
	b.WriteString("\tadmin off\n")
	b.WriteString("}\n")

	for _, rt := range sorted {
		host := rt.UpstreamHost
		if host == "" {
			host = PaasContainerName(rt.Slug)
		}
		renderCaddySiteBlock(&b, rt.Domain, fmt.Sprintf("%s:%d", host, rt.Port))
	}

	return b.String(), nil
}

// CaddyManager atomically writes the generated Caddyfile and optionally reloads
// Caddy using argument-slice exec (never shell interpolation).
type CaddyManager struct {
	caddyfilePath  string
	caddyBin       string
	reloadEnabled  bool
	dockerBin      string
	caddyContainer string
	staticRoutes   []CaddyStaticRoute
	runner         CommandRunner
}

// NewCaddyManager constructs a CaddyManager from configuration.
func NewCaddyManager(caddyfilePath, caddyBin string, reloadEnabled bool, runner CommandRunner) *CaddyManager {
	if runner == nil {
		runner = runCmdOutput
	}
	return &CaddyManager{
		caddyfilePath: caddyfilePath,
		caddyBin:      caddyBin,
		reloadEnabled: reloadEnabled,
		runner:        runner,
	}
}

// SetStaticRoutes validates and stores static routes appended to the Caddyfile.
// Fails closed without mutating existing static routes if any entry is invalid.
func (m *CaddyManager) SetStaticRoutes(routes []CaddyStaticRoute) error {
	validated := make([]CaddyStaticRoute, 0, len(routes))
	seen := make(map[string]bool, len(routes))
	for _, rt := range routes {
		if err := validateStaticRoute(rt); err != nil {
			return err
		}
		if seen[rt.Domain] {
			return fmt.Errorf("duplicate static route domain %q", rt.Domain)
		}
		seen[rt.Domain] = true
		validated = append(validated, rt)
	}
	m.staticRoutes = validated
	return nil
}

// ConfigureContainerReload configures CaddyManager to reload a containerized
// Caddy instance via `docker restart <containerName>`.
func (m *CaddyManager) ConfigureContainerReload(dockerBin, containerName string) {
	m.dockerBin = strings.TrimSpace(dockerBin)
	m.caddyContainer = strings.TrimSpace(containerName)
	if m.caddyContainer != "" {
		m.reloadEnabled = true
	}
}

// Sync generates and atomically writes the Caddyfile for the given routes.
// If reloadEnabled is true, it restarts the configured Caddy container or
// invokes `caddy reload --config <path>`.
func (m *CaddyManager) Sync(ctx context.Context, routes []CaddyRoute) (string, error) {
	content, err := GenerateCaddyfile(routes)
	if err != nil {
		return "", err
	}
	if len(m.staticRoutes) > 0 {
		dynamicDomains := make(map[string]bool, len(routes))
		for _, rt := range routes {
			dynamicDomains[rt.Domain] = true
		}
		sortedStatic := make([]CaddyStaticRoute, 0, len(m.staticRoutes))
		for _, srt := range m.staticRoutes {
			if !dynamicDomains[srt.Domain] {
				sortedStatic = append(sortedStatic, srt)
			}
		}
		if len(sortedStatic) > 0 {
			sort.Slice(sortedStatic, func(i, j int) bool {
				return sortedStatic[i].Domain < sortedStatic[j].Domain
			})
			var sb strings.Builder
			sb.WriteString(content)
			for _, srt := range sortedStatic {
				renderCaddySiteBlock(&sb, srt.Domain, srt.Upstream)
			}
			content = sb.String()
		}
	}
	if m.caddyfilePath != "" {
		dir := filepath.Dir(m.caddyfilePath)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", fmt.Errorf("create caddyfile dir: %w", err)
		}
		tmpFile, err := os.CreateTemp(dir, ".Caddyfile.tmp-*")
		if err != nil {
			return "", fmt.Errorf("create temp caddyfile: %w", err)
		}
		tmpPath := tmpFile.Name()
		if _, err := tmpFile.WriteString(content); err != nil {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
			return "", fmt.Errorf("write temp caddyfile: %w", err)
		}
		if err := tmpFile.Chmod(0o644); err != nil {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
			return "", fmt.Errorf("chmod temp caddyfile: %w", err)
		}
		if err := tmpFile.Close(); err != nil {
			_ = os.Remove(tmpPath)
			return "", fmt.Errorf("close temp caddyfile: %w", err)
		}
		if err := os.Rename(tmpPath, m.caddyfilePath); err != nil {
			_ = os.Remove(tmpPath)
			return "", fmt.Errorf("rename caddyfile: %w", err)
		}
	}
	if m.reloadEnabled {
		if m.caddyContainer != "" && m.dockerBin != "" {
			if _, err := m.runner(ctx, m.dockerBin, "restart", m.caddyContainer); err != nil {
				return content, fmt.Errorf("caddy container reload failed: %w", err)
			}
		} else if m.caddyBin != "" && m.caddyfilePath != "" {
			if _, err := m.runner(ctx, m.caddyBin, "reload", "--config", m.caddyfilePath); err != nil {
				return content, fmt.Errorf("caddy reload failed: %w", err)
			}
		}
	}
	return content, nil
}
