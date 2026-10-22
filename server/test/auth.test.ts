import { describe, expect, it } from "vitest";
import { api, rawFetch } from "./helpers";

describe("auth", () => {
  it("health is public", async () => {
    const r = await rawFetch("/api/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("rejects missing token", async () => {
    const r = await rawFetch("/api/stats");
    expect(r.status).toBe(401);
  });

  it("rejects wrong token", async () => {
    const r = await rawFetch("/api/stats", { headers: { Authorization: "Bearer nope" } });
    expect(r.status).toBe(401);
  });

  it("accepts correct token (route may not exist yet -> not 401)", async () => {
    const r = await api("/api/__nothing__");
    expect(r.status).toBe(404);
  });

  // Phase A review, S2: the report routes (plan 3) carry the whole week's work and the xlsx a
  // person downloads, so every one of them is pinned here rather than trusting that the one
  // /api/stats case above still speaks for the whole app's middleware.
  describe("report routes require credentials", () => {
    const WEEK = "2026-W39";
    const CELL = { sheet: "tasks", row_key: "T1", column: "title" };

    const cases: Array<[string, () => Promise<Response>]> = [
      ["GET preview", () => rawFetch(`/api/reports/${WEEK}/weekly`)],
      [
        "PUT cell override",
        () =>
          rawFetch(`/api/reports/${WEEK}/weekly/cells`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...CELL, value: "手入力" }),
          }),
      ],
      [
        "DELETE cell override",
        () =>
          rawFetch(
            `/api/reports/${WEEK}/weekly/cells?sheet=${CELL.sheet}&row_key=${CELL.row_key}&column=${CELL.column}`,
            { method: "DELETE" },
          ),
      ],
      ["GET xlsx", () => rawFetch(`/api/reports/${WEEK}/weekly/xlsx`)],
    ];

    for (const [name, send] of cases) {
      it(`${name} without credentials is 401 unauthorized`, async () => {
        const r = await send();
        expect(r.status).toBe(401);
        expect(await r.json()).toEqual({ error: "unauthorized" });
      });
    }
  });
});
