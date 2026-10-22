// server/test/i18n-sweep.test.ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { SOURCES } from "../src/i18n/registry";
import { POLISH_TRIES, SWEEP_LIMIT, findStale, runSweep } from "../src/i18n/sweep";
import { fakeAnthropic } from "./fake-anthropic";
import { resetDb } from "./helpers";

const E = env as any;
const db = () => E.DB as D1Database;
const T0 = new Date("2026-10-08T00:00:00Z");
const tr = (u: string) => ({ source: "ja", zh: `zh:${u}`, ja: u, en: `en:${u}` });
// a polish reply (task titles are polished): the translation plus the unchanged text as its polish
const trp = (u: string) => ({ ...tr(u), polished: u });
const textOf = (u: string) => u.split("<text>\n")[1].split("\n</text>")[0];
const addTask = (id: string, title: string) => db().prepare(
  `INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
   VALUES (?1, 'r', '', ?2, 'open', '2026-10-01', '', '[]', 'm', 'x', 'u0')`).bind(id, title).run();
const row = (id: string, field = "title") => db().prepare(
  "SELECT * FROM translations WHERE entity='task' AND entity_id=?1 AND field=?2").bind(id, field).first<any>();

describe("translation sweep", () => {
  beforeEach(resetDb);

  it("finds untranslated non-empty fields, translates them, and does not touch updated_at", async () => {
    await addTask("T1", "帳票修正");
    expect((await findStale(db(), T0.toISOString(), 30)).map((x) => [x.entity, x.field, x.entity_id])).toEqual([["task", "title", "T1"]]);
    const r = await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => trp(textOf(u))), now: T0 });
    expect(r).toMatchObject({ done: 1, failed: 0, stopped: false });
    expect(await row("T1")).toMatchObject({ source_text: "帳票修正", source_lang: "ja", zh: "zh:帳票修正", en: "en:帳票修正", model: "claude-opus-5-5" });
    expect((await db().prepare("SELECT updated_at FROM tasks WHERE id='T1'").first<any>()).updated_at).toBe("u0");
    expect(await findStale(db(), T0.toISOString(), 30)).toEqual([]);
  });

  it("an edited source is stale again", async () => {
    await addTask("T1", "旧");
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => tr(textOf(u))), now: T0 });
    await db().prepare("UPDATE tasks SET title='新' WHERE id='T1'").run();
    expect((await findStale(db(), T0.toISOString(), 30)).map((x) => x.text)).toEqual(["新"]);
  });

  it("resets attempts when the source text changed since the last failure", async () => {
    await addTask("T1", "B");
    await db().prepare(
      `INSERT INTO translations (entity, entity_id, field, failed_text, attempts, next_try_at, last_error, updated_at)
       VALUES ('task', 'T1', 'title', 'A', 5, '2099-01-01T00:00:00Z', 'boom', 'u0')`).run();
    const st = await findStale(db(), T0.toISOString(), 30);
    expect(st.map((x) => [x.text, x.attempts])).toEqual([["B", 0]]);
  });

  it("lists a digest's pdf_text when set, not when NULL", async () => {
    const ins = (day: string, pdf: string | null) => db().prepare(
      `INSERT INTO report_digests (week, day, text, pdf_text, inputs_hash, edited, model, generated_at, updated_at)
       VALUES ('2026-W39', ?1, '', ?2, 'h', 0, 'm', 'n', 'n')`).bind(day, pdf).run();
    await ins("", "進んだ"); await ins("2026-09-22", null);
    const st = await findStale(db(), T0.toISOString(), 30);
    expect(st.map((x) => [x.entity, x.field, x.entity_id])).toEqual([["digest", "pdf_text", "2026-W39\u001f"]]);
  });

  it("skips the round quietly without an API key", async () => {
    await addTask("T1", "x");
    expect(await runSweep({ ...E, ANTHROPIC_API_KEY: undefined }, { now: T0 })).toMatchObject({ skipped: "no-key", done: 0 });
  });

  it("stops the round on an API error and backs off that item", async () => {
    await addTask("T1", "a"); await addTask("T2", "b");
    const calls: string[] = [];
    const client = fakeAnthropic(() => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow" } }), { status: 429 }), calls);
    const r = await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client, now: T0, limit: 30 });
    expect(r.stopped).toBe(true);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const failed = await db().prepare("SELECT * FROM translations WHERE attempts > 0").all<any>();
    expect(failed.results[0]).toMatchObject({ attempts: 1, source_text: "" });
    expect(failed.results[0].next_try_at > T0.toISOString()).toBe(true);
    // not eligible again until next_try_at
    expect((await findStale(db(), T0.toISOString(), 30)).map((x) => x.entity_id)).not.toContain(failed.results[0].entity_id);
  });

  it("drops a result whose source changed mid-flight", async () => {
    await addTask("T1", "古い");
    const client = fakeAnthropic(async (u) => {
      await db().prepare("UPDATE tasks SET title='新しい' WHERE id='T1'").run();
      return tr(textOf(u));
    });
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client, now: T0 });
    const r = await row("T1");
    expect(r?.source_text ?? "").not.toBe("古い");
  });

  it("a malformed model reply records a failure but does not stop the round", async () => {
    await addTask("T1", "a"); await addTask("T2", "b");
    let n = 0;
    const client = fakeAnthropic((u) => {
      if (n++ === 0) return new Response(JSON.stringify({
        id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "not json" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
      return trp(textOf(u));
    });
    const r = await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client, now: T0, limit: 30 });
    expect(r).toEqual({ done: 1, failed: 1, stopped: false });
  });

  it("keeps numeric / date override values as identity without calling the model", async () => {
    await db().prepare(`INSERT INTO report_overrides (week, template, sheet, row_key, "column", value, updated_at)
      VALUES ('2026-W40','weekly','tasks','T1','hours','2.5','x')`).run();
    const calls: string[] = [];
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => tr(textOf(u)), calls), now: T0 });
    expect(calls).toEqual([]);
    expect(await db().prepare("SELECT model, zh, en FROM translations WHERE entity='report_override'").first<any>()).toEqual({ model: "identity", zh: "2.5", en: "2.5" });
  });

  it("removes translations whose entity is gone", async () => {
    await addTask("T1", "x");
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => tr(textOf(u))), now: T0 });
    await db().prepare("DELETE FROM tasks WHERE id='T1'").run();
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => tr(textOf(u))), now: T0, cleanup: true });
    expect(await row("T1")).toBeNull();
  });

  it("keeps orphan translations when the round is not a cleanup round", async () => {
    await addTask("T1", "x");
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => tr(textOf(u))), now: T0 });
    await db().prepare("DELETE FROM tasks WHERE id='T1'").run();
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => tr(textOf(u))), now: T0 });
    expect(await row("T1")).not.toBeNull();
  });

  it("marks polishable fields: task title yes, project no; a session summary only when hand-edited", async () => {
    await db().prepare(
      `INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
       VALUES ('T1', 'r', 'PRJ', '帳票直す', 'open', '2026-10-01', '', '[]', 'm', 'x', 'u0')`).run();
    const ses = (id: string, edited: string | null) => db().prepare(
      `INSERT INTO sessions (id, machine, agent, session_id, cwd, started_at, ended_at, active_minutes, turns, summary,
        summary_edited, summary_source, task_id, link_method, ts, updated_at) VALUES (?1, 'm', 'claude-code', ?1, '/x',
        '2026-10-01T01:00:00Z', '2026-10-01T02:00:00Z', 60, 3, '検証した', ?2, 'llm', NULL, 'none', 'x', 'u')`).bind(id, edited).run();
    await ses("S1", null); await ses("S2", "ちゃんと検証");
    const st = await findStale(db(), T0.toISOString(), 30);
    const by = (e: string, f: string, id: string) => st.find((x) => x.entity === e && x.field === f && x.entity_id === id);
    expect(by("task", "title", "T1")).toMatchObject({ polishable: 1, pinned_raw: null });
    expect(by("task", "project", "T1")).toMatchObject({ polishable: 0 });
    expect(by("session", "summary", "S1")).toMatchObject({ polishable: 0 });
    expect(by("session", "summary", "S2")).toMatchObject({ polishable: 1, text: "ちゃんと検証" });
  });

  it("a digest is polished only when edited = 1", async () => {
    const dg = (day: string, edited: number) => db().prepare(
      `INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at) VALUES ('2026-W41', ?1, '本日の作業', 'h', ?2, 'u', 'u')`).bind(day, edited).run();
    await dg("2026-10-05", 0); await dg("2026-10-06", 1);
    const st = await findStale(db(), T0.toISOString(), 30);
    const d = (day: string) => st.find((x) => x.entity === "digest" && x.field === "text" && x.entity_id === `2026-W41\u001f${day}`);
    expect(d("2026-10-05")).toMatchObject({ polishable: 0 });
    expect(d("2026-10-06")).toMatchObject({ polishable: 1 });
  });

  const pol = (u: string) => ({ source: "ja", polished: `P(${u})`, zh: `zh:P(${u})`, ja: "ignored", en: `en:P(${u})` });
  const isPolish = (b: any) => b.output_config.format.schema.required.includes("polished");

  it("polishes a polishable field and translates from the polish; project stays translate-only", async () => {
    await db().prepare(
      `INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
       VALUES ('T1', 'r', 'PRJ', '帳票なおす', 'open', '2026-10-01', '', '[]', 'm', 'x', 'u0')`).run();
    const client = fakeAnthropic((u) => (u.includes("(title)") ? pol(textOf(u)) : tr(textOf(u))));
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client, now: T0 });
    expect(await row("T1")).toMatchObject({ source_text: "帳票なおす", polished_from: "帳票なおす", ja: "P(帳票なおす)", zh: "zh:P(帳票なおす)" });
    expect(await row("T1", "project")).toMatchObject({ source_text: "PRJ", polished_from: null, zh: "zh:PRJ" });
    expect((await db().prepare("SELECT title, updated_at FROM tasks WHERE id='T1'").first<any>())).toEqual({ title: "帳票なおす", updated_at: "u0" });
  });

  it("drops a polish result whose source changed mid-flight", async () => {
    await addTask("T1", "古い");
    const client = fakeAnthropic(async (u) => {
      await db().prepare("UPDATE tasks SET title='新しい' WHERE id='T1'").run();
      return pol(textOf(u));
    });
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client, now: T0 });
    expect(await row("T1")).toBeNull();
    expect((await findStale(db(), T0.toISOString(), 30)).map((x) => x.text)).toContain("新しい");
  });

  it("a pinned raw text is translated, not polished; a different text is polished again", async () => {
    await addTask("T1", "そのまま");
    await db().prepare(`INSERT INTO translations (entity, entity_id, field, source_text, pinned_raw, updated_at)
      VALUES ('task', 'T1', 'title', '', 'そのまま', 'u')`).run();
    const bodies: any[] = [];
    const client = fakeAnthropic((u) => (bodies.at(-1) && isPolish(bodies.at(-1)) ? pol(textOf(u)) : tr(textOf(u))), [], (b) => bodies.push(b));
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client, now: T0, only: { entity: "task", entity_id: "T1" } });
    expect(bodies.some(isPolish)).toBe(false);
    expect(await row("T1")).toMatchObject({ source_text: "そのまま", polished_from: null, pinned_raw: "そのまま", ja: "そのまま" });
    await db().prepare("UPDATE tasks SET title='べつの' WHERE id='T1'").run();
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client, now: T0, only: { entity: "task", entity_id: "T1" } });
    expect(await row("T1")).toMatchObject({ source_text: "べつの", polished_from: "べつの", ja: "P(べつの)" });
  });

  it("identity values are never polished", async () => {
    await db().prepare(`INSERT INTO report_overrides (week, template, sheet, row_key, "column", value, updated_at)
      VALUES ('2026-W41', 'weekly', 'hours', '2026-10-09', 'hours', '7.5', 'u')`).run();
    const calls: string[] = [];
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => pol(textOf(u)), calls), now: T0 });
    expect(calls).toEqual([]);
    const r = await db().prepare("SELECT model, polished_from, zh FROM translations WHERE entity='report_override'").first<any>();
    expect(r).toEqual({ model: "identity", polished_from: null, zh: "7.5" });
  });

  it(`after ${3} format failures on the same text it falls back to translate-only`, async () => {
    expect(POLISH_TRIES).toBe(3);
    await addTask("T1", "だめ");
    await db().prepare(`INSERT INTO translations (entity, entity_id, field, failed_text, attempts, next_try_at, last_error, updated_at)
      VALUES ('task', 'T1', 'title', 'だめ', 3, NULL, 'format: Error: too long', 'u')`).run();
    const bodies: any[] = [];
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => tr(textOf(u)), [], (b) => bodies.push(b)), now: T0, only: { entity: "task", entity_id: "T1" } });
    expect(bodies.some(isPolish)).toBe(false);
    expect(await row("T1")).toMatchObject({ source_text: "だめ", polished_from: null, attempts: 0 });
  });

  it("3 API errors on a text do not demote it: it is still polished next round", async () => {
    await addTask("T1", "ネット");
    await db().prepare(`INSERT INTO translations (entity, entity_id, field, failed_text, attempts, next_try_at, last_error, updated_at)
      VALUES ('task', 'T1', 'title', 'ネット', 3, NULL, 'Error: 529 overloaded', 'u')`).run();
    const bodies: any[] = [];
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => pol(textOf(u)), [], (b) => bodies.push(b)), now: T0, only: { entity: "task", entity_id: "T1" } });
    expect(bodies.some(isPolish)).toBe(true);
    expect(await row("T1")).toMatchObject({ polished_from: "ネット", ja: "P(ネット)" });
  });

  it("a format failure is recorded with its count and the format: marker", async () => {
    await addTask("T1", "ふぉーまっと");
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic(() => ({ nonsense: true })), now: T0, only: { entity: "task", entity_id: "T1" } });
    expect((await row("T1")).last_error).toMatch(/^pf1\|format:/);
  });

  // rounds of one failure kind each, an hour apart (past any backoff); returns whether each round asked for a polish
  const failRounds = async (kinds: ("fmt" | "api")[]) => {
    const asked: boolean[] = [];
    for (const [i, k] of kinds.entries()) {
      const bodies: any[] = [];
      const client = fakeAnthropic(() => (k === "fmt" ? { nonsense: true }
        : new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow" } }), { status: 429 })), [], (b) => bodies.push(b));
      await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client, now: new Date(T0.getTime() + i * 3_600_000), only: { entity: "task", entity_id: "T1" } });
      asked.push(bodies.some(isPolish));
    }
    return asked;
  };
  const nextRoundPolishes = async (n: number) => {
    const bodies: any[] = [];
    await runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => (u.includes("(title)") ? pol(textOf(u)) : tr(textOf(u))), [], (b) => bodies.push(b)),
      now: new Date(T0.getTime() + n * 3_600_000), only: { entity: "task", entity_id: "T1" } });
    return bodies.some(isPolish);
  };

  it("API, API, format is one format failure: the text is still polished", async () => {
    await addTask("T1", "ねっと");
    expect(await failRounds(["api", "api", "fmt"])).toEqual([true, true, true]);
    expect((await row("T1")).attempts).toBe(3);
    expect(await nextRoundPolishes(3)).toBe(true);
  });

  it("format failures count across API errors in between: the third one demotes", async () => {
    await addTask("T1", "まぜる");
    expect(await failRounds(["fmt", "api", "fmt", "api", "fmt"])).toEqual([true, true, true, true, true]);
    expect((await row("T1")).last_error).toMatch(/^pf3\|format:/);
    expect(await nextRoundPolishes(5)).toBe(false);
    expect(await row("T1")).toMatchObject({ polished_from: null, attempts: 0 });
  });

  it("an API error after a demotion keeps it demoted", async () => {
    await addTask("T1", "さげる");
    expect(await failRounds(["fmt", "fmt", "fmt", "api"])).toEqual([true, true, true, false]);
    expect((await row("T1")).last_error).toMatch(/^pf3\|/);
    expect(await nextRoundPolishes(4)).toBe(false);
  });

  it("a demoted text that is edited starts counting again and is polished", async () => {
    await addTask("T1", "だめ");
    await failRounds(["fmt", "fmt", "fmt"]);
    await db().prepare("UPDATE tasks SET title='なおした' WHERE id='T1'").run();
    expect(await nextRoundPolishes(3)).toBe(true);
    expect(await row("T1")).toMatchObject({ source_text: "なおした", polished_from: "なおした" });
  });

  it("polishing adds no D1 statements to a round", async () => {
    const count = async (title: string, project: string) => {
      await resetDb();
      await db().prepare(
        `INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
         VALUES ('T1', 'r', ?2, ?1, 'open', '2026-10-01', '', '[]', 'm', 'x', 'u0')`).bind(title, project).run();
      let n = 0;
      const real = db();
      const DB = new Proxy(real, { get: (t, k) => (k === "prepare" ? (...a: any[]) => { n++; return (t as any).prepare(...a); } : (t as any)[k]?.bind?.(t) ?? (t as any)[k]) });
      const client = fakeAnthropic((u) => (u.includes("(title)") ? pol(textOf(u)) : tr(textOf(u))));
      await runSweep({ ...E, DB, ANTHROPIC_API_KEY: "k" }, { client, now: T0, only: { entity: "task", entity_id: "T1" } });
      return n;
    };
    // one stale field each: a polished title vs a translate-only project
    expect(await count("帳票なおす", "")).toBe(await count("", "PRJ"));
  });
});

/** env.DB with every prepare() counted; `failWrites` makes each translations INSERT of writeOk throw on run(). */
function countingDb(failWrites = false) {
  const real = db(), seen = { n: 0 };
  const DB = new Proxy(real, {
    get(t, k) {
      if (k === "prepare") return (sql: string) => {
        seen.n++;
        const st = t.prepare(sql);
        if (failWrites && sql.includes("polished_from") && sql.startsWith("INSERT INTO translations")) {
          return new Proxy(st, { get(x, kk) { return kk === "bind" ? (...a: unknown[]) => { const b = x.bind(...a); return new Proxy(b, { get(y, k3) {
            return k3 === "run" ? async () => { throw new Error("D1 write failed"); } : (y as any)[k3]?.bind?.(y) ?? (y as any)[k3]; } }); } : (x as any)[kk]?.bind?.(x) ?? (x as any)[kk]; } });
        }
        return st;
      };
      const v = (t as any)[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { DB, seen };
}

describe("sweep D1 budget (Workers Free: 50 statements per invocation)", () => {
  beforeEach(resetDb);

  it("the budget inputs are pinned: a new registry source or a larger round needs a budget change first", () => {
    expect(SWEEP_LIMIT, "a larger SWEEP_LIMIT needs a budget change first").toBe(8);
    expect(SOURCES.length, "a new registry source needs a budget change first").toBe(15);
  });

  it("a full sweep round prepares at most 50 statements (SWEEP_LIMIT items, hourly orphan cleanup on)", async () => {
    for (let i = 0; i < SWEEP_LIMIT + 5; i++) await addTask(`T${i}`, `件名${i}`);
    const { DB, seen } = countingDb();
    const r = await runSweep({ ...E, DB, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => trp(textOf(u))), now: T0, cleanup: true });
    expect(r.done).toBe(SWEEP_LIMIT);
    expect(seen.n).toBeLessThanOrEqual(49);   // measured 46 = 15 findStale + 2×8 + 15 orphan; the failed-write slack (+3) is the next test
  });

  it("a round whose writes fail prepares at most 50 statements (three workers can fail in flight)", async () => {
    for (let i = 0; i < SWEEP_LIMIT + 5; i++) await addTask(`T${i}`, `件名${i}`);
    const { DB, seen } = countingDb(true);
    const r = await runSweep({ ...E, DB, ANTHROPIC_API_KEY: "k" }, { client: fakeAnthropic((u) => trp(textOf(u))), now: T0, cleanup: true });
    expect(r.stopped).toBe(true);
    expect(seen.n).toBeLessThanOrEqual(50);
  });
});
