# AGENT.md — dbview (Oracle database browser)

> **Global rules live in [`/engineering/AGENT.md`](../../AGENT.md)** (git/branching,
> spec-driven, OCI/secret policy). This file is **dbview-specific** only.
> Spec-driven: read [`specs/dbview.md`](specs/dbview.md) before changing behavior.

## What this is

A **read-only** Oracle database browser: a Go API plus React UI for
introspection (tables → columns → paginated rows) and JSON viewing. It connects
to the same Autonomous Database pattern Score uses (pure-Go `go-ora` +
auto-login wallet, no Instant Client) and **only ever issues SELECTs**.
Designed to be **embedded into any project** as a separate page (iframe-friendly).

## Layout

```
oci-db-json-view/
├── api/               # Go API/library + standalone server
│   ├── cmd/server     # bootstrap: Oracle connect + serve API/UI
│   ├── oracle.go      # read-only introspection (validated identifiers, SELECT-only)
│   └── server.go      # HTTP API + shared-password auth + static file server
├── ui/                # Vite/React browser UI
├── Dockerfile         # builds React UI, copies assets beside the Go API binary
├── entrypoint.sh      # loads /secrets/app.env + wallet (reuses Score ADB creds)
├── docker-compose.app.yml, deploy.sh
└── specs/dbview.md    # authoritative spec
```

## Safety model (do not weaken)

- **SELECT-only.** No INSERT/UPDATE/DELETE/DDL, ever. No arbitrary SQL from the
  client — there is no query endpoint.
- **Identifier validation.** Table/column names are matched against `^[A-Za-z0-9_$#]+$`
  AND confirmed to exist in `user_tables`/`user_tab_columns` before being quoted
  into a statement. Values (offset/limit) are always bound.
- **Scope = the connected user's own schema** (`user_tables`, not `all_tables`).
- **Auth.** `DBVIEW_PASSWORD` gates the UI/API (shared-password → HMAC cookie).
  Empty ⇒ open (dev only). `frame-ancestors` CSP limits embedding to `*.dev.elitua.ayc.io`.

## Build / run

```bash
go build -o dbview-bin ./api/cmd/server && \
  ORA_USER=.. ORA_PASSWORD=.. ORA_CONNECT_DESCRIPTOR=.. ORA_WALLET=/path/wallet \
  DBVIEW_UI_DIR=ui/dist PORT=6210 DBVIEW_PASSWORD=secret ./dbview-bin
```

Deploy (reuses Score's materialized ADB creds):
`./deploy.sh` → container on `127.0.0.1:6210`; password in `/engineering/local/dbview.env`.

## Embedding into another project

Add a menu item that points at dbview as a separate page — either link to
`https://dbview.dev.elitua.ayc.io` or iframe/proxy it:
`<iframe src="/dbview/?embed=1&table=APP_STATE"></iframe>`
(`?embed=1` hides dbview's own topbar; `?table=NAME` preselects a table.)

## Recent changes

- 2026-06-14: First version. Read-only Oracle browser: `/api/tables`,
  `/api/tables/{name}/columns`, `/api/tables/{name}/rows` (paged, sortable);
  embedded UI with table list, grid, row-detail, and a dependency-free
  collapsible JSON viewer (expand/collapse per-node + all). Shared-password auth,
  single static binary, iframe-embeddable. Reuses jira's ADB creds.
- 2026-06-27: Split into `api/` and `ui/`, rewired deploy to Score's
  `/run/emibs/score` Oracle secrets, and added Score iframe/proxy integration.
