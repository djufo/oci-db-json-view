import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  );
}

const rowsPage = {
  table: "ORDERS",
  columns: [
    { name: "ID", type: "NUMBER", nullable: false, jsonish: false },
    { name: "PAYLOAD", type: "CLOB", nullable: true, jsonish: true }
  ],
  rows: [[{ v: "1" }, { v: '{"a":1}' }], [{ v: "2" }, null]],
  total: 2,
  page: 1,
  size: 50,
  order: "",
  dir: "ASC"
};

describe("dbview App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/api/me")) return json({ authed: true, authRequired: false, readOnly: true });
        if (url.endsWith("/api/tables")) return json([{ name: "ORDERS", rows: 2 }, { name: "USERS", rows: 10 }]);
        if (url.includes("/api/tables/ORDERS/rows")) return json(rowsPage);
        return json({ error: "not found" }, 404);
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("lists tables and renders the selected table with a JSON chip", async () => {
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Tables" });
    expect(await within(nav).findByText("USERS")).toBeInTheDocument();
    const grid = await screen.findByRole("table", { name: "ORDERS rows" });
    expect(within(grid).getByText("PAYLOAD")).toBeInTheDocument();
    await waitFor(() => expect(within(grid).getByText(/\{ \}/)).toBeInTheDocument());
    expect(within(grid).getByText("null")).toBeInTheDocument();
  });

  it("asks for a password when auth is required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ authed: false, authRequired: true, readOnly: true }))
    );
    render(<App />);
    expect(await screen.findByLabelText("Access password")).toBeInTheDocument();
  });

  it("keeps Enter and Space on a JSON chip from opening the row details", async () => {
    render(<App />);
    const grid = await screen.findByRole("table", { name: "ORDERS rows" });
    const chip = await within(grid).findByText(/\{ \}/);
    fireEvent.keyDown(chip.closest("button") as HTMLElement, { key: "Enter" });
    fireEvent.keyDown(chip.closest("button") as HTMLElement, { key: " " });
    expect(screen.queryByText(/ORDERS row 1/)).toBeNull();
  });

  it("clears the typed password after signing out", async () => {
    let authed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith("/api/login")) { authed = true; return json({}); }
        if (url.endsWith("/api/logout")) { authed = false; return json({}); }
        if (url.endsWith("/api/me")) return json({ authed, authRequired: true, readOnly: true });
        if (url.endsWith("/api/tables")) return json([]);
        void init;
        return json({ error: "not found" }, 404);
      })
    );
    render(<App />);
    const field = await screen.findByLabelText("Access password");
    fireEvent.change(field, { target: { value: "secret" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    const signOut = await screen.findByRole("button", { name: /sign out/i });
    fireEvent.click(signOut);
    expect(((await screen.findByLabelText("Access password")) as HTMLInputElement).value).toBe("");
  });
});
