import { describe, expect, it, vi } from "vitest";
import { TranslateFormatError, polishAndTranslate, polishLimit, translate } from "../src/i18n/translator";
import { ONELINER_STYLE_NOTE } from "../src/i18n/registry";
import { fakeAnthropic } from "./fake-anthropic";

describe("translator", () => {
  it("returns all three languages and keeps the source verbatim in its own slot", async () => {
    const client = fakeAnthropic(() => ({ source: "ja", zh: "报表修改", ja: "帳票の修正", en: "Report fix" }));
    expect(await translate(client, "帳票修正", "task", "title")).toEqual({ source: "ja", zh: "报表修改", ja: "帳票修正", en: "Report fix" });
  });

  it("trims non-source translations but leaves the source slot verbatim", async () => {
    const client = fakeAnthropic(() => ({ source: "ja", zh: " 报表 \n", ja: "x", en: "\tReport " }));
    expect(await translate(client, " 帳票\n", "task", "title")).toEqual({ source: "ja", zh: "报表", ja: " 帳票\n", en: "Report" });
  });

  it("sends the text inside the user message and asks for effort low on opus 5.5", async () => {
    let seen: any;
    const client = fakeAnthropic(() => ({ source: "zh", zh: "x", ja: "y", en: "z" }), [], (b) => { seen = b; });
    await translate(client, "写周报", "note", "text");
    expect(seen.model).toBe("claude-opus-5-5");
    expect(seen.output_config.effort).toBe("low");
    expect(seen.output_config.format.type).toBe("json_schema");
    expect(seen.messages[0].content).toContain("写周报");
    expect(seen.thinking).toBeUndefined();
  });

  it("tells the model to keep quoted folder / file / 案件 names (「…」『…』\"…\") verbatim, a translation only in parentheses", async () => {
    let seen: any;
    const client = fakeAnthropic(() => ({ source: "ja", zh: "x", ja: "y", en: "z" }), [], (b) => { seen = b; });
    await translate(client, "「帳票改修」フォルダを整理", "session", "summary");
    expect(seen.system).toContain("Keep quoted folder names, file names and 案件 names (in 「…」, 『…』, \"…\") exactly as in the original; a translation may follow in parentheses.");
  });

  it("an optional 案件 name glossary goes into the user message; without one the message is unchanged", async () => {
    const seen: any[] = [];
    const client = fakeAnthropic(() => ({ source: "ja", zh: "x", ja: "y", en: "z" }), [], (b) => { seen.push(b); });
    await translate(client, "■ 研究：済", "digest", "pdf_compose", [{ ja: "研究", zh: "研究项目", en: "Research" }]);
    await translate(client, "■ 研究：済", "digest", "pdf_compose");
    expect(seen[0].messages[0].content).toContain("use exactly these names");
    expect(seen[0].messages[0].content).toContain("ja: 研究 / zh: 研究项目 / en: Research");
    expect(seen[1].messages[0].content).toBe("Kind: a one-sentence summary of a work day or week (pdf_compose).\n<text>\n■ 研究：済\n</text>");
    expect(seen[0].system).toBe(seen[1].system);
  });

  it("the digest oneliner carries a formal-register style note in the user message; other fields' messages do not change", async () => {
    const seen: any[] = [];
    const client = fakeAnthropic(() => ({ source: "ja", zh: "x", ja: "y", en: "z" }), [], (b) => { seen.push(b); });
    await translate(client, "A の改修を完了した。", "digest", "oneliner");
    await translate(client, "■ A：済", "digest", "text");
    await translate(client, "写周报", "note", "text");
    expect(seen[0].messages[0].content).toBe(`Kind: a one-sentence summary of a work day or week (oneliner).\nStyle: ${ONELINER_STYLE_NOTE}\n<text>\nA の改修を完了した。\n</text>`);
    expect(ONELINER_STYLE_NOTE).toContain("formal written");
    expect(ONELINER_STYLE_NOTE).toContain("Chinese stays within 40 characters, English within 25 words");
    expect(ONELINER_STYLE_NOTE).toContain("shortened only, never replaced by another name or invented");
    expect(seen[1].messages[0].content).toBe("Kind: a one-sentence summary of a work day or week (text).\n<text>\n■ A：済\n</text>");
    expect(seen[2].messages[0].content).toBe("Kind: a progress note (text).\n<text>\n写周报\n</text>");
    expect(seen[0].system).toBe(seen[1].system);
  });

  it("an optional timeout overrides the per-kind default (digest 180 s, others 60 s)", async () => {
    const client = fakeAnthropic(() => ({ source: "ja", zh: "x", ja: "y", en: "z" }));
    const create = vi.spyOn(client.messages, "create");
    await translate(client, "a", "digest", "pdf_compose");
    await translate(client, "a", "note", "text");
    await translate(client, "a", "digest", "pdf_compose", undefined, 60_000);
    expect(create.mock.calls.map((c) => (c[1] as { timeout: number }).timeout)).toEqual([180_000, 60_000, 60_000]);
  });

  it("throws TranslateFormatError on a reply that is not the schema", async () => {
    const client = fakeAnthropic(() => ({ source: "xx", zh: "a" }));
    await expect(translate(client, "a", "note", "text")).rejects.toBeInstanceOf(TranslateFormatError);
  });
});

describe("polishAndTranslate", () => {
  it("returns the polished text in its own slot and the translations made from it", async () => {
    const client = fakeAnthropic(() => ({ source: "zh", polished: "完成 1 个 domain 的 Mapping 仕様", zh: "x", ja: "1 つの domain の Mapping 仕様を完成", en: "Finish the Mapping spec for 1 domain" }));
    expect(await polishAndTranslate(client, "做一个domain", "day_plan_item", "detail")).toEqual({
      source: "zh", polished: "完成 1 个 domain 的 Mapping 仕様", zh: "完成 1 个 domain 的 Mapping 仕様",
      ja: "1 つの domain の Mapping 仕様を完成", en: "Finish the Mapping spec for 1 domain",
    });
  });

  it("asks opus 5.5 at effort low with the polish rules and the old translate rules", async () => {
    let seen: any;
    const client = fakeAnthropic(() => ({ source: "ja", polished: "帳票を修正", zh: "a", ja: "b", en: "c" }), [], (b) => { seen = b; });
    await polishAndTranslate(client, "帳票なおす", "task", "title");
    expect(seen.model).toBe("claude-opus-5-5");
    expect(seen.output_config.effort).toBe("low");
    expect(seen.output_config.format.schema.required).toEqual(["source", "polished", "zh", "ja", "en"]);
    expect(seen.system).toContain("Never add facts");
    expect(seen.system).toContain("Keep person names, company names, product and project names");
    expect(seen.system).toContain("For the source language, return the polished text.");
    expect(seen.messages[0].content).toContain("帳票なおす");
  });

  it("polishing a hand-edited oneliner carries the same style note; other fields' messages do not change", async () => {
    const seen: any[] = [];
    const client = fakeAnthropic(() => ({ source: "ja", polished: "帳票を修正", zh: "a", ja: "b", en: "c" }), [], (b) => { seen.push(b); });
    await polishAndTranslate(client, "帳票なおした", "digest", "oneliner");
    await polishAndTranslate(client, "帳票なおす", "task", "title");
    expect(seen[0].messages[0].content).toBe(`Kind: a one-sentence summary of a work day or week (oneliner).\nStyle: ${ONELINER_STYLE_NOTE}\n<text>\n帳票なおした\n</text>`);
    expect(seen[1].messages[0].content).toBe("Kind: a task (案件) field (title).\n<text>\n帳票なおす\n</text>");
  });

  it("rejects a polish longer than the guard and an empty slot", async () => {
    const long = fakeAnthropic(() => ({ source: "zh", polished: "很".repeat(polishLimit(4) + 1), zh: "x", ja: "y", en: "z" }));
    await expect(polishAndTranslate(long, "写周报", "note", "text")).rejects.toBeInstanceOf(TranslateFormatError);
    const empty = fakeAnthropic(() => ({ source: "zh", polished: "写周报", zh: "写周报", ja: "", en: "z" }));
    await expect(polishAndTranslate(empty, "写周报", "note", "text")).rejects.toBeInstanceOf(TranslateFormatError);
  });

  it("polishLimit is max(2n, n + 40)", () => {
    expect(polishLimit(3)).toBe(43);
    expect(polishLimit(100)).toBe(200);
  });
});
