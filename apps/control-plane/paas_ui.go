package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

//go:embed ui/index.html
var paasUIHTML []byte

const (
	paasSessionCookieName = "mw_paas_session"
	paasSessionTTL        = 7 * 24 * time.Hour
	paasPBKDF2Iterations  = 100000
	paasAuthDomain        = "moonwitness-paas-ui-session-v1"
)

type paasUIUser struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

type paasSessionPayload struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
	Exp   int64  `json:"exp"`
}

func pbkdf2HMACSHA256(password, salt []byte, iterations, keyLen int) []byte {
	prf := func(key, data []byte) []byte {
		mac := hmac.New(sha256.New, key)
		_, _ = mac.Write(data)
		return mac.Sum(nil)
	}
	numBlocks := (keyLen + sha256.Size - 1) / sha256.Size
	dk := make([]byte, 0, numBlocks*sha256.Size)
	var blockBuf [4]byte
	for block := 1; block <= numBlocks; block++ {
		blockBuf[0] = byte(block >> 24)
		blockBuf[1] = byte(block >> 16)
		blockBuf[2] = byte(block >> 8)
		blockBuf[3] = byte(block)
		in := make([]byte, len(salt)+4)
		copy(in, salt)
		copy(in[len(salt):], blockBuf[:])
		u := prf(password, in)
		t := make([]byte, len(u))
		copy(t, u)
		for i := 2; i <= iterations; i++ {
			u = prf(password, u)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

func hashPaasPassword(password string) (hashHex string, saltHex string, err error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", "", err
	}
	dk := pbkdf2HMACSHA256([]byte(password), salt, paasPBKDF2Iterations, 32)
	return hex.EncodeToString(dk), hex.EncodeToString(salt), nil
}

func verifyPaasPassword(password, expectedHashHex, saltHex string) bool {
	salt, err := hex.DecodeString(saltHex)
	if err != nil || len(salt) == 0 {
		return false
	}
	expected, err := hex.DecodeString(expectedHashHex)
	if err != nil || len(expected) == 0 {
		return false
	}
	got := pbkdf2HMACSHA256([]byte(password), salt, paasPBKDF2Iterations, len(expected))
	return subtle.ConstantTimeCompare(got, expected) == 1
}

func sessionSigningKey(adminToken string) []byte {
	mac := hmac.New(sha256.New, []byte(adminToken))
	_, _ = mac.Write([]byte(paasAuthDomain))
	return mac.Sum(nil)
}

func signPaasSession(adminToken string, user paasUIUser, now time.Time) (string, error) {
	if adminToken == "" {
		return "", errors.New("missing admin token for session signing")
	}
	payload := paasSessionPayload{
		Name:  user.Name,
		Email: user.Email,
		Role:  user.Role,
		Exp:   now.Add(paasSessionTTL).Unix(),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, sessionSigningKey(adminToken))
	_, _ = mac.Write([]byte(encoded))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encoded + "." + sig, nil
}

func verifyPaasSession(adminToken, cookieVal string, now time.Time) (paasUIUser, bool) {
	if adminToken == "" || cookieVal == "" {
		return paasUIUser{}, false
	}
	parts := strings.Split(cookieVal, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return paasUIUser{}, false
	}
	mac := hmac.New(sha256.New, sessionSigningKey(adminToken))
	_, _ = mac.Write([]byte(parts[0]))
	expectedSig := mac.Sum(nil)
	presentedSig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(presentedSig) != len(expectedSig) || subtle.ConstantTimeCompare(presentedSig, expectedSig) != 1 {
		return paasUIUser{}, false
	}
	rawPayload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return paasUIUser{}, false
	}
	var payload paasSessionPayload
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		return paasUIUser{}, false
	}
	if payload.Email == "" || payload.Exp <= now.Unix() {
		return paasUIUser{}, false
	}
	return paasUIUser{Name: payload.Name, Email: payload.Email, Role: payload.Role}, true
}

func isSecureCookieRequest(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func setPaasSessionCookie(w http.ResponseWriter, r *http.Request, signed string) {
	http.SetCookie(w, &http.Cookie{
		Name:     paasSessionCookieName,
		Value:    signed,
		Path:     "/",
		MaxAge:   int(paasSessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   isSecureCookieRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func clearPaasSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     paasSessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecureCookieRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func countPaasUIUsers(db *sql.DB) (int, error) {
	if db == nil {
		return 0, nil
	}
	var cnt int
	err := db.QueryRow(`SELECT COUNT(*) FROM paas_ui_users`).Scan(&cnt)
	return cnt, err
}

func isValidUIEmail(email string) bool {
	if len(email) < 5 || len(email) > 254 || strings.ContainsAny(email, " \r\n\t\x00") {
		return false
	}
	at := strings.IndexByte(email, '@')
	if at <= 0 || at != strings.LastIndexByte(email, '@') {
		return false
	}
	domain := email[at+1:]
	return strings.Contains(domain, ".") && !strings.HasPrefix(domain, ".") && !strings.HasSuffix(domain, ".")
}

func authenticateUIRequest(r *http.Request, adminToken string) (paasUIUser, bool) {
	if presented := paasCredentialFromRequest(r); presented != "" && adminToken != "" && constantTimeEquals(presented, adminToken) {
		return paasUIUser{Name: "API Admin", Email: "admin@local", Role: "owner"}, true
	}
	c, err := r.Cookie(paasSessionCookieName)
	if err != nil {
		return paasUIUser{}, false
	}
	return verifyPaasSession(adminToken, c.Value, time.Now().UTC())
}

// NewPaasUIHandler serves the embedded Coolify-style Web Console on `/`,
// manages first-run owner setup and session auth on `/api/auth/*`, and
// proxies `/api/paas/*` requests to PaasManager behind privileged auth.
func NewPaasUIHandler(paasMgr *PaasManager, adminToken string) http.Handler {
	mux := http.NewServeMux()

	var db *sql.DB
	paasAPI := http.NewServeMux()
	if paasMgr != nil {
		db = paasMgr.db
		paasAPI.HandleFunc("/paas/node/metrics", paasMgr.handleNodeMetrics())
		paasAPI.HandleFunc("/paas/metrics", paasMgr.handleNodeMetrics())
		paasAPI.HandleFunc("/paas/host/services", paasMgr.handleHostServices())
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

	mux.HandleFunc("/api/auth/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		cnt, _ := countPaasUIUsers(db)
		user, authed := authenticateUIRequest(r, adminToken)
		resp := map[string]interface{}{
			"setupRequired": cnt == 0,
			"authenticated": authed,
		}
		if authed {
			resp["user"] = user
		}
		writePaasJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("/api/auth/setup", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if db == nil {
			writePaasJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database unavailable"})
			return
		}
		cnt, err := countPaasUIUsers(db)
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if cnt > 0 {
			writePaasJSON(w, http.StatusForbidden, map[string]string{"error": "owner account already configured"})
			return
		}
		var req struct {
			Name     string `json:"name"`
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
		name := strings.TrimSpace(req.Name)
		email := strings.ToLower(strings.TrimSpace(req.Email))
		if name == "" || len(name) > 80 {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "valid name is required"})
			return
		}
		if !isValidUIEmail(email) {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "valid email is required"})
			return
		}
		if len(req.Password) < 8 || len(req.Password) > 128 {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be 8-128 characters"})
			return
		}
		hashHex, saltHex, err := hashPaasPassword(req.Password)
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to hash password"})
			return
		}
		if _, err := db.Exec(
			`INSERT INTO paas_ui_users (name, email, password_hash, salt, role) VALUES (?, ?, ?, ?, 'owner')`,
			name, email, hashHex, saltHex,
		); err != nil {
			writePaasJSON(w, http.StatusConflict, map[string]string{"error": "owner account already configured"})
			return
		}
		user := paasUIUser{Name: name, Email: email, Role: "owner"}
		signed, err := signPaasSession(adminToken, user, time.Now().UTC())
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		setPaasSessionCookie(w, r, signed)
		writePaasJSON(w, http.StatusCreated, map[string]interface{}{
			"authenticated": true,
			"setupRequired": false,
			"user":          user,
		})
	})

	mux.HandleFunc("/api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		var req struct {
			Email    string `json:"email"`
			Password string `json:"password"`
			Token    string `json:"token"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 32*1024)).Decode(&req); err != nil {
			writePaasJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}
		var user paasUIUser
		authed := false
		if presented := strings.TrimSpace(req.Token); presented != "" {
			if adminToken != "" && constantTimeEquals(presented, adminToken) {
				user = paasUIUser{Name: "Admin Token", Email: "admin@local", Role: "owner"}
				authed = true
			}
		} else if db != nil {
			email := strings.ToLower(strings.TrimSpace(req.Email))
			if email != "" && req.Password != "" {
				var name, hashHex, saltHex, role string
				err := db.QueryRow(
					`SELECT name, password_hash, salt, role FROM paas_ui_users WHERE email = ?`,
					email,
				).Scan(&name, &hashHex, &saltHex, &role)
				if err == nil && verifyPaasPassword(req.Password, hashHex, saltHex) {
					user = paasUIUser{Name: name, Email: email, Role: role}
					authed = true
				}
			}
		}
		if !authed {
			writePaasJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
			return
		}
		signed, err := signPaasSession(adminToken, user, time.Now().UTC())
		if err != nil {
			writePaasJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		setPaasSessionCookie(w, r, signed)
		writePaasJSON(w, http.StatusOK, map[string]interface{}{
			"authenticated": true,
			"user":          user,
		})
	})

	mux.HandleFunc("/api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writePaasJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		clearPaasSessionCookie(w, r)
		writePaasJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("/api/paas/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if _, ok := authenticateUIRequest(r, adminToken); !ok {
			writePaasJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		rewritten := r.Clone(r.Context())
		rewritten.Header = r.Header.Clone()
		rewritten.Header.Set("Authorization", "Bearer "+adminToken)
		urlCopy := *r.URL
		urlCopy.Path = "/paas/" + strings.TrimPrefix(r.URL.Path, "/api/paas/")
		if urlCopy.RawPath != "" {
			urlCopy.RawPath = ""
		}
		rewritten.URL = &urlCopy
		paasAPI.ServeHTTP(w, rewritten)
	})

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
