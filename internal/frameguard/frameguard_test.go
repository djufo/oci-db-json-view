package frameguard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInvalidStartupPolicy(t *testing.T) {
	for _, raw := range []string{"*|embed", "https://*.example|embed", "https://host.example/path|embed", "https://host.example/|embed", "https://host.example", "https://host.example|", "https://user@host.example|embed", "https://host.example?x|embed", "https://host.example#x|embed", "https://host.example|x,", "http://localhost|embed", "http://127.0.0.1|embed"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("FRAME_ALLOWED_ANCESTORS", raw)
			t.Setenv("FRAME_ALLOWED_INSECURE_HOSTS", "")
			if _, err := FromEnv(); err == nil {
				t.Fatal("invalid startup policy accepted")
			}
		})
	}
}
func TestInsecureHostOptIn(t *testing.T) {
	if _, err := Parse("http://localhost:8080|embed", "localhost"); err != nil {
		t.Fatal(err)
	}
	if _, err := Parse("http://other:8080|embed", "localhost"); err == nil {
		t.Fatal("other host accepted")
	}
}
func TestHeadersAndRuntimeConfig(t *testing.T) {
	for _, raw := range []string{"", "https://host.example|embed,https://host.example|other"} {
		t.Run(raw, func(t *testing.T) {
			p, err := Parse(raw, "")
			if err != nil {
				t.Fatal(err)
			}
			h := p.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors https://retired.example; img-src data:")
				w.Header().Set("X-Frame-Options", "SAMEORIGIN")
				w.Header().Set("Content-Type", "text/html")
				_, _ = w.Write([]byte("<!doctype html>"))
			}))
			for _, path := range []string{"/", "/index.html", "/deep/route"} {
				w := httptest.NewRecorder()
				h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
				csp := w.Header().Get("Content-Security-Policy")
				want := "default-src 'self'; img-src data:; frame-ancestors 'self'"
				if raw != "" {
					want += " https://host.example"
				}
				if csp != want {
					t.Fatalf("%s CSP = %s", path, csp)
				}
				xfo := w.Header().Get("X-Frame-Options")
				if (raw == "" && xfo != "DENY") || (raw != "" && xfo != "") {
					t.Fatalf("XFO=%s", xfo)
				}
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("GET", "/frame-config.json", nil))
			var c struct {
				Entries []Entry `json:"frameAllowedAncestors"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
				t.Fatal(err)
			}
			if len(c.Entries) != len(p) || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'self'") {
				t.Fatal(w.Body.String(), w.Header())
			}
		})
	}
}

func TestMuxGeneratedHTMLRedirectHasFramePolicy(t *testing.T) {
	p, _ := Parse("https://host.example|embed", "")
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	w := httptest.NewRecorder()
	p.Wrap(mux).ServeHTTP(w, httptest.NewRequest("GET", "/a//b", nil))
	if (w.Code < 300 || w.Code >= 400) || !strings.Contains(w.Header().Get("Content-Type"), "text/html") || w.Header().Get("Content-Security-Policy") != "frame-ancestors 'self' https://host.example" {
		t.Fatal(w.Code, w.Header())
	}
}

func TestEmptyPolicyPreservesRouteDenial(t *testing.T) {
	for _, existing := range []string{"frame-ancestors 'none'", "FRAME-ANCESTORS   'none'"} {
		got := (Policy{}).CSP("default-src 'none'; " + existing + "; sandbox")
		if got != "default-src 'none'; sandbox; frame-ancestors 'none'" {
			t.Fatal(got)
		}
	}
	if got := (Policy{}).CSP(""); got != "frame-ancestors 'self'" {
		t.Fatal(got)
	}
	p, _ := Parse("https://host.example|embed", "")
	if got := p.CSP("frame-ancestors 'none'"); got != "frame-ancestors 'self' https://host.example" {
		t.Fatal(got)
	}
}
