import { vi } from "vitest";
import type { CellKind, CellValue, ComposeOut, DigestOut, Grid, GridCell, GridRow, Machine, ReportDownload, ReportPreview, Task, Timeline } from "../src/api/types";
import { isValidWeek, reportWeekDates } from "../src/lib/jst";
import { task } from "../src/predict/fixtures";

export const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// ---- preview builders (the shapes server/src/report/layout.ts emits) ----------------------------------

const c = (column: string, value: CellValue, kind: CellKind, bold = false): GridCell => (bold ? { column, value, kind, bold } : { column, value, kind });
/** A 日別作業 row: row_key `S:<session id>` / `N:<note id>`. */
export const dayRow = (row_key: string, date: string, title: string, text: string, minutes: number): GridRow => ({
  row_key, cells: [c("date", date, "date"), c("task", title, "text"), c("text", text, "text"), c("minutes", minutes, "int")],
});
export const daysGrid = (rows: GridRow[]): Grid => ({
  key: "days", title: "日別作業", freeze_header: true,
  columns: [{ key: "date", header: "日付" }, { key: "task", header: "案件" }, { key: "text", header: "作業内容" }, { key: "minutes", header: "分" }],
  rows,
});
const TASK_COLS = ["requester", "title", "project", "status", "received_at", "done_at", "hours", "deliverables", "thinking"];
const TASK_HEADERS = ["依頼元", "案件名", "プロジェクト", "状態", "受領日", "完了日", "工数(h)", "成果物", "備考"];
/** A 案件一覧 row for a fixture task (hours given). */
export const taskRow = (t: Task, hours: number): GridRow => ({
  row_key: t.id,
  cells: [
    c("requester", t.requester, "text"), c("title", t.title, "text"), c("project", t.project, "text"),
    c("status", { open: "対応中", done: "完了", hold: "保留" }[t.status], "text"), c("received_at", t.received_at, "date"),
    c("done_at", t.done_at, "date"), c("hours", hours, "float"), c("deliverables", t.deliverables.join(", "), "text"),
    c("thinking", t.thinking, "text"),
  ],
  sessions: [],
});
export const tasksGrid = (rows: GridRow[]): Grid => ({
  key: "tasks", title: "案件一覧", freeze_header: true, columns: TASK_COLS.map((key, i) => ({ key, header: TASK_HEADERS[i] })), rows,
});
const summaryGrid = (week: string): Grid => ({
  key: "summary", title: "サマリー", freeze_header: false, columns: [{ key: "label", header: null }, { key: "value", header: null }],
  rows: [{ row_key: "week", cells: [c("label", "週", "text", true), c("value", week, "text")] }],
});
const hoursGrid = (days: Grid): Grid => {
  const by = new Map<string, number>();
  for (const r of days.rows) { const d = String(r.cells[0].value); by.set(d, (by.get(d) ?? 0) + Number(r.cells[3].value)); }
  const dates = [...by.keys()].sort();
  return {
    key: "hours", title: "稼働", freeze_header: true, columns: [{ key: "date", header: "日付" }, { key: "hours", header: "稼働時間(h)" }],
    rows: [...dates.map((d) => ({ row_key: d, cells: [c("date", d, "date"), c("hours", by.get(d)! / 60, "float")] })),
      { row_key: "total", cells: [c("date", "合計", "text", true), c("hours", [...by.values()].reduce((a, b) => a + b, 0) / 60, "float")] }],
  };
};
const deliverablesGrid = (): Grid => ({
  key: "deliverables", title: "成果物", freeze_header: true,
  columns: [{ key: "title", header: "案件" }, { key: "path", header: "成果物パス" }, { key: "done_at", header: "完了日" }], rows: [],
});
/** A whole preview in the template's sheet order; `tasks` / `days` are the parts a test cares about. */
export function preview(week: string, o: { tasks?: GridRow[]; days?: GridRow[]; unassigned_sessions?: number; unassigned_minutes?: number } = {}): ReportPreview {
  const days = daysGrid(o.days ?? []);
  const sheets = [summaryGrid(week), tasksGrid(o.tasks ?? []), days, deliverablesGrid(), hoursGrid(days)];
  const dates = reportWeekDates(week);
  return {
    week, template: "weekly", range: { from: dates[0], to: dates[6], dates }, sheets,
    unassigned_sessions: o.unassigned_sessions ?? 0, unassigned_minutes: o.unassigned_minutes ?? 0, digests: { week: null, days: {} },
  };
}

// ---- the stub server ------------------------------------------------------------------------------------

const INT = /^-?\d+$/, FLOAT = /^-?\d+(\.\d+)?$/;
/** server/src/report/overrides.ts's coerce, minus the calendar check on dates. */
const coerce = (value: string, kind: CellKind): { value: CellValue; kind: CellKind } =>
  kind === "int" ? (INT.test(value) ? { value: Number(value), kind } : { value, kind: "text" })
    : kind === "float" ? (FLOAT.test(value) ? { value: Number(value), kind } : { value, kind: "text" })
      : { value, kind };

/** server/src/report/overrides.ts's applyOverrides: the stored edits on a freshly built preview. */
function applied(p: ReportPreview, edits: Map<string, string>): ReportPreview {
  return {
    ...p,
    sheets: p.sheets.map((g) => ({
      ...g,
      rows: g.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          const v = edits.get(`${g.key}\u0000${row.row_key}\u0000${cell.column}`);
          return v === undefined ? { ...cell } : { ...cell, ...coerce(v, cell.kind), auto: cell.value, overridden: true };
        }),
      })),
    })),
  };
}

/** A small in-memory API for the 週報 page. GET /api/reports/:week/weekly answers `db.previews["<week>/weekly"]`
 *  (built by the test; 404 when there is none, 400 for a bad week; agency / site are answered as weekly, as on the
 *  server) with the edits in `db.edits["<week>/weekly"]` applied the way the server does — so an edit hits every row with that row_key
 *  and the computed value stays under `auto`. PUT / DELETE …/cells store / remove an edit (DELETE: 404 when
 *  there was none). The timeline, tasks, downloads, machines and the range bounds come from `db`. Writes are recorded in `calls`;
 *  `failNext` answers the next matching request instead. */
export function rpServer(o: { previews?: Record<string, ReportPreview>; timelines?: Record<string, Timeline>; tasks?: Task[]; downloads?: Record<string, ReportDownload[]>; machines?: Machine[]; digestsAuto?: boolean; compose?: Record<string, ComposeOut>; bounds?: { first: string | null; last: string } } = {}) {
  const db = {
    previews: o.previews ?? {},
    edits: {} as Record<string, Map<string, string>>,
    timelines: o.timelines ?? {},
    tasks: o.tasks ?? [task("T20260901-01", "alpha 改修"), task("T20260915-01", "beta 調査")],
    downloads: o.downloads ?? {},
    machines: o.machines ?? [],
    /** GET …/pdf/compose answers `compose["<week>/<lang>"]`; a week without one answers 404 (as before the composer). */
    compose: o.compose ?? {},
    /** GET /api/reports/range/bounds. */
    bounds: o.bounds ?? { first: null, last: "2026-W40" },
  };
  const editsOf = (k: string) => (db.edits[k] ??= new Map());
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  let next: ((method: string, url: string) => Response | Promise<Response> | null) | null = null;
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method !== "GET") calls.push({ method, url, body });
    const once = next?.(method, url);
    if (once) { next = null; return once; }
    const [path, query = ""] = url.split("?"), seg = path.split("/").map(decodeURIComponent);
    if (path === "/api/reports/range/bounds") return json(db.bounds);
    if (path.startsWith("/api/reports/")) {
      const k = `${seg[3]}/weekly`;
      if (!isValidWeek(seg[3])) return json({ error: "invalid week" }, 400);
      // PATCH …/digests/:day (before the template check, as on the server): a text edit answers the line edited,
      // a regenerate answers the line marked stale (or nothing) plus `auto` (R12: false = only marked, DIGESTS_AUTO off)
      if (seg[4] === "digests" && method === "PATCH") {
        if (!body || (!("text" in body) && !("oneliner" in body))) {
          const p = Object.entries(db.previews).find(([k]) => k.startsWith(`${seg[3]}/`))?.[1];
          const line = seg[5] === "week" ? p?.digests.week : p?.digests.days[seg[5]];
          return json({ ...(line ? { ...line, edited: false, stale: true } : {}), auto: o.digestsAuto ?? true });
        }
        const cur = Object.entries(db.previews).find(([k]) => k.startsWith(`${seg[3]}/`))?.[1];
        const line = seg[5] === "week" ? cur?.digests.week : cur?.digests.days[seg[5]];
        const d: DigestOut = "oneliner" in body
          ? { ...(line as DigestOut), oneliner: String(body.oneliner) || null, oneliner_edited: String(body.oneliner) !== "" }
          : { text: String(body.text), pdf_text: null, edited: true, stale: false, updated_at: "2026-10-02T05:00:00Z", oneliner: line?.oneliner_edited ? line.oneliner : null, oneliner_edited: !!line?.oneliner_edited };
        for (const [k, p] of Object.entries(db.previews)) {
          if (!k.startsWith(`${seg[3]}/`)) continue;
          db.previews[k] = { ...p, digests: seg[5] === "week" ? { ...p.digests, week: d } : { ...p.digests, days: { ...p.digests.days, [seg[5]]: d } } };
        }
        return json(d);
      }
      if (seg[4] === "pdf" && seg[5] === "compose" && method === "GET") {
        const v = db.compose[`${seg[3]}/${new URLSearchParams(query).get("lang")}`];
        return v ? json(v) : json({ error: "not found" }, 404);
      }
      if (seg[4] !== "weekly" && seg[4] !== "agency" && seg[4] !== "site") return json({ error: "not found" }, 404);
      if (seg[5] === "cells") {
        if (method === "PUT") {
          editsOf(k).set(`${body!.sheet}\u0000${body!.row_key}\u0000${body!.column}`, String(body!.value));
          return json({ ok: true, updated_at: "2026-10-02T05:00:00Z" });
        }
        const q = new URLSearchParams(query);
        const gone = editsOf(k).delete(`${q.get("sheet")}\u0000${q.get("row_key")}\u0000${q.get("column")}`);
        return gone ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      const p = db.previews[k];
      return p ? json(applied(p, editsOf(k))) : json({ error: "not found" }, 404);
    }
    if (path.startsWith("/api/weeks/")) {
      const w = seg[3];
      return json(db.timelines[w] ?? { week: w, days: [], total_minutes: 0, unassigned: 0, hidden: 0 });
    }
    if (path === "/api/report-downloads") return json(db.downloads[new URLSearchParams(query).get("week") ?? ""] ?? []);
    if (path.startsWith("/api/tasks")) return json(db.tasks);
    if (path === "/api/machines") return json(db.machines);
    return json({});
  }));
  return { db, calls, failNext: (f: (method: string, url: string) => Response | Promise<Response> | null) => { next = f; } };
}
export const fail = (status = 500) => json({ error: "boom" }, status);
