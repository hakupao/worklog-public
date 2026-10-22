import { afterEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "../src/i18n/strings";
import { glyphOf, htmlLang, t } from "../src/i18n/t";
import { fmtClock, fmtDate, fmtHm, fmtMoney } from "../src/i18n/format";
import { INK_FX_OPTIONS, LED_FX_OPTIONS, WORLD_FX_OPTIONS } from "../src/prefs/types";

afterEach(() => vi.restoreAllMocks());

describe("strings table", () => {
  it("every key has a non-empty zh, ja and en", () => {
    const missing = Object.entries(STRINGS).flatMap(([k, v]) =>
      (["zh", "ja", "en"] as const).filter((l) => !(v as Record<string, string>)[l]?.trim()).map((l) => `${k}.${l}`));
    expect(missing).toEqual([]);
  });
  it("has a name for every effect the settings page offers", () => {
    const led = new Set(Object.values(LED_FX_OPTIONS).flat()), ink = new Set(Object.values(INK_FX_OPTIONS).flat());
    for (const f of led) expect(STRINGS).toHaveProperty(`fx.${f}`);
    for (const f of ink) expect(STRINGS).toHaveProperty(`ofx.${f}`);
    for (const f of WORLD_FX_OPTIONS) expect(STRINGS).toHaveProperty(`wfx.${f}`);
  });
});

describe("t", () => {
  it("picks the language and fills variables", () => {
    expect(t("zh", "nav.now")).toBe("此刻");
    expect(t("ja", "machines.synced", { name: "MAC", t: "18:00" })).toBe("MAC 18:00 収集済");
    expect(t("en", "machines.synced", { name: "WIN", t: "09:05" })).toBe("WIN synced 09:05");
  });
  it("falls back to zh and warns in dev when a translation is blank", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const k = "nav.now" as const, saved = STRINGS[k].en;
    (STRINGS[k] as { en: string }).en = "";
    try { expect(t("en", k)).toBe("此刻"); } finally { (STRINGS[k] as { en: string }).en = saved; }
    expect(warn).toHaveBeenCalled();
  });
  it("maps html lang and glyph set", () => {
    expect([htmlLang("zh"), htmlLang("ja"), htmlLang("en")]).toEqual(["zh-CN", "ja", "en"]);
    expect([glyphOf("zh"), glyphOf("ja"), glyphOf("en")]).toEqual(["zh", "ja", "zh"]);
  });
});

describe("format (Asia/Tokyo)", () => {
  const d = new Date("2026-10-05T00:41:09Z");     // Mon 09:41:09 JST
  it("clock and HH:MM", () => {
    expect(fmtClock(d)).toBe("09:41:09");
    expect(fmtHm("2026-10-05T09:00:00Z")).toBe("18:00");
  });
  it("date per language", () => {
    expect(fmtDate(d, "zh")).toBe("2026年10月5日（周一）");
    expect(fmtDate(d, "ja")).toBe("2026年10月5日（月）");
    expect(fmtDate(d, "en")).toBe("MON, OCT 5, 2026");
  });
  it("money per language", () => {
    expect(fmtMoney(39.29, "en")).toBe("$39.29");
    expect(fmtMoney(39.29, "ja")).toBe("$39.29");
  });
});
