import { describe, expect, it } from "vitest";
import { overview, requesterStats, timeStats } from "../src/dashboard/stats";
import { counts, input, note, sess, task, tokens } from "./dashboard-fixtures";

const W39 = { from: "2026-09-21", to: "2026-09-27" };

// T1 has two 依頼元, so everything linked to it is split in half between A and B.
const i = input({
  tasks: [task("T1", { requester: "A、B" }), task("T2", { requester: "B" })],
  sessions: [
    sess("a", "2026-09-22T01:00:00Z", { task_id: "T1", minutes: 60, tokens: tokens({
      by_model: { opus: counts({ input: 600, output: 400 }) }, cost_usd: 2,
    }) }),
    sess("b", "2026-09-22T03:00:00Z", { task_id: "T2", minutes: 30, tokens: tokens({
      by_model: { opus: counts({ input: 100 }) }, cost_usd: 1,
    }) }),
    sess("c", "2026-09-23T01:00:00Z", { task_id: null, minutes: 20, tokens: tokens({
      by_model: { gpt: counts({ output: 50 }) }, cost_usd: null,
    }) }),
    sess("d", "2026-09-23T02:00:00Z", { task_id: "T2", minutes: 10 }),          // tokens never collected
    sess("h", "2026-09-23T03:00:00Z", { task_id: "T1", minutes: 999, hidden: true }),
    sess("o", "2026-09-10T03:00:00Z", { task_id: "T1", minutes: 999 }),          // outside the range
  ],
  notes: [
    note("n1", "2026-09-24T09:00:00", { task_id: "T1", minutes: 10 }),
    note("n2", "2026-09-24T10:00:00", { task_id: null, minutes: 5 }),
  ],
});

describe("requesterStats", () => {
  const r = requesterStats(i, W39);

  it("splits a multi-requester task evenly and files unlinked work under 未关联", () => {
    expect(r.map((x) => [x.requester, x.minutes, x.tokens])).toEqual([
      ["B", 30 + 30 + 10 + 5, 500 + 100],  // half of a, all of b and d, half of n1
      ["A", 30 + 5, 500],                  // half of a and n1
      ["未关联", 20 + 5, 50],              // c and n2
    ]);
  });

  it("marks a requester partial when a session had no tokens or no price", () => {
    const by = Object.fromEntries(r.map((x) => [x.requester, x]));
    expect(by.A).toMatchObject({ cost_usd: 1, cost_partial: false });
    expect(by.B).toMatchObject({ cost_usd: 2, cost_partial: true });          // d was never collected
    expect(by["未关联"]).toMatchObject({ cost_usd: 0, cost_partial: true });  // c has no price
  });

  it("adds up to the overview totals within rounding, thirds included", () => {
    const o = overview(i, W39);
    expect(r.reduce((s, x) => s + x.minutes, 0)).toBeCloseTo(o.minutes, 6);
    expect(r.reduce((s, x) => s + x.tokens, 0)).toBeCloseTo(o.tokens, 6);

    const three = input({
      tasks: [task("T3", { requester: "X、Y、Z" })],
      sessions: [sess("s", "2026-09-22T01:00:00Z", { task_id: "T3", minutes: 7, tokens: tokens({
        by_model: { opus: counts({ input: 100 }) }, cost_usd: 1,
      }) })],
    });
    const rows = requesterStats(three, W39);
    expect(rows.map((x) => [x.requester, x.minutes, x.tokens])).toEqual([
      ["X", 2.33, 33.33], ["Y", 2.33, 33.33], ["Z", 2.33, 33.33],
    ]);
    expect(rows.reduce((s, x) => s + x.minutes, 0)).toBeCloseTo(7, 1);
  });

  it("files a task with a blank requester under （无依頼元）", () => {
    const blank = input({
      tasks: [task("T0", { requester: " 、 " })],
      sessions: [sess("s", "2026-09-22T01:00:00Z", { task_id: "T0", minutes: 5 })],
    });
    expect(requesterStats(blank, W39).map((x) => x.requester)).toEqual(["（无依頼元）"]);
  });

  it("is empty when nothing happened", () => {
    expect(requesterStats(input(), W39)).toEqual([]);
  });
});

describe("timeStats.by_requester", () => {
  it("uses the same even split, so both requester views agree", () => {
    expect(timeStats(i, W39).by_requester).toEqual([{ key: "B", minutes: 75 }, { key: "A", minutes: 35 }]);
  });
});
