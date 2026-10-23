import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import DEFAULTS from "../src/prefs/defaults.json";
import { api, resetDb } from "./helpers";

const put = (body: unknown) => api("/api/prefs", { method: "PUT", body: JSON.stringify(body) });
// workers-types' Response.json() returns unknown; the other route tests cast the same way.
const body = async (r: Response) => (await r.json()) as any;

describe("prefs", () => {
  beforeEach(resetDb);

  it("GET returns the defaults when nothing is stored", async () => {
    const r = await api("/api/prefs");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(DEFAULTS);
  });

  it("PUT replaces the whole object and GET reads it back", async () => {
    const next = { ...DEFAULTS, lang: "ja", world: "omote", fx: { load: "scan", lang: "flap", data: "decode" }, speed: 0.5 };
    const r = await put(next);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(next);
    expect(await (await api("/api/prefs")).json()).toEqual(next);
  });

  it("drops unknown keys and fills missing ones with defaults", async () => {
    const r = await put({ lang: "en", bogus: 1, fx: { load: "none" }, omote: { extra: true } });
    expect(await r.json()).toEqual({ ...DEFAULTS, lang: "en", fx: { ...DEFAULTS.fx, load: "none" } });
  });

  it("rejects an illegal value with 400 and keeps the stored row", async () => {
    await put({ ...DEFAULTS, lang: "ja" });
    for (const bad of [
      { lang: "fr" }, { speed: 2 }, { fx: { load: "slide" } }, { ofx: { load: "slide" } },
      { worldFx: "melt" }, { dock: "float" }, { omote: { hide: ["no-dot"] } }, { omote: { font: "comic" } },
    ]) {
      const r = await put(bad);
      expect(r.status).toBe(400);
      expect((await body(r)).error).toBe("invalid");
    }
    expect((await body(await api("/api/prefs"))).lang).toBe("ja");
  });

  it("rejects a body that is not JSON", async () => {
    const r = await api("/api/prefs", { method: "PUT", body: "nope" });
    expect(r.status).toBe(400);
  });

  it("last write wins: two machines writing different fields do not merge", async () => {
    await put({ ...DEFAULTS, lang: "ja" });
    await put({ ...DEFAULTS, world: "omote" });
    const got = await body(await api("/api/prefs"));
    expect(got.world).toBe("omote");
    expect(got.lang).toBe("zh");
  });

  it("a stored row that no longer validates reads back as defaults", async () => {
    await (env as any).DB.prepare("INSERT INTO prefs (id, json, updated_at) VALUES (1, ?1, ?2)")
      .bind(JSON.stringify({ lang: "klingon" }), new Date().toISOString()).run();
    expect(await (await api("/api/prefs")).json()).toEqual(DEFAULTS);
  });

  it("a stored row from before the scene keys went drops `scene` on read and on a keep-merge", async () => {
    await (env as any).DB.prepare("INSERT INTO prefs (id, json, updated_at) VALUES (1, ?1, ?2)")
      .bind(JSON.stringify({ ...DEFAULTS, scene: { mode: "mono" } }), new Date().toISOString()).run();
    expect(await (await api("/api/prefs")).json()).toEqual(DEFAULTS);
    const { cal: _c, ...older } = DEFAULTS as any;
    expect(await (await put(older)).json()).toEqual(DEFAULTS);
  });

  it("predict: a partial object is filled leaf by leaf, unknown rules are dropped", async () => {
    const r = await put({ ...DEFAULTS, predict: {
      runningMin: 15,
      modes: { weekly: { from: "14:00" } },
      rules: { "task.waiting": { on: false, params: { keywords: [" 確認待ち "] } }, "no.such": { on: true } },
    } });
    expect(r.status).toBe(200);
    const got = await body(r);
    expect(got.predict.runningMin).toBe(15);
    expect(got.predict.modes.weekly).toEqual({ ...DEFAULTS.predict.modes.weekly, from: "14:00" });
    expect(got.predict.modes.morning).toEqual(DEFAULTS.predict.modes.morning);
    expect(got.predict.rules["task.waiting"]).toEqual({ ...DEFAULTS.predict.rules["task.waiting"], on: false,
      params: { keywords: ["確認待ち"], days: DEFAULTS.predict.rules["task.waiting"].params.days } });
    expect(got.predict.rules).not.toHaveProperty("no.such");
    expect(Object.keys(got.predict.rules)).toHaveLength(10);
  });

  it("predict: illegal values are rejected", async () => {
    for (const predict of [
      { runningMin: 0 }, { runningMin: 2.5 },
      { modes: { morning: { from: "25:00" } } }, { modes: { morning: { to: "24:00" } } },
      { modes: { focus: { days: [0] } } }, { modes: { focus: { days: [1, 1] } } },
      { rules: { "plan.stale": { weight: 101 } } }, { rules: { "plan.stale": { mode: "noon" } } },
      { rules: { "task.waiting": { params: { keywords: [] } } } }, { rules: { "task.waiting": { params: { keywords: ["  "] } } } },
      { rules: { "unlinked.stale": { params: { minutes: 0 } } } }, { rules: { "task.waiting": { params: { days: 8 } } } },
      { rules: { "unlinked.stale": { params: { minMinutes: -1 } } } }, { rules: { "unlinked.stale": { params: { minMinutes: 601 } } } },
      { rules: { "unlinked.stale": { params: { minMinutes: 2.5 } } } },
      { rules: { "week.unlinked": { params: { minMinutes: -1 } } } }, { rules: { "week.unlinked": { params: { minMinutes: 601 } } } },
    ]) {
      const r = await put({ ...DEFAULTS, predict });
      expect(r.status, JSON.stringify(predict)).toBe(400);
    }
  });

  it("unlinked.stale.minMinutes (Task 15b): a stored row without it reads back with the default 5; 0 and 600 are accepted", async () => {
    const old = structuredClone(DEFAULTS) as any;
    old.predict.rules["unlinked.stale"].params = { minutes: 45 };
    await (env as any).DB.prepare("INSERT INTO prefs (id, json, updated_at) VALUES (1, ?1, ?2)")
      .bind(JSON.stringify(old), new Date().toISOString()).run();
    expect((await body(await api("/api/prefs"))).predict.rules["unlinked.stale"].params).toEqual({ minutes: 45, minMinutes: 5 });
    expect(DEFAULTS.predict.rules["unlinked.stale"].params.minMinutes).toBe(5);
    for (const minMinutes of [0, 600]) {
      const r = await put({ ...DEFAULTS, predict: { rules: { "unlinked.stale": { params: { minMinutes } } } } });
      expect(r.status).toBe(200);
      expect((await body(r)).predict.rules["unlinked.stale"].params).toEqual({ minutes: 30, minMinutes });
    }
  });

  it("week.unlinked.minMinutes (final review): a stored row without it reads back with the default 5; 0 and 600 are accepted", async () => {
    const old = structuredClone(DEFAULTS) as any;
    old.predict.rules["week.unlinked"].params = {};
    await (env as any).DB.prepare("INSERT INTO prefs (id, json, updated_at) VALUES (1, ?1, ?2)")
      .bind(JSON.stringify(old), new Date().toISOString()).run();
    expect((await body(await api("/api/prefs"))).predict.rules["week.unlinked"].params).toEqual({ minMinutes: 5 });
    expect(DEFAULTS.predict.rules["week.unlinked"].params.minMinutes).toBe(5);
    for (const minMinutes of [0, 600]) {
      const r = await put({ ...DEFAULTS, predict: { rules: { "week.unlinked": { params: { minMinutes } } } } });
      expect(r.status).toBe(200);
      expect((await body(r)).predict.rules["week.unlinked"].params).toEqual({ minMinutes });
    }
  });

  it("a row stored by sub-project 1 (no predict) reads back with its own fields and the default predict", async () => {
    const { predict: _drop, ...sub1 } = { ...DEFAULTS, lang: "ja", world: "omote" };
    await (env as any).DB.prepare("INSERT INTO prefs (id, json, updated_at) VALUES (1, ?1, ?2)")
      .bind(JSON.stringify(sub1), new Date().toISOString()).run();
    expect(await body(await api("/api/prefs"))).toEqual({ ...DEFAULTS, lang: "ja", world: "omote" });
  });

  it("stats (sub-project 7b): a stored row without it reads back with the default order, all on", async () => {
    const { stats: _drop, ...old } = { ...DEFAULTS, lang: "ja" };
    await (env as any).DB.prepare("INSERT INTO prefs (id, json, updated_at) VALUES (1, ?1, ?2)")
      .bind(JSON.stringify(old), new Date().toISOString()).run();
    const got = await body(await api("/api/prefs"));
    expect(got.lang).toBe("ja");
    expect(got.stats).toEqual(DEFAULTS.stats);
    expect(DEFAULTS.stats.order).toHaveLength(24);
    expect(DEFAULTS.stats.off).toEqual([]);
  });

  it("stats: well-formed ids are not an enum (an id a later version dropped still validates); bad ones are 400", async () => {
    const r = await put({ ...DEFAULTS, stats: { order: ["gone", "dial"], off: ["hours24"] } });
    expect(r.status).toBe(200);
    expect((await body(r)).stats).toEqual({ order: ["gone", "dial"], off: ["hours24"] });
    expect((await body(await put({ ...DEFAULTS, stats: { off: ["dial"] } }))).stats).toEqual({ order: DEFAULTS.stats.order, off: ["dial"] });
    for (const stats of [
      { order: ["Hours24"] }, { order: ["a".repeat(25)] }, { order: "dial" }, { off: ["stats.cost"] }, { off: [3] },
      { order: Array.from({ length: 65 }, () => "dial") },
    ]) {
      const bad = await put({ ...DEFAULTS, stats });
      expect(bad.status, JSON.stringify(stats)).toBe(400);
    }
  });

  it("a PUT without stats (a tab on an older bundle) keeps the stored stats; one with stats replaces it whole", async () => {
    await put({ ...DEFAULTS, stats: { order: ["dial", "headlines"], off: ["terrain"] } });
    const { stats: _drop, ...noStats } = { ...DEFAULTS, lang: "en", predict: { ...DEFAULTS.predict, runningMin: 15 } };
    const r = await body(await put(noStats));
    expect([r.lang, r.predict.runningMin, r.stats]).toEqual(["en", 15, { order: ["dial", "headlines"], off: ["terrain"] }]);
    expect((await body(await api("/api/prefs"))).stats).toEqual({ order: ["dial", "headlines"], off: ["terrain"] });
    expect((await body(await put({ ...DEFAULTS, stats: {} }))).stats).toEqual(DEFAULTS.stats);
  });

  it("a PUT without predict (a tab still on the sub-1 bundle) keeps the stored predict; one with predict replaces it whole", async () => {
    await put({ ...DEFAULTS, predict: { ...DEFAULTS.predict, runningMin: 30 } });
    const { predict: _drop, ...noPredict } = { ...DEFAULTS, lang: "en" };
    const r = await body(await put(noPredict));
    expect([r.lang, r.predict.runningMin]).toEqual(["en", 30]);
    expect((await body(await api("/api/prefs"))).predict.runningMin).toBe(30);
    expect((await body(await put({ ...DEFAULTS, predict: {} }))).predict).toEqual(DEFAULTS.predict);
  });

  it("report.name: defaults, trims, rejects empty / over 60, and survives a PUT without `report`", async () => {
    expect((await body(await api("/api/prefs"))).report).toEqual({ name: "Taro Yamada" });
    expect((await body(await put({ ...DEFAULTS, report: { name: "  山田 太郎 " } }))).report).toEqual({ name: "山田 太郎" });
    expect((await put({ ...DEFAULTS, report: { name: "   " } })).status).toBe(400);
    expect((await put({ ...DEFAULTS, report: { name: "x".repeat(61) } })).status).toBe(400);
    const { report: _drop, ...older } = DEFAULTS as any;   // a tab on a bundle from before S3
    expect((await body(await put({ ...older, lang: "en" }))).report).toEqual({ name: "山田 太郎" });
  });
  it("cal prefs", async () => {
    const d = await body(await api("/api/prefs"));
    expect(d.cal).toEqual({
      payday: 25,
      breaks: [
        { name: "年末年始", from: "12-29", to: "01-03" },
        { name: "GW", from: "04-29", to: "05-05" },
        { name: "お盆", from: "08-13", to: "08-16" },
      ],
    });
    expect(d).not.toHaveProperty("scene");
    for (const payday of [0, 32]) expect((await put({ ...DEFAULTS, cal: { ...DEFAULTS.cal, payday } })).status).toBe(400);
    const bad = [{ name: "GW", from: "13-01", to: "01-03" }];
    expect((await put({ ...DEFAULTS, cal: { payday: 25, breaks: bad } })).status).toBe(400);
    // a tab on an older bundle still sends `scene`: accepted, and not stored
    const saved = await body(await put({ ...DEFAULTS, cal: { payday: 10, breaks: [] }, scene: { mode: "mono" } }));
    expect(saved).toMatchObject({ cal: { payday: 10, breaks: [] } });
    expect(saved).not.toHaveProperty("scene");
    const { cal: _c, ...older } = DEFAULTS as any;
    const r = await body(await put({ ...older, lang: "en" }));
    expect(r.cal).toEqual({ payday: 10, breaks: [] });
  });
});
