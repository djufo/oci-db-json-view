package dbview

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestFramePolicyHTMLAndConfig(t *testing.T) {
	for _, raw := range []string{"", "https://host.example|embed"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("FRAME_ALLOWED_ANCESTORS", raw)
			t.Setenv("FRAME_ALLOWED_INSECURE_HOSTS", "")
			h := NewServer(nil, "", nil, fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>DB</title>")}}).Handler()
			for _, path := range []string{"/", "/deep/route", "/frame-config.json"} {
				w := httptest.NewRecorder()
				h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
				csp := w.Header().Get("Content-Security-Policy")
				want := "frame-ancestors 'self'"
				if raw != "" {
					want += " https://host.example"
				}
				wantStatus := 200
				if path == "/deep/route" {
					wantStatus = 301
				}
				if w.Code != wantStatus || csp != want {
					t.Fatal(w.Code, csp)
				}
				if raw == "" && w.Header().Get("X-Frame-Options") != "DENY" {
					t.Fatal(w.Header())
				}
				if path == "/frame-config.json" && !strings.Contains(w.Body.String(), "frameAllowedAncestors") {
					t.Fatal(w.Body.String())
				}
			}
		})
	}
}
func TestFramePolicyInvalidRefusesLibraryStartup(t *testing.T) {
	t.Setenv("FRAME_ALLOWED_ANCESTORS", "https://*.example|embed")
	defer func() {
		if recover() == nil {
			t.Fatal("invalid policy did not refuse startup")
		}
	}()
	NewServer(nil, "", nil, nil).Handler()
}
