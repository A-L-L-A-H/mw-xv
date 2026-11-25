package main

import (
	_ "embed"
	"net/http"
	"strings"
)

//go:embed ui/index.html
var paasUIHTML []byte

// NewPaasUIHandler serves the embedded Coolify-style Web Console on `/` and
// proxies `/api/paas/*` requests to PaasManager behind privileged admin token auth.
func NewPaasUIHandler(paasMgr *PaasManager, adminToken string) http.Handler {
	mux := http.NewServeMux()

	paasAPI := http.NewServeMux()
	if paasMgr != nil {
		paasAPI.HandleFunc("/paas/node/metrics", paasMgr.handleNodeMetrics())
		paasAPI.HandleFunc("/paas/metrics", paasMgr.handleNodeMetrics())
		paasAPI.HandleFunc("/paas/templates", paasMgr.handleTemplates())
		paasAPI.HandleFunc("/paas/apps", paasMgr.handleApps())
		paasAPI.HandleFunc("/paas/apps/deploy", paasMgr.handleDeploy())
		paasAPI.HandleFunc("/paas/apps/deploy-git", paasMgr.handleGitDeploy())
		paasAPI.HandleFunc("/paas/apps/deploy-compose", paasMgr.handleComposeDeploy())
		paasAPI.HandleFunc("/paas/apps/preview", paasMgr.handlePreviewDeploy())
		paasAPI.HandleFunc("/paas/apps/", paasMgr.handleAppSubroutes())
		paasAPI.HandleFunc("/paas/backups/postgres", paasMgr.handleBackupPostgres())
		paasAPI.HandleFunc("/paas/backups", paasMgr.handleListBackups())
		paasAPI.HandleFunc("/paas/backups/restore", paasMgr.handleRestoreBackup())
		paasAPI.HandleFunc("/paas/cluster/nodes", paasMgr.handleClusterNodes())
		paasAPI.HandleFunc("/paas/cluster/nodes/join", paasMgr.handleClusterJoin())
		paasAPI.HandleFunc("/paas/cluster/ha/status", paasMgr.handleHAStatus())
	}

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		writePaasJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("/api/paas/", requirePrivilegedPaasAuth(adminToken, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		rewritten := r.Clone(r.Context())
		urlCopy := *r.URL
		urlCopy.Path = "/paas/" + strings.TrimPrefix(r.URL.Path, "/api/paas/")
		if urlCopy.RawPath != "" {
			urlCopy.RawPath = ""
		}
		rewritten.URL = &urlCopy
		paasAPI.ServeHTTP(w, rewritten)
	}))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			writePaasJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
		)
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write(paasUIHTML)
		}
	})

	return mux
}
