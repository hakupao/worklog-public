import { describe, expect, it } from "vitest";
import { ONELINER_NAMES, PLAIN, SYSTEM_ONELINER, SYSTEM_WEEK } from "../src/report/digests";

// Step 13 audit (attempt 1 FAIL on length): a full 案件名 alone took most of the 40 字, so the oneliner may shorten
// names — shortened only, never replaced — and its length target is a hard 以内, not 程度.
describe("the oneliner prompts", () => {
  it("allow a short 案件名 (before （ ( ： : or the common name), never another name, as an exception to PLAIN", () => {
    for (const s of ["「（」「(」「：」「:」より前の部分", "通称", "別の名前に置き換えたり新しく作ったりしない"]) expect(ONELINER_NAMES).toContain(s);
    expect(PLAIN).toContain("案件名・人名・製品名はそのまま使う");
    expect(ONELINER_NAMES).toContain("例外");
  });

  it("the local backfill prompt and the week call's oneliner both carry the name rule and the 40 字以内 / 25 語以内 target", () => {
    for (const p of [SYSTEM_ONELINER, SYSTEM_WEEK]) {
      expect(p).toContain(ONELINER_NAMES);
      expect(p).toMatch(/1 文で(書く)?（40 字以内、「■」は付けない）/);
      expect(p).toContain("中国語は 40 字以内、英語は 25 語以内");
      expect(p).not.toContain("40 字程度まで、「■」");
      expect(p.indexOf(ONELINER_NAMES)).toBeLessThan(p.indexOf(PLAIN));   // the exception sits above the rule it overrides
    }
    expect(SYSTEM_ONELINER).not.toContain("案件名・数字は入力のまま");
    expect(SYSTEM_ONELINER).toContain("数字は入力のまま使う");
  });
});
