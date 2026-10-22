import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";
import { jstNow } from "../src/jst";

const post = (body: unknown) => api("/api/notes", { method: "POST", body: JSON.stringify(body) });

describe("notes: create / edit / delete", () => {
  beforeEach(resetDb);

  it("creates a note for today (JST) by default", async () => {
    const r = await post({ text: "打ち合わせ", minutes: 30 });
    expect(r.status).toBe(201);
    const n = (await r.json()) as any;
    expect(n.ts.slice(0, 10)).toBe(jstNow().date);
    expect(n.id).toMatch(/^N\d{8}-\d{6}$/);
    expect([n.text, n.minutes, n.task_id, n.machine]).toEqual(["打ち合わせ", 30, null, "web"]);
  });

  it("can be back-dated, and shows up on that day of the timeline", async () => {
    const n = (await (await post({ text: "過去分", minutes: 20, date: "2026-09-22" })).json()) as any;
    expect(n.ts.slice(0, 10)).toBe("2026-09-22");
    const t = (await (await api("/api/weeks/2026-W39/timeline")).json()) as any;
    expect(t.days[1].notes.map((x: any) => x.id)).toEqual([n.id]);
  });

  it("two notes in the same second get distinct ids", async () => {
    const [a, b] = await Promise.all([post({ text: "a", date: "2026-09-22" }), post({ text: "b", date: "2026-09-22" })]);
    const ids = [((await a.json()) as any).id, ((await b.json()) as any).id];
    expect(new Set(ids).size).toBe(2);
  });

  it("rejects an unknown task", async () => {
    const r = await post({ text: "x", task_id: "T19990101-01" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).issues[0]).toEqual({ path: "task_id", message: "unknown task" });
  });

  it("rejects an empty string task_id on create and edit, but null still passes", async () => {
    expect((await post({ text: "x", task_id: "" })).status).toBe(400);
    expect((await post({ text: "x", task_id: null })).status).toBe(201);
    const n = (await (await post({ text: "old", date: "2026-09-22" })).json()) as any;
    const rejected = await api(`/api/notes/${n.id}`, {
      method: "PATCH",
      body: JSON.stringify({ updated_at: n.updated_at, task_id: "" }),
    });
    expect(rejected.status).toBe(400);
    const accepted = await api(`/api/notes/${n.id}`, {
      method: "PATCH",
      body: JSON.stringify({ updated_at: n.updated_at, task_id: null }),
    });
    expect(accepted.status).toBe(200);
  });

  it("PATCH edits; stale -> 409; unknown -> 404", async () => {
    const n = (await (await post({ text: "old", date: "2026-09-22" })).json()) as any;
    const ok = await api(`/api/notes/${n.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: n.updated_at, text: "new", minutes: 5 }) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).text).toBe("new");
    const stale = await api(`/api/notes/${n.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: n.updated_at, text: "lost" }) });
    expect(stale.status).toBe(409);
    expect((await api("/api/notes/Nnope", { method: "PATCH", body: JSON.stringify({ updated_at: "x", text: "y" }) })).status).toBe(404);
  });

  it("409 responses on PATCH and DELETE carry the note's id in current", async () => {
    const n = (await (await post({ text: "old", date: "2026-09-22" })).json()) as any;
    const stalePatch = await api(`/api/notes/${n.id}`, {
      method: "PATCH",
      body: JSON.stringify({ updated_at: "2000-01-01T00:00:00.000Z", text: "x" }),
    });
    expect(stalePatch.status).toBe(409);
    expect(((await stalePatch.json()) as any).current.id).toBe(n.id);

    const staleDelete = await api(`/api/notes/${n.id}?updated_at=2000-01-01T00:00:00.000Z`, { method: "DELETE" });
    expect(staleDelete.status).toBe(409);
    expect(((await staleDelete.json()) as any).current.id).toBe(n.id);
  });

  it("DELETE requires the current updated_at", async () => {
    const n = (await (await post({ text: "bye", date: "2026-09-22" })).json()) as any;
    expect((await api(`/api/notes/${n.id}`, { method: "DELETE" })).status).toBe(400);
    expect((await api(`/api/notes/${n.id}?updated_at=2000-01-01T00:00:00.000Z`, { method: "DELETE" })).status).toBe(409);
    expect((await api(`/api/notes/${n.id}?updated_at=${encodeURIComponent(n.updated_at)}`, { method: "DELETE" })).status).toBe(204);
    expect(((await (await api("/api/stats")).json()) as any).notes).toBe(0);
    expect((await api(`/api/notes/${n.id}?updated_at=x`, { method: "DELETE" })).status).toBe(404);
  });
});
