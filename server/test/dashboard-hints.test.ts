import { describe, expect, it } from "vitest";
import { buildDashboard } from "../src/dashboard/build";
import { buildHints, THRESHOLDS } from "../src/dashboard/hints";
import { rhythmStats } from "../src/dashboard/stats";
import type { DashInput } from "../src/dashboard/types";
import { counts, input, note, sess, task, tokens } from "./dashboard-fixtures";

const W39 = { from: "2026-09-21", to: "2026-09-27" };
const NOW = new Date("2026-09-29T03:00:00Z");   // 2026-09-29 12:00 JST
const hints = (i: DashInput) => buildHints(i, W39, rhythmStats(i, W39), NOW);
const ids = (i: DashInput) => hints(i).map((h) => h.id);

describe("buildHints", () => {
  it("is empty for a clean record", () => {
    expect(hints(input())).toEqual([]);
  });

  it("flags unlinked sessions with a link to the 未关联 list", () => {
    const h = hints(input({ sessions: [sess("a", "2026-09-22T01:00:00Z"), sess("b", "2026-09-23T01:00:00Z")] }));
    expect(h[0]).toMatchObject({ id: "unlinked", level: "warn", links: [{ label: "去关联（全部）", href: "#/v2/timeline?unlinked=1" }] });
    expect(h[0].text).toContain("2 个会话");
  });

  it("flags open tasks without activity for more than the threshold", () => {
    const i = input({ tasks: [
      task("OLD", { received_at: "2026-09-01" }),
      task("FRESH", { received_at: "2026-09-01" }),
      task("NOTED", { received_at: "2026-09-01" }),
    ], sessions: [sess("s", "2026-09-25T01:00:00Z", { task_id: "FRESH" })],
       notes: [note("n", "2026-09-26T10:00:00", { task_id: "NOTED" })] });
    const h = hints(i).find((x) => x.id === "stale-open")!;
    expect(h.links).toEqual([{ label: "t OLD", href: "#/v2/tasks/OLD" }]);
    expect(THRESHOLDS.staleOpenDays).toBe(14);
  });

  it("flags done tasks without deliverables and tasks with unpicked document candidates", () => {
    const i = input({
      tasks: [
        task("D", { status: "done", done_at: "2026-09-20" }),
        task("C", { deliverables: ["docs/spec.md"] }),
        task("OK", { deliverables: ["spec.md"] }),
      ],
      sessions: [
        sess("c", "2026-09-10T01:00:00Z", { task_id: "C", files_written: ["/r/docs/spec.md", "/r/out/report.xlsx", "/r/src/a.py"] }),
        sess("ok", "2026-09-10T01:00:00Z", { task_id: "OK", files_written: ["/r/spec.md", "/r/.omc/plans/x.md"] }),
      ],
    });
    expect(hints(i).find((x) => x.id === "done-no-deliverable")!.links).toEqual([{ label: "t D", href: "#/v2/tasks/D" }]);
    // Unpicked candidates are no longer a hint: 成果物 are derived automatically (deliverables/derive.ts).
    expect(hints(i).find((x) => x.id === "candidates-pending")).toBeUndefined();
  });

  it("flags fallback summaries, silent machines, late-night and weekend work", () => {
    const i = input({
      tasks: [task("T")],
      sessions: [
        sess("f", "2026-09-22T14:00:00Z", { task_id: "T", summary_source: "fallback", minutes: 60 }),  // Tue 23:00
        sess("w", "2026-09-26T01:00:00Z", { task_id: "T", minutes: 60 }),                               // Sat
      ],
      machines: [{ name: "win11", last_seen_at: "2026-09-25T00:00:00Z" }, { name: "macmini", last_seen_at: "2026-09-29T02:00:00Z" }],
    });
    expect(ids(i)).toEqual(["machine-silent", "summary-fallback", "late-night", "weekend"]);
    expect(hints(i)[0].text).toContain("win11");
    expect(hints(i)[2].text).toBe("深夜（22–5 时）的工作占 50%");
  });

  it("flags costly and subagent-heavy sessions", () => {
    const heavy = tokens({
      by_model: { m: counts({ cache_read: 20_000_000 }) }, subagent: { m: counts({ cache_read: 19_000_000 }) }, cost_usd: 150,
    });
    const i = input({ tasks: [task("T")], sessions: [sess("x", "2026-09-22T01:00:00Z", { task_id: "T", tokens: heavy })] });
    expect(ids(i)).toEqual(["costly-session", "subagent-heavy"]);
    expect(hints(i)[0].text).toContain("$150");
    expect(hints(i)[0].links).toEqual([{ label: "2026-W39", href: "#/v2/timeline/2026-W39" }]);
  });

  it("links a 案件 by its v2 address with the id encoded", () => {
    const i = input({ tasks: [task("a b/c", { received_at: "2026-09-01" })] });
    expect(hints(i).find((x) => x.id === "stale-open")!.links).toEqual([{ label: "t a b/c", href: "#/v2/tasks/a%20b%2Fc" }]);
  });

  it("carries the fixed params of every hint id", () => {
    const heavy = tokens({
      by_model: { m: counts({ cache_read: 20_000_000 }) }, subagent: { m: counts({ cache_read: 19_000_000 }) }, cost_usd: 150.6,
    });
    const i = input({
      tasks: [
        task("T"),
        task("D", { status: "done", done_at: "2026-09-20" }),
        task("OLD", { received_at: "2026-09-01" }),
        task("C", { received_at: "2026-09-20" }),
      ],
      sessions: [
        sess("u1", "2026-09-22T01:00:00Z", { minutes: 45 }),
        sess("u2", "2026-09-23T01:00:00Z", { minutes: 50 }),
        sess("f", "2026-09-22T14:00:00Z", { task_id: "T", summary_source: "fallback", minutes: 60 }),  // Tue 23:00
        sess("w", "2026-09-26T01:00:00Z", { task_id: "T", minutes: 60 }),                               // Sat
        sess("x", "2026-09-24T01:00:00Z", { task_id: "T", minutes: 30, tokens: heavy }),
        sess("c", "2026-09-24T02:00:00Z", { task_id: "C", minutes: 30, files_written: ["/r/out/report.xlsx"] }),
      ],
      machines: [
        { name: "win11", last_seen_at: "2026-09-25T00:00:00Z" },
        { name: "macbook", last_seen_at: "2026-09-20T00:00:00Z" },
        { name: "macmini", last_seen_at: "2026-09-29T02:00:00Z" },
      ],
    });
    const params = Object.fromEntries(hints(i).map((h) => [h.id, h.params]));
    expect(params).toEqual({
      "unlinked": { n: 2, hours: 1.6 },
      "done-no-deliverable": { n: 1 },
      "machine-silent": { names: "win11、macbook", days: 4 },
      "stale-open": { n: 1, days: 14 },
      "summary-fallback": { n: 1 },
      "late-night": { pct: 22 },
      "weekend": { pct: 22 },
      "costly-session": { n: 1, usd: 100, max: 151 },
      "subagent-heavy": { n: 1, pct: 80 },
    });
  });

  it("keeps the Chinese text alongside the params", () => {
    const h = hints(input({ sessions: [sess("a", "2026-09-22T01:00:00Z")] }));
    expect(h[0].text).toBe("1 个会话未关联案件（1h），不会进入周报的案件工时");
  });

  it("caps links at three", () => {
    const tasks = Array.from({ length: 5 }, (_, k) => task(`T${k}`, { status: "done", done_at: "2026-09-20" }));
    expect(hints(input({ tasks }))[0].links).toHaveLength(3);
  });
});

describe("buildDashboard", () => {
  it("assembles every section with the previous-period overview", () => {
    const d = buildDashboard(input({ sessions: [sess("p", "2026-09-15T01:00:00Z", { task_id: null })] }),
      W39, { from: "2026-09-14", to: "2026-09-20" }, NOW);
    expect(d.range).toEqual(W39);
    expect(d.overview.minutes).toBe(0);
    expect(d.overview_prev.minutes).toBe(60);
    expect(Object.keys(d).sort()).toEqual(
      ["ai", "hints", "output", "overview", "overview_prev", "prev_range", "range", "requesters", "rhythm", "time"]);
  });
});
