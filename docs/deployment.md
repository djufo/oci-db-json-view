# Deployment

## Frame policy

Framing is denied by default. `FRAME_ALLOWED_ANCESTORS` is a runtime setting:
a comma-separated list of exact `https://host[:port]|window-name` pairs.
Both parts are required. Window names start with a letter or digit and contain
1–128 letters, digits, `.`, `_`, `:`, or `-`. Wildcards, paths (including a
trailing slash), credentials, query strings and fragments refuse startup.
HTTP origins require their hostname explicitly in `FRAME_ALLOWED_INSECURE_HOSTS`
(comma-separated hostnames, empty by default). Localhost has no special status.
An empty allowlist sends CSP `frame-ancestors 'self'` and X-Frame-Options `DENY`,
preserving a route's explicit `frame-ancestors 'none'`.
Configured origins replace only the CSP ancestor directive; other CSP directives
are preserved, and conflicting X-Frame-Options is omitted for exceptions.

Client admission runs before the application loads: top-level windows start immediately without fetching frame configuration;
a frame needs both an exact direct-parent origin and its matching window name.
The host sets the iframe `name` attribute. Ancestor information comes from
`location.ancestorOrigins[0]`, falling back to the referrer's origin only when
ancestor origins are unavailable. Missing information denies access. Denied
clients show “This app is not supported inside a frame” without app/API loads.
The browser may block the document at the CSP layer before this text appears.
The public runtime configuration is uncached and carries the same entries used
for headers. No exception is baked into the frontend bundle.
