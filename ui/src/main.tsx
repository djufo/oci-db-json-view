import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

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

const params = new URLSearchParams(window.location.search);
const embedded = params.get("embed") === "1";
const base = window.location.pathname.replace(/\/[^/]*$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
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

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loginError, setLoginError] = useState("");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(params.get("table")?.toUpperCase() ?? "");
  const [pageSize, setPageSize] = useState(50);
  const [pageNo, setPageNo] = useState(1);
  const [order, setOrder] = useState("");
  const [dir, setDir] = useState("asc");
  const [page, setPage] = useState<Page | null>(null);
  const [status, setStatus] = useState("Loading");
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
      void loadTables().catch((error) => setStatus(error.message));
    }
  }, [authed, loadTables]);

  const loadRows = useCallback(async () => {
    if (!selected) {
      return;
    }
    setStatus("Loading rows");
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
      void loadRows().catch((error) => {
        setStatus(error.message);
        setPage(null);
      });
    }
  }, [authed, selected, loadRows]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/login", { method: "POST", body: JSON.stringify({ password: form.get("password") }) });
      setLoginError("");
      setMe(await api<Me>("/me"));
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Sign in failed");
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
    return <Shell status="Loading" />;
  }

  if (me.authRequired && !me.authed) {
    return (
      <div className="login-screen">
        <form className="login-panel" onSubmit={login}>
          <div className="brand-mark">DB</div>
          <h1>Database Viewer</h1>
          <p>Read-only Oracle schema browser.</p>
          <input autoFocus name="password" placeholder="Access password" type="password" />
          <button type="submit">Sign in</button>
          {loginError ? <p role="alert">{loginError}</p> : null}
        </form>
      </div>
    );
  }

  return (
    <Shell status={status} onLogout={me.authRequired ? logout : undefined}>
      <aside className="sidebar">
        <div className="side-header">
          <strong>Tables</strong>
          <span>{tables.length}</span>
        </div>
        <input
          className="filter"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter tables"
          type="search"
          value={filter}
        />
        <div className="table-list">
          {visibleTables.map((table) => (
            <button
              className={table.name === selected ? "table-item active" : "table-item"}
              key={table.name}
              onClick={() => chooseTable(table.name)}
              type="button"
            >
              <span>{table.name}</span>
              <small>{table.rows >= 0 ? table.rows.toLocaleString() : ""}</small>
            </button>
          ))}
        </div>
      </aside>
      <main className="workspace">
        {page ? (
          <TableView
            page={page}
            onDetail={setDetail}
            onNext={() => setPageNo((value) => value + 1)}
            onPrev={() => setPageNo((value) => Math.max(1, value - 1))}
            onRefresh={() => void loadRows()}
            onPageSize={(value) => {
              setPageSize(value);
              setPageNo(1);
            }}
            onSort={sortBy}
          />
        ) : (
          <section className="empty">
            <h2>Select a table</h2>
            <p>Choose a table from the left to inspect rows and JSON payloads.</p>
          </section>
        )}
      </main>
      {detail ? <DetailDialog detail={detail} onClose={() => setDetail(null)} /> : null}
    </Shell>
  );
}

function Shell({
  children,
  onLogout,
  status
}: {
  children?: React.ReactNode;
  onLogout?: () => void;
  status: string;
}) {
  return (
    <div className={embedded ? "app embedded" : "app"}>
      {!embedded ? (
        <header className="topbar">
          <div className="brand">
            <strong>Database Viewer</strong>
            <span>Score Oracle ADB</span>
          </div>
          <span className="badge">read-only</span>
          <span className="status">{status}</span>
          {onLogout ? (
            <button className="ghost" onClick={onLogout} type="button">
              Sign out
            </button>
          ) : null}
        </header>
      ) : null}
      <div className="layout">{children}</div>
    </div>
  );
}

function TableView({
  onDetail,
  onNext,
  onPageSize,
  onPrev,
  onRefresh,
  onSort,
  page
}: {
  page: Page;
  onDetail: (detail: Detail) => void;
  onNext: () => void;
  onPageSize: (size: number) => void;
  onPrev: () => void;
  onRefresh: () => void;
  onSort: (column: string) => void;
}) {
  const from = page.total === 0 ? 0 : (page.page - 1) * page.size + 1;
  const to = Math.min(page.total, from + page.rows.length - 1);
  return (
    <section className="table-view">
      <div className="table-toolbar">
        <div>
          <h1>{page.table}</h1>
          <span>{page.total.toLocaleString()} rows</span>
        </div>
        <label>
          Rows
          <select onChange={(event) => onPageSize(Number(event.target.value))} value={page.size}>
            {[25, 50, 100, 200].map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <button onClick={onPrev} disabled={page.page <= 1} type="button">
          Prev
        </button>
        <span className="range">{from.toLocaleString()}-{to.toLocaleString()}</span>
        <button onClick={onNext} disabled={to >= page.total} type="button">
          Next
        </button>
        <button onClick={onRefresh} type="button">
          Reload
        </button>
      </div>
      <div className="grid-wrap">
        <table className="data-grid">
          <thead>
            <tr>
              <th>#</th>
              {page.columns.map((column) => (
                <th key={column.name}>
                  <button onClick={() => onSort(column.name)} type="button">
                    {column.name}
                    <small>{column.type}</small>
                    {page.order === column.name ? <span>{page.dir === "DESC" ? "down" : "up"}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                onClick={() =>
                  onDetail({
                    kind: "row",
                    title: `${page.table} row ${from + rowIndex}`,
                    columns: page.columns,
                    row
                  })
                }
              >
                <td className="row-number">{from + rowIndex}</td>
                {row.map((cell, cellIndex) => (
                  <td key={page.columns[cellIndex]?.name ?? cellIndex}>
                    <CellView
                      cell={cell}
                      column={page.columns[cellIndex]}
                      onDetail={(detail) => {
                        onDetail(detail);
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

function DetailDialog({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const copyText = detailToText(detail);
  return (
    <div className="modal" role="presentation" onClick={onClose}>
      <section className="dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>{detail.title}</strong>
          <div>
            <button onClick={() => void navigator.clipboard?.writeText(copyText)} type="button">
              Copy
            </button>
            <button className="ghost" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </header>
        <div className="dialog-body">
          {detail.kind === "row" ? <RowDetail detail={detail} /> : null}
          {detail.kind === "text" ? <pre>{detail.text}</pre> : null}
          {detail.kind === "json" ? <JSONTree value={detail.value} /> : null}
        </div>
      </section>
    </div>
  );
}

function RowDetail({ detail }: { detail: Extract<Detail, { kind: "row" }> }) {
  return (
    <div className="kv">
      {detail.columns.map((column, index) => {
        const cell = detail.row[index];
        const json = cell ? parseJSON(cell.v) : undefined;
        return (
          <React.Fragment key={column.name}>
            <div className="key">{column.name}</div>
            <div className="value">
              {cell === null ? <span className="null">null</span> : json !== undefined ? <JSONTree value={json} /> : <pre>{cell.v}</pre>}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function JSONTree({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <details className="json-node" open>
        <summary>Array [{value.length}]</summary>
        <div>
          {value.map((item, index) => (
            <div className="json-row" key={index}>
              <span className="json-key">{index}</span>
              <JSONTree value={item} />
            </div>
          ))}
        </div>
      </details>
    );
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <details className="json-node" open>
        <summary>Object {"{" + entries.length + "}"}</summary>
        <div>
          {entries.map(([key, item]) => (
            <div className="json-row" key={key}>
              <span className="json-key">{key}</span>
              <JSONTree value={item} />
            </div>
          ))}
        </div>
      </details>
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
    obj[column.name] = cell === null ? null : parseJSON(cell.v) ?? cell.v;
  });
  return JSON.stringify(obj, null, 2);
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
