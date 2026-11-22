// Package frameguard enforces the runtime ancestor policy before app startup.
package frameguard

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

type Entry struct {
	Origin string `json:"origin"`
	Name   string `json:"name"`
}
type Policy []Entry

var invalid = errors.New("invalid FRAME_ALLOWED_ANCESTORS or FRAME_ALLOWED_INSECURE_HOSTS")
var namePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)
var hostnamePattern = regexp.MustCompile(`^[a-z0-9]+([a-z0-9.-]*[a-z0-9])?$`)

func validHostname(host string) bool {
	if net.ParseIP(host) != nil {
		return true
	}
	if len(host) > 253 {
		return false
	}
	labelPattern := regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
	for _, label := range strings.Split(host, ".") {
		if !labelPattern.MatchString(label) {
			return false
		}
	}
	return true
}
func FromEnv() (Policy, error) {
	return Parse(os.Getenv("FRAME_ALLOWED_ANCESTORS"), os.Getenv("FRAME_ALLOWED_INSECURE_HOSTS"))
}
func Parse(raw, insecureRaw string) (Policy, error) {
	insecure := map[string]bool{}
	if insecureRaw != "" {
		for _, h := range strings.Split(insecureRaw, ",") {
			h = strings.TrimSpace(h)
			if !validHostname(h) {
				return nil, invalid
			}
			insecure[h] = true
		}
	}
	entries := Policy{}
	if raw == "" {
		return entries, nil
	}
	for _, item := range strings.Split(raw, ",") {
		pair := strings.Split(strings.TrimSpace(item), "|")
		if len(pair) != 2 || !namePattern.MatchString(pair[1]) {
			return nil, invalid
		}
		origin := pair[0]
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(origin, "*\\ \t\r\n?#") || origin != u.Scheme+"://"+u.Host {
			return nil, invalid
		}
		host := u.Hostname()
		if host != strings.ToLower(host) || !validHostname(host) {
			return nil, invalid
		}
		if u.Scheme != "https" && !(u.Scheme == "http" && insecure[host]) {
			return nil, invalid
		}
		if port := u.Port(); port != "" {
			n, e := strconv.Atoi(port)
			if e != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port || (u.Scheme == "https" && n == 443) || (u.Scheme == "http" && n == 80) {
				return nil, invalid
			}
		} else if strings.HasSuffix(u.Host, ":") {
			return nil, invalid
		}
		entries = append(entries, Entry{origin, pair[1]})
	}
	return entries, nil
}
func (p Policy) CSP(existing string) string {
	directives := []string{}
	for _, part := range strings.Split(existing, ";") {
		part = strings.TrimSpace(part)
		fields := strings.Fields(part)
		if len(fields) > 0 && !strings.EqualFold(fields[0], "frame-ancestors") {
			directives = append(directives, part)
		}
	}
	ancestors := "frame-ancestors 'self'"
	seen := map[string]bool{}
	for _, entry := range p {
		if !seen[entry.Origin] {
			ancestors += " " + entry.Origin
			seen[entry.Origin] = true
		}
	}
	return strings.Join(append(directives, ancestors), "; ")
}
func (p Policy) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writer := &policyWriter{ResponseWriter: w, policy: p}
		if r.URL.Path == "/frame-config.json" && (r.Method == "GET" || r.Method == "HEAD") {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			if r.Method == "HEAD" {
				writer.WriteHeader(http.StatusOK)
				return
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{"frameAllowedAncestors": p})
			return
		}
		next.ServeHTTP(writer, r)
	})
}

type policyWriter struct {
	http.ResponseWriter
	policy Policy
	wrote  bool
}

func (w *policyWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *policyWriter) WriteHeader(status int) {
	if w.wrote {
		return
	}
	if status >= 100 && status < 200 {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	w.wrote = true
	h := w.Header()
	policies := h.Values("Content-Security-Policy")
	h.Del("Content-Security-Policy")
	if len(policies) == 0 {
		policies = []string{""}
	}
	for _, existing := range policies {
		h.Add("Content-Security-Policy", w.policy.CSP(existing))
	}
	if len(w.policy) == 0 {
		h.Set("X-Frame-Options", "DENY")
	} else {
		h.Del("X-Frame-Options")
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *policyWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		if w.Header().Get("Content-Type") == "" {
			w.Header().Set("Content-Type", http.DetectContentType(b))
		}
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}
func (w *policyWriter) Flush() {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}
