// DB Viewer UI. Talks to the read-only introspection API and renders tables,
// rows, and a collapsible JSON viewer for JSON columns. Embeddable via iframe
// (?embed=1 hides the topbar; ?table=NAME preselects a table).
const params = new URLSearchParams(location.search);
if (params.get("embed") === "1") document.body.classList.add("embed");

// Base path the app is served under. Empty at the domain root; "/db" when a
// project reverse-proxies dbview under /db/* — so the UI works both as its own
// subdomain and embedded under any existing project's domain (no new DNS).
const BASE = location.pathname.replace(/\/[^/]*$/, "");

const $ = (id) => document.getElementById(id);
let tables = [];
let current = null; // { name, page, size, order, dir, columns }

async function api(path, opts) {
  const res = await fetch(`${BASE}/api${path}`, { credentials: "same-origin", ...opts });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error || res.statusText);
  return body;
}

// --- JSON detection ---------------------------------------------------------
function tryJSON(s) {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    const v = JSON.parse(t);
    return v !== null && typeof v === "object" ? v : undefined;
  } catch { return undefined; }
}

// --- auth -------------------------------------------------------------------
async function boot() {
  const me = await api("/me").catch(() => ({ authed: false, authRequired: true }));
  if (me.authRequired && !me.authed) { showLogin(); return; }
  showApp(me);
  await loadTables();
  const pre = params.get("table");
  if (pre) selectTable(pre.toUpperCase());
}
function showLogin() { $("login").classList.remove("hidden"); $("app").classList.add("hidden"); }
function showApp(me) {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("logout").classList.toggle("hidden", !me.authRequired);
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await api("/login", { method: "POST", body: JSON.stringify({ password: $("pw").value }) }); location.reload(); }
  catch (err) { $("loginError").textContent = err.message; }
});
$("logout").addEventListener("click", async () => { await api("/logout", { method: "POST" }); location.reload(); });

// --- tables list ------------------------------------------------------------
async function loadTables() {
  tables = await api("/tables");
  renderTableList(tables);
}
function renderTableList(list) {
  const q = $("tableFilter").value.trim().toLowerCase();
  const el = $("tableList");
  el.innerHTML = "";
  list.filter((t) => !q || t.name.toLowerCase().includes(q)).forEach((t) => {
    const row = document.createElement("div");
    row.className = "table-item" + (current && current.name === t.name ? " active" : "");
    row.innerHTML = `<span class="tname">${esc(t.name)}</span><span class="tcount">${t.rows >= 0 ? fmt(t.rows) : ""}</span>`;
    row.addEventListener("click", () => selectTable(t.name));
    el.appendChild(row);
  });
}
$("tableFilter").addEventListener("input", () => renderTableList(tables));

// --- table view -------------------------------------------------------------
async function selectTable(name) {
  current = { name, page: 1, size: Number($("pageSize").value) || 50, order: "", dir: "asc" };
  renderTableList(tables);
  await loadRows();
}
async function loadRows() {
  if (!current) return;
  $("empty").classList.add("hidden");
  $("tableView").classList.remove("hidden");
  $("tvName").textContent = current.name;
  $("tvCount").textContent = "loading…";
  const qs = new URLSearchParams({ page: current.page, size: current.size, order: current.order, dir: current.dir });
  let page;
  try { page = await api(`/tables/${encodeURIComponent(current.name)}/rows?${qs}`); }
  catch (e) { $("tvCount").textContent = ""; $("grid").innerHTML = `<tbody><tr><td class="err">${esc(e.message)}</td></tr></tbody>`; return; }
  current.columns = page.columns;
  current.order = page.order; current.dir = page.dir;
  renderGrid(page);
  const from = (page.page - 1) * page.size + 1;
  const to = Math.min(page.total, from + page.rows.length - 1);
  $("tvCount").textContent = `${fmt(page.total)} rows`;
  $("pageInfo").textContent = page.total ? `${fmt(from)}–${fmt(to)}` : "0";
  $("prev").disabled = page.page <= 1;
  $("next").disabled = to >= page.total;
}
function renderGrid(page) {
  const grid = $("grid");
  const cols = page.columns;
  const thead = `<thead><tr><th class="rownum">#</th>${cols.map((c) => {
    const arrow = c.name === page.order ? `<span class="arrow">${page.dir === "DESC" ? "▼" : "▲"}</span>` : "";
    return `<th data-col="${esc(c.name)}" title="${esc(c.type)}">${esc(c.name)}<span class="coltype">${esc(c.type)}</span>${arrow}</th>`;
  }).join("")}</tr></thead>`;
  const startNum = (page.page - 1) * page.size;
  const tbody = "<tbody>" + page.rows.map((row, ri) => {
    const cells = row.map((cell, ci) => `<td>${cellHtml(cell, ci)}</td>`).join("");
    return `<tr data-ri="${ri}"><td class="rownum">${startNum + ri + 1}</td>${cells}</tr>`;
  }).join("") + "</tbody>";
  grid.innerHTML = thead + tbody;

  grid.querySelectorAll("thead th[data-col]").forEach((th) =>
    th.addEventListener("click", () => sortBy(th.dataset.col)));
  grid.querySelectorAll("tbody tr").forEach((tr) =>
    tr.addEventListener("click", (e) => { if (!e.target.closest(".json-chip,.cell-more")) openRow(page, Number(tr.dataset.ri)); }));
  grid.querySelectorAll("[data-json]").forEach((n) =>
    n.addEventListener("click", (e) => { e.stopPropagation(); openJSON(n.dataset.col, JSON.parse(n.dataset.json)); }));
  grid.querySelectorAll(".cell-more").forEach((n) =>
    n.addEventListener("click", (e) => { e.stopPropagation(); openText(n.dataset.col, n.dataset.full); }));

  // cache raw page for row dialog
  grid._page = page;
}
function cellHtml(cell, ci) {
  if (cell === null) return `<span class="cell-null">null</span>`;
  const col = (current.columns[ci] || {}).name || "";
  if (cell.bin) return `<span class="cell">${esc(cell.v)}</span>`;
  const j = tryJSON(cell.v);
  if (j !== undefined) {
    const preview = esc(cell.v.length > 60 ? cell.v.slice(0, 60) + "…" : cell.v);
    return `<span class="json-chip" data-json='${attr(cell.v)}' data-col="${esc(col)}">${Array.isArray(j) ? "[ ]" : "{ }"} ${preview}</span>`;
  }
  const v = cell.v;
  if (v.length > 240) {
    return `<span class="cell clip">${esc(v.slice(0, 240))}…</span> <span class="cell-more" data-col="${esc(col)}" data-full="${attr(v)}">more</span>`;
  }
  return `<span class="cell">${esc(v)}</span>`;
}
function sortBy(col) {
  if (current.order === col) current.dir = current.dir === "ASC" ? "desc" : "asc";
  else { current.order = col; current.dir = "asc"; }
  current.page = 1;
  loadRows();
}
$("pageSize").addEventListener("change", () => { if (current) { current.size = Number($("pageSize").value); current.page = 1; loadRows(); } });
$("prev").addEventListener("click", () => { if (current && current.page > 1) { current.page--; loadRows(); } });
$("next").addEventListener("click", () => { if (current) { current.page++; loadRows(); } });
$("reload").addEventListener("click", () => loadRows());

// --- cell / row dialogs -----------------------------------------------------
function openJSON(title, value) {
  $("cellTitle").textContent = title || "JSON";
  const body = $("cellBody"); body.innerHTML = "";
  const tree = JsonView.render(value);
  body.appendChild(tree);
  toggleJV(true, tree);
  $("cellCopy").onclick = () => navigator.clipboard?.writeText(JSON.stringify(value, null, 2));
  $("cellDialog").showModal();
}
function openText(title, text) {
  $("cellTitle").textContent = title || "Value";
  const body = $("cellBody"); body.innerHTML = "";
  const pre = document.createElement("pre"); pre.textContent = text; body.appendChild(pre);
  toggleJV(false);
  $("cellCopy").onclick = () => navigator.clipboard?.writeText(text);
  $("cellDialog").showModal();
}
function openRow(page, ri) {
  const row = page.rows[ri];
  $("cellTitle").textContent = `${page.table} — row ${(page.page - 1) * page.size + ri + 1}`;
  const body = $("cellBody"); body.innerHTML = "";
  const kv = document.createElement("div"); kv.className = "kv";
  page.columns.forEach((c, ci) => {
    const cell = row[ci];
    const k = document.createElement("div"); k.className = "k"; k.textContent = c.name;
    const v = document.createElement("div"); v.className = "v";
    if (cell === null) v.innerHTML = `<span class="cell-null">null</span>`;
    else {
      const j = tryJSON(cell.v);
      if (j !== undefined) {
        const t = JsonView.render(j); v.appendChild(t);
      } else { const pre = document.createElement("pre"); pre.textContent = cell.v; v.appendChild(pre); }
    }
    kv.appendChild(k); kv.appendChild(v);
  });
  body.appendChild(kv);
  toggleJV(true, body);
  $("cellCopy").onclick = () => {
    const obj = {};
    page.columns.forEach((c, ci) => { obj[c.name] = row[ci] === null ? null : (tryJSON(row[ci].v) ?? row[ci].v); });
    navigator.clipboard?.writeText(JSON.stringify(obj, null, 2));
  };
  $("cellDialog").showModal();
}
function toggleJV(show, root) {
  $("jvExpand").classList.toggle("hidden", !show);
  $("jvCollapse").classList.toggle("hidden", !show);
  if (show && root) {
    $("jvExpand").onclick = () => JsonView.expandAll(root);
    $("jvCollapse").onclick = () => JsonView.collapseAll(root);
  }
}
$("cellClose").addEventListener("click", () => $("cellDialog").close());
$("cellDialog").addEventListener("click", (e) => { if (e.target === $("cellDialog")) $("cellDialog").close(); });

// --- helpers ----------------------------------------------------------------
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function attr(s) { return esc(s).replace(/'/g, "&#39;"); }
function fmt(n) { return Number(n).toLocaleString(); }

boot().catch((e) => { document.body.innerHTML = `<pre style="padding:20px;color:#c0392b">${esc(e.message)}</pre>`; });
