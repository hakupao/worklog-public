// The range workbook's data (spec 2026-10-13 §3), built by data.ts (or, for the Task 1 samples, from the per-week API).
export interface RangeWeek {
  week: string; start: string; end: string;   // report week key, its Saturday and Friday (05:00 days)
  hours: number; sum_hours: number;           // wall clock / 累計 (sessions summed), 2 decimals
  new: number; done: number; done_cum: number;
  by_series: number[];                        // hours per RangeData.series entry, same order
  cost_usd: number; tokens: number;
  oneliner: string | null;                    // in the export language; null = none stored
  top_tasks: string[];                        // up to 3 案件 titles by the week's wall minutes
  digest_text: string | null;                 // the week digest as the 週報 PDF shows it (pdf_text, else text), export language; null = none
  tasks: RangeWeekTask[];                     // the 案件 the 週報 lists for the week (当週業務内容), 案件一覧 order
}
/** One 案件 of one week, as the 週報 shows it (当週業務内容). */
export interface RangeWeekTask {
  id: string; requester: string; title: string; status: "open" | "done" | "hold";
  /** 当週作業時間: the 案件's wall-clock hours in this week (= 週報 今週(h)), 2 decimals. */
  week_hours: number;
  /** 累計作業時間: the 案件's hours over all history, not only the range (= 週報 累計(h)): hours_manual, else quarter hours. */
  total_hours_all_time: number;
  deliverables: string[];   // hand-picked, then the automatic ones written that week, in the 週報's order
}
export interface RangeTask {
  id: string; requester: string; title: string; project: string; status: "open" | "done" | "hold";
  received_at: string; done_at: string | null;
  range_hours: number;     // quarter hours like total_hours; 2 decimals when total_hours is a hand value
  total_hours: number;     // hours_manual, else quarter hours over all history
  total_manual: boolean;   // total_hours is hours_manual (marked ※ in 案件一覧)
  deliverables: string[];
}
/** One 05:00 day of the range's last week (本周日别). */
export interface RangeDay {
  date: string;
  hours: number;          // wall clock, 2 decimals (notes included, as the week's hours)
  by_series: number[];    // hours per RangeData.series entry, 2 decimals
  by_task: number[];      // hours per RangeData.day_tasks entry, 2 decimals
  /** Earliest start / latest end of session time that day, hours after the date's 00:00 JST (25.5 = 01:30 the next
   *  morning); null when the day has no session time (notes do not count). */
  start: number | null; end: number | null;
}
/** A 案件 series of the day charts: a task id, or the OTHER / UNLINKED sentinel (series.ts). */
export interface RangeDayTask {
  key: string; label: string;
  color: string;          // "RRGGBB": the 案件's badge colour inked for paper; "" for OTHER / UNLINKED (the style's slots)
}
export interface RangeData {
  from: string; to: string; generated: string;   // generated = the JST date the file was made
  weeks: RangeWeek[];                            // oldest first
  series_keys: string[];                         // top 6 依頼元 keys, then OTHER, then UNLINKED (series.ts) — chart and データ order
  series: string[];                              // the same series as shown in the export language (seriesLabel)
  share: Array<[string, number]>;                // range hours per series, same order
  totals: { hours: number; sum_hours: number; done: number; cost_usd: number; tokens: number; cost_partial: boolean };
  tasks: RangeTask[];
  days: RangeDay[];                              // the last week's 7 days, oldest first
  day_tasks: RangeDayTask[];                     // the last week's top 6 案件 by wall minutes, then OTHER, then UNLINKED
}
