import test from "node:test";
import assert from "node:assert/strict";
import { keepOtherInPdf } from "./digests-pdf-other.mjs";

const mk = () => ({ lines: ["■ A：x", "■ その他：y"], pdf_lines: ["■ A：x"],
  zh: { lines: ["a", "其他"], pdf_lines: ["a"] }, en: { lines: ["a", "Other"], pdf_lines: ["a"] } });

test("appends the その他 line to ja / zh / en pdf_lines", () => {
  const j = mk(); assert.equal(keepOtherInPdf(j), true);
  assert.deepEqual(j.pdf_lines, ["■ A：x", "■ その他：y"]);
  assert.deepEqual(j.zh.pdf_lines, ["a", "其他"]); assert.deepEqual(j.en.pdf_lines, ["a", "Other"]);
});
test("zh length mismatch: only ja and the matching en are touched", () => {
  const j = mk(); j.zh.lines.push("extra"); keepOtherInPdf(j);
  assert.equal(j.pdf_lines.length, 2); assert.deepEqual(j.zh.pdf_lines, ["a"]); assert.equal(j.en.pdf_lines.length, 2);
});
test("no-op when pdf_lines already has it, or lines has none", () => {
  const a = mk(); a.pdf_lines.push("■ その他：z"); assert.equal(keepOtherInPdf(a), false); assert.equal(a.pdf_lines.length, 2);
  const b = mk(); b.lines.pop(); assert.equal(keepOtherInPdf(b), false);
});
