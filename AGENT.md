# AGENT.md — dbview (Oracle database browser)

> **Global rules live in [`/engineering/AGENT.md`](../../AGENT.md)** (git/branching,
> spec-driven, OCI/secret policy). This file is **dbview-specific** only.
> Spec-driven: read [`specs/dbview.md`](specs/dbview.md) before changing behavior.

## What this is

A **read-only** Oracle database browser: one Go binary that serves both an
introspection API (tables → columns → paginated rows) and an embedded web UI
with a **collapsible JSON viewer** for JSON columns (à la jsonviewer.stack.hu).
It connects to the same Autonomous Database pattern jira uses (pure-Go `go-ora`
+ auto-login wallet, no Instant Client) and **only ever issues SELECTs**.
Designed to be **embedded into any project** as a separate page (iframe-friendly).

## Layout

```
dbview/
├── main.go            # bootstrap: Oracle connect + embed UI + serve
├── oracle.go          # read-only introspection (validated identifiers, SELECT-only)
├── api.go             # HTTP API + shared-password auth + static file server
├── public/            # embedded UI (index.html, app.js, jsonview.js, styles.css)
├── Dockerfile         # single static binary, embeds the UI (no nginx)
├── entrypoint.sh      # loads /secrets/app.env + wallet (reuses jira's ADB creds)
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
  Empty ⇒ open (dev only). `frame-ancestors` CSP limits embedding to `*.ocidev.ayc.io`.

## Build / run

```bash
go build -o dbview-bin . && \
  ORA_USER=.. ORA_PASSWORD=.. ORA_CONNECT_DESCRIPTOR=.. ORA_WALLET=/path/wallet \
  PORT=6210 DBVIEW_PASSWORD=secret ./dbview-bin
```

Deploy (reuses jira's materialized ADB creds — deploy jira first):
`./deploy.sh` → container on `127.0.0.1:6210`; password in `/engineering/local/dbview.env`.

## Embedding into another project

Add a menu item that points at dbview as a separate page — either link to
`https://dbview.ocidev.ayc.io` or iframe it:
`<iframe src="https://dbview.ocidev.ayc.io/?embed=1&table=APP_STATE_TASKS"></iframe>`
(`?embed=1` hides dbview's own topbar; `?table=NAME` preselects a table.)

## Recent changes

- 2026-06-14: First version. Read-only Oracle browser: `/api/tables`,
  `/api/tables/{name}/columns`, `/api/tables/{name}/rows` (paged, sortable);
  embedded UI with table list, grid, row-detail, and a dependency-free
  collapsible JSON viewer (expand/collapse per-node + all). Shared-password auth,
  single static binary, iframe-embeddable. Reuses jira's ADB creds.
