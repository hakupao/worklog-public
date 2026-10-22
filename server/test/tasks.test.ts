import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const task = (over: Record<string, unknown> = {}) => ({
  kind: "task",
  schema_version: 1,
  id: "T20260918-01",
  requester: "田中さん（営業部）",
  project: "order",
  title: "帳票修正",
  status: "open",
  received_at: "2026-09-18",
  done_at: null,
  thinking: "",
  deliverables: [],
  hours_manual: null,
  machine: "macmini",
  ts: "2026-09-18T10:00:00",
  ...over,
});

const put = (id: string, body: unknown) =>
  api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) });

describe("tasks", () => {
  beforeEach(resetDb);

  it("PUT creates, GET lists with deliverables as array", async () => {
    expect((await put("T20260918-01", task({ deliverables: ["a.xlsx"] }))).status).toBe(200);
    const list = (await (await api("/api/tasks")).json()) as any[];
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("帳票修正");
    expect(list[0].deliverables).toEqual(["a.xlsx"]);
    expect(list[0].updated_at).toBeTruthy();
  });

  it("PUT is an idempotent full upsert", async () => {
    await put("T20260918-01", task());
    await put("T20260918-01", task({ status: "done", done_at: "2026-09-19", hours_manual: 2 }));
    const list = (await (await api("/api/tasks")).json()) as any[];
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("done");
    expect(list[0].done_at).toBe("2026-09-19");
    expect(list[0].hours_manual).toBe(2);
  });

  it("filters by comma-separated status", async () => {
    await put("T20260918-01", task());
    await put("T20260918-02", task({ id: "T20260918-02", status: "done", done_at: "2026-09-18" }));
    await put("T20260918-03", task({ id: "T20260918-03", status: "hold" }));
    const list = (await (await api("/api/tasks?status=open,hold")).json()) as any[];
    expect(list.map((t) => t.id)).toEqual(["T20260918-01", "T20260918-03"]);
  });

  it("rejects invalid body with field path", async () => {
    const r = await put("T20260918-01", task({ status: "bogus" }));
    expect(r.status).toBe(400);
    const body = (await r.json()) as any;
    expect(body.error).toBe("invalid");
    expect(body.issues[0].path).toBe("status");
  });

  // PUT is the only way a collector or the CLI writes hours, so it needs the same floor PATCH has:
  // a negative override would subtract from the weekly report's total.
  it("rejects a negative hours_manual but keeps zero a valid override", async () => {
    const r = await put("T20260918-01", task({ hours_manual: -1 }));
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).issues[0].path).toBe("hours_manual");

    expect((await put("T20260918-01", task({ hours_manual: 0 }))).status).toBe(200);
    const list = (await (await api("/api/tasks")).json()) as any[];
    expect(list[0].hours_manual).toBe(0);
  });
});
