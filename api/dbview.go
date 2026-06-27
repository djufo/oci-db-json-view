// Package dbview is an embeddable, read-only Oracle database browser. A host
// service (jira, oci-srv-mgr, …) mounts it under any base path; it serves both
// the introspection API (tables → columns → paginated rows) and an embedded web
// UI with a collapsible JSON viewer for JSON columns. It only ever issues
// SELECTs against the connected user's own schema.
//
// Embedding example (mount under /dbview/* behind your own admin auth):
//
//	db, _ := dbview.OpenDB(dbview.DBConfig{User: u, Password: p, ConnectDescriptor: d, WalletPath: w})
//	h := dbview.New(dbview.Config{DB: db})           // Password "" => host-protected
//	mux.Handle("/dbview/", http.StripPrefix("/dbview", h))
//
// The UI uses a relative API base, so it works mounted at the domain root or
// under any subpath.
package dbview

import (
	"crypto/rand"
	"io/fs"
	"net/http"
)

// Config configures an embedded dbview handler.
type Config struct {
	// DB is a connected read-only client (see OpenDB). Required.
	DB *DB
	// Password gates the UI/API with a shared-password login. Leave empty when the
	// host already authenticates the mount (recommended for embedding).
	Password string
	// Secret signs the session cookie. Random per-process if empty.
	Secret []byte
	// UI serves the compiled frontend. Defaults to an empty filesystem when nil.
	UI fs.FS
}

// New returns an http.Handler serving the dbview API + embedded UI. Mount it at
// the root or under a subpath with http.StripPrefix.
func New(cfg Config) http.Handler {
	secret := cfg.Secret
	if len(secret) == 0 {
		secret = randomSecret()
	}
	return NewServer(cfg.DB, cfg.Password, secret, cfg.UI).Handler()
}

func randomSecret() []byte {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return []byte("dbview-dev-secret-change-me")
	}
	return b
}
