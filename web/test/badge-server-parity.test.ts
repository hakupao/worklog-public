import { describe, expect, it } from "vitest";
import { BADGE_OBJECT_NAMES } from "../../server/src/badge/names.gen";
import { fnv1a as serverFnv, PALETTE_SIZE } from "../../server/src/badge/alloc";
import { LINE_PALETTE as SERVER_PALETTE, hashLineColor as serverHash, inkOf as serverInk } from "../../server/src/badge/palette";
import { BADGE_OBJECTS } from "../src/badge/objects";
import { fnv1a } from "../src/badge/rng";
import { LINE_PALETTE, hashLineColor, inkOf } from "../src/ui/palette";

describe("server badge data matches the web", () => {
  it("lists the same objects in the same order (re-run node web/scripts/badge-objects.mjs if not)", () => {
    expect([...BADGE_OBJECT_NAMES]).toEqual([...BADGE_OBJECTS]);
  });
  it("hashes the same way", () => {
    for (const s of ["", "T20261014-01", "T20261014-01|obj", "案件|color", "😀", "😁"]) expect(serverFnv(s)).toBe(fnv1a(s));
  });
  it("has the same palette size", () => { expect(PALETTE_SIZE).toBe(LINE_PALETTE.length); });
  it("has the same palette, hash colour and paper ink (the range xlsx's 案件 colours)", () => {
    expect([...SERVER_PALETTE]).toEqual([...LINE_PALETTE]);
    for (const id of ["", "T20261014-01", "T20260901-03", "案件", "😀"]) expect(serverHash(id)).toBe(hashLineColor(id));
    for (const c of [...LINE_PALETTE, "#000000", "#ffffff"]) expect(serverInk(c)).toBe(inkOf(c));
  });
});
