import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const note = {
  kind: "note",
  id: "N20260918-101500",
  text: "原因を調査した",
  task_id: "T20260918-01",
  minutes: 15,
  machine: "macmini",
  ts: "2026-09-18T10:15:00",
};

describe("notes", () => {
  beforeEach(resetDb);

  it("PUT upserts idempotently", async () => {
    const put = () => api(`/api/notes/${note.id}`, { method: "PUT", body: JSON.stringify(note) });
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(200);
    const stats = (await (await api("/api/stats")).json()) as any;
    expect(stats.notes).toBe(1);
  });

  it("accepts null task_id and minutes", async () => {
    const r = await api(`/api/notes/${note.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...note, task_id: null, minutes: null }),
    });
    expect(r.status).toBe(200);
  });

  it("rejects empty text", async () => {
    const r = await api(`/api/notes/${note.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...note, text: "" }),
    });
    expect(r.status).toBe(400);
  });
});
