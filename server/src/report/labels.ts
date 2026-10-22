// server/src/report/labels.ts
// Fixed words of the exported 週報 (design 2026-10-08 §4.3, §4.1): xlsx sheet names / headers / labels and the
// PDF's captions and date formats, per export language. The web preview never uses this (its JSON stays Japanese).
// LABELS.ja must equal the literals in templates.ts / layout.ts / weekly.ts (test/report-labels.test.ts).
import type { Lang } from "../i18n/langs";
import type { SheetKey, TaskColumn } from "./types";

export interface Labels {
  sheet: Record<SheetKey, string>;
  taskHeader: Record<TaskColumn, string>;
  status: Record<"open" | "done" | "hold", string>;
  summary: { week: string; new: string; done: string; ongoing: string; total_hours: string; unassigned_hours: string; requester: string; count: string };
  days: { date: string; task: string; text: string; minutes: string };
  deliverables: { title: string; path: string; done_at: string };
  hours: { date: string; hours: string; total: string };
  unassigned: string;
  pdf: {
    title: string; period: string; name: string; summary: string; daily: string; projects: string;
    vertical: boolean;                 // labels set vertically (ja / zh) or across (en)
    weekdays: string[];                // 0 Sun … 6 Sat
    others: [string, string];          // {n}; [one, other]
    other: string;                     // a day line's folded 案件 (composed sheets)
    work: string;                      // the wall-clock total (工作时间: parallel sessions counted once)
    cumulative: string;                // 累計: every session's own time added up (parallel ones in full)
    taskCount: [string, string];
    daysWorked: [string, string];
    total: string;
    weekOf: string;                    // {y} {w}
    issued: string;                    // {d}
  };
}

const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const LABELS: Record<Lang, Labels> = {
  ja: {
    sheet: { summary: "サマリー", tasks: "案件一覧", days: "日別作業", deliverables: "成果物", hours: "稼働" },
    taskHeader: { requester: "依頼元", title: "案件名", project: "プロジェクト", status: "状態", received_at: "受領日",
      done_at: "完了日", hours: "累計(h)", week_hours: "今週(h)", deliverables: "成果物", thinking: "備考" },
    status: { open: "対応中", done: "完了", hold: "保留" },
    summary: { week: "週", new: "新規", done: "完了", ongoing: "継続", total_hours: "総工数(h)", unassigned_hours: "未割当工数(h)", requester: "依頼元", count: "件数" },
    days: { date: "日付", task: "案件", text: "作業内容", minutes: "分" },
    deliverables: { title: "案件", path: "成果物パス", done_at: "完了日" },
    hours: { date: "日付", hours: "稼働時間(h)", total: "合計" },
    unassigned: "その他・調査",
    pdf: { title: "週次作業報告書", period: "期間", name: "氏名", summary: "概要", daily: "日別", projects: "案件", vertical: true,
      weekdays: ["日", "月", "火", "水", "木", "金", "土"], others: ["その他 {n} 件", "その他 {n} 件"], other: "その他", work: "稼働時間", cumulative: "累計", taskCount: ["対応案件 {n} 件", "対応案件 {n} 件"],
      daysWorked: ["稼働 {n} 日", "稼働 {n} 日"], total: "合計", weekOf: "{y}年 第{w}週", issued: "発行 {d}" },
  },
  zh: {
    sheet: { summary: "概要", tasks: "案件一览", days: "每日工作", deliverables: "成果物", hours: "工时" },
    taskHeader: { requester: "委托方", title: "案件名", project: "项目", status: "状态", received_at: "受理日",
      done_at: "完成日", hours: "累计(h)", week_hours: "本周(h)", deliverables: "成果物", thinking: "备注" },
    status: { open: "进行中", done: "完成", hold: "暂停" },
    summary: { week: "周", new: "新建", done: "完成", ongoing: "进行中", total_hours: "总工时(h)", unassigned_hours: "未关联工时(h)", requester: "委托方", count: "件数" },
    days: { date: "日期", task: "案件", text: "工作内容", minutes: "分钟" },
    deliverables: { title: "案件", path: "成果物路径", done_at: "完成日" },
    hours: { date: "日期", hours: "工时(h)", total: "合计" },
    unassigned: "其他・调研",
    pdf: { title: "周工作报告", period: "期间", name: "姓名", summary: "概要", daily: "每日", projects: "案件", vertical: true,
      weekdays: ["日", "一", "二", "三", "四", "五", "六"], others: ["其他 {n} 件", "其他 {n} 件"], other: "其他", work: "工作时间", cumulative: "累计", taskCount: ["案件 {n} 件", "案件 {n} 件"],
      daysWorked: ["工作 {n} 天", "工作 {n} 天"], total: "合计", weekOf: "{y}年 第{w}周", issued: "发行 {d}" },
  },
  en: {
    sheet: { summary: "Summary", tasks: "Tasks", days: "Daily work", deliverables: "Deliverables", hours: "Hours" },
    taskHeader: { requester: "Requester", title: "Task", project: "Project", status: "Status", received_at: "Received",
      done_at: "Done", hours: "Total (h)", week_hours: "This week (h)", deliverables: "Deliverables", thinking: "Notes" },
    status: { open: "Open", done: "Done", hold: "On hold" },
    summary: { week: "Week", new: "New", done: "Done", ongoing: "Ongoing", total_hours: "Total hours (h)", unassigned_hours: "Unassigned hours (h)", requester: "Requester", count: "Count" },
    days: { date: "Date", task: "Task", text: "Work", minutes: "Min" },
    deliverables: { title: "Task", path: "Path", done_at: "Done" },
    hours: { date: "Date", hours: "Hours (h)", total: "Total" },
    unassigned: "Other / research",
    pdf: { title: "Weekly Work Report", period: "Period", name: "Name", summary: "Summary", daily: "Daily", projects: "Projects", vertical: false,
      weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], others: ["{n} other", "{n} others"], other: "Other", work: "Worked", cumulative: "Sum", taskCount: ["{n} project", "{n} projects"],
      daysWorked: ["{n} day worked", "{n} days worked"], total: "Total", weekOf: "{y} · Week {w}", issued: "Issued {d}" },
  },
};

/** "{n} others" → "5 others". */
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
/** [one, other] forms filled with a count: en 1 → "1 project", 2 → "2 projects". */
export const countText = (forms: [string, string], n: number) => fill(n === 1 ? forms[0] : forms[1], { n });

const wd = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const [y, m, d] = [(s: string) => s.slice(0, 4), (s: string) => Number(s.slice(5, 7)), (s: string) => Number(s.slice(8, 10))];

/** 期間: ja / zh "2026.09.26（土）〜 10.02（金）" (the year again when it changes); en "Sat 26 Sep – Fri 2 Oct 2026". */
export function periodText(lang: Lang, from: string, to: string): string {
  const L = LABELS[lang].pdf;
  if (lang === "en") {
    const one = (s: string, withYear: boolean) => `${L.weekdays[wd(s)]} ${d(s)} ${MON_EN[m(s) - 1]}${withYear ? ` ${y(s)}` : ""}`;
    return `${one(from, y(from) !== y(to))} – ${one(to, true)}`;
  }
  const dot = (s: string) => s.replace(/-/g, ".");
  const end = y(from) === y(to) ? dot(to).slice(5) : dot(to);
  return `${dot(from)}（${L.weekdays[wd(from)]}）〜 ${end}（${L.weekdays[wd(to)]}）`;
}

/** A 日別 row's date: ja "9/26 土", zh "9/26 六", en "Sat 9/26". */
export function dayText(lang: Lang, date: string): string {
  const L = LABELS[lang].pdf, md = `${m(date)}/${d(date)}`;
  return lang === "en" ? `${L.weekdays[wd(date)]} ${md}` : `${md} ${L.weekdays[wd(date)]}`;
}

/** The issue date: "2026.10.08" (ja / zh), "2026-10-08" (en). */
export const issuedText = (lang: Lang, date: string) => fill(LABELS[lang].pdf.issued, { d: lang === "en" ? date : date.replace(/-/g, ".") });

/** "2026-W40" → ja "2026年 第40週". */
export function weekText(lang: Lang, week: string): string {
  const [yy, ww] = week.split("-W");
  return fill(LABELS[lang].pdf.weekOf, { y: yy, w: Number(ww) });
}
