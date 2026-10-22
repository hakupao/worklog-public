import { vi } from "vitest";
import type { AutoDeliverable, Note, Session, Task } from "../src/api/types";
import { machine, session, task } from "../src/predict/fixtures";
import { note, weekTl } from "./tl-fixtures";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const bump = (iso: string) => new Date(Date.parse(iso) + 1000).toISOString();

/** A small in-memory API for the 案件 page and drawer (week 2026-W40): GETs read `db`, writes change it and are
 *  recorded in `calls`. `failNext` answers the next matching request instead. */
export function tkServer(o: { tasks?: Task[]; sessions?: Session[]; notes?: Note[]; auto?: Record<string, AutoDeliverable[]> } = {}) {
  const db = {
    tasks: o.tasks ?? [
      { ...task("T20260901-01", "alpha 改修"), requester: "田中さん", project: "order", thinking: "まず帳票から" },
      { ...task("T20260915-01", "beta 調査", "hold"), received_at: "2026-09-15" },
    ],
    sessions: o.sessions ?? [
      session("a1", "2026-09-29 10:00", "2026-09-29 11:30", { task_id: "T20260901-01", summary: "帳票の修正", cwd: "/w/repo", files_written: ["/w/repo/成果物/設計.xlsx", "/w/repo/src/a.ts"] }, 2),
      session("a2", "2026-10-01 13:00", "2026-10-01 13:30", { task_id: "T20260901-01", summary: "確認", cwd: "/w/repo", hidden: 1 }, 5),
    ],
    notes: o.notes ?? [note("n1", "2026-09-30T12:00:00", { minutes: 30, text: "電話", task_id: "T20260901-01" })],
    // auto_deliverables per task as the server would derive them; PUT /api/deliverable-verdicts flips one.
    auto: o.auto ?? {} as Record<string, AutoDeliverable[]>,
  };
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  let next: ((method: string, url: string) => Response | Promise<Response> | null) | null = null;
  const detail = (id: string) => {
    const ss = db.sessions.filter((s) => s.task_id === id), ns = db.notes.filter((n) => n.task_id === id);
    const total = ss.filter((s) => !s.hidden).reduce((n, s) => n + s.minutes_effective, 0) + ns.reduce((n, x) => n + (x.minutes ?? 0), 0);
    return { task: db.tasks.find((t) => t.id === id)!, sessions: ss, notes: ns, total_minutes: total, auto_deliverables: db.auto[id] ?? [] };
  };
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method !== "GET") calls.push({ method, url, body });
    const once = next?.(method, url);
    if (once) { next = null; return once; }
    const id = decodeURIComponent(url.split("?")[0].split("/").pop()!);
    if (method === "PUT" && url === "/api/deliverable-verdicts") {
      for (const list of Object.values(db.auto)) {
        for (const a of list) if (a.key === body!.key) Object.assign(a, { verdict: body!.verdict, source: "user", reason: "" });
      }
      return json({ ...body, source: "user" });
    }
    if (method === "PATCH" && url.startsWith("/api/tasks/")) {
      const t = db.tasks.find((x) => x.id === id)!;
      const { updated_at: _u, ...patch } = body as Record<string, unknown>;
      Object.assign(t, patch, { updated_at: bump(t.updated_at) });
      if ("status" in patch) t.done_at = patch.status === "done" ? "2026-10-02" : null;
      return json(t);
    }
    if (method === "POST" && url === "/api/tasks") {
      const t: Task = { ...task("T20261002-01", String(body!.title)), requester: String(body!.requester), received_at: String(body!.received_at) };
      db.tasks.push(t);
      return json(t, 201);
    }
    if (method === "DELETE" && url.startsWith("/api/tasks/")) {
      if (db.sessions.some((s) => s.task_id === id) || db.notes.some((n) => n.task_id === id)) return json({ error: "linked", sessions: 1, notes: 0, plans: 0 }, 409);
      db.tasks = db.tasks.filter((x) => x.id !== id);
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH" && url.startsWith("/api/sessions/")) {
      const s = db.sessions.find((x) => x.id === id)!;
      const { updated_at: _u, ...patch } = body as Record<string, unknown>;
      Object.assign(s, patch, { updated_at: bump(s.updated_at) });
      if ("hidden" in patch) s.hidden = patch.hidden ? 1 : 0;
      const { summary_effective: _a, minutes_effective: _b, ...raw } = s;
      return json(raw);
    }
    if (url.startsWith("/api/machines")) return json([machine("macmini", "2026-10-02 14:12")]);
    if (url.startsWith("/api/weeks/")) return json(weekTl("2026-W40", "2026-09-28", db.sessions, db.notes, url.includes("include_hidden=1")));
    if (url === "/api/tasks/totals") return json(db.tasks.map((t) => ({ id: t.id, total_minutes: detail(t.id).total_minutes, last_date: null })));
    if (url.startsWith("/api/tasks/")) return db.tasks.some((t) => t.id === id) ? json(detail(id)) : json({ error: "not found" }, 404);
    if (url.startsWith("/api/tasks")) return json(db.tasks);
    if (url.startsWith("/api/requesters")) return json(["田中さん", "佐藤さん"]);
    if (url.startsWith("/api/sessions?unlinked=1")) return json([]);
    return json({});
  }));
  return { db, calls, failNext: (f: (method: string, url: string) => Response | Promise<Response> | null) => { next = f; } };
}
export const conflict = (current: unknown) => json({ error: "conflict", current }, 409);
export const fail = (status = 500) => json({ error: "boom" }, status);
