import { describe, expect, it } from "vitest";
import type { Hint } from "../src/api/types";
import { hintLinks, hintText } from "../src/pages/stats/hints";
import { toV2Href } from "../src/pages/stats/hrefs";
import { UNLINKED_HREF } from "../src/predict/rules";
import { FULL } from "./pages/dashboard-fixture";

const h = (id: string, params: Hint["params"], text = "原文", links: Hint["links"] = []): Hint => ({ id, level: "info", text, links, params });

describe("toV2Href", () => {
  it("maps the server's old-page links to v2 addresses; anything else is unchanged", () => {
    expect(toV2Href("#/tasks/T20260901-01")).toBe("#/v2/tasks/T20260901-01");
    expect(toV2Href("#/tasks/a b/c")).toBe("#/v2/tasks/a%20b%2Fc");   // the server does not encode the id
    expect(toV2Href("#/timeline/2026-W40")).toBe("#/v2/timeline/2026-W40");
    expect(toV2Href("#/unlinked")).toBe(UNLINKED_HREF);
    for (const x of ["#/", "#/report", "https://example.com", "#/tasks/", "#/unlinked/x"]) expect(toV2Href(x)).toBe(x);
  });
});

describe("hintText", () => {
  it("zh is the server's own wording, filled from params", () => {
    // the strings server/src/dashboard/hints.ts builds for the same numbers
    const cases: [Hint, string][] = [
      [h("unlinked", { n: 4, hours: 2.5 }), "4 个会话未关联案件（2.5h），不会进入周报的案件工时"],
      [h("done-no-deliverable", { n: 2 }), "2 个已完了的案件没有填写成果物"],
      [h("stale-open", { n: 3, days: 14 }), "3 个 open 案件超过 14 天没有进展"],
      [h("summary-fallback", { n: 1 }), "1 个会话的摘要生成失败，显示的是首句"],
      [h("late-night", { pct: 23 }), "深夜（22–5 时）的工作占 23%"],
      [h("weekend", { pct: 31 }), "周末工作占 31%"],
      [h("costly-session", { n: 2, usd: 100, max: 184 }), "2 个会话的等价费用超过 $100（最高 $184）"],
      [h("subagent-heavy", { n: 5, pct: 80 }), "5 个会话超过 80% 的 token 花在子 agent 上"],
    ];
    for (const [hint, zh] of cases) expect(hintText("zh", hint)).toBe(zh);
    expect(hintText("zh", h("machine-silent", { names: "MAC、WIN", days: 4 }))).toBe("MAC、WIN 已 4 天以上没有新会话");
  });
  it("ja / en use their own templates; English joins machine names with commas", () => {
    expect(hintText("ja", h("weekend", { pct: 31 }))).toBe("週末の作業が 31%");
    expect(hintText("en", h("costly-session", { n: 2, usd: 100, max: 184 }))).toBe("2 session(s) cost over $100 equivalent (max $184)");
    expect(hintText("en", h("machine-silent", { names: "MAC、WIN", days: 4 }))).toBe("No new sessions from MAC, WIN for 4+ days");
    expect(hintText("ja", h("machine-silent", { names: "MAC、WIN", days: 4 }))).toContain("MAC、WIN");
  });
  it("an unknown id, or a missing / non-scalar param, falls back to the server's text", () => {
    expect(hintText("en", FULL.hints[0])).toBe("INFO-HINT");
    expect(hintText("ja", FULL.hints[1])).toBe("WARN-HINT");
    expect(hintText("en", h("stale-open", { n: 3 }, "3 个 open 案件超过 14 天没有进展"))).toBe("3 个 open 案件超过 14 天没有进展");
    expect(hintText("en", h("unlinked", {}, "旧文"))).toBe("旧文");
    expect(hintText("en", { ...h("weekend", {}, "旧文"), params: { pct: { x: 1 } } as never })).toBe("旧文");
    expect(hintText("en", { ...h("weekend", {}, "旧文"), params: undefined as never })).toBe("旧文");   // an old server
    expect(hintText("en", h("toString", {}, "旧文"))).toBe("旧文");   // not an own key of the table
  });
});

describe("hintLinks", () => {
  it("points the links at v2 and words the unlinked one in the page's language (it opens the filter over all weeks)", () => {
    const unlinked = h("unlinked", { n: 1, hours: 1 }, "x", [{ label: "去关联（全部）", href: "#/unlinked" }]);
    expect(hintLinks("en", unlinked)).toEqual([{ label: "Link them", href: UNLINKED_HREF, taskId: null }]);
    expect(hintLinks("zh", unlinked)).toEqual([{ label: "去关联", href: UNLINKED_HREF, taskId: null }]);
    // the server now names the v2 filter itself; worded the same way
    const v2Unlinked = h("unlinked", { n: 1, hours: 1 }, "x", [{ label: "去关联（全部）", href: UNLINKED_HREF }]);
    expect(hintLinks("en", v2Unlinked)).toEqual([{ label: "Link them", href: UNLINKED_HREF, taskId: null }]);
    expect(hintLinks("ja", FULL.hints[0])).toEqual([{ label: "查看周", href: "#/v2/timeline/2026-W39", taskId: null }]);
    expect(hintLinks("zh", h("stale-open", { n: 1, days: 14 }, "x", [{ label: "看板开发", href: "#/tasks/T1" }])))
      .toEqual([{ label: "看板开发", href: "#/v2/tasks/T1", taskId: "T1" }]);
    expect(hintLinks("zh", { ...h("weekend", {}), links: undefined as never })).toEqual([]);
  });

  it("carries each link's own task id (raw, not encoded); a malformed link is dropped without shifting the others", () => {
    const links = [
      { label: "坏的", href: 7 as never },
      null as never,
      { label: "2026-W40", href: "#/timeline/2026-W40" },
      { label: "a b", href: "#/tasks/a b" },
    ];
    expect(hintLinks("zh", h("stale-open", { n: 1, days: 14 }, "x", links))).toEqual([
      { label: "2026-W40", href: "#/v2/timeline/2026-W40", taskId: null },
      { label: "a b", href: "#/v2/tasks/a%20b", taskId: "a b" },
    ]);
  });

  it("reads the server's v2 links as they are: the href unchanged, the task id decoded", () => {
    const links = [
      { label: "2026-W40", href: "#/v2/timeline/2026-W40" },
      { label: "a b", href: "#/v2/tasks/a%20b%2Fc" },
      { label: "坏的", href: "#/v2/tasks/%E0" },
    ];
    expect(hintLinks("zh", h("stale-open", { n: 1, days: 14 }, "x", links))).toEqual([
      { label: "2026-W40", href: "#/v2/timeline/2026-W40", taskId: null },
      { label: "a b", href: "#/v2/tasks/a%20b%2Fc", taskId: "a b/c" },
      { label: "坏的", href: "#/v2/tasks/%E0", taskId: null },
    ]);
  });
});

