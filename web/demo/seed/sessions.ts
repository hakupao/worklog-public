// Several hundred harvested sessions over the demo weeks, built in memory (no I/O): two machines, Claude Code and Codex,
// weekday hours with lunch, the odd evening, four sessions over midnight, and two still running at DEMO_NOW.
import { classifyPath } from "../../../server/src/deliverables/rules";
import { ALL_DAYS, TODAY, iso, isWorkday, jstDate, jstMs, naive } from "./calendar";
import { ACTIONS, ASK_CODEX, fill, join2 } from "./phrases";
import { rng } from "./rng";
import type { Agent, Lang, MachineKey, ModelTokens, Said, SessionBody, SessionTokens, Tri } from "./types";
import {
  ARTIFACTS, CHAT_SUMMARIES, FALLBACK_SUMMARIES, MACHINES, MISC_SUMMARIES, SPECIAL_SUMMARIES, TASKS, cwdOf, pathOf, taskById,
  type DocDef, type TaskDef,
} from "./world";

export interface SessionRec {
  body: SessionBody;
  machine: MachineKey;
  task: TaskDef | null;
  /** The summary as written, with its translations; null for a fallback (untranslated first prompt). */
  said: Said | null;
  object: Tri | null;
  startMs: number;
  endMs: number;
  /** JST date of the start. */
  date: string;
  minutes: number;
  /** Active minutes per JST calendar day. */
  byDate: Map<string, number>;
  docs: { path: string; doc: DocDef }[];
  hide?: boolean;
  edit?: Said;
  override?: number;
}

// $ per MTok, from config.example.toml (only the models the demo uses).
const PRICE: Record<string, Partial<Record<keyof ModelTokens, number>>> = {
  "claude-opus-5-5": { input: 4, output: 20, cache_read: 0.2, cache_write_5m: 5, cache_write_1h: 8 },
  "claude-opus-5-5:fast": { input: 8, output: 40 },
  "claude-sonnet-5-5": { input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4 },
  "claude-haiku-4-5": { input: 1, output: 5, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 },
  "gpt-6-sol": { input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5 },
  "gpt-6.1-sol": { input: 2, output: 10, cache_read: 0.1, cache_write_5m: 2.5 },
  "gpt-6-astra": { input: 10, output: 50, cache_read: 1, cache_write_5m: 12.5 },
};
const KINDS: (keyof ModelTokens)[] = ["input", "output", "cache_read", "cache_write_5m", "cache_write_1h", "reasoning"];
const zero = (): ModelTokens => ({ input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, reasoning: 0 });
const add = (into: Record<string, ModelTokens>, model: string, x: ModelTokens) => {
  const cur = into[model] ?? (into[model] = zero());
  for (const k of KINDS) cur[k] += x[k];
};

/** cost_usd the collector's way: priced kinds only; a model, or a used kind, without a price makes it partial. */
export function priced(by_model: Record<string, ModelTokens>, subagent: Record<string, ModelTokens>): SessionTokens {
  let cost = 0, partial = false, any = false;
  for (const [model, x] of Object.entries(by_model)) {
    const p = PRICE[model];
    if (!p) { partial = true; continue; }
    any = true;
    for (const k of KINDS) {
      if (k === "reasoning" || x[k] === 0) continue;   // reasoning is billed inside output
      if (p[k] === undefined) { partial = true; continue; }
      cost += (x[k] / 1e6) * p[k]!;
    }
  }
  return { by_model, subagent, cost_usd: any ? Math.round(cost * 1e4) / 1e4 : null, cost_partial: partial };
}

let R = rng("sessions");
const between = (a: number, b: number) => a + R.next() * (b - a);
const n = (x: number) => Math.max(0, Math.round(x));

function tokensFor(agent: Agent, minutes: number, date: string, mult = 1): SessionTokens {
  const m = Math.max(1, minutes) * mult;
  const by: Record<string, ModelTokens> = {}, sub: Record<string, ModelTokens> = {};
  if (agent === "codex") {
    const model = R.chance(0.1) ? "gpt-6-astra" : date < "2026-10-01" ? "gpt-6-sol" : "gpt-6.1-sol";
    const output = n(m * between(400, 1100));
    add(by, model, { ...zero(), input: n(m * between(2000, 6000)), cache_read: n(m * between(40_000, 110_000)), output, reasoning: n(output * between(0.3, 0.6)) });
    return priced(by, sub);
  }
  const main = R.chance(date < "2026-09-15" ? 0.3 : 0.1) ? "claude-sonnet-5-5" : "claude-opus-5-5";
  add(by, main, {
    ...zero(), input: n(m * between(120, 500)), output: n(m * between(500, 1500)), cache_read: n(m * between(110_000, 260_000)),
    cache_write_5m: n(m * between(2500, 8000)), cache_write_1h: n(m * between(800, 4000)),
  });
  if (R.chance(0.35)) {
    const model = R.chance(0.6) ? "claude-haiku-4-5" : "claude-sonnet-5-5";
    const x = { ...zero(), input: n(m * between(50, 200)), output: n(m * between(200, 700)), cache_read: n(m * between(20_000, 90_000)), cache_write_5m: n(m * between(1000, 4000)) };
    add(by, model, x); add(sub, model, x);
  }
  return priced(by, sub);
}

/** Intervals in minutes after the day's midnight → ISO pairs, active minutes and the per-day split. */
function shape(date: string, clusters: [number, number][]) {
  const pairs = clusters.map(([a, b]) => [jstMs(date, a, R.int(0, 59)), jstMs(date, b, R.int(0, 59))] as [number, number])
    .map(([a, b]) => [a, Math.max(a + 60_000, b)] as [number, number]);
  const ms = pairs.reduce((s, [a, b]) => s + (b - a), 0);
  const byDate = new Map<string, number>();
  for (const [a, b] of pairs) {
    for (let at = a; at < b;) {
      const day = jstDate(iso(at)), next = Math.min(b, Date.parse(`${day}T00:00:00+09:00`) + 86_400_000);
      byDate.set(day, (byDate.get(day) ?? 0) + (next - at) / 60_000);
      at = next;
    }
  }
  for (const [d, v] of byDate) byDate.set(d, Math.round(v));
  return { pairs, minutes: Math.round(ms / 60_000), byDate };
}

const used = new Set<string>();
/** The collector's id rule (harvest: "S" + session_id[:8]); a repeat draws again. */
function newIds() {
  for (;;) {
    const session_id = R.uuid(), id = `S${session_id.slice(0, 8)}`;
    if (!used.has(id)) { used.add(id); return { id, session_id }; }
  }
}

const LANGS: [Lang, number][] = [["ja", 0.62], ["zh", 0.27], ["en", 0.11]];
let miscAt = 0, chatAt = 0;

type Kind = "task" | "misc" | "chat";
interface Draft { date: string; machine: MachineKey; kind: Kind; task?: TaskDef; clusters: [number, number][]; agent?: Agent; said?: Said; object?: Tri }

function build(d: Draft): SessionRec {
  const { pairs, minutes, byDate } = shape(d.date, d.clusters);
  const agent: Agent = d.agent ?? (R.chance(d.machine === "mac" ? 0.18 : 0.45) ? "codex" : "claude-code");
  const { id, session_id } = newIds();
  const home = d.machine === "mac" ? "/Users/dev" : "C:\\Users\\dev";
  let cwd = home, task: TaskDef | null = null, link: SessionBody["link_method"] = "none", said: Said | null = null, object: Tri | null = null;
  const files: string[] = [];
  if (d.kind === "task" && d.task) {
    task = d.task;
    const r = R.next();
    if (r < 0.88) { cwd = cwdOf(d.machine, task.dir); link = "auto-dir"; }
    else if (r < 0.94) { link = "manual"; }
    else { cwd = d.machine === "mac" ? "/Users/dev/Projects/tools" : "C:\\Dev\\Acme\\tools"; link = "auto-time"; }
    object = d.object ?? R.pick(task.objects);
    if (d.said) said = d.said;
    else {
      const pool = task.actions.filter((i) => agent !== "codex" || i !== ASK_CODEX).map((i) => ACTIONS[i]);
      let tri = fill(R.pick(pool), object, R.int(2, 9));
      if (minutes > 70 && R.chance(0.5)) tri = join2(tri, fill(R.pick(pool), R.pick(task.objects), R.int(2, 6)));
      said = { tri, src: R.weighted(LANGS) };
    }
    for (let k = R.int(0, 3); k > 0; k--) {
      const p = pathOf(d.machine, task.dir, R.pick(task.code));
      if (!files.includes(p)) files.push(p);
    }
  } else if (d.kind === "misc") {
    said = d.said ?? MISC_SUMMARIES[miscAt++ % MISC_SUMMARIES.length];
    cwd = R.chance(0.6) ? `${home}${d.machine === "mac" ? "/scratch" : "\\scratch"}` : home;
    if (R.chance(0.5)) files.push(`${cwd}${d.machine === "mac" ? "/" : "\\"}${R.pick(["sample.go", "convert.py", "notes.txt", "query.sql"])}`);
  } else {
    said = CHAT_SUMMARIES[chatAt++ % CHAT_SUMMARIES.length];
  }
  const startMs = pairs[0][0], endMs = pairs[pairs.length - 1][1];
  const turns = d.kind === "chat" ? R.int(2, 6) : agent === "codex" ? Math.round(minutes * between(0.2, 0.5)) + 1 : Math.max(2, Math.round(minutes * between(0.35, 0.9)));
  return {
    machine: d.machine, task, said, object, startMs, endMs, date: d.date, minutes, byDate, docs: [], hide: d.kind === "chat",
    body: {
      id, machine: MACHINES[d.machine], agent, session_id, cwd, started_at: iso(startMs), ended_at: iso(endMs), active_minutes: minutes, turns,
      summary: said ? said.tri[said.src] : "", summary_source: "llm", task_id: task?.id ?? null, link_method: link,
      files_written: files, tokens: tokensFor(agent, minutes, d.date), active_intervals: pairs.map(([a, b]) => [iso(a), iso(b)]),
      artifacts: [], ts: naive(startMs),
    },
  };
}

const activeOn = (date: string, m: MachineKey) =>
  TASKS.filter((x) => x.received <= date && (!x.end || date <= x.end.date) && (x.machine === m || x.machine === "both"));

function weightOf(x: TaskDef, date: string) {
  let w = x.weight * (x.machine === "both" ? 0.6 : 1);
  if (date <= addDaysStr(x.received, 2)) w *= 1.5;
  if (x.end && x.end.status === "done" && date >= addDaysStr(x.end.date, -2)) w *= 1.3;
  return w;
}
const addDaysStr = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

/** One machine's working day: sessions back to back from the morning, lunch kept free, and a session may come back
 *  after a gap of more than 30 minutes (a second activity cluster) while the next one has started. */
function track(date: string, m: MachineKey): Draft[] {
  const active = activeOn(date, m);
  if (active.length === 0) return [];
  const out: Draft[] = [];
  // macmini is the main desk; win11 holds the client-side work and runs a few longer sessions beside it.
  let cursor = m === "mac" ? 9 * 60 + R.int(5, 35) : 9 * 60 + R.int(40, 90);
  const until = m === "mac" ? 18 * 60 + 40 : 17 * 60 + 45;
  while (cursor < until) {
    const task = R.weighted(active.map((x) => [x, weightOf(x, date)] as const));
    const c1 = R.int(12, 95);
    const clusters: [number, number][] = [[cursor, cursor + c1]];
    if (c1 > 25 && R.chance(0.3)) {
      let at = cursor + c1 + R.int(35, 80);
      clusters.push([at, at + R.int(10, 50)]);
      if (R.chance(0.25)) { at = clusters[1][1] + R.int(35, 70); clusters.push([at, at + R.int(10, 35)]); }
    }
    out.push({ date, machine: m, kind: "task", task, clusters });
    cursor += c1 + (m === "mac" ? R.int(10, 40) : R.int(35, 90));
    if (cursor >= 11 * 60 + 50 && cursor < 13 * 60) cursor = 13 * 60 + R.int(0, 15);
  }
  if (m === "mac" && R.chance(0.12)) {
    const at = 20 * 60 + 30 + R.int(0, 60);
    out.push({ date, machine: m, kind: "task", task: R.weighted(active.map((x) => [x, weightOf(x, date)] as const)), clusters: [[at, at + R.int(25, 80)]] });
  }
  return out;
}

// Fixed days for the sessions that make a point: hidden chats at lunch, unlinked odds and ends, work over midnight.
const CHAT_DAYS = ["2026-08-27", "2026-09-09", "2026-09-24", "2026-10-06", "2026-10-14"];
const MISC_DAYS: [string, MachineKey][] = [["2026-08-31", "mac"], ["2026-09-04", "mac"], ["2026-09-15", "win"], ["2026-09-30", "mac"],
  ["2026-10-08", "win"], ["2026-10-09", "mac"], ["2026-10-13", "mac"], ["2026-10-14", "win"]];
const MIDNIGHT: [string, MachineKey][] = [["2026-09-10", "mac"], ["2026-09-16", "win"], ["2026-09-28", "mac"], ["2026-10-07", "mac"]];

/** Weekend and holiday work, and DEMO_NOW's own day (whose last sessions are still running). */
function fixedDrafts(): Draft[] {
  const T = (id: string) => taskById.get(id)!;
  const hm = (h: number, m: number) => h * 60 + m;
  return [
    { date: "2026-08-22", machine: "mac", kind: "task", task: T("T20260822-01"), clusters: [[hm(13, 10), hm(14, 5)], [hm(14, 45), hm(15, 20)]] },
    { date: "2026-08-22", machine: "win", kind: "task", task: T("T20260822-01"), clusters: [[hm(15, 35), hm(16, 20)]] },
    { date: "2026-09-05", machine: "mac", kind: "task", task: T("T20260903-01"), clusters: [[hm(10, 20), hm(11, 30)]] },
    { date: "2026-09-22", machine: "mac", kind: "task", task: T("T20260914-01"), clusters: [[hm(21, 0), hm(21, 40)]] },
    { date: "2026-09-27", machine: "mac", kind: "task", task: T("T20260824-01"), clusters: [[hm(10, 0), hm(11, 25)], [hm(12, 0), hm(12, 30)]] },
    { date: "2026-10-04", machine: "mac", kind: "task", task: T("T20260924-01"), clusters: [[hm(14, 0), hm(15, 10)]] },
    // DEMO_NOW's day, by hand: the two last ones are still running at the last collection of each machine.
    { date: TODAY, machine: "mac", kind: "task", task: T("T20260924-01"), agent: "claude-code", clusters: [[hm(9, 12), hm(10, 24)]] },
    { date: TODAY, machine: "mac", kind: "task", task: T("T20260903-01"), agent: "claude-code", clusters: [[hm(10, 32), hm(11, 18)]] },
    { date: TODAY, machine: "mac", kind: "misc", agent: "claude-code", clusters: [[hm(11, 22), hm(11, 47)]],
      said: { src: "ja", tri: { ja: "社内ポータルの申請フォームの使い方を調べた", zh: "查了公司门户申请表的用法", en: "Looked up how to use the intranet request form" } } },
    { date: TODAY, machine: "mac", kind: "task", task: T("T20261013-01"), agent: "claude-code", clusters: [[hm(13, 4), hm(13, 56)]] },
    { date: TODAY, machine: "win", kind: "task", task: T("T20261001-01"), agent: "codex", clusters: [[hm(9, 41), hm(10, 52)]] },
    { date: TODAY, machine: "win", kind: "task", task: T("T20261006-01"), agent: "claude-code", clusters: [[hm(11, 2), hm(11, 44)]] },
    { date: TODAY, machine: "win", kind: "task", task: T("T20261001-01"), agent: "claude-code", clusters: [[hm(13, 12), hm(14, 9)]] },
  ];
}

/** Running at DEMO_NOW: last activity 15:18:40 on macmini (collected 15:19), 14:57:40 on win11 (collected 15:00). */
function runningRecs(): SessionRec[] {
  const mk = (machine: MachineKey, taskId: string, agent: Agent, a: [number, number], b: [number, number], said: Said) => {
    const rec = build({ date: TODAY, machine, kind: "task", task: taskById.get(taskId)!, agent, clusters: [[0, 1]], said });
    const s = jstMs(TODAY, a[0], a[1]), e = jstMs(TODAY, b[0], b[1]), minutes = Math.round((e - s) / 60_000);
    rec.startMs = s; rec.endMs = e; rec.minutes = minutes; rec.byDate = new Map([[TODAY, minutes]]);
    Object.assign(rec.body, {
      started_at: iso(s), ended_at: iso(e), active_minutes: minutes, active_intervals: [[iso(s), iso(e)]], ts: naive(s),
      turns: Math.round(minutes * 0.6), tokens: tokensFor(agent, minutes, TODAY), cwd: cwdOf(machine, taskById.get(taskId)!.dir), link_method: "auto-dir",
    });
    return rec;
  };
  return [
    mk("mac", "T20260924-01", "claude-code", [14 * 60 + 5, 10], [15 * 60 + 18, 40], { src: "ja", tri: {
      ja: "顧客マスタの移行スクリプトを本番相当のデータで流し、件数と金額の突き合わせを実行中",
      zh: "正在用相当于生产的数据执行客户主数据迁移脚本，并核对条数和金额",
      en: "Running the customer master migration on production-sized data and reconciling counts and totals" } }),
    mk("win", "T20261006-01", "codex", [14 * 60 + 22, 5], [14 * 60 + 57, 40], { src: "zh", tri: {
      ja: "監査ログの保存期間 7 年の削除処理を実装中",
      zh: "正在实现审计日志保存 7 年后的清理处理",
      en: "Implementing the 7-year retention cleanup for the audit log" } }),
  ];
}

export function buildSessions(): SessionRec[] {
  R = rng("sessions"); used.clear(); miscAt = 0; chatAt = 0;
  const drafts: Draft[] = [];
  for (const date of ALL_DAYS) {
    if (date === TODAY || !isWorkday(date)) continue;
    drafts.push(...track(date, "mac"), ...track(date, "win"));
    if (CHAT_DAYS.includes(date)) { const at = 12 * 60 + 5 + R.int(0, 20); drafts.push({ date, machine: "mac", kind: "chat", clusters: [[at, at + R.int(3, 12)]] }); }
    for (const [d, m] of MISC_DAYS) if (d === date) { const at = R.int(10 * 60, 17 * 60); drafts.push({ date, machine: m, kind: "misc", clusters: [[at, at + R.int(10, 45)]] }); }
    for (const [d, m] of MIDNIGHT) if (d === date) {
      const task = R.weighted(activeOn(date, m).map((x) => [x, weightOf(x, date)] as const));
      const a = 23 * 60 + R.int(0, 20), b = a + R.int(30, 50), c = b + R.int(35, 45);
      drafts.push({ date, machine: m, kind: "task", task, clusters: [[a, b], [c, c + R.int(40, 70)]] });
    }
  }
  drafts.push(...fixedDrafts());
  const recs = drafts.map(build).concat(runningRecs()).sort((a, b) => a.startMs - b.startMs || (a.body.id < b.body.id ? -1 : 1));
  applySpecials(recs);
  placeDocs(recs);
  placeArtifacts(recs);
  return recs;
}

const firstOf = (recs: SessionRec[], task: string, date: string) => recs.find((r) => r.task?.id === task && r.date === date && !r.hide);
const lastOf = (recs: SessionRec[], task: string, date: string) => recs.filter((r) => r.task?.id === task && r.date === date && !r.hide).pop();
const longestOf = (recs: SessionRec[], task: string, from: string, to: string) =>
  recs.filter((r) => r.task?.id === task && r.date >= from && r.date <= to).sort((a, b) => b.minutes - a.minutes)[0];

function setSaid(r: SessionRec, s: Said) { r.said = s; r.body.summary = s.tri[s.src]; }

function applySpecials(recs: SessionRec[]) {
  for (const s of SPECIAL_SUMMARIES) { const r = s.last ? lastOf(recs, s.task, s.date) : firstOf(recs, s.task, s.date); if (r) setSaid(r, s.s); }
  // Fallback summaries: the collector could not summarize, so the first prompt stands in (not translated).
  ([["T20260824-01", "2026-09-02"], ["T20260901-01", "2026-09-08"], ["T20260924-01", "2026-10-01"]] as const).forEach(([task, date], i) => {
    const r = firstOf(recs, task, date);
    if (r) { r.said = null; r.body.summary = FALLBACK_SUMMARIES[i]; r.body.summary_source = "fallback"; }
  });
  // One costly session (> $100) during the ORION-A crunch, one that spent > 80 % of > 10M tokens in subagents,
  // and two in Opus fast mode whose cache use has no fast price (cost_partial).
  const heavy = longestOf(recs, "T20260824-01", "2026-09-24", "2026-09-30");
  if (heavy) {
    const k = 112.4 / Math.max(heavy.body.tokens.cost_usd ?? 1, 1);
    const scale = (x: Record<string, ModelTokens>) =>
      Object.fromEntries(Object.entries(x).map(([m, v]) => [m, Object.fromEntries(KINDS.map((q) => [q, n(v[q] * k)])) as ModelTokens]));
    heavy.body.tokens = priced(scale(heavy.body.tokens.by_model), scale(heavy.body.tokens.subagent));
  }
  const swarm = longestOf(recs, "T20260901-01", "2026-09-07", "2026-09-11");
  if (swarm) {
    const by: Record<string, ModelTokens> = {}, sub: Record<string, ModelTokens> = {};
    add(by, "claude-opus-5-5", { ...zero(), input: 41_000, output: 96_000, cache_read: 1_850_000, cache_write_5m: 120_000, cache_write_1h: 60_000 });
    const s = { ...zero(), input: 380_000, output: 410_000, cache_read: 11_600_000, cache_write_5m: 690_000 };
    add(by, "claude-sonnet-5-5", s); add(sub, "claude-sonnet-5-5", s);
    swarm.body.tokens = priced(by, sub);
  }
  for (const [task, date] of [["T20260916-01", "2026-09-16"], ["T20260924-01", "2026-10-07"]] as const) {
    const r = firstOf(recs, task, date);
    if (!r || r.body.agent !== "claude-code") continue;
    const by: Record<string, ModelTokens> = {};
    add(by, "claude-opus-5-5:fast", { ...zero(), input: n(r.minutes * 300), output: n(r.minutes * 1200), cache_read: n(r.minutes * 150_000), cache_write_5m: n(r.minutes * 5000) });
    r.body.tokens = priced(by, {});
  }
  // Hand edits made later in the UI (applied through PATCH by the orchestrator).
  const edits: [string, string, Said][] = [
    ["T20260824-01", "2026-09-03", { src: "ja", tri: { ja: "受注一覧の検索条件を共通部品に置き換え、旧画面と検索結果が一致することを確認した",
      zh: "把订单列表的检索条件换成公共组件，并确认检索结果与旧画面一致", en: "Swapped the order list filters for the shared component and confirmed results match the old screen" } }],
    ["T20260826-01", "2026-09-11", { src: "zh", tri: { ja: "認証失敗 3 件は相手先のトークン有効期限の設定が原因と特定し、Alex Wang さんに連絡した",
      zh: "查明 3 起认证失败是对方令牌有效期设置导致的，并通知了 Alex Wang", en: "Traced the 3 authentication failures to the partner's token lifetime setting and told Alex Wang" } }],
    ["T20260914-01", "2026-10-05", { src: "en", tri: { ja: "Kevin Liu さんの指摘 9 件のうち 6 件を設計書に反映した",
      zh: "把 Kevin Liu 的 9 条意见中的 6 条反映到设计书里", en: "Worked 6 of Kevin Liu's 9 comments into the design document" } }],
  ];
  for (const [task, date, s] of edits) { const r = firstOf(recs, task, date); if (r) r.edit = s; }
  for (const [task, date] of [["T20260903-01", "2026-09-17"], ["T20261001-01", "2026-10-07"]] as const) {
    const r = longestOf(recs, task, date, date);
    if (r) r.override = Math.max(5, Math.round(r.minutes * 0.6));
  }
}

/** Documents into the sessions that wrote them. A gray document nobody has judged (no `model`) is written only this
 *  week, so it is still 待判定 at DEMO_NOW; every other document lands in a session that ran before. */
function placeDocs(recs: SessionRec[]) {
  for (const task of TASKS) {
    const own = recs.filter((r) => r.task === task && !r.hide);
    if (own.length === 0) continue;
    task.docs.forEach((doc, i) => {
      const pending = !doc.model && classifyPath(doc.rel).verdict === "gray";
      const pool = own.filter((r) => (pending ? r.date >= "2026-10-13" : r.date < "2026-10-13"));
      const list = pool.length ? pool : own;
      const writers = [list[Math.min(list.length - 1, Math.floor(((i + 1) * list.length) / (task.docs.length + 1)))]];
      if (list.length > 4 && R.chance(0.6)) writers.push(list[list.length - 1 - R.int(0, 1)]);
      for (const r of writers) {
        const path = pathOf(r.machine, task.dir, doc.rel);
        if (!r.body.files_written.includes(path)) { r.body.files_written.push(path); r.docs.push({ path, doc }); }
      }
    });
  }
}

function placeArtifacts(recs: SessionRec[]) {
  const A = rng("artifacts");
  for (const a of ARTIFACTS) {
    const r = longestOf(recs, a.task, a.date, addDaysStr(a.date, 7));
    if (!r) continue;
    const id = A.uuid();
    r.body.artifacts.push({ url: `https://artifacts.example.invalid/${id}`, title: a.title, artifact_id: id, ts: iso(r.endMs - 4 * 60_000) });
  }
}
