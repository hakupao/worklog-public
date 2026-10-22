import type { TaskColumn, Template, TemplateKey } from "./types";

/**
 * The report template. It began as two (派遣元 `agency`, 現場 `site`, a hand-port of the Python report's
 * templates/*.toml); they were merged into this one, which has every sheet and the detailed 日別作業 (one row
 * per session / note). test/report-templates.test.ts holds the expected shape in full.
 *
 * Sheet order is behaviour: layoutSheets emits the sheets in the order they appear here.
 */
const TASK_COLUMNS: TaskColumn[] = [
  "requester", "title", "project", "status", "received_at", "done_at", "hours", "week_hours", "deliverables", "thinking",
];
const TASK_HEADERS = [
  "依頼元", "案件名", "プロジェクト", "状態", "受領日", "完了日", "累計(h)", "今週(h)", "成果物", "備考",
];

export const TEMPLATES: Record<TemplateKey, Template> = {
  weekly: {
    summary: { enabled: true, title: "サマリー" },
    tasks: { enabled: true, title: "案件一覧", columns: TASK_COLUMNS, headers: TASK_HEADERS },
    days: { enabled: true, title: "日別作業" },
    deliverables: { enabled: true, title: "成果物" },
    hours: { enabled: true, title: "稼働" },
  },
};

/** The retired template names, still answered (old links, the v1 page) as the one template. */
export const TEMPLATE_ALIASES: Record<string, TemplateKey> = { agency: "weekly", site: "weekly" };
