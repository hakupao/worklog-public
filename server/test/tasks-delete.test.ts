import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;

const post = (body: unknown) => api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
const del = (id: string, updatedAt?: string) =>
  api(`/api/tasks/${id}${updatedAt === undefined ? "" : `?updated_at=${encodeURIComponent(updatedAt)}`}`, { method: "DELETE" });

/** A task with no sessions and no notes pointing at it. */
const freshTask = async () => (await (await post({ requester: "田中さん", title: "消す案件", received_at: "2026-09-22" })).json()) as any;

/** One ingested session, linked to `taskId` — the same shape tasks-edit.test.ts uses for detail. */
const linkSession = (id: string, taskId: string) =>
  api("/api/ingest/sessions", {
    method: "POST",
    body: JSON.stringify({
      machine: "macmini",
      sessions: [
        {
          id, machine: "macmini", agent: "codex", session_id: `${id}-x`, cwd: "/w",
          started_at: "2026-09-22T01:00:00Z", ended_at: "2026-09-22T02:00:00Z", active_minutes: 60, turns: 3,
          summary: "s", summary_source: "llm", task_id: taskId, link_method: "auto-dir", ts: "2026-09-22T12:00:00",
        },
      ],
    }),
  });

describe("tasks: delete", () => {
  beforeEach(resetDb);

  it("DELETE without updated_at is a 400 naming the missing parameter", async () => {
    const t = await freshTask();
    const r = await del(t.id);
    expect(r.status).toBe(400);
    const body = (await r.json()) as any;
    expect(body.error).toBe("invalid");
    expect(body.issues[0]).toEqual({ path: "updated_at", message: "required" });
    // The task is untouched.
    expect((await api(`/api/tasks/${t.id}`)).status).toBe(200);
  });

  it("deletes a task with no links and the row is really gone", async () => {
    const t = await freshTask();
    const r = await del(t.id, t.updated_at);
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
    expect((await api(`/api/tasks/${t.id}`)).status).toBe(404);
    expect((await (await api("/api/tasks")).json()) as any[]).toEqual([]);
  });

  it("refuses a task a session still points at, reporting both counts", async () => {
    const t = await freshTask();
    expect((await linkSession("Sdel1", t.id)).status).toBe(200);
    const r = await del(t.id, t.updated_at);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "linked", sessions: 1, notes: 0, plans: 0 });
    // Refused means refused: the row is still there.
    expect((await api(`/api/tasks/${t.id}`)).status).toBe(200);
  });

  it("refuses a task a note still points at, reporting both counts", async () => {
    const t = await freshTask();
    const n = await api("/api/notes", { method: "POST", body: JSON.stringify({ text: "memo", task_id: t.id }) });
    expect(n.status).toBe(201);
    const r = await del(t.id, t.updated_at);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "linked", sessions: 0, notes: 1, plans: 0 });
    expect((await api(`/api/tasks/${t.id}`)).status).toBe(200);
  });

  it("counts sessions and notes separately when both are linked", async () => {
    const t = await freshTask();
    await linkSession("Sdel1", t.id);
    await linkSession("Sdel2", t.id);
    await api("/api/notes", { method: "POST", body: JSON.stringify({ text: "memo", task_id: t.id }) });
    const r = await del(t.id, t.updated_at);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "linked", sessions: 2, notes: 1, plans: 0 });
  });

  it("refuses while a plan item or a day-plan item links the task, and counts them", async () => {
    const t = await freshTask();
    const now = new Date().toISOString();
    await db().prepare(
      "INSERT INTO plan_items (id, horizon, text, status, created_at, updated_at) VALUES ('P1','daily','x','active',?1,?1)",
    ).bind(now).run();
    await db().prepare("INSERT INTO plan_item_tasks (plan_item_id, task_id) VALUES ('P1', ?1)").bind(t.id).run();
    const r = await del(t.id, t.updated_at);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "linked", sessions: 0, notes: 0, plans: 1 });

    await db().prepare("DELETE FROM plan_item_tasks").run();
    await db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES ('2026-10-02', ?1, ?1)").bind(now).run();
    await db().prepare(
      "INSERT INTO day_plan_items (id, date, text, updated_at) VALUES ('D1','2026-10-02','x',?1)",
    ).bind(now).run();
    await db().prepare("INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) VALUES ('D1', ?1)").bind(t.id).run();
    const r2 = await del(t.id, t.updated_at);
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as any).plans).toBe(1);
  });

  it("the guard reads only the link tables: a value left in the old task_id columns does not block", async () => {
    const t = await freshTask();
    const now = new Date().toISOString();
    await db().prepare(
      "INSERT INTO plan_items (id, horizon, text, task_id, status, created_at, updated_at) VALUES ('P2','daily','x',?1,'active',?2,?2)",
    ).bind(t.id, now).run();
    await db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES ('2026-10-03', ?1, ?1)").bind(now).run();
    await db().prepare(
      "INSERT INTO day_plan_items (id, date, task_id, text, updated_at) VALUES ('D2','2026-10-03',?1,'x',?2)",
    ).bind(t.id, now).run();
    expect((await del(t.id, t.updated_at)).status).toBe(204);
  });

  it("a stale updated_at is a conflict carrying the current row, not a linked refusal", async () => {
    const t = await freshTask();
    const r = await del(t.id, "2000-01-01T00:00:00.000Z");
    expect(r.status).toBe(409);
    const body = (await r.json()) as any;
    expect(body.error).toBe("conflict");
    expect(body.current.id).toBe(t.id);
    // Same decoding as every other tasks response (toJson), never the raw stored string.
    expect(Array.isArray(body.current.deliverables)).toBe(true);
    expect((await api(`/api/tasks/${t.id}`)).status).toBe(200);
  });

  it("an unknown id is a 404, whatever updated_at is sent", async () => {
    expect((await del("T19990101-01", "2000-01-01T00:00:00.000Z")).status).toBe(404);
    const r = await del("T19990101-01", "x");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not found" });
  });

  it("leaves another task's links alone: they never block this one's delete", async () => {
    const keep = (await (await post({ requester: "田中さん", title: "残す案件", received_at: "2026-09-22" })).json()) as any;
    await linkSession("Skeep", keep.id);
    await api("/api/notes", { method: "POST", body: JSON.stringify({ text: "memo", task_id: keep.id }) });
    const doomed = (await (await post({ requester: "田中さん", title: "消す案件", received_at: "2026-09-22" })).json()) as any;

    expect((await del(doomed.id, doomed.updated_at)).status).toBe(204);
    expect((await api(`/api/tasks/${keep.id}`)).status).toBe(200);
    // And the task that still has links is still refused, with only ITS OWN counts.
    const refused = await del(keep.id, keep.updated_at);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "linked", sessions: 1, notes: 1, plans: 0 });
  });

  // Report overrides are keyed by coordinates, not by a foreign key, and task ids are re-used —
  // so an orphan override would reattach itself to whichever task next gets that id.
  describe("report overrides", () => {
    const WEEK = "2026-W39";
    const putCell = (row_key: string, column: string, value: string) =>
      api(`/api/reports/${WEEK}/weekly/cells`, {
        method: "PUT",
        body: JSON.stringify({ sheet: "tasks", row_key, column, value }),
      });
    const rowKeys = async () =>
      ((await db().prepare("SELECT row_key FROM report_overrides ORDER BY row_key").all<{ row_key: string }>()).results).map(
        (r) => r.row_key,
      );

    it("takes the deleted task's overrides with it, in every sheet shape, and leaves other rows alone", async () => {
      const doomed = await freshTask();
      const keep = (await (await post({ requester: "田中さん", title: "残す案件", received_at: "2026-09-22" })).json()) as any;

      // The tasks sheet stores the bare id; the retired 派遣元 日別 sheet stored `<date>|<id>`.
      expect((await putCell(doomed.id, "title", "手入力")).status).toBe(200);
      expect((await putCell(`2026-09-22|${doomed.id}`, "title", "手入力2")).status).toBe(200);
      expect((await putCell(keep.id, "title", "残す")).status).toBe(200);
      expect((await putCell(`2026-09-22|${keep.id}`, "title", "残す2")).status).toBe(200);
      // An unassigned day row must survive too: its id half is "-", never a task id.
      expect((await putCell("2026-09-22|-", "title", "未紐付け")).status).toBe(200);
      // The 成果物 sheet: `<id>|<index>` for a hand-picked one, `<id>|d:<hash>` for an automatic one.
      expect((await putCell(`${doomed.id}|0`, "path", "手入力3")).status).toBe(200);
      expect((await putCell(`${doomed.id}|d:0a1b2c3d`, "path", "手入力4")).status).toBe(200);
      expect((await putCell(`${keep.id}|d:0a1b2c3d`, "path", "残す3")).status).toBe(200);

      expect((await del(doomed.id, doomed.updated_at)).status).toBe(204);

      expect(await rowKeys()).toEqual([`2026-09-22|-`, `2026-09-22|${keep.id}`, keep.id, `${keep.id}|d:0a1b2c3d`].sort());
    });

    it("keeps them when the delete is REFUSED", async () => {
      const t = await freshTask();
      await putCell(t.id, "title", "手入力");
      await linkSession("Sdel1", t.id);

      expect((await del(t.id, t.updated_at)).status).toBe(409);
      expect(await rowKeys()).toEqual([t.id]);

      // …and a stale token is equally not a reason to drop them.
      expect((await del(t.id, "2000-01-01T00:00:00.000Z")).status).toBe(409);
      expect(await rowKeys()).toEqual([t.id]);
    });

    it("an id a later task inherits starts with no overrides of its own", async () => {
      const first = (await (await post({ requester: "田中さん", title: "一件目", received_at: "2026-09-22" })).json()) as any;
      await putCell(first.id, "title", "一件目の手入力");
      expect((await del(first.id, first.updated_at)).status).toBe(204);

      // Same received date, so the allocator hands out the very same id again.
      const reused = (await (await post({ requester: "田中さん", title: "二件目", received_at: "2026-09-22" })).json()) as any;
      expect(reused.id).toBe(first.id);
      expect(await rowKeys()).toEqual([]);
    });
  });

  // The refusal is a "unlink first" instruction, so the unlinking has to actually unblock it.
  it("unlinking the last session makes the same delete succeed", async () => {
    const t = await freshTask();
    await linkSession("Sdel1", t.id);
    expect((await del(t.id, t.updated_at)).status).toBe(409);

    const session = (await (await api("/api/weeks/2026-W39/timeline")).json()) as any;
    const updatedAt = session.days.flatMap((d: any) => d.sessions).find((s: any) => s.id === "Sdel1").updated_at;
    const unlinked = await api("/api/sessions/Sdel1", {
      method: "PATCH",
      body: JSON.stringify({ updated_at: updatedAt, task_id: null }),
    });
    expect(unlinked.status).toBe(200);

    expect((await del(t.id, t.updated_at)).status).toBe(204);
    expect((await api(`/api/tasks/${t.id}`)).status).toBe(404);
  });
});
