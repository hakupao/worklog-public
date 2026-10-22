import { vi } from "vitest";
import type { Dashboard, Review, StatsSessions, Task } from "../src/api/types";
import { FULL } from "./pages/dashboard-fixture";

export const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
export const fail = (status = 500) => json({ error: "boom" }, status);

export const review = (week: string, text = `# ${week}\n\n本周 10.5h。`): Review =>
  ({ week, text, model: "claude-sonnet", generated_at: `2026-10-05T01:02:03Z`, machine: "macmini" });

export const stTask = (id: string, over: Partial<Task> = {}): Task => ({
  id, requester: "田中", project: "P", title: `案件 ${id}`, status: "open", received_at: "2026-09-01", done_at: null, thinking: "",
  deliverables: [], hours_manual: null, machine: "macmini", ts: "2026-09-01T00:00:00", updated_at: "2026-09-01T00:00:00Z", ...over,
});

/** A small in-memory API for the 统计 page. GET /api/dashboard?from=&to= answers `db.dash(from, to)` — by default
 *  FULL with the asked range in `range`, so a test can tell which range landed; GET /api/reviews answers
 *  `db.reviews` cut to ?limit=; GET /api/stats/sessions?from=&to= answers `db.sessions(from, to)` (by default no sessions
 *  and no plans, with the asked range); GET /api/tasks answers `db.tasks`. Every request is recorded in `calls`; `failNext` answers the next matching request
 *  instead. */
export function stServer(o: {
  dash?: (from: string, to: string) => Dashboard; reviews?: Review[];
  sessions?: (from: string, to: string) => StatsSessions; tasks?: Task[];
} = {}) {
  const db = {
    dash: o.dash ?? ((from: string, to: string): Dashboard => ({ ...FULL, range: { from, to } })),
    reviews: o.reviews ?? [review("2026-W40"), review("2026-W39")],
    sessions: o.sessions ?? ((from: string, to: string): StatsSessions => ({ range: { from, to }, day_start: "05:00", sessions: [], plans: [] })),
    tasks: o.tasks ?? [],
  };
  const calls: string[] = [];
  let next: ((url: string) => Response | Promise<Response> | null) | null = null;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    calls.push(url);
    const once = next?.(url);
    if (once) { next = null; return once; }
    const [path, query = ""] = url.split("?"), q = new URLSearchParams(query);
    if (path === "/api/dashboard") return json(db.dash(q.get("from") ?? "", q.get("to") ?? ""));
    if (path === "/api/reviews") return json(db.reviews.slice(0, Number(q.get("limit") ?? 8)));
    if (path === "/api/stats/sessions") return json(db.sessions(q.get("from") ?? "", q.get("to") ?? ""));
    if (path === "/api/tasks") return json(db.tasks);
    if (path === "/api/machines") return json([]);
    return json({});
  }));
  return { db, calls, failNext: (f: (url: string) => Response | Promise<Response> | null) => { next = f; } };
}
