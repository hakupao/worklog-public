// 计划: the four horizons and a 今日安排 for most working days, each judged against that day's sessions.
// The rows are written with SQL because the API stamps created_at / started_at with "now" and draws random ids, and the
// 週報 digests read plan goals by created_at (report/digest-context.ts). The verdicts go through the real judgement
// route (fingerprint from judge-input), then only their times are moved back to the evening they ran.
import { ISO_WEEKS, TODAY, WORKDAYS, addDays, iso, isoWeekOf, jstMs, stamp } from "./calendar";
import type { Translations } from "./i18n";
import { DETAILS, dayItem, fill, judgeNote } from "./phrases";
import type { Progress } from "./progress";
import { rng } from "./rng";
import type { Lang, Said, SeedCtx, Tri } from "./types";
import { MACHINES, TASKS, taskById, type TaskDef } from "./world";

type Horizon = "daily" | "week" | "near" | "far";
interface PlanDef {
  id: string; horizon: Horizon; said: Said; tasks: string[]; createdMs: number;
  status: "active" | "done" | "dropped"; closedMs: number | null; week: string | null; until: string | null; sort: number;
}

let R = rng("plans");
const LANGS: [Lang, number][] = [["ja", 0.5], ["zh", 0.4], ["en", 0.1]];
const t = (ja: string, zh: string, en: string): Tri => ({ ja, zh, en });
const hm = (h: number, m: number) => h * 60 + m;

/** The fixed items: routines (daily), what is coming (near) and the long view (far). */
const fixed = (horizon: Horizon, tri: Tri, tasks: string[], created: [string, number], status: PlanDef["status"] = "active",
  closed: [string, number] | null = null, until: string | null = null) => ({ horizon, tri, tasks, created, status, closed, until });
const FIXED_ITEMS = [
  fixed("daily", t("朝：未関連のセッションを片付けてから今日の安排を作る", "早上：先处理未关联的会话，再排今日安排", "Morning: clear unlinked sessions before planning the day"),
    [], ["2026-08-24", hm(9, 2)], "dropped", ["2026-09-04", hm(18, 5)]),
  fixed("daily", t("ORION-A：毎日 1 画面ずつ移植する", "ORION-A：每天移植一个画面", "ORION-A: port one screen a day"),
    ["T20260824-01"], ["2026-08-25", hm(9, 10)], "done", ["2026-09-30", hm(18, 20)]),
  fixed("daily", t("HARBOR：結合テストの失敗ケースを毎日 3 件消化する", "HARBOR：每天处理 3 个集成测试失败用例", "HARBOR: clear three failing integration cases a day"),
    ["T20260826-01"], ["2026-09-01", hm(9, 5)], "active", null, "2026-09-18"),
  fixed("daily", t("ORION-B：移行スクリプトを毎日テーブル 2 本ずつ", "ORION-B：迁移脚本每天推进 2 张表", "ORION-B: two tables of migration scripts a day"),
    ["T20260924-01"], ["2026-09-28", hm(9, 0)]),
  fixed("daily", t("LEDGER：監査ログのレビュー指摘を毎日確認する", "LEDGER：每天确认审计日志的评审意见", "LEDGER: check the audit log review comments daily"),
    ["T20261006-01"], ["2026-10-07", hm(9, 15)], "active", null, "2026-10-23"),
  fixed("near", t("ORION-B：本番移行リハーサルの手順書を作る", "ORION-B：编写正式迁移演练的步骤书", "ORION-B: write the production rehearsal runbook"),
    ["T20260924-01"], ["2026-09-28", hm(10, 0)]),
  fixed("near", t("DocMerge：v1.0 を鈴木さんの部署に公開する", "DocMerge：向铃木先生的部门发布 v1.0", "DocMerge: release v1.0 to Suzuki-san's department"),
    ["T20260903-01"], ["2026-09-15", hm(9, 30)]),
  fixed("near", t("ATLAS：設計書を開発チームに引き継ぐ", "ATLAS：把设计书移交给开发团队", "ATLAS: hand the design over to the dev team"),
    ["T20260914-01"], ["2026-09-24", hm(9, 40)], "done", ["2026-10-09", hm(17, 10)]),
  fixed("near", t("analytics：データ鮮度アラートの仕様を決める", "analytics：确定数据新鲜度告警的规格", "analytics: decide how the data freshness alert works"),
    ["T20260929-01"], ["2026-10-05", hm(9, 20)]),
  fixed("near", t("HARBOR：v1 利用先への移行案内を準備する", "HARBOR：准备给 v1 使用方的迁移通知", "HARBOR: prepare the migration notice for v1 users"),
    ["T20261001-01"], ["2026-10-06", hm(10, 10)]),
  fixed("far", t("Go 製 CLI を社内に配布する", "在公司内部分发 Go 编写的 CLI", "Roll the Go CLI out across the company"),
    ["T20261008-01"], ["2026-10-08", hm(9, 30)]),
  fixed("far", t("data-wiki：定義書を自動生成にする", "data-wiki：让定义书自动生成", "data-wiki: generate the dictionary automatically"),
    ["T20260907-01"], ["2026-09-10", hm(9, 45)]),
  fixed("far", t("LEDGER：年次照合にも同じ改善を広げる", "LEDGER：把同样的优化推广到年度对账", "LEDGER: bring the same speed-up to the yearly reconciliation"),
    [], ["2026-09-26", hm(9, 10)]),
  fixed("far", t("LLM レビュー補助を試験導入する", "试行导入 LLM 评审辅助", "Pilot the LLM review assistant"),
    ["T20260909-01"], ["2026-09-09", hm(16, 0)], "done", ["2026-10-02", hm(17, 40)]),
];

const lastWorkdayOf = (week: string) => WORKDAYS.filter((d) => isoWeekOf(d) === week).pop()!;
const doneBy = (task: TaskDef, date: string) => task.end?.status === "done" && task.end.date < date;

function buildPlanItems(prog: Progress): PlanDef[] {
  const out: PlanDef[] = [];
  const sorts: Record<Horizon, number> = { daily: 0, week: 0, near: 0, far: 0 };
  const push = (p: Omit<PlanDef, "id" | "sort">) =>
    out.push({ ...p, id: `P${stamp(p.createdMs)}-${R.hex(8)}`, sort: sorts[p.horizon]++ });
  for (const f of FIXED_ITEMS) {
    push({
      horizon: f.horizon, said: { tri: f.tri, src: R.weighted(LANGS) }, tasks: f.tasks, createdMs: jstMs(f.created[0], f.created[1], R.int(0, 59)),
      status: f.status, closedMs: f.closed ? jstMs(f.closed[0], f.closed[1], R.int(0, 59)) : null, week: null, until: f.until,
    });
  }
  // 本周: the week's two or three biggest 案件, set on its first working morning; closed on its last evening
  // (done when the week put ≥ 4 h into it). Last week's smallest stays open: the 上周遗留 example.
  const ordinal = new Map<string, number>();
  for (const week of ISO_WEEKS) {
    const days = WORKDAYS.filter((d) => isoWeekOf(d) === week);
    if (days.length === 0) continue;
    const ranked = TASKS.map((x) => ({ x, m: days.reduce((s, d) => s + prog.minutesOn(x.id, d), 0) }))
      .filter((r) => r.m > 0).sort((a, b) => b.m - a.m);
    const top = ranked.slice(0, ranked[2] && ranked[2].m >= 180 ? 3 : 2);
    const current = week === isoWeekOf(TODAY), last = week === isoWeekOf(addDays(TODAY, -7));
    const smallest = top[top.length - 1];
    for (const { x, m } of top) {
      const k = ordinal.get(x.id) ?? 0;
      ordinal.set(x.id, k + 1);
      const day = x.received > days[0] ? x.received : days[0];
      const keep = current || (last && x === smallest.x);
      push({
        horizon: "week", said: { tri: x.weekGoals[k % x.weekGoals.length], src: R.weighted(LANGS) }, tasks: [x.id],
        createdMs: jstMs(day, hm(9, R.int(0, 20)), R.int(0, 59)), week, until: null,
        status: keep ? "active" : m >= 240 ? "done" : "dropped",
        closedMs: keep ? null : jstMs(lastWorkdayOf(week), hm(18, R.int(0, 40)), R.int(0, 59)),
      });
    }
  }
  return out;
}

/** Active on `date`: created by that morning and not closed before it. */
const activeOn = (p: PlanDef, date: string) => p.createdMs <= jstMs(date, hm(9, 30)) && (p.closedMs === null || p.closedMs >= jstMs(date, 0));
const effectiveDaily = (p: PlanDef, date: string) =>
  p.horizon === "daily" && activeOn(p, date) && (p.until === null || p.until >= date)
  && (p.tasks.length === 0 || p.tasks.some((id) => !doneBy(taskById.get(id)!, date)));

interface DayItem { id: string; planId: string | null; tasks: string[]; said: Said; detail: Said | null; carried: boolean }

/** Days without a 今日安排 (the user did not make one). */
const NO_PLAN = new Set(["2026-08-28", "2026-09-10", "2026-09-29", "2026-10-06"]);

export async function seedPlans(ctx: SeedCtx, prog: Progress, tr: Translations): Promise<void> {
  R = rng("plans");
  const items = buildPlanItems(prog);
  for (const p of items) {
    const at = iso(p.closedMs ?? p.createdMs);
    await ctx.sql(
      `INSERT INTO plan_items (id, horizon, text, task_id, status, week, until_date, sort, created_at, done_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      p.id, p.horizon, p.said.tri[p.said.src], p.status, p.week, p.until, p.sort, iso(p.createdMs), p.closedMs === null ? null : iso(p.closedMs), at,
    );
    for (const id of p.tasks) await ctx.sql("INSERT INTO plan_item_tasks (plan_item_id, task_id) VALUES (?1, ?2)", p.id, id);
    tr.add("plan_item", p.id, "text", p.said.tri, p.said.src, iso(p.createdMs));
  }

  let prev: { items: DayItem[]; final: Map<string, "done" | "partial" | "none"> } | null = null;
  for (const date of WORKDAYS) {
    if (NO_PLAN.has(date)) continue;
    const startMs = jstMs(date, hm(9, R.int(0, 12)), R.int(0, 59));
    const scheduled = TASKS.map((x) => ({ x, m: prog.minutesOn(x.id, date) })).filter((r) => r.m >= 30).sort((a, b) => b.m - a.m).map((r) => r.x);
    const list: DayItem[] = [];
    const add = (it: Omit<DayItem, "id">) => list.push({ ...it, id: `D${stamp(startMs + list.length * 1000)}-${R.hex(8)}` });
    // 1. daily items in effect, 2. yesterday's unfinished ones (start's own rules), 3. what today's work needs.
    for (const p of items) if (effectiveDaily(p, date)) add({ planId: p.id, tasks: p.tasks, said: p.said, detail: null, carried: false });
    for (const it of prev?.items ?? []) {
      if (prev!.final.get(it.id) === "done") continue;
      if (it.planId) {
        const src = items.find((p) => p.id === it.planId)!;
        if (!activeOn(src, date) || (src.horizon === "daily" && !effectiveDaily(src, date))) continue;
        const same = list.find((d) => d.planId === it.planId);
        if (same) { same.detail ??= it.detail; continue; }
      } else if (list.some((d) => d.planId === null && d.said.tri[d.said.src] === it.said.tri[it.said.src])) continue;
      const idle = !it.tasks.some((id) => scheduled.some((x) => x.id === id));
      if (idle && R.chance(0.7)) continue;   // re-planned: dropped from today's list by hand
      add({ planId: it.planId, tasks: it.tasks, said: it.said, detail: it.detail, carried: true });
    }
    for (const x of scheduled) {
      if (list.length >= 6) break;
      if (list.some((d) => d.tasks.includes(x.id))) continue;
      const wk = items.find((p) => p.horizon === "week" && p.week === isoWeekOf(date) && p.tasks.includes(x.id) && activeOn(p, date));
      if (wk) add({ planId: wk.id, tasks: wk.tasks, said: wk.said, detail: null, carried: false });
      else add({ planId: null, tasks: [x.id], said: { tri: dayItem(x.short, prog.objectOn(x, date)), src: R.weighted(LANGS) }, detail: null, carried: false });
    }
    // Today also carries a near-term goal nobody has touched yet: the 今日安排未动 hint has something to point at.
    if (date === TODAY) {
      const near = items.find((p) => p.horizon === "near" && p.tasks.includes("T20260929-01") && p.status === "active");
      if (near && !list.some((d) => d.planId === near.id)) add({ planId: near.id, tasks: near.tasks, said: near.said, detail: null, carried: false });
    }
    for (const it of list) {
      if (it.detail || it.tasks.length === 0 || !R.chance(0.35)) continue;
      it.detail = { tri: fill(R.pick(DETAILS), prog.objectOn(taskById.get(it.tasks[0])!, date)), src: R.weighted(LANGS) };
    }

    await ctx.sql("INSERT INTO day_plans (date, started_at, updated_at) VALUES (?1, ?2, ?2)", date, iso(startMs));
    for (const [i, it] of list.entries()) {
      await ctx.sql(
        `INSERT INTO day_plan_items (id, date, plan_item_id, text, detail, sort, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        it.id, date, it.planId, it.said.tri[it.said.src], it.detail ? it.detail.tri[it.detail.src] : "", i, iso(startMs),
      );
      for (const id of it.tasks) await ctx.sql("INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) VALUES (?1, ?2)", it.id, id);
      tr.add("day_plan_item", it.id, "text", it.said.tri, it.said.src, iso(startMs));
      if (it.detail) tr.add("day_plan_item", it.id, "detail", it.detail.tri, it.detail.src, iso(startMs));
    }

    prev = { items: list, final: await judge(ctx, prog, tr, date, list) };
  }
}

/** The hourly AI 对账 as the collector would send it: per item the minutes its 案件 got that day decide the verdict. */
async function judge(ctx: SeedCtx, prog: Progress, tr: Translations, date: string, list: DayItem[]) {
  const input = await ctx.api("GET", `/api/day-plans/${date}/judge-input`);
  const judgedMs = date === TODAY ? jstMs(date, hm(15, 4), 51) : jstMs(date, hm(18, R.int(4, 20)), R.int(0, 59));
  const final = new Map<string, "done" | "partial" | "none">();
  const verdicts = (input.items as { id: string; task_ids: string[] }[]).map((it) => {
    const mine = list.find((x) => x.id === it.id)!;
    const related = (input.sessions as { id: string; task_id: string | null; minutes: number }[])
      .filter((s) => s.task_id !== null && it.task_ids.includes(s.task_id)).sort((a, b) => b.minutes - a.minutes);
    const minutes = related.reduce((s, x) => s + x.minutes, 0);
    const status: "done" | "partial" | "none" = it.task_ids.length === 0 || minutes === 0 ? "none"
      : date === TODAY ? (minutes >= 100 ? "done" : "partial")
      : minutes >= (mine.detail ? 120 : 90) && R.chance(0.75) ? "done" : "partial";
    const main = it.task_ids.map((id) => taskById.get(id)!).sort((a, b) => prog.minutesOn(b.id, date) - prog.minutesOn(a.id, date))[0];
    const progress = status === "none" || !main ? null : prog.milestoneAt(main, date);
    const note = judgeNote(status, related.length, minutes, it.task_ids.length > 0);
    if (progress) tr.add("day_plan_item", it.id, "ai_progress", progress, "ja", iso(judgedMs));
    tr.add("day_plan_item", it.id, "ai_note", note, "ja", iso(judgedMs));
    final.set(it.id, status);
    return { id: it.id, status, progress: progress?.ja ?? "", evidence: related.slice(0, 3).map((s) => s.id), note: note.ja };
  });
  await ctx.api("POST", `/api/day-plans/${date}/judgement`, {
    fingerprint: input.fingerprint, model: "claude-sonnet-5-5", machine: MACHINES.mac, items: verdicts,
  });
  await ctx.sql("UPDATE day_plans SET judged_at = ?1, updated_at = ?1 WHERE date = ?2", iso(judgedMs), date);
  // A few verdicts the user corrected by hand that evening (never today's: those still await 确认).
  if (date !== TODAY) {
    for (const v of verdicts) {
      if (v.status !== "partial" || !R.chance(0.12)) continue;
      await ctx.sql("UPDATE day_plan_items SET manual_status = 'done', updated_at = ?1 WHERE id = ?2", iso(judgedMs + 25 * 60_000), v.id);
      final.set(v.id, "done");
    }
  }
  return final;
}
