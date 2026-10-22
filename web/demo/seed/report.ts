// 週報 and 周复盘: AI digests through the generator's own write-back route (so their input hashes are the server's and
// nothing reads 待更新), weekly reviews, a few hand-edited cells, and the download history of every past week.
import { weekRange } from "../../../server/src/jst";
import { reportWeekOf, reportWeekRange } from "../../../server/src/report/week";
import { ALL_DAYS, ISO_WEEKS, TODAY, addDays, iso, isoWeekOf, jstMs } from "./calendar";
import type { Translations } from "./i18n";
import { OTHER, UNASSIGNED, cap, continued, smallWork } from "./phrases";
import type { Progress } from "./progress";
import { rng } from "./rng";
import type { SessionRec } from "./sessions";
import type { SeedCtx, Tri } from "./types";
import { MACHINES, TASKS, type TaskDef } from "./world";

const MODEL = "claude-opus-5-5";
/** server/src/report/weekly.ts UNASSIGNED_LABEL: the 作業記録 title of rows with no 案件. */
const UNASSIGNED_LABEL = "その他・調査";
const byTitle = new Map(TASKS.map((x) => [x.title.ja, x]));

/** Report weeks (Sat 05:00 → Sat 05:00, keyed by the Friday's ISO week) that hold demo days. */
export const REPORT_WEEKS = [...new Set(ALL_DAYS.map((d) => reportWeekOf(jstMs(d, 12 * 60))))];

/** Minutes per 案件 in one day's 作業記録 section (`- <title>：<text>（N分）`), null key = no 案件. */
function worked(input: string): Map<TaskDef | null, number> {
  const out = new Map<TaskDef | null, number>();
  const section = input.split("## 作業記録\n")[1] ?? "";
  for (const line of section.split("\n")) {
    const m = /^- (.*)（(\d+)分）$/.exec(line);
    if (!m) continue;
    const head = m[1];
    const task = head.startsWith(`${UNASSIGNED_LABEL}：`) ? null : [...byTitle].find(([title]) => head.startsWith(`${title}：`))?.[1] ?? null;
    out.set(task, (out.get(task) ?? 0) + Number(m[2]));
  }
  return out;
}

type Lines = { ja: string[]; zh: string[]; en: string[] };
const line = (L: Lines, title: Tri, body: Tri) => {
  L.ja.push(`■ ${title.ja}：${body.ja}`); L.zh.push(`■ ${title.zh}：${body.zh}`); L.en.push(`■ ${title.en}: ${cap(body.en)}`);
};
const others = (L: Lines, names: Tri[]) => { if (names.length) line(L, OTHER, smallWork(names)); };
const text = (L: Lines) => ({ ja: L.ja.join("\n"), zh: L.zh.join("\n"), en: L.en.join("\n") });

function dayDigest(prog: Progress, date: string, input: string) {
  const rows = [...worked(input)].sort((a, b) => b[1] - a[1]);
  const L: Lines = { ja: [], zh: [], en: [] }, small: Tri[] = [], top: Tri[] = [];
  for (const [task, minutes] of rows) {
    if (!task) { small.push(UNASSIGNED); continue; }
    if (minutes < 25) { small.push(task.short); continue; }
    const m = prog.movedOn(task, date) ? prog.milestoneAt(task, date) : null;
    const body = m ?? continued(prog.objectOn(task, date));
    line(L, task.title, body);
    if (top.length < 2) top.push({ ja: `${task.short.ja}：${body.ja}`, zh: `${task.short.zh}：${body.zh}`, en: `${cap(task.short.en)}: ${body.en}` });
  }
  others(L, small);
  const pdf = top.length === 2 && Array.from(top[0].ja + top[1].ja).length <= 60
    ? { ja: `${top[0].ja}、${top[1].ja}`, zh: `${top[0].zh}，${top[1].zh}`, en: `${top[0].en}; ${top[1].en}` }
    : top[0] ?? smallWork(small);
  return { text: text(L), pdf, minutes: rows };
}

function weekDigest(prog: Progress, week: string, days: Map<string, Map<TaskDef | null, number>>) {
  const range = reportWeekRange(week)!;
  const total = new Map<TaskDef | null, number>(), last = new Map<TaskDef, string>();
  for (const [date, rows] of [...days].sort()) for (const [task, m] of rows) {
    total.set(task, (total.get(task) ?? 0) + m);
    if (task && m >= 20) last.set(task, date);
  }
  const ranked = [...total].sort((a, b) => b[1] - a[1]);
  const L: Lines = { ja: [], zh: [], en: [] }, small: Tri[] = [], main: TaskDef[] = [];
  for (const [task, m] of ranked) {
    if (!task) { small.push(UNASSIGNED); continue; }
    const ms = last.get(task) && prog.milestoneAt(task, last.get(task)!);
    if (m < 60 || !ms) { small.push(task.short); continue; }
    line(L, task.title, ms);
    main.push(task);
  }
  const P: Lines = { ja: L.ja.slice(0, 5), zh: L.zh.slice(0, 5), en: L.en.slice(0, 5) };
  const rest = [...main.slice(5).map((x) => x.short), ...small];
  others(L, small); others(P, rest);
  const finished = (x: TaskDef) => x.end?.status === "done" && range.days.includes(x.end.date);
  const [a, b] = main;
  const oneliner: Tri = !a ? { ja: "細かな作業を進めた。", zh: "推进了零碎的工作。", en: "Worked through smaller items." }
    : !b ? (finished(a) ? { ja: `${a.short.ja}を完了した。`, zh: `完成了${a.short.zh}。`, en: `Completed the ${a.short.en}.` }
      : { ja: `${a.short.ja}の作業を進めた。`, zh: `推进了${a.short.zh}的工作。`, en: `Advanced the ${a.short.en}.` })
    : finished(a) ? { ja: `${a.short.ja}を完了し、${b.short.ja}の作業を進めた。`, zh: `完成了${a.short.zh}，并推进了${b.short.zh}。`, en: `Completed the ${a.short.en} and advanced the ${b.short.en}.` }
    : finished(b) ? { ja: `${b.short.ja}を完了し、${a.short.ja}の作業を進めた。`, zh: `完成了${b.short.zh}，并推进了${a.short.zh}。`, en: `Completed the ${b.short.en} and advanced the ${a.short.en}.` }
    : { ja: `${a.short.ja}と${b.short.ja}の作業を進めた。`, zh: `推进了${a.short.zh}和${b.short.zh}的工作。`, en: `Advanced the ${a.short.en} and the ${b.short.en}.` };
  return { text: text(L), pdf: text(P), oneliner };
}

/** Day lines first (the week input embeds them), then the week line; weeks oldest first (each embeds last week's). */
export async function seedDigests(ctx: SeedCtx, prog: Progress): Promise<number> {
  let written = 0;
  for (const week of REPORT_WEEKS) {
    const first = await ctx.api("GET", `/api/reports/${week}/digest-inputs`);
    const days = new Map<string, Map<TaskDef | null, number>>();
    for (const it of first.items as { day: string; input: string; hash: string }[]) {
      if (it.day === "") continue;
      const d = dayDigest(prog, it.day, it.input);
      days.set(it.day, new Map(d.minutes));
      await ctx.api("PUT", `/api/reports/${week}/digests/${it.day}/generated`, {
        text: d.text.ja, pdf_text: d.pdf.ja, inputs_hash: it.hash, model: MODEL,
        zh: { text: d.text.zh, pdf_text: d.pdf.zh }, en: { text: d.text.en, pdf_text: d.pdf.en },
      });
      written++;
    }
    const again = await ctx.api("GET", `/api/reports/${week}/digest-inputs`);
    const wk = (again.items as { day: string; hash: string }[]).find((x) => x.day === "");
    if (!wk) continue;
    const w = weekDigest(prog, week, days);
    await ctx.api("PUT", `/api/reports/${week}/digests/week/generated`, {
      text: w.text.ja, pdf_text: w.pdf.ja, oneliner: w.oneliner.ja, inputs_hash: wk.hash, model: MODEL,
      zh: { text: w.text.zh, pdf_text: w.pdf.zh, oneliner: w.oneliner.zh }, en: { text: w.text.en, pdf_text: w.pdf.en, oneliner: w.oneliner.en },
    });
    written++;
    // generated_at / updated_at as of the local generator's run on each day's evening, not DEMO_NOW
    const at = (day: string) => iso(Math.min(jstMs(day, 19 * 60 + 2, 11), jstMs(TODAY, 15 * 60 + 2, 11)));
    for (const day of days.keys()) await ctx.sql("UPDATE report_digests SET generated_at = ?1, updated_at = ?1 WHERE week = ?2 AND day = ?3", at(day), week, day);
    await ctx.sql("UPDATE report_digests SET generated_at = ?1, updated_at = ?1 WHERE week = ?2 AND day = ''", at([...days.keys()].sort().pop()!), week);
  }
  return written;
}

/** 周复盘 for every finished ISO week, written the Monday after from that week's numbers. */
export async function seedReviews(ctx: SeedCtx, recs: SessionRec[], tr: Translations): Promise<number> {
  const R = rng("reviews");
  const done = ISO_WEEKS.filter((w) => w < isoWeekOf(TODAY) && recs.some((r) => isoWeekOf(r.date) === w && r.minutes > 0 && r.date >= "2026-08-24"));
  let prevHours: number | null = null;
  for (const week of done) {
    const own = recs.filter((r) => !r.hide && isoWeekOf(r.date) === week);
    const minutes = own.reduce((s, r) => s + r.minutes, 0), hours = minutes / 60;
    const cost = own.reduce((s, r) => s + (r.body.tokens.cost_usd ?? 0), 0);
    const byTask = new Map<TaskDef, number>();
    for (const r of own) if (r.task) byTask.set(r.task, (byTask.get(r.task) ?? 0) + r.minutes);
    const top = [...byTask].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const codex = own.filter((r) => r.body.agent === "codex").length;
    let cr = 0, all = 0, sub = 0;
    for (const r of own) for (const [, x] of Object.entries(r.body.tokens.by_model)) { cr += x.cache_read; all += x.input + x.cache_read + x.cache_write_5m + x.cache_write_1h; }
    for (const r of own) for (const [, x] of Object.entries(r.body.tokens.subagent)) sub += x.input + x.output + x.cache_read + x.cache_write_5m;
    const late = own.filter((r) => { const h = new Date(r.startMs + 9 * 3_600_000).getUTCHours(); return h >= 22 || h < 5; }).length;
    const unlinked = own.filter((r) => !r.task).reduce((s, r) => s + r.minutes, 0);
    const costliest = [...own].sort((a, b) => (b.body.tokens.cost_usd ?? 0) - (a.body.tokens.cost_usd ?? 0))[0];
    const h1 = (x: number) => x.toFixed(1), usd = (x: number) => `$${x.toFixed(0)}`;
    const delta = prevHours === null ? null : hours - prevHours;
    const d = (s: string) => (delta === null ? "" : s.replace("{d}", `${delta >= 0 ? "+" : ""}${h1(delta)}`));
    const pct = Math.round((cr / Math.max(all, 1)) * 100);
    const insight = late > 0
      ? { ja: `22 時以降に始めたセッションが ${late} 件あった。翌朝の開始が遅れた日がある。`, zh: `有 ${late} 个会话是在 22 点以后开始的，有几天第二天上午开工偏晚。`, en: `${late} session${late === 1 ? "" : "s"} started after 22:00; some next mornings started late.` }
      : unlinked >= 30
        ? { ja: `案件に紐付いていないセッションが計 ${unlinked} 分ある。週報に載らないので早めに関連付けたい。`, zh: `有共计 ${unlinked} 分钟的会话没有关联案件，不会计入週報，最好尽早关联。`, en: `${unlinked} minutes of sessions are not linked to any 案件 and will be missing from the 週報; link them soon.` }
        : { ja: "作業は平日の日中に収まり、深夜・週末の作業はなかった。", zh: "工作都集中在工作日白天，没有深夜和周末加班。", en: "Work stayed within weekday hours, with no late-night or weekend sessions." };
    const next = top[0] ? top[0][0] : null;
    const suggestion = next
      ? { ja: `${next.short.ja}は来週も中心になる見込み。今日安排に「具体要求」を書いてから始めると判定が正確になる。`,
          zh: `${next.short.zh}下周预计仍是重点。先在今日安排里写好「具体要求」再开始，判定会更准确。`,
          en: `The ${next.short.en} will likely stay the focus next week; writing a concrete goal in the day plan first makes the judgement more accurate.` }
      : { ja: "来週の計画を先に立てておく。", zh: "先把下周的计划排好。", en: "Plan next week ahead of time." };
    const sub80 = sub / Math.max(all, 1) > 0.25
      ? { ja: "サブエージェントの使用が多く、トークンの 4 分の 1 以上を占めた。", zh: "子 agent 用得较多，占了四分之一以上的 token。", en: "Subagents were used heavily, taking over a quarter of the tokens." }
      : null;
    const lines = (L: "ja" | "zh" | "en") => {
      const H = { ja: ["## 今週のまとめ", "## 時間の使い方", "## AI の使い方", "## 気づき", "## 来週に向けて"],
        zh: ["## 本周总结", "## 时间分配", "## AI 使用情况", "## 发现", "## 下周建议"],
        en: ["## This week", "## Where the time went", "## AI usage", "## Observations", "## Next week"] }[L];
      const head = { ja: `稼働 ${h1(hours)} 時間、セッション ${own.length} 件、等価費用 ${usd(cost)}${d("（先週比 {d} 時間）")}。`,
        zh: `工作 ${h1(hours)} 小时，会话 ${own.length} 个，等价费用 ${usd(cost)}${d("（比上周 {d} 小时）")}。`,
        en: `${h1(hours)} hours over ${own.length} sessions, ${usd(cost)} equivalent cost${d(" ({d} h on last week)")}.` }[L];
      const tops = top.map(([x, m]) => {
        const p = Math.round((m / Math.max(minutes, 1)) * 100);
        return L === "en" ? `- ${x.title.en}: ${h1(m / 60)} h (${p}%)` : `- ${x.title[L]}：${h1(m / 60)}${L === "ja" ? " 時間" : " 小时"}（${p}%）`;
      });
      const ai = { ja: `- Claude Code ${own.length - codex} 件／Codex ${codex} 件、キャッシュ命中率 ${pct}%。`,
        zh: `- Claude Code ${own.length - codex} 个／Codex ${codex} 个，缓存命中率 ${pct}%。`,
        en: `- Claude Code ${own.length - codex} / Codex ${codex} sessions, cache hit rate ${pct}%.` }[L];
      const most = costliest?.task ? { ja: `- 最も費用がかかったのは${costliest.task.short.ja}のセッション（${usd(costliest.body.tokens.cost_usd ?? 0)}）。`,
        zh: `- 费用最高的是${costliest.task.short.zh}的会话（${usd(costliest.body.tokens.cost_usd ?? 0)}）。`,
        en: `- The most expensive session was on the ${costliest.task.short.en} (${usd(costliest.body.tokens.cost_usd ?? 0)}).` }[L] : null;
      return [H[0], head, "", H[1], ...tops, "", H[2], ai, ...(most ? [most] : []), ...(sub80 ? [`- ${sub80[L]}`] : []), "", H[3], `- ${insight[L]}`, "", H[4], `- ${suggestion[L]}`].join("\n");
    };
    const body: Tri = { ja: lines("ja"), zh: lines("zh"), en: lines("en") };
    const stats = { week, hours: Number(h1(hours)), sessions: own.length, cost_usd: Math.round(cost * 100) / 100, codex_sessions: codex,
      cache_hit: pct / 100, late_sessions: late, unlinked_minutes: unlinked, top: top.map(([x, m]) => ({ id: x.id, title: x.title.ja, minutes: m })) };
    await ctx.api("POST", "/api/reviews", { week, text: body.ja, model: "claude-haiku-4-5", stats_json: JSON.stringify(stats), machine: MACHINES.mac });
    const at = iso(jstMs(addDays(weekRange(week)!.days[0], 7), 0, R.int(240, 900)));
    await ctx.sql("UPDATE weekly_reviews SET generated_at = ?1 WHERE week = ?2", at, week);
    tr.add("weekly_review", week, "text", body, "ja", at);
    prevHours = hours;
  }
  return done.length;
}

/** Hand edits of three generated cells, made on the Friday of their week. */
export async function seedOverrides(ctx: SeedCtx, recs: SessionRec[], tr: Translations): Promise<number> {
  const S = recs.find((r) => r.task?.id === "T20260914-01" && r.date === "2026-10-08" && !r.hide);
  const cells: { week: string; sheet: string; row_key: string; column: string; tri?: Tri; value?: string; at: string }[] = [
    { week: "2026-W40", sheet: "tasks", row_key: "T20260824-01", column: "thinking", at: "2026-10-02T08:40:00.000Z",
      tri: { ja: "全 12 画面の移し替えを完了。旧画面は 10/16 に停止予定。", zh: "全部 12 个画面已迁移完成。旧画面计划于 10/16 停用。", en: "All 12 screens migrated. The old screens will be retired on 10/16." } },
    { week: "2026-W39", sheet: "hours", row_key: "2026-09-25", column: "hours", value: "7.5", at: "2026-09-25T09:05:00.000Z" },
    ...(S ? [{ week: "2026-W41", sheet: "days", row_key: `S:${S.body.id}`, column: "text", at: "2026-10-09T09:15:00.000Z",
      tri: { ja: "権限マトリクスの最終版を作成し、Kevin Liu さんに送付した", zh: "完成了权限矩阵的最终版并发送给 Kevin Liu", en: "Finished the final permission matrix and sent it to Kevin Liu" } }] : []),
  ];
  for (const c of cells) {
    const value = c.tri ? c.tri.ja : c.value!;
    await ctx.api("PUT", `/api/reports/${c.week}/weekly/cells`, { sheet: c.sheet, row_key: c.row_key, column: c.column, value });
    await ctx.sql(`UPDATE report_overrides SET updated_at = ?1 WHERE week = ?2 AND template = 'weekly' AND sheet = ?3 AND row_key = ?4 AND "column" = ?5`,
      c.at, c.week, c.sheet, c.row_key, c.column);
    const id = [c.week, "weekly", c.sheet, c.row_key, c.column].join("\u001f");
    if (c.tri) tr.add("report_override", id, "value", c.tri, "ja", c.at, undefined);
    else tr.identity("report_override", id, "value", value, c.at);
  }
  return cells.length;
}

/** The xlsx (and some PDF) downloads of every finished report week, on its Friday evening. The current week has none,
 *  which is what the 此刻 page's 週報未下载 hint looks for. Written by SQL: only the download route writes this table. */
export async function seedDownloads(ctx: SeedCtx): Promise<number> {
  const R = rng("downloads");
  let n = 0;
  for (const week of REPORT_WEEKS) {
    if (week >= reportWeekOf(jstMs(TODAY, 12 * 60))) continue;
    const friday = reportWeekRange(week)!.days[6];
    await ctx.sql("INSERT INTO report_downloads (week, template, at) VALUES (?1, 'weekly', ?2)", week, iso(jstMs(friday, 18 * 60 + R.int(10, 40), R.int(0, 59))));
    n++;
    if (["2026-W38", "2026-W40", "2026-W41"].includes(week)) {
      await ctx.sql("INSERT INTO report_downloads (week, template, at) VALUES (?1, 'pdf', ?2)", week, iso(jstMs(friday, 18 * 60 + R.int(41, 55), R.int(0, 59))));
      n++;
    }
  }
  return n;
}
