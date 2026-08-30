# AGENT.md — dbview (Oracle database browser)

> Read [`/engineering/AGENT.md`](/engineering/AGENT.md) first — estate-wide rules live there. This file is dbview-specific only.
>
> Spec-driven: [`specs/dbview.md`](specs/dbview.md) is authoritative for the
> library, server, API, rendering and security contract — change it first, then
> the code.

An **embeddable, read-only Oracle schema browser**: tables → columns → paginated
rows, with a collapsible viewer for JSON columns. The **library is the primary
integration path** — `dbview.New(cfg)` (`api/dbview.go`) returns an
`http.Handler` a host service mounts under any base path behind its own auth
(`http.StripPrefix("/dbview", h)`); the UI uses a relative API base, so it works
at the root or any subpath. `api/cmd/server` wraps the same handler standalone.

**It is not tied to Score.** dbview browses whatever schema its `ORA_*` config
names. `deploy.sh`/`entrypoint.sh` borrow the Oracle credentials Score still
materializes into `/run/emibs/score`, but Score's durable store is Postgres
(`DB_DRIVER=postgres`; Oracle is retired for board storage) — that reuse is a
convenience, not a dependency. Never call dbview "the database Score uses".

## Invariants (do not weaken)

`specs/dbview.md` holds the full contract. Three things are never traded:
**SELECT-only** (no DML/DDL, no query endpoint, no client-supplied SQL);
**identifier validation** (names matched against `^[A-Za-z0-9_$#]+$` *and*
confirmed present in `user_tables`/`user_tab_columns` before being quoted in,
offset/limit always bound); **own-schema scope** (`user_tables`, never
`all_tables`).

Two security facts that must stay visible. `DBVIEW_PASSWORD` gates the UI/API
(shared password → HMAC cookie) and **empty is fail-open** — `api/server.go:51`
authorises every request when it is unset, so anything reachable beyond loopback
must set it. `api/server.go:173` sends `Content-Security-Policy: frame-ancestors
'self' https://*.dev.elitua.ayc.io`; that is real in code but currently permits
nothing, because no dbview host exists in that zone — re-derive it from the
actual embedding host before relying on it.

## Build

`go build -o dbview-bin ./api/cmd/server`, then run it with `ORA_USER`,
`ORA_PASSWORD`, `ORA_CONNECT_DESCRIPTOR`, `ORA_WALLET`, `DBVIEW_UI_DIR`, `PORT`
and `DBVIEW_PASSWORD` set. In an embedded UI, `?embed=1` hides dbview's own
topbar and `?table=NAME` preselects a table.

## Platform declaration (G-D.17)

Against [`platform-naming-and-environments.md`](/engineering/specs/platform-naming-and-environments.md) §6:

- **Environments:** none. No environment is provisioned and no surface is routed
  — no container runs, nothing listens on `6210`, no Caddy entry, no DNS record,
  no deploy job. `/engineering/local/dbview.env`, which `deploy.sh` expects to
  read, does not exist on this host either.
- **Surfaces:** `ui` + `api` from one handler; embedded as a library it has no hostname of its own.
- **Reach / access:** internal, unrouted; token-gated (`DBVIEW_PASSWORD`)
  before any route is ever added.
- **Naming if revived:** `dbview.ui.dev.ayc.io` / `dbview.api.dev.ayc.io` under
  the standing wildcards. dbview is not §2-grandfathered, and the hand-minted
  `dbview.dev.elitua.ayc.io` older docs referenced is outside them and does not
  resolve. Port `6210` is likewise unregistered and sits inside eLitua's
  `6200-6299` range in
  [`port-allocation.md`](/engineering/specs/patterns/port-allocation.md) — claim
  a real block before deploying.
