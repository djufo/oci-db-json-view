package dbview

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"strconv"
	"time"
)

// Server wires the read-only DB introspection API + the embedded static UI.
type Server struct {
	db       *DB
	password string // when empty, auth is disabled (dev)
	secret   []byte // cookie HMAC key
	ui       fs.FS
}

const cookieName = "dbv_session"

func NewServer(db *DB, password string, secret []byte, ui fs.FS) *Server {
	if ui == nil {
		ui = emptyFS{}
	}
	return &Server{db: db, password: password, secret: secret, ui: ui}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/me", s.me)
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("GET /api/tables", s.requireAuth(s.tables))
	mux.HandleFunc("GET /api/tables/{name}/columns", s.requireAuth(s.columns))
	mux.HandleFunc("GET /api/tables/{name}/rows", s.requireAuth(s.rows))
	// Everything else is the UI app; unknown paths fall back to index.html.
	mux.Handle("/", spaFileServer{s.ui})
	return withSecurityHeaders(mux)
}

// --- auth (shared-password -> signed cookie) --------------------------------

func (s *Server) authed(r *http.Request) bool {
	if s.password == "" {
		return true // auth disabled in dev
	}
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	return s.validToken(c.Value)
}

func (s *Server) token() string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("dbview-ok"))
	return hex.EncodeToString(mac.Sum(nil))
}
func (s *Server) validToken(v string) bool {
	want := s.token()
	return subtle.ConstantTimeCompare([]byte(v), []byte(want)) == 1
}

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authed(r) {
			writeErr(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next(w, r)
	}
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if s.password == "" {
		writeJSON(w, http.StatusOK, map[string]any{"authed": true, "authRequired": false})
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Password), []byte(s.password)) != 1 {
		writeErr(w, http.StatusUnauthorized, "wrong password")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: s.token(), Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 86400 * 7,
	})
	writeJSON(w, http.StatusOK, map[string]any{"authed": true})
}

func (s *Server) logout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	writeJSON(w, http.StatusOK, map[string]any{"authed": false})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"authed":       s.authed(r),
		"authRequired": s.password != "",
		"readOnly":     true,
	})
}

// --- handlers ---------------------------------------------------------------

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy"})
}

func (s *Server) tables(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	t, err := s.db.Tables(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if t == nil {
		t = []TableInfo{}
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) columns(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	cols, err := s.db.Columns(ctx, r.PathValue("name"))
	if err != nil {
		s.dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cols)
}

func (s *Server) rows(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	size, _ := strconv.Atoi(q.Get("size"))
	p, err := s.db.Rows(ctx, r.PathValue("name"), q.Get("order"), q.Get("dir"), page, size)
	if err != nil {
		s.dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) dbErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "table not found")
		return
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}

// --- helpers ----------------------------------------------------------------

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// Embeddable in other development pages via iframe (same-site tooling).
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'self' https://*.dev.elitua.ayc.io")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

type spaFileServer struct {
	fs fs.FS
}

func (s spaFileServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/" {
		path = "index.html"
	} else {
		path = path[1:]
	}
	if f, err := s.fs.Open(path); err == nil {
		_ = f.Close()
		http.FileServer(http.FS(s.fs)).ServeHTTP(w, r)
		return
	}
	r.URL.Path = "/index.html"
	http.FileServer(http.FS(s.fs)).ServeHTTP(w, r)
}

type emptyFS struct{}

func (emptyFS) Open(string) (fs.File, error) {
	return nil, fs.ErrNotExist
}
