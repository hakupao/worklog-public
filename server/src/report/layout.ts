import type {
  CellKind, CellValue, Grid, GridCell, GridRow, SheetConfig, SheetKey, TaskColumn, TaskRow,
  Template, WeekData,
} from "./types";
import type { Labels } from "./labels";
import { sameFileKey } from "../deliverables/rules";
import { UNASSIGNED_LABEL } from "./weekly";

/**
 * Port of the "what to compute" half of src/worklog/report/xlsx.py: every `_write_*_sheet` decides
 * which rows exist and what each cell holds, and that is what a Grid carries. The drawing half
 * (bold, freeze, column width) lives in xlsx.ts, which reads the `bold` flags and `kind`s set here.
 *
 * Pure: it never touches D1, so the same Grid[] feeds the preview API and the workbook writer.
 */

const STATUS_LABELS: Record<string, string> = { open: "対応中", done: "完了", hold: "保留" };

const round2 = (x: number) => Math.round(x * 100) / 100;

const cell = (column: string, value: CellValue, kind: CellKind, bold = false): GridCell =>
  bold ? { column, value, kind, bold: true } : { column, value, kind };

function summarySheet(data: WeekData, cfg: SheetConfig, L?: Labels): Grid {
  const s = data.summary;
  const labelled = (row_key: string, label: string, value: CellValue, kind: CellKind): GridRow => ({
    row_key,
    cells: [cell("label", label, "text", true), cell("value", value, kind)],
  });
  const rows: GridRow[] = [
    // xlsx.py falls back to the date range when the week label is missing.
    labelled("week", L?.summary.week ?? "週", s.week || `${s.week_start} - ${s.week_end}`, "text"),
    labelled("new", L?.summary.new ?? "新規", s.new, "int"),
    labelled("done", L?.summary.done ?? "完了", s.done, "int"),
    labelled("ongoing", L?.summary.ongoing ?? "継続", s.ongoing, "int"),
    labelled("total_hours", L?.summary.total_hours ?? "総工数(h)", s.total_hours, "float"),
    labelled("unassigned_hours", L?.summary.unassigned_hours ?? "未割当工数(h)", s.unassigned_hours, "float"),
    { row_key: "blank", cells: [cell("label", null, "text"), cell("value", null, "text")] },
    {
      row_key: "req_header",
      cells: [cell("label", L?.summary.requester ?? "依頼元", "text", true), cell("value", L?.summary.count ?? "件数", "text", true)],
    },
    ...s.by_requester.map(([requester, count]): GridRow => ({
      row_key: `req:${requester}`,
      cells: [cell("label", requester, "text"), cell("value", count, "int")],
    })),
  ];
  // This sheet writes its labels down column A instead of a header row, so nothing is frozen.
  return {
    key: "summary", title: cfg.title, freeze_header: false,
    columns: [{ key: "label", header: null }, { key: "value", header: null }],
    rows,
  };
}

/** Port of _TASK_FIELD_GETTERS, paired with the kind each value is written as. */
function taskCell(row: TaskRow, key: TaskColumn, L?: Labels): [CellValue, CellKind] {
  const t = row.task;
  switch (key) {
    case "requester": return [t.requester, "text"];
    case "title": return [t.title, "text"];
    case "project": return [t.project, "text"];
    case "status": return [(L?.status ?? STATUS_LABELS)[t.status] ?? t.status, "text"];
    case "received_at": return [t.received_at, "date"];
    case "done_at": return [t.done_at, "date"];
    case "hours": return [row.hours, "float"];
    case "week_hours": return [round2(row.week_minutes / 60), "float"];
    case "deliverables": return [[...t.deliverables, ...(row.auto ?? []).map((a) => a.label)].join(", "), "text"];
    case "thinking": return [t.thinking, "text"];
  }
}

function tasksSheet(data: WeekData, cfg: SheetConfig, L?: Labels): Grid {
  const columns = cfg.columns ?? [];
  const headers = cfg.headers ?? [];
  return {
    key: "tasks", title: cfg.title, freeze_header: true,
    columns: columns.map((key, i) => ({ key, header: L ? L.taskHeader[key] : headers[i] ?? key })),
    rows: data.tasks.map((row) => ({
      row_key: row.task.id,
      cells: columns.map((key) => cell(key, ...taskCell(row, key, L))),
      // The web preview lists a task's sessions under its row; no other sheet has them.
      sessions: row.sessions,
    })),
  };
}

function daysSheet(data: WeekData, cfg: SheetConfig, L?: Labels): Grid {
  const title = (t: string) => (L && t === UNASSIGNED_LABEL ? L.unassigned : t);
  // One row per session / note: a row_key names its source, so an edit stays on that source.
  const items = data.days.map((d) => ({
    row_key: `${d.source.kind === "session" ? "S" : "N"}:${d.source.id}`,
    date: d.date, title: title(d.task_title), text: d.text, minutes: d.minutes,
  }));

  return {
    key: "days", title: cfg.title, freeze_header: true,
    columns: [
      { key: "date", header: L?.days.date ?? "日付" }, { key: "task", header: L?.days.task ?? "案件" },
      { key: "text", header: L?.days.text ?? "作業内容" }, { key: "minutes", header: L?.days.minutes ?? "分" },
    ],
    rows: items.map((it) => ({
      row_key: it.row_key,
      cells: [
        cell("date", it.date, "date"), cell("task", it.title, "text"),
        cell("text", it.text, "text"), cell("minutes", it.minutes, "int"),
      ],
    })),
  };
}

/** FNV-1a, 32 bits, as 8 hex digits: a stable short name for a deliverable's path or url within one 案件. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(s)) h = Math.imul(h ^ ch, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function deliverablesSheet(data: WeekData, cfg: SheetConfig, L?: Labels): Grid {
  return {
    key: "deliverables", title: cfg.title, freeze_header: true,
    columns: [
      { key: "title", header: L?.deliverables.title ?? "案件" }, { key: "path", header: L?.deliverables.path ?? "成果物パス" },
      { key: "done_at", header: L?.deliverables.done_at ?? "完了日" },
    ],
    // Hand-picked ones keep their `<task>|<index>` keys (and the hand edits stored under them). An automatic one is
    // keyed by what it is, `<task>|d:<hash of its path or url>`, so its edits stay on it as others come and go; its
    // date is the last day of the week it was written / published on.
    rows: data.tasks.flatMap((row) => [
      ...row.task.deliverables.map((path, i): GridRow => ({
        row_key: `${row.task.id}|${i}`,
        cells: [
          cell("title", row.task.title, "text"), cell("path", path, "text"),
          cell("done_at", row.task.done_at, "date"),
        ],
      })),
      ...(row.auto ?? []).map((a): GridRow => ({
        // A file by its last three segments (rules.ts sameFileKey), so the key does not depend on which mount's path
        // the sessions read happened to show first.
        row_key: `${row.task.id}|d:${shortHash(a.kind === "file" ? sameFileKey(a.key) : a.key)}`,
        cells: [cell("title", row.task.title, "text"), cell("path", a.label, "text"), cell("done_at", a.date, "date")],
      })),
    ]),
  };
}

function hoursSheet(data: WeekData, cfg: SheetConfig, L?: Labels): Grid {
  // Wall-clock minutes per day (weekly.ts), so parallel sessions are not counted twice; idle days are left out.
  const worked = data.day_minutes.filter(([, minutes]) => minutes > 0);
  const totalMinutes = worked.reduce((sum, [, minutes]) => sum + minutes, 0);

  const rows: GridRow[] = worked.map(([date, minutes]) => ({
    row_key: date,
    cells: [cell("date", date, "date"), cell("hours", round2(minutes / 60), "float")],
  }));
  // The total rounds the raw minutes, so it can differ from the sum of the rounded rows.
  rows.push({
    row_key: "total",
    cells: [cell("date", L?.hours.total ?? "合計", "text", true), cell("hours", round2(totalMinutes / 60), "float")],
  });

  return {
    key: "hours", title: cfg.title, freeze_header: true,
    columns: [{ key: "date", header: L?.hours.date ?? "日付" }, { key: "hours", header: L?.hours.hours ?? "稼働時間(h)" }],
    rows,
  };
}

const SHEETS: Record<SheetKey, (data: WeekData, cfg: SheetConfig, L?: Labels) => Grid> = {
  summary: summarySheet,
  tasks: tasksSheet,
  days: daysSheet,
  deliverables: deliverablesSheet,
  hours: hoursSheet,
};

/** Every enabled sheet of the template, in the template's own order. */
export function layoutSheets(data: WeekData, template: Template, L?: Labels): Grid[] {
  const grids: Grid[] = [];
  for (const key of Object.keys(template) as SheetKey[]) {
    const cfg = template[key];
    const build = SHEETS[key];
    if (!cfg?.enabled || !build) continue;
    const grid = build(data, cfg, L);
    if (L) grid.title = L.sheet[key];
    grids.push(grid);
  }
  return grids;
}
