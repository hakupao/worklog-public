import { describe, expect, it } from "vitest";
import { buildScene } from "../src/badge/scene";
import { omoteSvg } from "../src/badge/omote";
import { uraSvg, type Sampler } from "../src/badge/ura";
import { fnv1a } from "../src/badge/rng";
import type { Level } from "../src/badge/lod";
import { LINE_PALETTE } from "../src/ui/palette";

// Golden digests of the signed-off badge look (G0 passed). Only obj+color are stored; landscape, season, hero
// placement and materials all derive from the task id, so a silent constant change would redraw every live badge.
// These digests change ONLY when the look intentionally changes: update them in the same commit, with a G0 /
// visual sign-off note in the message.
const IDS = ["T20261001-01", "T20260116-02", "T20260704-03", "legacy-7"];
const LEVELS: Level[] = ["S", "M", "L"];
const OBJS = ["phosphor:cat", "fluent:panda"];
const COLOR = LINE_PALETTE[1];
// same fake as badge-ura.test.ts
const fake: Sampler = (x, y) => (x > 80 && x < 110 && y > 30 && y < 70 ? "hero" : y > 80 ? "bg" : y < 20 ? "acc" : null);

const h = (s: string) => fnv1a(s).toString(16).padStart(8, "0");

/** "id|obj|level" -> [scene, omote, ura (no canvas), ura (fake sampler)] */
const GOLDEN: Record<string, [string, string, string, string]> = {
  "legacy-7|fluent:panda|L": ["4eda42b5","9c5502a3","d1275f86","6d2529cb"],
  "legacy-7|fluent:panda|M": ["396cb870","72f0e42d","93ddb972","a9c3a8b1"],
  "legacy-7|fluent:panda|S": ["cbc9be7f","fc61c9e4","611d3f15","10c09c08"],
  "legacy-7|phosphor:cat|L": ["e091677a","7415253b","91d4800a","6d2529cb"],
  "legacy-7|phosphor:cat|M": ["d5b5a081","1f0066a9","3a7d02be","a9c3a8b1"],
  "legacy-7|phosphor:cat|S": ["44bcd320","64e8425c","b64f9079","10c09c08"],
  "T20260116-02|fluent:panda|L": ["2d7146da","1c724050","0cf5cb73","b8ed9b7e"],
  "T20260116-02|fluent:panda|M": ["5d582573","fece415c","81bd8e4d","4e642b44"],
  "T20260116-02|fluent:panda|S": ["e5878c22","658e127b","a214c291","10c09c08"],
  "T20260116-02|phosphor:cat|L": ["40f0ca41","46dfa54c","65733a0b","b8ed9b7e"],
  "T20260116-02|phosphor:cat|M": ["480453ae","8a004bd4","20c9a5b9","4e642b44"],
  "T20260116-02|phosphor:cat|S": ["5e073555","8ceca7cf","39c8c7fd","10c09c08"],
  "T20260704-03|fluent:panda|L": ["82dab2d7","d45065a5","5ca46b28","f5950719"],
  "T20260704-03|fluent:panda|M": ["581f60f4","66d9bf55","3bc3593a","430991ef"],
  "T20260704-03|fluent:panda|S": ["00396a79","05ea67c4","a214c291","10c09c08"],
  "T20260704-03|phosphor:cat|L": ["764bb4d6","307be0c5","aa13afdc","f5950719"],
  "T20260704-03|phosphor:cat|M": ["f8e2311f","9b7734d1","b2fe189a","430991ef"],
  "T20260704-03|phosphor:cat|S": ["9663b018","fd08983c","39c8c7fd","10c09c08"],
  "T20261001-01|fluent:panda|L": ["f919f9e5","450375ce","d83a5c51","ea714ce9"],
  "T20261001-01|fluent:panda|M": ["2fd5fea6","1b18632d","2b44efea","39e44bbf"],
  "T20261001-01|fluent:panda|S": ["3875b4d4","129773e3","a214c291","10c09c08"],
  "T20261001-01|phosphor:cat|L": ["ad7fb274","daec37a2","68fef555","ea714ce9"],
  "T20261001-01|phosphor:cat|M": ["06ac2775","27c9dda9","98c9fc0a","39e44bbf"],
  "T20261001-01|phosphor:cat|S": ["ed03ca7f","cac62437","39c8c7fd","10c09c08"],
};

function digests(id: string, obj: string, level: Level): [string, string, string, string] {
  const scene = buildScene(id, obj, level);
  return [
    h(JSON.stringify(scene)),
    h(omoteSvg(scene, COLOR, level, id, "g")),
    h(uraSvg(scene, COLOR, level, id, "g", null)),
    h(uraSvg(scene, COLOR, level, id, "g", fake)),
  ];
}

describe("badge golden digests (change only with an intentional, signed-off look change)", () => {
  for (const id of IDS) for (const obj of OBJS) for (const level of LEVELS) {
    const key = `${id}|${obj}|${level}`;
    it(key, () => {
      // regenerate: GOLDEN_PRINT=1 npx vitest run test/badge-golden.test.ts, then paste the printed rows
      if (process.env.GOLDEN_PRINT) console.log(`  "${key}": ${JSON.stringify(digests(id, obj, level))},`);
      expect(digests(id, obj, level)).toEqual(GOLDEN[key]);
    });
  }
});
