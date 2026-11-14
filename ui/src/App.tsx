import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Database, LogOut, RefreshCw } from "lucide-react";
import { AppFrame } from "emibs-ui-lib/components/layout/AppFrame";
import { AppearanceControls } from "emibs-ui-lib/components/layout/AppearanceControls";
import { SignInPage } from "emibs-ui-lib/components/layout/SignInPage";
import { PageColumns, PageScaffold, type PageScaffoldState } from "emibs-ui-lib/components/layout/PageScaffold";
import { PageHeader } from "emibs-ui-lib/components/layout/PageHeader";
import { SectionCard } from "emibs-ui-lib/components/layout/SectionCard";
import { WorkspaceShell } from "emibs-ui-lib/components/layout/WorkspaceShell";
import { NavigationMenu } from "emibs-ui-lib/components/layout/NavigationMenu";
import { Pager } from "emibs-ui-lib/components/data/Pager";
import { TablePrimitive, type TablePrimitiveColumn } from "emibs-ui-lib/components/primitives/TablePrimitive";
import { PayloadBlock } from "emibs-ui-lib/components/primitives/PayloadBlock";
import { Button } from "emibs-ui-lib/components/primitives/Button";
import { Badge } from "emibs-ui-lib/components/primitives/Badge";
import { SearchField } from "emibs-ui-lib/components/primitives/SearchField";
import { SelectControl } from "emibs-ui-lib/components/primitives/SelectControl";
import { TextInputControl } from "emibs-ui-lib/components/primitives/TextInputControl";
import { NoticeBanner } from "emibs-ui-lib/components/feedback/NoticeBanner";
import { Dialog } from "emibs-ui-lib";

type TableInfo = { name: string; rows: number };
type Column = { name: string; type: string; nullable: boolean; jsonish: boolean };
type Cell = { v: string; bin?: boolean } | null;
type Page = {
  table: string;
  columns: Column[];
  rows: Cell[][];
  total: number;
  page: number;
  size: number;
  order: string;
  dir: string;
};
type Me = { authed: boolean; authRequired: boolean; readOnly: boolean };
type Detail =
  | { kind: "row"; title: string; columns: Column[]; row: Cell[] }
  | { kind: "text"; title: string; text: string }
  | { kind: "json"; title: string; value: unknown };
type GridRow = { id: string; index: number; cells: Cell[] };

// The UI is embeddable: `?embed=1` hides the product chrome, `?table=NAME` preselects a table,
// and the API base is relative to wherever the host mounts this document.
function readParams() {
  return new URLSearchParams(window.location.search);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = window.location.pathname.replace(/\/[^/]*$/, "");
  const response = await fetch(`${base}/api${path}`, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
    ...init
  });
  const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(body?.error ?? response.statusText);
  }
  return body as T;
}

export function App() {
  return (
    <AppFrame defaultDensity="compact" storageKey="oci-db-json-view">
      <Viewer />
    </AppFrame>
  );
}

function Viewer() {
  const params = useMemo(readParams, []);
  const embedded = params.get("embed") === "1";
  const [me, setMe] = useState<Me | null>(null);
  const [loginError, setLoginError] = useState("");
  const [password, setPassword] = useState("");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(params.get("table")?.toUpperCase() ?? "");
  const [pageSize, setPageSize] = useState(50);
  const [pageNo, setPageNo] = useState(1);
  const [order, setOrder] = useState("");
  const [dir, setDir] = useState("asc");
  const [page, setPage] = useState<Page | null>(null);
  const [status, setStatus] = useState("Loading");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    api<Me>("/me")
      .then(setMe)
      .catch(() => setMe({ authed: false, authRequired: true, readOnly: true }));
  }, []);

  const authed = me && (!me.authRequired || me.authed);

  const loadTables = useCallback(async () => {
    setStatus("Loading tables");
    const next = await api<TableInfo[]>("/tables");
    setTables(next);
    setStatus("");
    const preselect = selected || next[0]?.name || "";
    if (preselect && !selected) {
      setSelected(preselect);
    }
  }, [selected]);

  useEffect(() => {
    if (authed) {
      void loadTables().catch((err: Error) => {
        setStatus("");
        setError(err.message);
      });
    }
  }, [authed, loadTables]);

  const loadRows = useCallback(async () => {
    if (!selected) {
      return;
    }
    setStatus("Loading rows");
    setError("");
    const query = new URLSearchParams({
      page: String(pageNo),
      size: String(pageSize),
      order,
      dir
    });
    const next = await api<Page>(`/tables/${encodeURIComponent(selected)}/rows?${query}`);
    setPage(next);
    setOrder(next.order);
    setDir(next.dir);
    setStatus("");
  }, [dir, order, pageNo, pageSize, selected]);

  useEffect(() => {
    if (authed && selected) {
      void loadRows().catch((err: Error) => {
        setStatus("");
        setError(err.message);
        setPage(null);
      });
    }
  }, [authed, selected, loadRows]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api("/login", { method: "POST", body: JSON.stringify({ password }) });
      setLoginError("");
      setMe(await api<Me>("/me"));
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Sign in failed");
    }
  }

  async function logout() {
    await api("/logout", { method: "POST" });
    setMe(await api<Me>("/me"));
  }

  function chooseTable(name: string) {
    setSelected(name);
    setPageNo(1);
    setOrder("");
    setDir("asc");
  }

  function sortBy(column: string) {
    setPageNo(1);
    if (order === column) {
      setDir(dir === "ASC" ? "desc" : "asc");
    } else {
      setOrder(column);
      setDir("asc");
    }
  }

  const visibleTables = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? tables.filter((table) => table.name.toLowerCase().includes(q)) : tables;
  }, [filter, tables]);

  if (!me) {
    return <Chrome embedded={embedded} status="Loading" />;
  }

  if (me.authRequired && !me.authed) {
    return (
      <SignInPage
        brand={<Database aria-hidden="true" size={28} />}
        corner={<AppearanceControls />}
        description="Read-only Oracle schema browser."
        eyebrow="Database Viewer"
        notice={loginError ? <NoticeBanner tone="danger">{loginError}</NoticeBanner> : undefined}
        title="Sign in"
      >
        <form className="login-form" onSubmit={login}>
          <TextInputControl
            autoFocus
            id="dbview-password"
            label="Access password"
            name="password"
            onValueChange={setPassword}
            placeholder="Access password"
            type="password"
            value={password}
          />
          <Button type="submit">Sign in</Button>
        </form>
      </SignInPage>
    );
  }

  const tablePanel = (
    <SectionCard
      badges={[{ id: "count", label: tables.length.toLocaleString() }]}
      className="table-panel"
      density="compact"
      title="Tables"
    >
      <SearchField
        density="compact"
        hideLabel
        id="dbview-filter"
        label="Filter tables"
        onValueChange={setFilter}
        placeholder="Filter tables"
        value={filter}
      />
      <div className="table-list">
        <NavigationMenu
          ariaLabel="Tables"
          density="compact"
          items={visibleTables.map((table) => ({
            id: table.name,
            label: table.name,
            meta: table.rows >= 0 ? table.rows.toLocaleString() : undefined,
            active: table.name === selected
          }))}
          onItemSelect={(item) => chooseTable(item.id)}
          showDividers={false}
        />
      </div>
    </SectionCard>
  );

  const mainState: PageScaffoldState | null = page
    ? null
    : error
      ? { kind: "error", title: "Unable to load", description: error }
      : status
        ? { kind: "loading", title: status }
        : {
            kind: "empty",
            title: "Select a table",
            description: "Choose a table from the left to inspect rows and JSON payloads."
          };

  return (
    <Chrome embedded={embedded} onLogout={me.authRequired ? logout : undefined} status={status}>
      <PageColumns className="dbview-columns" layout="aside-main">
        {tablePanel}
        <PageScaffold
          footer={page ? <TableFooter onPage={setPageNo} page={page} /> : undefined}
          header={page ? <TableHeader onReload={() => void loadRows()} page={page} /> : undefined}
          state={mainState}
          toolbar={
            page ? (
              <SelectControl
                density="compact"
                id="dbview-page-size"
                label="Rows"
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPageNo(1);
                }}
                options={[25, 50, 100, 200].map((size) => ({ value: String(size), label: String(size) }))}
                value={String(page.size)}
              />
            ) : undefined
          }
          width="full"
        >
          {page ? <TableView onDetail={setDetail} onSort={sortBy} page={page} /> : null}
        </PageScaffold>
      </PageColumns>
      <DetailDialog detail={detail} onClose={() => setDetail(null)} />
    </Chrome>
  );
}

function Chrome({
  children,
  embedded,
  onLogout,
  status
}: {
  children?: React.ReactNode;
  embedded: boolean;
  onLogout?: () => void;
  status: string;
}) {
  if (embedded) {
    return (
      <div className="embedded">
        {status ? (
          <NoticeBanner density="compact" tone="loading">
            {status}
          </NoticeBanner>
        ) : null}
        {children}
      </div>
    );
  }
  return (
    <WorkspaceShell
      actions={
        <>
          <AppearanceControls />
          {onLogout ? (
            <Button onClick={onLogout} size="sm" type="button" variant="ghost">
              <LogOut aria-hidden="true" size={15} />
              Sign out
            </Button>
          ) : null}
        </>
      }
      brand={<strong>Database Viewer</strong>}
      status={status ? <span role="status">{status}</span> : undefined}
      subtitle={
        <>
          Score Oracle ADB <Badge>read-only</Badge>
        </>
      }
    >
      {children}
    </WorkspaceShell>
  );
}

function TableHeader({ onReload, page }: { onReload: () => void; page: Page }) {
  return (
    <PageHeader
      actions={
        <Button onClick={onReload} size="sm" type="button" variant="secondary">
          <RefreshCw aria-hidden="true" size={15} />
          Reload
        </Button>
      }
      density="compact"
      description={`${page.total.toLocaleString()} rows`}
      level={1}
      title={page.table}
    />
  );
}

function TableFooter({ onPage, page }: { onPage: (page: number) => void; page: Page }) {
  const from = page.total === 0 ? 0 : (page.page - 1) * page.size + 1;
  const to = Math.min(page.total, from + page.rows.length - 1);
  return (
    <Pager
      onPageChange={onPage}
      page={page.page}
      summary={`${from.toLocaleString()}-${to.toLocaleString()} of ${page.total.toLocaleString()}`}
      total={Math.max(1, Math.ceil(page.total / page.size))}
    />
  );
}

function TableView({
  onDetail,
  onSort,
  page
}: {
  page: Page;
  onDetail: (detail: Detail) => void;
  onSort: (column: string) => void;
}) {
  const from = page.total === 0 ? 0 : (page.page - 1) * page.size + 1;
  const rows: GridRow[] = page.rows.map((cells, index) => ({ id: String(index), index, cells }));
  // Columns are dynamic (they come from the selected table) and sorting is server-side,
  // so this uses TablePrimitive rather than DataTable, which sorts and pages client-side.
  const columns: TablePrimitiveColumn<GridRow>[] = [
    { id: "#", header: "#", align: "end", cell: (row) => <span className="row-number">{from + row.index}</span> },
    ...page.columns.map(
      (column, columnIndex): TablePrimitiveColumn<GridRow> => ({
        id: column.name,
        sortDirection: page.order === column.name ? (page.dir === "DESC" ? "descending" : "ascending") : "none",
        header: (
          <button className="col-sort" onClick={() => onSort(column.name)} type="button">
            {column.name}
            <small>{column.type}</small>
            {page.order === column.name ? <span>{page.dir === "DESC" ? "down" : "up"}</span> : null}
          </button>
        ),
        cell: (row) => <CellView cell={row.cells[columnIndex]} column={column} onDetail={onDetail} />
      })
    )
  ];
  return (
    <div className="grid-wrap">
      <TablePrimitive
        ariaLabel={`${page.table} rows`}
        columns={columns}
        density="compact"
        emptyMessage="This table has no rows."
        getRowId={(row) => row.id}
        onRowActivate={(row) =>
          onDetail({ kind: "row", title: `${page.table} row ${from + row.index}`, columns: page.columns, row: row.cells })
        }
        rows={rows}
      />
    </div>
  );
}

function CellView({ cell, column, onDetail }: { cell: Cell; column: Column; onDetail: (detail: Detail) => void }) {
  if (cell === null) {
    return <span className="null">null</span>;
  }
  if (cell.bin) {
    return <span className="cell">{cell.v}</span>;
  }
  const json = parseJSON(cell.v);
  if (json !== undefined) {
    return (
      <button
        className="json-chip"
        onClick={(event) => {
          event.stopPropagation();
          onDetail({ kind: "json", title: column.name, value: json });
        }}
        type="button"
      >
        {Array.isArray(json) ? "[ ]" : "{ }"} {cell.v.slice(0, 72)}
      </button>
    );
  }
  if (cell.v.length > 220) {
    return (
      <>
        <span className="cell clipped">{cell.v.slice(0, 220)}...</span>
        <button
          className="link-button"
          onClick={(event) => {
            event.stopPropagation();
            onDetail({ kind: "text", title: column.name, text: cell.v });
          }}
          type="button"
        >
          more
        </button>
      </>
    );
  }
  return <span className="cell">{cell.v}</span>;
}

function DetailDialog({ detail, onClose }: { detail: Detail | null; onClose: () => void }) {
  if (!detail) {
    return null;
  }
  const copyText = detailToText(detail);
  return (
    <Dialog
      actions={
        <Button onClick={() => void navigator.clipboard?.writeText(copyText)} size="sm" type="button" variant="secondary">
          Copy
        </Button>
      }
      closeLabel="Close"
      // Portal inside the theme scope, otherwise the dialog loses theme tokens (white in dark mode).
      container={document.querySelector<HTMLElement>(".ui-theme-scope")}
      onClose={onClose}
      open
      size="xl"
      title={detail.title}
    >
      {detail.kind === "row" ? <RowDetail detail={detail} /> : null}
      {detail.kind === "text" ? <PayloadBlock ariaLabel={detail.title} payload={detail.text} variant="plain" wrap /> : null}
      {detail.kind === "json" ? <JSONViewer value={detail.value} /> : null}
    </Dialog>
  );
}

function RowDetail({ detail }: { detail: Extract<Detail, { kind: "row" }> }) {
  return (
    <dl className="kv">
      {detail.columns.map((column, index) => {
        const cell = detail.row[index];
        const json = cell ? parseJSON(cell.v) : undefined;
        return (
          <React.Fragment key={column.name}>
            <dt className="key">{column.name}</dt>
            <dd className="value">
              {cell === null ? (
                <span className="null">null</span>
              ) : json !== undefined ? (
                <JSONViewer value={json} />
              ) : (
                <PayloadBlock ariaLabel={column.name} density="compact" payload={cell.v} variant="plain" wrap />
              )}
            </dd>
          </React.Fragment>
        );
      })}
    </dl>
  );
}

// Expand all / Collapse all (specs/dbview.md): a bumped generation tells every node to take `open`.
const TreeControl = React.createContext<{ gen: number; open: boolean }>({ gen: 0, open: true });

function JSONViewer({ value }: { value: unknown }) {
  const [control, setControl] = useState({ gen: 0, open: true });
  const isContainer = value !== null && typeof value === "object";
  return (
    <TreeControl.Provider value={control}>
      {isContainer ? (
        <div className="json-actions">
          <Button onClick={() => setControl((c) => ({ gen: c.gen + 1, open: true }))} size="sm" type="button" variant="ghost">
            Expand all
          </Button>
          <Button onClick={() => setControl((c) => ({ gen: c.gen + 1, open: false }))} size="sm" type="button" variant="ghost">
            Collapse all
          </Button>
        </div>
      ) : null}
      <JSONTree value={value} />
    </TreeControl.Provider>
  );
}

function JSONNode({ summary, children }: { summary: string; children: React.ReactNode }) {
  const control = React.useContext(TreeControl);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (control.gen > 0) {
      setOpen(control.open);
    }
  }, [control]);
  return (
    <details className="json-node" onToggle={(event) => setOpen(event.currentTarget.open)} open={open}>
      <summary>{summary}</summary>
      <div>{children}</div>
    </details>
  );
}

function JSONTree({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <JSONNode summary={`Array [${value.length}]`}>
        {value.map((item, index) => (
          <div className="json-row" key={index}>
            <span className="json-key">{index}</span>
            <JSONTree value={item} />
          </div>
        ))}
      </JSONNode>
    );
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <JSONNode summary={`Object {${entries.length}}`}>
        {entries.map(([key, item]) => (
          <div className="json-row" key={key}>
            <span className="json-key">{key}</span>
            <JSONTree value={item} />
          </div>
        ))}
      </JSONNode>
    );
  }
  return <span className={`json-scalar ${value === null ? "json-null" : ""}`}>{JSON.stringify(value)}</span>;
}

function parseJSON(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

function detailToText(detail: Detail): string {
  if (detail.kind === "text") {
    return detail.text;
  }
  if (detail.kind === "json") {
    return JSON.stringify(detail.value, null, 2);
  }
  const obj: Record<string, unknown> = {};
  detail.columns.forEach((column, index) => {
    const cell = detail.row[index];
    obj[column.name] = cell === null ? null : (parseJSON(cell.v) ?? cell.v);
  });
  return JSON.stringify(obj, null, 2);
}
