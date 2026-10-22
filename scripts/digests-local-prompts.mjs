// The prompt parts and pure checks of the local digest generator (plan 2026-10-13-xlsx-range-report, Task 6), shared by
// digests-local.mjs and its tests. Every local prompt ends with the same 案件名の訳 paragraph (NAMES).
export const NAMES = `
入力の末尾に「## 案件名の訳」（ja｜zh｜en）が付く。zh・en の行では、「■ 案件名：」の部分も、案件に触れる他の箇所も、その表の zh・en の名前をそのまま使う（日本語の案件名を残さない）。案件名以外の人名・製品名などは今まで通り原文のまま。`;
// The oneliner's exception (user 10/13, Step 13 audit; the server's ONELINER_NAMES): a full table name alone can take most of
// the 40 字, so the oneliner may shorten it. After NAMES, which it overrides for the oneliner only.
export const NAMES_ONE = NAMES + `
ただし oneliner では、表の名前を短い形にしてよい：「（」「(」「：」「:」より前の部分、またはその案件の通称。短くするだけで、別の名前に置き換えたり新しく作ったりしない。`;
const SHAPE = (j) => `\n出力は JSON のみ（前置き・コードブロック不要）：${j}。`;
const TR = "zh は簡体字中国語、en は英語に、行ごとに同じ数・同じ順で訳す。案件名・人名・製品名・版番号は原文のまま。訳文も同じく平易な言葉で。";
export const LOCAL = SHAPE(`{"lines":[…],"pdf_lines":[…],"zh":{"lines":[…],"pdf_lines":[…]},"en":{"lines":[…],"pdf_lines":[…]}}`) + TR + NAMES;
export const LOCAL_WEEK = SHAPE(`{"lines":[…],"pdf_lines":[…],"oneliner":"…","zh":{"lines":[…],"pdf_lines":[…],"oneliner":"…"},"en":{"lines":[…],"pdf_lines":[…],"oneliner":"…"}}`)
  + TR + "oneliner も同じく訳す（zh は 40 字以内、en は 25 語以内）。" + NAMES_ONE;
export const LOCAL_ONE = SHAPE(`{"oneliner":"…","zh":{"oneliner":"…"},"en":{"oneliner":"…"}}`) + "zh は簡体字中国語、en は英語に訳す（zh は 40 字以内、en は 25 語以内）。" + NAMES_ONE;

const line = (s) => typeof s === "string" && s.trim() !== "" && !s.trim().includes("\n");
export const checkLines = (j) => Array.isArray(j?.lines) && Array.isArray(j?.pdf_lines) && !!j.zh && !!j.en;
export const checkWeek = (j) => checkLines(j) && line(j.oneliner) && line(j.zh?.oneliner) && line(j.en?.oneliner);
export const checkOne = (j) => line(j?.oneliner) && line(j?.zh?.oneliner) && line(j?.en?.oneliner);
/** Over the oneliner's length target (ja / zh 40 code points, en 25 words): a soft check — one more try, never a failure. */
export const onelinerLong = (j) => [j.oneliner, j.zh.oneliner].some((s) => [...s.trim()].length > 40)
  || j.en.oneliner.trim().split(/\s+/).length > 25;
/** Week items whose oneliner is missing (none yet, or dropped by a hand edit of the text), minus the weeks regenerated in
 *  this run (their new line already carries one). */
export const onelinerTodo = (items, regenerated) => items.filter((i) => i.day === "" && i.oneliner_missing && i.text && !regenerated.has(i.day));
export const onelinerBody = (e, model) => ({ oneliner_only: true, source_text: e.source_text, oneliner: e.oneliner.trim(), model: `${model}-local`,
  zh: { oneliner: e.zh.trim() }, en: { oneliner: e.en.trim() } });
