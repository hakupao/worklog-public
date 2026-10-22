import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { localize, localizeSessions, localizeTaskRefs } from "../src/i18n/store";
import { resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const putTr = (entity: string, id: string, field: string, source: string, zh: string, ja: string, en: string) =>
  db().prepare(
    `INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'ja', ?5, ?6, ?7, 'm', 'now')`,
  ).bind(entity, id, field, source, zh, ja, en).run();

describe("i18n store", () => {
  beforeEach(resetDb);

  it("replaces a field with the fresh translation for the language", async () => {
    await putTr("task", "T1", "title", "帳票修正", "报表修改", "帳票修正", "Report fix");
    const rows = [{ id: "T1", title: "帳票修正", project: "p" }];
    expect(await localize(db(), "zh", "task", rows, ["title", "project"])).toEqual([{ id: "T1", title: "报表修改", project: "p" }]);
    expect(rows[0].title).toBe("帳票修正"); // input untouched
  });

  it("keeps the source when the translation is stale, missing, or lang is null", async () => {
    await putTr("task", "T1", "title", "旧タイトル", "旧标题", "旧タイトル", "Old");
    const rows = [{ id: "T1", title: "新タイトル" }, { id: "T2", title: "未翻訳" }];
    expect(await localize(db(), "en", "task", rows, ["title"])).toEqual(rows);
    expect(await localize(db(), null, "task", [{ id: "T1", title: "旧タイトル" }], ["title"])).toEqual([{ id: "T1", title: "旧タイトル" }]);
  });

  it("localizes a session's effective summary into whichever column carries it", async () => {
    await putTr("session", "S1", "summary", "手直し", "手改", "手直し", "Hand edit");
    await putTr("session", "S2", "summary", "収集", "采集", "収集", "Collected");
    const out = await localizeSessions(db(), "en", [
      { id: "S1", summary: "収集文", summary_edited: "手直し" },
      { id: "S2", summary: "収集", summary_edited: null },
    ]);
    expect(out.map((r) => [r.summary, r.summary_edited])).toEqual([["収集文", "Hand edit"], ["Collected", null]]);
  });

  it("localizes linked task titles", async () => {
    await putTr("task", "T1", "title", "帳票", "报表", "帳票", "Report");
    expect(await localizeTaskRefs(db(), "zh", [{ id: "T1", title: "帳票", status: "open" }])).toEqual([{ id: "T1", title: "报表", status: "open" }]);
  });
});
