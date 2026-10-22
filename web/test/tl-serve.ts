import { vi } from "vitest";
import type { Note, Session, Task } from "../src/api/types";
import { machine, session, task } from "../src/predict/fixtures";
import { note, weekTl } from "./tl-fixtures";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

/** A small in-memory API for the timeline page: GETs read `db`, PATCH / DELETE write it and are recorded. */
export function tlServer(o: { sessions?: Session[]; notes?: Note[]; tasks?: Task[]; unlinked?: Session[] } = {}) {
  const db = {
    sessions: o.sessions ?? [
      session("a1", "2026-10-01 10:00", "2026-10-01 11:00", { task_id: "A", summary: "設計の見直し", cwd: "/w/a" }),
      session("u1", "2026-10-01 13:00", "2026-10-01 13:30", { summary: "調査", cwd: "/w/a" }),
      session("b1", "2026-10-02 13:30", "2026-10-02 14:10", { task_id: "B", cwd: "/w/b" }),
    ],
    notes: o.notes ?? [note("n1", "2026-10-02T12:00:00", { minutes: 30, text: "打ち合わせ" })],
    tasks: o.tasks ?? [task("A", "alpha 改修"), task("B", "beta 調査"), task("Z", "zeta 完了", "done")],
  };
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  let next: ((method: string, url: string) => Response | Promise<Response> | null) | null = null;
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method !== "GET") calls.push({ method, url, body });
    const once = next?.(method, url);
    if (once) { next = null; return once; }
    if (method === "PATCH" && url.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(url.split("/").pop()!), s = db.sessions.find((x) => x.id === id)!;
      const { updated_at: _u, ...patch } = body as Record<string, unknown>;
      Object.assign(s, patch, { updated_at: new Date(Date.parse(s.updated_at) + 1000).toISOString() });
      if ("hidden" in patch) s.hidden = patch.hidden ? 1 : 0;
      s.summary_effective = s.summary_edited ?? s.summary;
      s.minutes_effective = s.minutes_override ?? s.active_minutes;
      const { summary_effective: _a, minutes_effective: _b, ...raw } = s;
      return json(raw);
    }
    if (method === "PATCH" && url.startsWith("/api/notes/")) {
      const id = decodeURIComponent(url.split("/").pop()!), n = db.notes.find((x) => x.id === id)!;
      const { updated_at: _u, ...patch } = body as Record<string, unknown>;
      Object.assign(n, patch, { updated_at: new Date(Date.parse(n.updated_at) + 1000).toISOString() });
      return json(n);
    }
    if (method === "DELETE" && url.startsWith("/api/notes/")) {
      const id = decodeURIComponent(url.split("/").pop()!.split("?")[0]);
      db.notes = db.notes.filter((x) => x.id !== id);
      return new Response(null, { status: 204 });
    }
    if (url.startsWith("/api/machines")) return json([machine("macmini", "2026-10-02 14:12")]);
    if (url.startsWith("/api/weeks/2026-W40/timeline")) return json(weekTl("2026-W40", "2026-09-28", db.sessions, db.notes, url.includes("include_hidden=1")));
    if (url.startsWith("/api/weeks/")) return json(weekTl("2026-W39", "2026-09-21", []));
    if (url.startsWith("/api/tasks")) return json(db.tasks);
    if (url.startsWith("/api/sessions?unlinked=1")) return json(o.unlinked ?? db.sessions.filter((s) => !s.hidden && (!s.task_id || !db.tasks.some((t) => t.id === s.task_id))));
    if (url.startsWith("/api/requesters")) return json([]);
    return json({});
  }));
  return { db, calls, failNext: (f: (method: string, url: string) => Response | Promise<Response> | null) => { next = f; } };
}
export const conflict = (current: unknown) => json({ error: "conflict", current }, 409);
