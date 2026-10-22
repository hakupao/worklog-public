// Task 1 / Task 8 of docs/plans/2026-10-13-xlsx-range-report.md: the range workbook from real data, for the
// user to open in Windows and Mac Excel (gates G1, G1b). READ-ONLY: only GETs /api/reports/:week/weekly (sheets +
// week digest). AI cost is not in that answer, so the cost KPI and chart read $0.00 with the "not collected" note.
// 当週業務内容 and 案件一覧 come from the 週報's 案件一覧 grids (computed values, never hand edits).
// Usage: cd server && npx tsx scripts/xlsx-samples.ts --from 2026-W30 --to 2026-W41 [--base <url>] [--out <dir>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { rangeWeeks } from "../src/report/range/data";
import { reportWeekRange } from "../src/report/week";
import { LABELS } from "../src/report/labels";
import { RANGE_LABELS } from "../src/report/range/labels";
import { NONE, UNLINKED, foldSeries, seriesLabel } from "../src/report/range/series";
import { STYLE } from "../src/report/range/style";
import type { RangeData, RangeTask, RangeWeek } from "../src/report/range/types";
import { renderRangeXlsx } from "../src/report/range/xlsx";
import type { DigestOut, Grid } from "../src/report/types";
import { splitRequesters } from "../src/requesters";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const toml = (p: string) => (!existsSync(p) ? {} : Object.fromEntries(readFileSync(p, "utf8").split("\n")
  .map((l) => /^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1], m[2]]))) as Record<string, string>;
const cfg = toml(path.join(import.meta.dirname, "..", "..", "config.toml"));
const cred = toml(path.join(homedir(), ".worklog", "credentials.toml"));
const BASE = args.base ?? process.env.WORKLOG_API ?? cfg.api_url, TOKEN = process.env.WORKLOG_TOKEN ?? cred.api_token;
if (!BASE || !TOKEN) throw new Error("need api_url (config.toml / WORKLOG_API / --base) and api_token (~/.worklog/credentials.toml / WORKLOG_TOKEN)");
const HEADERS: Record<string, string> = {
  Authorization: `Bearer ${TOKEN}`, "User-Agent": "worklog-xlsx-samples/1 (+node)",   // Cloudflare 1010 without a real UA
  ...(cred.access_client_id && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE) ? { "CF-Access-Client-Id": cred.access_client_id, "CF-Access-Client-Secret": cred.access_client_secret } : {}),
};
const OUT = args.out ?? path.join(homedir(), "Desktop", "xlsx-range-samples");

type Preview = { week: string; range: { from: string; to: string }; sheets: Grid[]; day_sum_minutes?: Record<string, number>; digests?: { week: DigestOut | null } };
const get = async (p: string): Promise<Preview> => {
  const r = await fetch(BASE + p, { headers: HEADERS, redirect: "manual" });
  if (r.status !== 200) throw new Error(`${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<Preview>;
};
// Every figure and name is the computed one, never a hand edit of the 週報 (the range xlsx ignores report_overrides).
const auto = (c: { value: unknown; auto?: unknown; overridden?: boolean } | undefined) => (c ? (c.overridden ? c.auto : c.value) : undefined);
const value = (g: Grid, row: string, col: string) => {
  const c = g.rows.find((r) => r.row_key === row)?.cells.find((x) => x.column === col);
  if (!c) throw new Error(`no ${g.key}.${row}.${col}`);
  return Number(auto(c)) || 0;
};

const weeks = rangeWeeks(args.from, args.to);
if (!weeks) throw new Error("bad --from / --to");
const L = RANGE_LABELS.ja;
const previews = [];
for (const w of weeks) previews.push(await get(`/api/reports/${w}/weekly`));   // sequential: gentle on the Worker

// The preview's 状態 is the ja label (no X-Lang); its 成果物 one ", "-joined string (a path holding ", " splits — a sample).
const statusOf = (label: string) => (Object.entries(LABELS.ja.status).find(([, v]) => v === label)?.[0] ?? "open") as RangeTask["status"];
const list = (v: unknown) => (String(v ?? "") ? String(v).split(", ") : []);
const perWeek = previews.map((p) => {
  const sum = p.sheets.find((g) => g.key === "summary")!, tasks = p.sheets.find((g) => g.key === "tasks")!;
  const byName = new Map<string, number>([[UNLINKED, value(sum, "unassigned_hours", "value")]]);
  const cellOf = (r: Grid["rows"][number], col: string) => auto(r.cells.find((c) => c.column === col));
  const rows = tasks.rows.map((r) => ({
    id: r.row_key, req: String(cellOf(r, "requester") ?? ""), title: String(cellOf(r, "title") ?? ""), h: Number(cellOf(r, "week_hours") ?? 0),
    project: String(cellOf(r, "project") ?? ""), status: statusOf(String(cellOf(r, "status") ?? "")), received_at: String(cellOf(r, "received_at") ?? ""),
    done_at: (cellOf(r, "done_at") as string | null) || null, total: Number(cellOf(r, "hours") ?? 0), deliverables: list(cellOf(r, "deliverables")),
  }));
  for (const t of rows) { const ns = splitRequesters(t.req); for (const n of ns.length ? ns : [NONE]) byName.set(n, (byName.get(n) ?? 0) + t.h / Math.max(ns.length, 1)); }
  return { p, sum, byName, rows, top: rows.filter((t) => t.h > 0).sort((a, b) => b.h - a.h).slice(0, 3).map((t) => t.title) };
});
const all = new Map<string, number>();
for (const w of perWeek) for (const [n, h] of w.byName) all.set(n, (all.get(n) ?? 0) + h);
const { keys, keyOf } = foldSeries(all);
const series = keys.map((k) => seriesLabel(k, L));
// 案件一覧 order (data.ts byRequester), as the server sorts both tables.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
let cum = 0;
const rw: RangeWeek[] = perWeek.map(({ p, sum, byName, rows, top }) => {
  const bySeries = series.map(() => 0);
  for (const [n, h] of byName) if (h > 0) bySeries[keys.indexOf(keyOf(n))] += h;
  const done = value(sum, "done", "value"); cum += done;
  return { week: p.week, start: p.range.from, end: p.range.to, hours: value(sum, "total_hours", "value"),
    sum_hours: Math.round(Object.values(p.day_sum_minutes ?? {}).reduce((a, m) => a + m, 0) / 60 * 100) / 100,
    new: value(sum, "new", "value"), done, done_cum: cum, by_series: bySeries.map((h) => Math.round(h * 100) / 100),
    cost_usd: 0, tokens: 0, oneliner: p.digests?.week?.oneliner || null, top_tasks: top,
    digest_text: p.digests?.week?.pdf_text || p.digests?.week?.text || null,
    tasks: [...rows].sort((a, b) => cmp(a.req, b.req) || cmp(a.received_at, b.received_at) || cmp(a.id, b.id)).map((t) => ({ id: t.id, requester: t.req, title: t.title, status: t.status, week_hours: t.h, total_hours_all_time: t.total, deliverables: t.deliverables })) };
});
// 案件一覧: every 案件 of any week, its range hours summed; the latest week's row for the rest, 成果物 merged in week order.
const rangeTasks = new Map<string, RangeTask>();
for (const { rows } of perWeek) for (const t of rows) {
  const prev = rangeTasks.get(t.id);
  rangeTasks.set(t.id, { id: t.id, requester: t.req, title: t.title, project: t.project, status: t.status, received_at: t.received_at, done_at: t.done_at,
    range_hours: (prev?.range_hours ?? 0) + t.h, total_hours: t.total, total_manual: false,   // the preview does not say which 累計 is a hand value
    deliverables: [...new Set([...(prev?.deliverables ?? []), ...t.deliverables])] });
}
for (const t of rangeTasks.values()) t.range_hours = Math.round(t.range_hours * 4) / 4;   // quarter hours, like the server
const data: RangeData = {
  from: weeks[0], to: weeks.at(-1)!, generated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), weeks: rw, series_keys: keys, series,
  share: series.map((n, i) => [n, Math.round(rw.reduce((a, w) => a + w.by_series[i], 0) * 100) / 100]),
  totals: { hours: Math.round(rw.reduce((a, w) => a + w.hours, 0) * 100) / 100, sum_hours: Math.round(rw.reduce((a, w) => a + w.sum_hours, 0) * 100) / 100,
    done: cum, cost_usd: 0, tokens: 0, cost_partial: true },
  tasks: [...rangeTasks.values()].sort((a, b) => cmp(a.requester, b.requester) || cmp(a.received_at, b.received_at) || cmp(a.id, b.id)),
  // 本周日别 needs session times the preview does not carry: empty days here (the route's workbook has them).
  days: reportWeekRange(weeks.at(-1)!)!.days.map((date) => ({ date, hours: 0, by_series: series.map(() => 0), by_task: [], start: null, end: null })),
  day_tasks: [],
};
mkdirSync(OUT, { recursive: true });
const f = path.join(OUT, `range-sample-${STYLE.key}-v3-${data.from}_${data.to}.xlsx`);
writeFileSync(f, new Uint8Array(await renderRangeXlsx(data, "ja", STYLE)));
console.log(f);
