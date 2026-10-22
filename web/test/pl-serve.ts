import { vi } from "vitest";
import type { DayPlan, DayPlanItem, PlanItem, Session, Task } from "../src/api/types";
import { dayItem, dayPlan, machine, planItem, session, task, taskRef } from "../src/predict/fixtures";
import { weekTl } from "./tl-fixtures";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const bump = (iso: string) => new Date(Date.parse(iso) + 1000).toISOString();
const ref = (t: Task) => taskRef(t.id, t.title, t.status);

/** A small in-memory API for the 计划 page and its drawers (today = 2026-10-02, week 2026-W40): GETs read `db`,
 *  writes change it the way the server does (routes/plan-items.ts, routes/day-plans.ts) and are recorded in
 *  `calls`. `failNext` answers the next matching request instead. */
export function plServer(o: { items?: PlanItem[]; days?: Record<string, DayPlan | null>; sessions?: Session[]; tasks?: Task[] } = {}) {
  const tasks = o.tasks ?? [task("T20260901-01", "alpha 改修"), task("T20260915-01", "beta 調査"), task("T20260920-01", "gamma 設計", "hold")];
  const db = {
    tasks,
    items: o.items ?? [
      planItem({ id: "P1", horizon: "daily", text: "BEACON 每天推进一点", tasks: [ref(tasks[0])], until_date: "2026-10-09" }),
      planItem({ id: "P2", horizon: "daily", text: "过期的每日", until_date: "2026-09-30", effective: false }),
      planItem({ id: "P3", horizon: "week", text: "ORION-B 交付", tasks: [ref(tasks[1])], week: "2026-W40" }),
      planItem({ id: "P4", horizon: "week", text: "LEDGER 验证", stale: true, week: "2026-W39" }),
      planItem({ id: "P5", horizon: "far", text: "Go 采集器" }),
    ],
    closed: [planItem({ id: "P9", horizon: "near", text: "已做完的", status: "done", done_at: "2026-09-30T09:00:00Z" })],
    days: o.days ?? {
      "2026-10-01": dayPlan("2026-10-01", [dayItem({ id: "D0", date: "2026-10-01", text: "昨天的", manual_status: "done" })]),
      "2026-10-02": dayPlan("2026-10-02", [
        { ...dayItem({ id: "D1", text: "worklog 上线验证", tasks: [ref(tasks[0])], ai_status: "done", ai_progress: "约 51 轮", ai_note: "合并上线并在 prod 验证", ai_evidence: ["a1"] }),
          ai_evidence_sessions: [{ id: "a1", summary: "帳票の修正", started_at: "2026-10-02T01:00:00.000Z" }] },
        dayItem({ id: "D2", text: "HARBOR2 Mapping", tasks: [ref(tasks[1]), ref(tasks[2])], detail: "至少 1 个 domain", plan_item_id: "P3" }),
        dayItem({ id: "D3", text: "电话确认", ai_status: "none", manual_status: "partial" }),
      ], { judged_at: "2026-10-02T09:00:00Z", judge_machine: "macmini" }),
    } as Record<string, DayPlan | null>,
    sessions: o.sessions ?? [
      session("a1", "2026-10-02 10:00", "2026-10-02 11:30", { task_id: "T20260901-01", summary: "帳票の修正" }),
      session("b1", "2026-09-29 13:00", "2026-09-29 13:40", { task_id: "T20260915-01", summary: "調査" }),
    ],
  };
  let seq = 10;
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  let next: ((method: string, url: string) => Response | Promise<Response> | null) | null = null;
  const allDay = () => Object.values(db.days).flatMap((p) => p?.items ?? []);
  const withFinal = (it: DayPlanItem): DayPlanItem => ({ ...it, final_status: it.manual_status ?? it.ai_status ?? "none" });
  const tasksOf = (ids: unknown) => (ids as string[]).map((id) => ref(db.tasks.find((t) => t.id === id)!));
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method !== "GET") calls.push({ method, url, body });
    const once = next?.(method, url);
    if (once) { next = null; return once; }
    const path = url.split("?")[0], last = decodeURIComponent(path.split("/").pop()!);
    if (url.startsWith("/api/plan-items")) {
      if (method === "GET") return json(url.includes("status=closed") ? db.closed : db.items);
      if (method === "POST") {
        const p = planItem({ id: `P${++seq}`, horizon: body!.horizon, text: String(body!.text).trim(), week: body!.horizon === "week" ? "2026-W40" : null, tasks: tasksOf(body!.task_ids ?? []) });
        db.items.push(p);
        return json(p, 201);
      }
      const p = [...db.items, ...db.closed].find((x) => x.id === last);
      if (!p) return json({ error: "not found" }, 404);
      if (body!.updated_at !== p.updated_at) return json({ error: "conflict", current: p }, 409);
      const { updated_at: _u, task_ids, ...patch } = body as Record<string, unknown>;
      Object.assign(p, patch, { updated_at: bump(p.updated_at) });
      if (task_ids) p.tasks = tasksOf(task_ids);
      if ("horizon" in patch) { p.week = patch.horizon === "week" ? (patch.week as string) ?? "2026-W40" : null; if (patch.horizon !== "daily") p.until_date = null; p.stale = false; }
      if ("week" in patch) p.stale = false;
      if ("status" in patch) {
        p.done_at = patch.status === "active" ? null : "2026-10-02T05:00:00Z";
        db.items = db.items.filter((x) => x.id !== p.id); db.closed = db.closed.filter((x) => x.id !== p.id);
        (p.status === "active" ? db.items : db.closed).push(p);
      }
      if (p.horizon === "daily") p.effective = p.status === "active" && (!p.until_date || p.until_date >= "2026-10-02");
      return json(p);
    }
    if (url.startsWith("/api/day-plans/")) {
      const date = path.split("/")[3];
      if (method === "GET") return db.days[date] ? json(db.days[date]) : json({ error: "no plan" }, 404);
      if (path.endsWith("/start")) {
        if (db.days[date]) return json({ error: "exists" }, 409);
        db.days[date] = dayPlan(date, db.items.filter((p) => p.horizon === "daily" && p.effective)
          .map((p) => dayItem({ id: `D${++seq}`, date, text: p.text, tasks: p.tasks, plan_item_id: p.id })));
        return json(db.days[date], 201);
      }
      const plan = db.days[date];
      if (!plan) return json({ error: "no plan" }, 404);
      const from = body!.plan_item_id ? db.items.find((p) => p.id === body!.plan_item_id) : null;
      const it = dayItem({ id: `D${++seq}`, date, text: from ? from.text : String(body!.text), tasks: from ? from.tasks : [], plan_item_id: from?.id ?? null,
        sort: Math.max(0, ...plan.items.map((i) => i.sort)) + 1 });
      plan.items.push(it);
      return json(it, 201);
    }
    if (url.startsWith("/api/day-plan-items/")) {
      const it = allDay().find((x) => x.id === last);
      if (!it) return json({ error: "not found" }, 404);
      const sent = method === "DELETE" ? new URLSearchParams(url.split("?")[1]).get("updated_at") : body!.updated_at;
      if (sent !== it.updated_at) return json({ error: "conflict", current: it }, 409);
      const plan = db.days[it.date]!;
      if (method === "DELETE") { plan.items = plan.items.filter((x) => x.id !== it.id); return new Response(null, { status: 204 }); }
      const { updated_at: _u, task_ids, ...patch } = body as Record<string, unknown>;
      Object.assign(it, patch, { updated_at: bump(it.updated_at) });
      if (task_ids) it.tasks = tasksOf(task_ids);
      Object.assign(it, withFinal(it));
      plan.items.sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
      return json(it);
    }
    if (url.startsWith("/api/machines")) return json([machine("macmini", "2026-10-02 14:12")]);
    if (url.startsWith("/api/weeks/2026-W40/")) return json(weekTl("2026-W40", "2026-09-28", db.sessions));
    if (url.startsWith("/api/weeks/")) {
      const w = path.split("/")[3];
      return json({ week: w, days: [], total_minutes: 0, unassigned: 0, hidden: 0 });
    }
    if (method === "POST" && url === "/api/tasks") {
      const t: Task = { ...task(`T20261002-0${++seq % 10}`, String(body!.title)), requester: String(body!.requester) };
      db.tasks.push(t);
      return json(t, 201);
    }
    if (url.startsWith("/api/tasks")) return json(db.tasks);
    if (url.startsWith("/api/requesters")) return json([]);
    return json({});
  }));
  return { db, calls, failNext: (f: (method: string, url: string) => Response | Promise<Response> | null) => { next = f; } };
}
export const conflict = (current: unknown) => json({ error: "conflict", current }, 409);
export const fail = (status = 404) => json({ error: "boom" }, status);
