// Collapsible JSON tree viewer (no dependencies), inspired by jsonviewer.stack.hu.
// JsonView.render(value) -> DOM element. Each object/array node has a toggle to
// collapse/expand that region individually; expandAll/collapseAll do the lot.
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function isContainer(v) {
    return v !== null && typeof v === "object";
  }

  // Build a node for `value` optionally labelled with `key` (string or index).
  function node(key, value, isLast) {
    const wrap = el("div", "jv-node");
    const line = el("div", "jv-line");
    wrap.appendChild(line);

    const keyHtml = key == null ? null : el("span", "jv-key", typeof key === "number" ? key : JSON.stringify(key));
    const colon = key == null ? null : el("span", "jv-punc", ": ");

    if (!isContainer(value)) {
      if (keyHtml) { line.appendChild(keyHtml); line.appendChild(colon); }
      line.appendChild(primitive(value));
      if (!isLast) line.appendChild(el("span", "jv-punc", ","));
      return wrap;
    }

    const isArr = Array.isArray(value);
    const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
    const open = isArr ? "[" : "{";
    const close = isArr ? "]" : "}";

    const toggle = el("span", "jv-toggle", "▾");
    line.appendChild(toggle);
    if (keyHtml) { line.appendChild(keyHtml); line.appendChild(colon); }
    line.appendChild(el("span", "jv-punc", open));
    const badge = el("span", "jv-badge", String(entries.length));
    line.appendChild(badge);
    const ellipsis = el("span", "jv-ellipsis hidden", " … ");
    line.appendChild(ellipsis);

    const children = el("div", "jv-children");
    entries.forEach(([k, v], i) => children.appendChild(node(k, v, i === entries.length - 1)));
    wrap.appendChild(children);

    const closeLine = el("div", "jv-closeline");
    closeLine.appendChild(el("span", "jv-punc", close));
    if (!isLast) closeLine.appendChild(el("span", "jv-punc", ","));
    wrap.appendChild(closeLine);

    function setCollapsed(c) {
      wrap.classList.toggle("collapsed", c);
      toggle.textContent = c ? "▸" : "▾";
      children.classList.toggle("hidden", c);
      closeLine.classList.toggle("hidden", c);
      ellipsis.classList.toggle("hidden", !c);
    }
    toggle.addEventListener("click", () => setCollapsed(!wrap.classList.contains("collapsed")));
    line.addEventListener("dblclick", () => setCollapsed(!wrap.classList.contains("collapsed")));
    wrap._setCollapsed = setCollapsed;
    return wrap;
  }

  function primitive(v) {
    if (v === null) return el("span", "jv-null", "null");
    switch (typeof v) {
      case "number": return el("span", "jv-num", String(v));
      case "boolean": return el("span", "jv-bool", String(v));
      case "string": return el("span", "jv-str", JSON.stringify(v));
      default: return el("span", "jv-str", String(v));
    }
  }

  function walk(root, fn) {
    root.querySelectorAll(".jv-node").forEach((n) => { if (n._setCollapsed) fn(n); });
  }

  window.JsonView = {
    render(value) {
      const root = el("div", "jv");
      root.appendChild(node(null, value, true));
      return root;
    },
    expandAll(root) { walk(root, (n) => n._setCollapsed(false)); },
    collapseAll(root) {
      // collapse everything except the very top node, so the structure stays visible
      const top = root.querySelector(".jv-node");
      walk(root, (n) => { if (n !== top) n._setCollapsed(true); });
    },
    // collapse to a given depth (top = depth 0 visible)
    collapseToDepth(root, depth) {
      root.querySelectorAll(".jv-node").forEach((n) => {
        if (!n._setCollapsed) return;
        let d = 0, p = n.parentElement;
        while (p && p !== root) { if (p.classList.contains("jv-children")) d++; p = p.parentElement; }
        n._setCollapsed(d >= depth);
      });
    },
  };
})();
