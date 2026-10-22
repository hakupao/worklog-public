import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { findStale } from "../src/i18n/sweep";
import { api, resetDb } from "./helpers";

const DB = () => (env as any).DB as D1Database;
const row = (week: string, oneliner: string | null, oneliner_edited: number) => DB().prepare(
  `INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at, oneliner, oneliner_edited)
   VALUES (?1, '', '■ 帳票：直した', 'h', 0, 'g', 'u', ?2, ?3)`).bind(week, oneliner, oneliner_edited).run();

describe("digest.oneliner in the translation registry", () => {
  beforeEach(resetDb);

  it("a stored oneliner is stale until translated; polished only when hand-edited", async () => {
    await row("2026-W40", "帳票を直した", 0);
    await row("2026-W41", "手で直した一言", 1);
    const st = (await findStale(DB(), "2026-10-13T00:00:00Z", 50)).filter((x) => x.field === "oneliner");
    expect(st.map((x) => [x.entity_id, x.polishable])).toEqual([["2026-W40\u001f", 0], ["2026-W41\u001f", 1]]);
  });

  it("a NULL oneliner is not listed", async () => {
    await row("2026-W40", null, 0);
    expect((await findStale(DB(), "2026-10-13T00:00:00Z", 50)).some((x) => x.field === "oneliner")).toBe(false);
  });
});

const WEEK = "2026-W39";
const put = (body: unknown) => api(`/api/reports/${WEEK}/digests/week/generated`, { method: "PUT", body: JSON.stringify(body) });
const patch = (body: unknown, day = "week") => api(`/api/reports/${WEEK}/digests/${day}`, { method: "PATCH", body: JSON.stringify(body) });
const get = async () => (await DB().prepare("SELECT text, edited, oneliner, oneliner_edited FROM report_digests WHERE week = ?1 AND day = ''").bind(WEEK).first()) as any;
const seedWeek = (oneliner: string | null, oneliner_edited = 0) => DB().prepare(
  `INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at, oneliner, oneliner_edited)
   VALUES (?1, '', '■ 帳票：直した', 'h', 0, 'g', 'u', ?2, ?3)`).bind(WEEK, oneliner, oneliner_edited).run();
const one = (o: Record<string, unknown> = {}) => ({ oneliner_only: true, source_text: "■ 帳票：直した", oneliner: "帳票を直した",
  model: "opus-local", zh: { oneliner: "修好了报表" }, en: { oneliner: "Fixed the report" }, ...o });

describe("oneliner — hand edit", () => {
  beforeEach(resetDb);

  it("PATCH { oneliner } stores it as a hand edit and answers it", async () => {
    await seedWeek("AI の一言");
    const r = await patch({ oneliner: "手で直した一言" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ oneliner: "手で直した一言", oneliner_edited: true, edited: false });
    expect(await get()).toMatchObject({ oneliner: "手で直した一言", oneliner_edited: 1 });
  });

  it("a text edit keeps a hand-edited oneliner and clears an AI one", async () => {
    await seedWeek("手の一言", 1);
    await patch({ text: "本文を直した" });
    expect(await get()).toMatchObject({ text: "本文を直した", edited: 1, oneliner: "手の一言", oneliner_edited: 1 });
    await resetDb(); await seedWeek("AI の一言", 0);
    await patch({ text: "本文を直した" });
    expect(await get()).toMatchObject({ text: "本文を直した", edited: 1, oneliner: null, oneliner_edited: 0 });
  });

  it("an empty edit clears the oneliner and hands it back to generation", async () => {
    await seedWeek("手の一言", 1);
    const r = await patch({ oneliner: "" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ oneliner: null, oneliner_edited: false });
    expect(await get()).toMatchObject({ oneliner: null, oneliner_edited: 0 });
  });

  it("regenerate hands both the text and the oneliner back to generation", async () => {
    await seedWeek("手の一言", 1);
    await DB().prepare("UPDATE report_digests SET edited = 1 WHERE week = ?1").bind(WEEK).run();
    await patch({ regenerate: true });
    expect(await get()).toMatchObject({ edited: 0, oneliner_edited: 0 });
  });

  it("is week-only, needs the week row, and is capped at 120 code points", async () => {
    expect((await patch({ oneliner: "x" }, "2026-09-22")).status).toBe(400);
    expect((await patch({ oneliner: "x" })).status).toBe(404);
    await seedWeek(null);
    const long = await patch({ oneliner: "あ".repeat(121) });
    expect(long.status).toBe(400);
    expect(JSON.stringify(await long.json())).toContain("at most 120 characters");
    expect((await patch({ oneliner: "あ".repeat(120) })).status).toBe(200);
  });
});

describe("oneliner — oneliner_only (backfill)", () => {
  beforeEach(resetDb);

  it("fills a missing oneliner with its translations", async () => {
    await seedWeek(null);
    expect((await put(one())).status).toBe(200);
    expect(await get()).toMatchObject({ oneliner: "帳票を直した", oneliner_edited: 0 });
    const tr = await DB().prepare("SELECT zh, en FROM translations WHERE entity = 'digest' AND field = 'oneliner'").first();
    expect(tr).toEqual({ zh: "修好了报表", en: "Fixed the report" });
  });

  it("oneliner_only refuses a hand-edited, already-set or stale oneliner", async () => {
    await seedWeek("既にある");
    expect((await put(one())).status).toBe(409);
    await resetDb(); await seedWeek(null, 1);
    expect((await put(one())).status).toBe(409);
    await resetDb(); await seedWeek(null);
    expect((await put(one({ source_text: "古い本文" }))).status).toBe(409);
    expect((await get()).oneliner).toBeNull();
    expect(await DB().prepare("SELECT COUNT(*) AS n FROM translations WHERE field = 'oneliner'").first()).toEqual({ n: 0 });
  });

  it("404 without a week row; 400 on a day", async () => {
    expect((await put(one())).status).toBe(404);
    expect((await api(`/api/reports/${WEEK}/digests/2026-09-22/generated`, { method: "PUT", body: JSON.stringify(one()) })).status).toBe(400);
  });
});
