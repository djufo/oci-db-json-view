# Spec: dbview — read-only Oracle database browser

Authoritative spec. Spec-driven: change this first, then code.

## Purpose

Browse an Oracle schema (currently Score's Oracle ADB store) from a web page:
see every table, every row, and render JSON columns with an
expandable/collapsible JSON viewer. Embeddable as a separate page inside any
project's layout/menu.

## Project Shape

The project is split into two deployable/buildable surfaces:

- `api/`: Go read-only Oracle API and standalone server.
- `ui/`: Vite/React database browser UI.

The container build compiles the UI first, then ships the Go API binary with the
compiled UI assets. Local development may run the UI separately through Vite or
serve the built UI through the Go API with `DBVIEW_UI_DIR`.

## Non-goals (v1)

- No writes of any kind (read-only).
- No ad-hoc SQL console (only structured table browsing).
- No cross-schema browsing (only the connected user's own tables).
- Single Oracle connection target (the env-configured one).

## API (all JSON; browsing endpoints require auth when a password is set)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/health | liveness |
| GET | /api/me | `{authed, authRequired, readOnly:true}` |
| POST | /api/login | `{password}` → sets HMAC session cookie |
| POST | /api/logout | clears the cookie |
| GET | /api/tables | `[{name, rows}]` (rows = optimizer stat, -1 if unknown) |
| GET | /api/tables/{name}/columns | `[{name, type, nullable, jsonish}]` |
| GET | /api/tables/{name}/rows?page&size&order&dir | one page |

`rows` response: `{table, columns, rows:[[Cell|null,…]], total, page, size, order, dir}`.
A `Cell` is `{v:string, bin?:bool}`; a SQL `NULL` is JSON `null` (no Cell). `bin`
marks elided binary (BLOB/RAW) content. Binary columns return a length marker,
not raw bytes. LOB text columns return a bounded preview so table browsing never
loads whole large values.

Paging is deterministic: default `ORDER BY ROWID`; clicking a (non-LOB) column
header sorts by it (`order`+`dir`), validated against the table's columns.

## Security

- SELECT-only; no query endpoint. Identifiers validated (`^[A-Za-z0-9_$#]+$`) and
  confirmed against `user_tables`/`user_tab_columns`, then double-quoted; values
  bound. Scope is `user_*` (own schema).
- `DBVIEW_PASSWORD` → shared-password login → HMAC(`DBVIEW_COOKIE_SECRET`) cookie.
  Empty password ⇒ open (dev). `X-Content-Type-Options: nosniff` +
  `Content-Security-Policy: frame-ancestors 'self' https://*.ocidev.ayc.io`.

## UI

- Quiet operational UI matching Score-style application surfaces: compact
  toolbar, left table navigation, dense data grid, restrained colors, and no
  marketing/landing page.
- **Left:** filterable table list (name + row count).
- **Main:** selected table → sticky-header grid, page-size + prev/next pager,
  per-column sort. Row number column. Click a row → detail drawer/dialog (all
  columns).
- **JSON columns:** a cell whose text parses to an object/array shows a `{ }`/`[ ]`
  chip; clicking opens the **JSON viewer** — a collapsible tree where every
  object/array region toggles individually (▾/▸), plus **Expand all / Collapse
  all**. Long non-JSON text shows a `more` affordance → full-text dialog.
- **Embedding:** `?embed=1` hides the topbar; `?table=NAME` preselects a table.

## Persistence / config

Stateless. Connects via `ORA_USER`, `ORA_PASSWORD`, `ORA_CONNECT_DESCRIPTOR`,
`ORA_WALLET` (pure-Go go-ora + wallet). In production these are Score secrets
materialized at `/run/emibs/score`, mounted read-only. `DBVIEW_PASSWORD` +
`DBVIEW_COOKIE_SECRET` come from the container env (generated into
`/engineering/local/dbview.env` by `deploy.sh`).

## Score Link

Score links to dbview as an embedded admin surface at `/dbview/?embed=1`. Score's
UI nginx proxies `/dbview/` to the standalone dbview service on host
`127.0.0.1:6210`; dbview remains independently deployable and read-only.
