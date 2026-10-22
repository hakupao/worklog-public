import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL, LOCAL_ONE, LOCAL_WEEK, NAMES, NAMES_ONE, checkLines, checkOne, checkWeek, onelinerBody, onelinerLong, onelinerTodo } from "./digests-local-prompts.mjs";

const week = { lines: ["■ A：x"], pdf_lines: ["■ A：x"], oneliner: "A を進めた",
  zh: { lines: ["a"], pdf_lines: ["a"], oneliner: "推进了 A" }, en: { lines: ["a"], pdf_lines: ["a"], oneliner: "Moved A on" } };
test("the three local prompts share one 案件名の訳 paragraph; the two with a oneliner add its short-name exception after it", () => {
  assert.ok(LOCAL.endsWith(NAMES));
  for (const p of [LOCAL_WEEK, LOCAL_ONE]) assert.ok(p.endsWith(NAMES_ONE) && NAMES_ONE.startsWith(NAMES));
  assert.ok(LOCAL_WEEK.includes('"oneliner"') && !LOCAL.includes('"oneliner"'));
});
test("the oneliner's zh / en may shorten the table names (shortened only, never replaced) within 40 字 / 25 words", () => {
  for (const s of ["「（」「(」「：」「:」より前の部分", "通称", "別の名前に置き換えたり新しく作ったりしない"]) assert.ok(NAMES_ONE.includes(s), s);
  for (const p of [LOCAL_WEEK, LOCAL_ONE]) assert.ok(p.includes("zh は 40 字以内、en は 25 語以内"), p);
  assert.ok(!LOCAL_ONE.includes("25 語程度") && !LOCAL_WEEK.includes("25 語程度"));
});
test("onelinerLong: ja or zh over 40 code points, or en over 25 words", () => {
  const one = (ja, zh, en) => ({ oneliner: ja, zh: { oneliner: zh }, en: { oneliner: en } });
  const w = (n) => Array.from({ length: n }, () => "w").join(" ");
  assert.equal(onelinerLong(one("あ".repeat(40), "中".repeat(40), w(25))), false);
  assert.equal(onelinerLong(one("あ".repeat(41), "中", w(1))), true);
  assert.equal(onelinerLong(one("あ", "中".repeat(41), w(1))), true);
  assert.equal(onelinerLong(one("あ", "中", w(26))), true);
  assert.equal(onelinerLong(one(" " + "𠀋".repeat(40) + " ", "中", " a  b ")), false);   // code points, trimmed; spaces split words
});
test("checkLines is today's check", () => {
  assert.equal(checkLines({ lines: [], pdf_lines: [], zh: {}, en: {} }), true);
  assert.equal(checkLines({ lines: [], pdf_lines: [] }), false);
});
test("checkWeek accepts a week reply with oneliner in ja / zh / en, rejects one without", () => {
  assert.equal(checkWeek(week), true);
  assert.equal(checkWeek({ ...week, oneliner: "" }), false);
  assert.equal(checkWeek({ ...week, en: { ...week.en, oneliner: undefined } }), false);
});
test("checkOne wants three non-empty one-line strings", () => {
  assert.equal(checkOne({ oneliner: "x", zh: { oneliner: "y" }, en: { oneliner: "z" } }), true);
  assert.equal(checkOne({ oneliner: "x\ny", zh: { oneliner: "y" }, en: { oneliner: "z" } }), false);
});
test("onelinerTodo selects week items with oneliner_missing and a text, minus weeks regenerated in this run", () => {
  const items = [{ day: "2026-09-28", oneliner_missing: false, text: "d" }, { day: "", oneliner_missing: true, text: "本文" }];
  assert.deepEqual(onelinerTodo(items, new Set()).map((i) => i.day), [""]);
  assert.deepEqual(onelinerTodo(items, new Set([""])), []);
  assert.deepEqual(onelinerTodo([{ day: "", oneliner_missing: true, text: null }], new Set()), []);
});
test("onelinerBody: the oneliner_only PUT body, trimmed", () => {
  assert.deepEqual(onelinerBody({ week: "2026-W40", source_text: "t", oneliner: " x ", zh: " y ", en: " z " }, "opus"), {
    oneliner_only: true, source_text: "t", oneliner: "x", model: "opus-local", zh: { oneliner: "y" }, en: { oneliner: "z" } });
});
