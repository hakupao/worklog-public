import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const D = "2026-10-02";
const session = (id: string, over: Record<string, unknown> = {}) => ({
  id, machine: "macmini", agent: "claude-code", session_id: `${id}-x`, cwd: "/Users/me/Project/worklog",
  started_at: "2026-10-02T01:00:00Z", ended_at: "2026-10-02T02:00:00Z", active_minutes: 60, turns: 6,
  summary: `summary ${id}`, summary_source: "llm", task_id: null, link_method: "none", ts: "2026-10-02T11:00:00", ...over,
});
const ingest = (...s: unknown[]) => api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions: s }) });
const input = async () => (await (await api(`/api/day-plans/${D}/judge-input`)).json()) as any;
const judge = (body: unknown) => api(`/api/day-plans/${D}/judgement`, { method: "POST", body: JSON.stringify(body) });
const setup = async () => {
  await api(`/api/day-plans/${D}/start`, { method: "POST" });
  return (await (await api(`/api/day-plans/${D}/items`, { method: "POST", body: JSON.stringify({ text: "worklog", detail: "至少 2 轮" }) })).json()) as any;
};

describe("judge input / judgement", () => {
  beforeEach(resetDb);

  it("404 without a plan", async () => {
    expect((await api(`/api/day-plans/${D}/judge-input`)).status).toBe(404);
  });

  it("gives the day's items, sessions and notes; hidden sessions and other days are left out", async () => {
    const item = await setup();
    await ingest(
      session("S1"),
      session("S2", { started_at: "2026-10-03T01:00:00Z", ended_at: "2026-10-03T02:00:00Z" }),
      session("S3"),
    );
    await db().prepare("UPDATE sessions SET hidden = 1 WHERE id = 'S3'").run();
    await api("/api/notes", { method: "POST", body: JSON.stringify({ text: "打合せ", minutes: 30, date: D }) });
    const inp = await input();
    expect(inp.items).toEqual([{ id: item.id, text: "worklog", detail: "至少 2 轮", task_ids: [], task_titles: [] }]);
    expect(inp.sessions).toEqual([{
      id: "S1", agent: "claude-code", task_id: null, task_title: null, project: "worklog",
      summary: "summary S1", minutes: 60, turns: 6, turns_estimated: false,
    }]);
    expect(inp.notes.map((n: any) => [n.text, n.minutes])).toEqual([["打合せ", 30]]);
    expect(inp.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(inp.judged_fingerprint).toBeNull();
  });

  it("a session over midnight counts only today's share and estimates its turns", async () => {
    await setup();
    // 23:00–01:00 JST on 10/1–10/2: one hour each side.
    await ingest(session("S1", {
      started_at: "2026-10-01T14:00:00Z", ended_at: "2026-10-01T16:00:00Z", active_minutes: 120, turns: 10,
      active_intervals: [["2026-10-01T14:00:00Z", "2026-10-01T16:00:00Z"]],
    }));
    const s = (await input()).sessions[0];
    expect([s.minutes, s.turns, s.turns_estimated]).toEqual([60, 5, true]);
  });

  it("uses the edited summary and the overridden minutes", async () => {
    await setup();
    await ingest(session("S1"));
    await db().prepare("UPDATE sessions SET summary_edited = '手で直した', minutes_override = 15 WHERE id = 'S1'").run();
    const s = (await input()).sessions[0];
    expect([s.summary, s.minutes]).toEqual(["手で直した", 15]);
  });

  it("fingerprint changes with detail, not with manual_status", async () => {
    const item = await setup();
    const f1 = (await input()).fingerprint;
    const set = (await (await api(`/api/day-plan-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: item.updated_at, manual_status: "done" }) })).json()) as any;
    expect((await input()).fingerprint).toBe(f1);
    await api(`/api/day-plan-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: set.updated_at, detail: "3 轮" }) });
    expect((await input()).fingerprint).not.toBe(f1);
  });

  it("items carry task_ids and task_titles in id order; changing today's task_ids changes the fingerprint", async () => {
    const mk = async (title: string) =>
      (await (await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "田中", title }) })).json()) as any;
    const a = await mk("A案件");
    const b = await mk("B案件");
    const item = await setup();
    const f1 = (await input()).fingerprint;
    const r = await api(`/api/day-plan-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: item.updated_at, task_ids: [b.id, a.id] }) });
    expect(r.status).toBe(200);
    const inp = await input();
    const sorted = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(inp.items[0]).toEqual({
      id: item.id, text: "worklog", detail: "至少 2 轮", task_ids: sorted.map((t) => t.id), task_titles: sorted.map((t) => t.title),
    });
    expect(inp.fingerprint).not.toBe(f1);
  });

  it("stores ai fields, drops invented evidence, ignores unknown items, leaves manual_status alone", async () => {
    const item = await setup();
    await ingest(session("S1"));
    const cur = (await (await api(`/api/day-plans/${D}`)).json() as any).items[0];
    await api(`/api/day-plan-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: cur.updated_at, manual_status: "none" }) });
    const { fingerprint } = await input();
    const r = await judge({
      fingerprint, model: "haiku", machine: "macmini",
      items: [
        { id: item.id, status: "done", progress: "6/2 轮", evidence: ["S1", "S-made-up"], note: "做完了" },
        { id: "D-unknown", status: "done", progress: "", evidence: [], note: "" },
      ],
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ stored: 1 });
    const plan = (await (await api(`/api/day-plans/${D}`)).json()) as any;
    expect(plan.items[0]).toMatchObject({
      ai_status: "done", ai_progress: "6/2 轮", ai_evidence: ["S1"], ai_note: "做完了", manual_status: "none", final_status: "none",
    });
    expect([plan.judge_machine, plan.judge_model]).toEqual(["macmini", "haiku"]);
    expect(plan.judged_at).not.toBeNull();
    expect((await input()).judged_fingerprint).toBe(fingerprint);
  });

  it("a judgement does not bump the item's updated_at, so an open page can still edit it", async () => {
    const item = await setup();
    await ingest(session("S1"));
    const before = (await (await api(`/api/day-plans/${D}`)).json() as any).items[0].updated_at;
    const { fingerprint } = await input();
    expect((await judge({ fingerprint, model: "haiku", machine: "macmini", items: [{ id: item.id, status: "done", progress: "", evidence: ["S1"], note: "" }] })).status).toBe(200);
    const r = await api(`/api/day-plan-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: before, detail: "改了" }) });
    expect(r.status).toBe(200);
  });

  it("the day plan carries the cited sessions' summaries; ids no longer present are omitted", async () => {
    const item = await setup();
    await ingest(session("S1"), session("S2"));
    await db().prepare("UPDATE sessions SET summary_edited = '手で直した' WHERE id = 'S2'").run();
    const { fingerprint } = await input();
    await judge({ fingerprint, model: "haiku", machine: "macmini", items: [{ id: item.id, status: "done", progress: "", evidence: ["S1", "S2"], note: "" }] });
    await db().prepare("DELETE FROM sessions WHERE id = 'S2'").run();
    const plan = (await (await api(`/api/day-plans/${D}`)).json()) as any;
    expect(plan.items[0].ai_evidence).toEqual(["S1", "S2"]);
    expect(plan.items[0].ai_evidence_sessions).toEqual([{ id: "S1", summary: "summary S1", started_at: "2026-10-02T01:00:00Z" }]);
  });

  it("dedups repeated item ids; stored counts distinct items", async () => {
    const item = await setup();
    const { fingerprint } = await input();
    const r = await judge({
      fingerprint, model: "haiku", machine: "macmini",
      items: [
        { id: item.id, status: "done", progress: "", evidence: [], note: "first" },
        { id: item.id, status: "none", progress: "", evidence: [], note: "second" },
      ],
    });
    expect(await r.json()).toEqual({ stored: 1 });
  });

  it("a judgement made on stale input is refused", async () => {
    const item = await setup();
    const { fingerprint } = await input();
    await ingest(session("S1"));
    const r = await judge({ fingerprint, model: "haiku", machine: "macmini", items: [{ id: item.id, status: "done", progress: "", evidence: [], note: "" }] });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "stale" });
  });

  describe("only upgrades", () => {
    const row = (id: string, status: string, note: string) => ({ id, status, progress: note, evidence: ["S1"], note });
    const judgeAs = async (id: string, status: string, note: string) => {
      const r = await judge({ fingerprint: (await input()).fingerprint, model: "haiku", machine: "m", items: [row(id, status, note)] });
      expect(r.status).toBe(200);
    };
    const current = async () => (await (await api(`/api/day-plans/${D}`)).json() as any).items[0];
    const patch = (id: string, body: Record<string, unknown>) =>
      api(`/api/day-plan-items/${id}`, { method: "PATCH", body: JSON.stringify(body) });

    it("a later judgement cannot take a done back down; it keeps the done's progress, evidence and note", async () => {
      const item = await setup();
      await ingest(session("S1"));
      await judgeAs(item.id, "done", "做完了");
      await ingest(session("S2", { summary: "还在改" }));
      await judgeAs(item.id, "partial", "还在改");
      expect(await current()).toMatchObject({ ai_status: "done", ai_progress: "做完了", ai_evidence: ["S1"], ai_note: "做完了" });
    });

    it("partial upgrades to done", async () => {
      const item = await setup();
      await ingest(session("S1"));
      await judgeAs(item.id, "partial", "一半");
      await ingest(session("S2"));
      await judgeAs(item.id, "done", "做完了");
      expect(await current()).toMatchObject({ ai_status: "done", ai_note: "做完了" });
    });

    it("editing text or detail clears the verdict, so the next judgement may say partial", async () => {
      const item = await setup();
      await ingest(session("S1"));
      await judgeAs(item.id, "done", "做完了");
      const r = await patch(item.id, { updated_at: (await current()).updated_at, detail: "5 轮" });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ai_status: null, ai_progress: null, ai_evidence: [], ai_note: null, final_status: "none" });
      await judgeAs(item.id, "partial", "6/5 轮不够");
      expect(await current()).toMatchObject({ ai_status: "partial", ai_note: "6/5 轮不够" });

      await judgeAs(item.id, "done", "做完了");
      await patch(item.id, { updated_at: (await current()).updated_at, text: "worklog 新标题" });
      await judgeAs(item.id, "none", "");
      expect((await current()).ai_status).toBe("none");
    });

    it("re-sending the same text and detail, or changing only manual_status, keeps the verdict", async () => {
      const item = await setup();
      await ingest(session("S1"));
      await judgeAs(item.id, "done", "做完了");
      const r = await patch(item.id, { updated_at: (await current()).updated_at, text: "worklog", detail: "至少 2 轮", manual_status: "partial" });
      expect(r.status).toBe(200);
      expect(await current()).toMatchObject({ ai_status: "done", ai_note: "做完了", manual_status: "partial" });
    });

    it("changing the linked tasks clears the verdict; re-sending the same set keeps it", async () => {
      const mk = async (title: string) =>
        (await (await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "田中", title }) })).json()) as any;
      const a = await mk("A案件");
      const b = await mk("B案件");
      const item = await setup();
      await patch(item.id, { updated_at: item.updated_at, task_ids: [a.id] });
      await ingest(session("S1"));
      await judgeAs(item.id, "done", "做完了");
      expect((await patch(item.id, { updated_at: (await current()).updated_at, task_ids: [a.id] })).status).toBe(200);
      expect((await current()).ai_status).toBe("done");
      expect((await patch(item.id, { updated_at: (await current()).updated_at, task_ids: [a.id, b.id] })).status).toBe(200);
      expect(await current()).toMatchObject({ ai_status: null, ai_evidence: [] });

      await judgeAs(item.id, "done", "做完了");
      await patch(item.id, { updated_at: (await current()).updated_at, task_ids: [b.id] });
      expect((await current()).ai_status).toBeNull();
    });

    it("a done whose cited sessions are all gone from the day may be overwritten", async () => {
      const item = await setup();
      await ingest(session("S1"), session("S2"));
      await judgeAs(item.id, "done", "做完了");
      await db().prepare("UPDATE sessions SET hidden = 1 WHERE id = 'S1'").run();
      // evidence is ["S1"] (judgeAs cites S1 only); S2 is still there but was never cited.
      await judgeAs(item.id, "partial", "S1 不见了");
      expect(await current()).toMatchObject({ ai_status: "partial", ai_note: "S1 不见了" });
    });

    it("a done with one cited session still present is kept", async () => {
      const item = await setup();
      await ingest(session("S1"), session("S2"));
      const r = await judge({
        fingerprint: (await input()).fingerprint, model: "haiku", machine: "m",
        items: [{ id: item.id, status: "done", progress: "", evidence: ["S1", "S2"], note: "做完了" }],
      });
      expect(r.status).toBe(200);
      await db().prepare("UPDATE sessions SET hidden = 1 WHERE id = 'S1'").run();
      await judgeAs(item.id, "partial", "还在改");
      expect(await current()).toMatchObject({ ai_status: "done", ai_note: "做完了" });
    });

    it("a conflicting edit leaves the verdict alone", async () => {
      const item = await setup();
      await ingest(session("S1"));
      await judgeAs(item.id, "done", "做完了");
      expect((await patch(item.id, { updated_at: "1999-01-01T00:00:00.000Z", detail: "5 轮" })).status).toBe(409);
      expect((await current()).ai_status).toBe("done");
    });
  });

  it("rejects a malformed judgement", async () => {
    await setup();
    const { fingerprint } = await input();
    expect((await judge({ fingerprint, model: "haiku", machine: "m", items: [{ id: "x", status: "完成", progress: "", evidence: [], note: "" }] })).status).toBe(400);
  });
});
