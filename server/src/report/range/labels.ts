// Fixed words of the range workbook per export language (spec 2026-10-13 §3, §10): formal written ja / zh / en.
// Status / その他 / 未割当 come from the single-week LABELS so the two exports never disagree.
import type { Lang } from "../../i18n/langs";
import { LABELS } from "../labels";

// その他の依頼元 (folded 依頼元) and 未紐付 (time on no 案件) are deliberately different words: the 週報's
// 「その他・調査」 would read like a 依頼元 in a legend.
// Hour words (user 10/13): 稼働時間（実時間） = wall clock and 累計作業時間 = sessions summed name the range pair (表紙,
// 週次一覧, データ); a 案件's own hours are 当週作業時間 / 期間内作業時間 and, over all history, 通算作業時間 — never the
// pair's words (稼働 / 累計, zh 工作时间 / 累计, en Working / Cumulative), which mean something else.
type Kpi = { label: string; unit: string; def: string };
type Chart = { title: string; basis: string };
export interface RangeLabels {
  sheet: { cover: string; week: string; weekly: string; tasks: string; data: string };
  cover: {
    title: string;
    period: string; span: string;           // span: {from} {to} week texts (one week: the week alone)
    periodValue: string;                    // {span}, {dates} the period, {weeks} the count
    weeks: [string, string];                // [one, other] with {n}
    generated: string; subject: string; subjectValue: string; unit: string; unitValue: string;
    about: string; purpose: string;
    guide: string; guideRows: Record<"cover" | "week" | "weekly" | "tasks" | "data", string>;
    kpiHead: string; kpiCols: [string, string, string, string];   // item / value / unit / definition
    chartsHead: string; note: string;       // {text}
  };
  kpi: { hours: Kpi; sum: Kpi; avg: Kpi; done: Kpi; cost: Kpi };
  chart: { hours: Chart; tasks: Chart; share: Chart; cost: Chart };   // basis: {other} {unlinked}
  week: {
    week: string; period: string; summary: string; top: string; none: string;   // top: {names}
    table: string; cols: { requester: string; title: string; week: string; total: string; status: string; deliverables: string };
    noTasks: string; note: string;
    days: string;                           // the 本周日别 heading
    dayCharts: { series: Chart; tasks: Chart; span: Chart };   // basis: {other} {unlinked}
  };
  weekly: { week: string; period: string; oneliner: string; hours: string; sum: string; new: string; done: string; top: string };
  tasks: {
    requester: string; title: string; project: string; status: string; received: string; done: string; range: string; total: string; deliverables: string;
    note: string; none: string; manualMark: string; manualNote: string;   // manualMark follows a hand-entered 通算 value
  };
  data: {
    week: string; period: string; total: string; sum: string; new: string; done: string; cum: string; cost: string; tokens: string; requester: string; hours: string;
    days: string; date: string; day: string; start: string; end: string; span: string;   // the 本周日别 block
  };
  weekdays: [string, string, string, string, string, string, string];   // Sunday first (Date#getUTCDay)
  status: Record<"open" | "done" | "hold", string>;
  other: string; otherTask: string; unassigned: string;
  taskSuffix: string;   // after 未紐付 in the 案件 columns of the day block, so it differs from the 依頼元 series
 noRequester: string; requesterSuffix: string; costPartial: string; sep: string;
}

export const RANGE_LABELS: Record<Lang, RangeLabels> = {
  ja: {
    sheet: { cover: "表紙・概要", week: "当週業務内容", weekly: "週次一覧", tasks: "案件一覧", data: "データ" },
    cover: {
      title: "業務報告書（期間集計）",
      period: "対象期間", span: "{from} 〜 {to}", periodValue: "{span}（{dates}、{weeks}）", weeks: ["全 {n} 週", "全 {n} 週"],
      generated: "作成日",
      subject: "集計対象", subjectValue: "worklog に記録された作業セッション（Claude Code・Codex）および作業メモ。非表示に設定したセッションは含まない。",
      unit: "集計単位", unitValue: "週（土曜日から金曜日まで）。1 日は午前 5 時に始まるものとする。",
      about: "本書について",
      purpose: "本書は、対象期間における業務の実績を週単位で集計し、作業時間、案件の進捗状況および AI 利用費用を報告するものである。各シートの内容は次のとおり。",
      guide: "シート構成",
      guideRows: {
        cover: "本書の概要、主要指標および推移グラフ",
        week: "対象期間の最終週における業務概要、案件別内訳および日別の稼働",
        weekly: "週ごとの作業時間、案件数および業務概要",
        tasks: "対象期間中に作業を行った案件の一覧",
        data: "グラフの基礎データ",
      },
      kpiHead: "主要指標", kpiCols: ["指標", "値", "単位", "定義"],
      chartsHead: "推移グラフ", note: "注：{text}",
    },
    kpi: {
      hours: { label: "稼働時間（実時間）", unit: "時間", def: "作業を行っていた実際の経過時間。並行するセッションの重複する時間は 1 回のみ計上する。" },
      sum: { label: "累計作業時間", unit: "時間", def: "各セッションの作業時間の合計。並行するセッションはそれぞれ計上する。" },
      avg: { label: "週平均稼働時間", unit: "時間／週", def: "稼働時間（実時間）を対象期間の全週数（稼働のない週を含む）で除した値。" },
      done: { label: "完了案件数", unit: "件", def: "対象期間中に完了した案件の件数。" },
      cost: { label: "AI 利用費用", unit: "米ドル", def: "各セッションのトークン使用量をモデル別の API 料金で換算した推定額。" },
    },
    chart: {
      hours: { title: "週別稼働時間（依頼元別）", basis: "稼働時間（実時間）を依頼元別に積み上げて表示。複数の依頼元をもつ案件の時間は均等に按分し、上位 6 依頼元以外は「{other}」、案件に紐付かない作業は「{unlinked}」に計上する。" },
      tasks: { title: "週別案件数（新規・完了）", basis: "棒グラフは各週に受領した案件数および完了した案件数（左軸）、折れ線は完了案件数の累計（右軸）を示す。" },
      share: { title: "依頼元別稼働時間の構成比", basis: "対象期間の稼働時間（実時間）に占める各依頼元の割合を示す。" },
      cost: { title: "週別 AI 利用費用", basis: "各セッションの費用を、各週における当該セッションの稼働時間の比率で按分した額（米ドル）。" },
    },
    week: {
      week: "対象週", period: "期間", summary: "業務概要", top: "主な案件：{names}", none: "当該週の作業記録なし",
      table: "案件別内訳",
      cols: { requester: "依頼元", title: "案件名", week: "当週作業時間 (h)", total: "通算作業時間 (h)", status: "状態", deliverables: "成果物" },
      noTasks: "該当する案件なし",
      note: "注：当週作業時間は当該週における案件ごとの実時間。通算作業時間は記録開始以降の当該案件の作業時間（手入力値がある場合はその値）。",
      days: "当週の日別",
      dayCharts: {
        series: { title: "日別稼働時間（依頼元別）", basis: "各日の稼働時間（実時間）を依頼元別に積み上げて表示。日付は 5 時始まり。" },
        tasks: { title: "日別稼働時間（案件別）", basis: "各日の稼働時間（実時間）を案件別に積み上げて表示。当週の上位 6 案件以外は「{other}」、案件に紐付かない作業は「{unlinked}」に計上する。" },
        span: { title: "日別の開始・終了時刻", basis: "各日の最初のセッション開始から最後のセッション終了までを示す（作業メモは含まない）。24:00 以降は翌朝 5 時までの時刻。" },
      },
    },
    weekly: { week: "週次", period: "期間", oneliner: "業務概要", hours: "稼働時間（実時間）(h)", sum: "累計作業時間 (h)", new: "新規案件数", done: "完了案件数", top: "主な案件" },
    tasks: {
      requester: "依頼元", title: "案件名", project: "プロジェクト", status: "状態", received: "受領日", done: "完了日",
      range: "期間内作業時間 (h)", total: "通算作業時間 (h)", deliverables: "成果物",
      note: "注：期間内作業時間は対象期間における案件ごとの実時間。通算作業時間は記録開始以降の当該案件の作業時間（手入力値がある場合はその値）。",
      none: "該当する案件なし", manualMark: "※", manualNote: "※ 手入力値（作業記録からの集計値ではなく、案件に入力された値）。",
    },
    data: { week: "週次", period: "期間", total: "稼働時間（実時間）(h)", sum: "累計作業時間 (h)", new: "新規案件数", done: "完了案件数", cum: "完了案件数（累計）", cost: "AI 利用費用 (USD)", tokens: "トークン数", requester: "依頼元", hours: "稼働時間（実時間）(h)",
      days: "当週の日別", date: "日付", day: "曜日", start: "開始時刻", end: "終了時刻", span: "稼働幅" },
    weekdays: ["日", "月", "火", "水", "木", "金", "土"],
    status: LABELS.ja.status, other: "その他の依頼元", otherTask: "その他の案件", taskSuffix: "（案件）", unassigned: "未紐付", noRequester: "（依頼元なし）", requesterSuffix: "（依頼元）",
    costPartial: "※ 一部のセッションについては費用が集計されていない。", sep: "、",
  },
  zh: {
    sheet: { cover: "封面及概要", week: "本周业务内容", weekly: "每周一览", tasks: "案件一览", data: "数据" },
    cover: {
      title: "工作报告（期间汇总）",
      period: "报告期间", span: "{from} 至 {to}", periodValue: "{span}（{dates}，{weeks}）", weeks: ["共 {n} 周", "共 {n} 周"],
      generated: "编制日期",
      subject: "统计对象", subjectValue: "worklog 记录的作业会话（Claude Code、Codex）及作业备忘，不含已设为隐藏的会话。",
      unit: "统计单位", unitValue: "周（周六至周五），每日以上午 5 时为起点。",
      about: "关于本报告",
      purpose: "本报告按周汇总报告期间内的工作实绩，报告作业时间、案件进展情况及 AI 使用费用。各工作表的内容如下。",
      guide: "工作表构成",
      guideRows: {
        cover: "本报告概要、主要指标及趋势图表",
        week: "报告期间最后一周的工作概要、案件明细以及每日工作情况",
        weekly: "各周的作业时间、案件数及工作概要",
        tasks: "报告期间内有作业的案件一览",
        data: "图表的基础数据",
      },
      kpiHead: "主要指标", kpiCols: ["指标", "数值", "单位", "定义"],
      chartsHead: "趋势图表", note: "注：{text}",
    },
    kpi: {
      hours: { label: "工作时间（实际时长）", unit: "小时", def: "实际进行作业的经过时间；并行会话的重叠时间只计一次。" },
      sum: { label: "累计作业时间", unit: "小时", def: "各会话作业时间之和；并行会话分别计入。" },
      avg: { label: "周平均工作时间", unit: "小时／周", def: "工作时间（实际时长）除以报告期间的全部周数（含无作业的周）。" },
      done: { label: "完成案件数", unit: "件", def: "报告期间内完成的案件数。" },
      cost: { label: "AI 使用费用", unit: "美元", def: "按各模型的 API 价格折算各会话 token 用量所得的估算金额。" },
    },
    chart: {
      hours: { title: "每周工作时间（按委托方）", basis: "按委托方堆叠显示工作时间（实际时长）。有多个委托方的案件按委托方均分；前 6 名以外的委托方计入“{other}”，未关联案件的作业计入“{unlinked}”。" },
      tasks: { title: "每周案件数（新增与完成）", basis: "柱形图表示各周受理及完成的案件数（左轴），折线表示完成案件数的累计（右轴）。" },
      share: { title: "各委托方工作时间构成比", basis: "各委托方在报告期间工作时间（实际时长）中所占的比例。" },
      cost: { title: "每周 AI 使用费用", basis: "各会话费用按该会话在各周的工作时间比例分摊后的金额（美元）。" },
    },
    week: {
      week: "本报告周", period: "期间", summary: "工作概要", top: "主要案件：{names}", none: "该周无作业记录。",
      table: "案件明细",
      cols: { requester: "委托方", title: "案件名", week: "本周作业时间 (h)", total: "通算作业时间（自记录开始）(h)", status: "状态", deliverables: "成果物" },
      noTasks: "无相关案件。",
      note: "注：本周作业时间为该周内各案件的实际时长；通算作业时间（自记录开始）为自开始记录以来该案件的作业时间（如有手动输入值则采用该值）。",
      days: "本周日别",
      dayCharts: {
        series: { title: "每日工作时间（按委托方）", basis: "按委托方堆叠显示各日的工作时间（实际时长）。每日以上午 5 时为起点。" },
        tasks: { title: "每日工作时间（按案件）", basis: "按案件堆叠显示各日的工作时间（实际时长）。本周前 6 名以外的案件计入“{other}”，未关联案件的作业计入“{unlinked}”。" },
        span: { title: "每日开始／结束时刻", basis: "显示各日最早的会话开始至最晚的会话结束（不含作业备忘）。24:00 以后为次日上午 5 时前的时刻。" },
      },
    },
    weekly: { week: "周次", period: "期间", oneliner: "工作概要", hours: "工作时间（实际时长）(h)", sum: "累计作业时间 (h)", new: "新增案件数", done: "完成案件数", top: "主要案件" },
    tasks: {
      requester: "委托方", title: "案件名", project: "项目", status: "状态", received: "受理日期", done: "完成日期",
      range: "期间内作业时间 (h)", total: "通算作业时间（自记录开始）(h)", deliverables: "成果物",
      note: "注：期间内作业时间为报告期间内各案件的实际时长；通算作业时间（自记录开始）为自开始记录以来该案件的作业时间（如有手动输入值则采用该值）。",
      none: "无相关案件。", manualMark: "※", manualNote: "※ 手动输入值（并非由作业记录汇总，而是在案件中输入的值）。",
    },
    data: { week: "周次", period: "期间", total: "工作时间（实际时长）(h)", sum: "累计作业时间 (h)", new: "新增案件数", done: "完成案件数", cum: "完成案件数（累计）", cost: "AI 使用费用 (USD)", tokens: "token 数", requester: "委托方", hours: "工作时间（实际时长）(h)",
      days: "本周日别", date: "日期", day: "星期", start: "开始时刻", end: "结束时刻", span: "工作跨度" },
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
    status: LABELS.zh.status, other: "其他委托方", otherTask: "其他案件", taskSuffix: "（案件）", unassigned: "未关联", noRequester: "（无委托方）", requesterSuffix: "（委托方）",
    costPartial: "※ 部分会话的费用未计入。", sep: "、",
  },
  en: {
    sheet: { cover: "Cover and Summary", week: "Reporting Week", weekly: "Weekly Summary", tasks: "Task List", data: "Data" },
    cover: {
      title: "Work Report (Period Summary)",
      period: "Reporting Period", span: "{from} – {to}", periodValue: "{span} ({dates}; {weeks})", weeks: ["{n} week", "{n} weeks"],
      generated: "Date of Preparation",
      subject: "Scope", subjectValue: "Work sessions (Claude Code, Codex) and work notes recorded in worklog, excluding hidden sessions.",
      unit: "Unit of Aggregation", unitValue: "Weeks from Saturday to Friday; each day begins at 5:00 a.m.",
      about: "About This Report",
      purpose: "This report summarises, week by week, the work performed during the reporting period: working hours, the progress of tasks and AI usage costs. The sheets contain the following.",
      guide: "Structure of the Workbook",
      guideRows: {
        cover: "Overview of the report, key figures and charts",
        week: "Summary of work, breakdown by task and the day-by-day hours for the last week of the period",
        weekly: "Working hours, task counts and a summary of work for each week",
        tasks: "List of the tasks worked on during the period",
        data: "Source data of the charts",
      },
      kpiHead: "Key Figures", kpiCols: ["Item", "Value", "Unit", "Definition"],
      chartsHead: "Charts", note: "Note: {text}",
    },
    kpi: {
      hours: { label: "Working Hours (Wall Clock)", unit: "hours", def: "Elapsed time during which work was performed; overlapping parallel sessions are counted once." },
      sum: { label: "Cumulative Work Hours", unit: "hours", def: "Sum of the working time of each session; parallel sessions are each counted in full." },
      avg: { label: "Average Weekly Working Hours", unit: "hours/week", def: "Working hours (wall clock) divided by the number of weeks in the period, including weeks without work." },
      done: { label: "Completed Tasks", unit: "tasks", def: "Number of tasks completed during the period." },
      cost: { label: "AI Usage Cost", unit: "USD", def: "Estimated amount: the token usage of each session priced at the API rates of its model." },
    },
    chart: {
      hours: { title: "Weekly Working Hours by Requester", basis: "Working hours (wall clock) stacked by requester. The hours of a task with several requesters are split evenly; requesters outside the top six are shown as “{other}”, work not linked to a task as “{unlinked}”." },
      tasks: { title: "Weekly New and Completed Tasks", basis: "Bars: tasks received and tasks completed in each week (left axis). Line: cumulative completed tasks (right axis)." },
      share: { title: "Share of Working Hours by Requester", basis: "Each requester's share of the working hours (wall clock) in the period." },
      cost: { title: "Weekly AI Usage Cost", basis: "The cost of each session apportioned to the weeks by its share of working hours in each week (USD)." },
    },
    week: {
      week: "Reporting Week", period: "Period", summary: "Summary of Work", top: "Main tasks: {names}", none: "No work was recorded in this week.",
      table: "Breakdown by Task",
      cols: { requester: "Requester", title: "Task", week: "Hours This Week (h)", total: "Total Hours to Date (h)", status: "Status", deliverables: "Deliverables" },
      noTasks: "No tasks.",
      note: "Note: 'Hours This Week' is the wall-clock time on each task in this week; 'Total Hours to Date' is the task's time since records began (the manually entered value where one exists).",
      days: "This Week by Day",
      dayCharts: {
        series: { title: "Daily Working Hours by Requester", basis: "Working hours (wall clock) of each day stacked by requester. Each day begins at 5:00 a.m." },
        tasks: { title: "Daily Working Hours by Task", basis: "Working hours (wall clock) of each day stacked by task. Tasks outside the week's top six are shown as “{other}”, work not linked to a task as “{unlinked}”." },
        span: { title: "Daily Start and End Times", basis: "From the first session start to the last session end of each day (work notes excluded). Times past 24:00 are the next morning, before 5:00 a.m." },
      },
    },
    weekly: { week: "Week", period: "Period", oneliner: "Summary of Work", hours: "Working Hours (Wall Clock) (h)", sum: "Cumulative Work Hours (h)", new: "New Tasks", done: "Completed Tasks", top: "Main Tasks" },
    tasks: {
      requester: "Requester", title: "Task", project: "Project", status: "Status", received: "Date Received", done: "Date Completed",
      range: "Hours in Period (h)", total: "Total Hours to Date (h)", deliverables: "Deliverables",
      note: "Note: 'Hours in Period' is the wall-clock time on each task in the reporting period; 'Total Hours to Date' is the task's time since records began (the manually entered value where one exists).",
      none: "No tasks.", manualMark: "*", manualNote: "* Manually entered value (entered on the task, not aggregated from the work records).",
    },
    data: { week: "Week", period: "Period", total: "Working Hours (Wall Clock) (h)", sum: "Cumulative Work Hours (h)", new: "New Tasks", done: "Completed Tasks", cum: "Completed Tasks (Cumulative)", cost: "AI Usage Cost (USD)", tokens: "Tokens", requester: "Requester", hours: "Working Hours (Wall Clock) (h)",
      days: "This Week by Day", date: "Date", day: "Day", start: "Start", end: "End", span: "Span" },
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    status: LABELS.en.status, other: "Other requesters", otherTask: "Other tasks", taskSuffix: " (tasks)", unassigned: "Unlinked", noRequester: "(no requester)", requesterSuffix: " (requester)",
    costPartial: "* Costs have not been recorded for some sessions.", sep: ", ",
  },
};
