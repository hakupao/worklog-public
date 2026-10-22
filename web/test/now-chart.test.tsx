import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bitmap } from "../src/led/bits";
import { OMOTE_UNIT, PITCH } from "../src/led/lattice";
import { BOT, chartHeight, coverage, drawOmote, drawUra, geometry, hitTest, layoutChart, ROW_MIN, TOP } from "../src/pages/now/chart";
import { RunChart } from "../src/pages/now/RunChart";
import { Shell } from "../src/ui/Shell";
import { J, session, task } from "../src/predict/fixtures";
import { scenarioInput } from "../src/predict/scenarios";
import { buildSnapshot } from "../src/predict/snapshot";
import { rec } from "./canvas-rec";
import { V2TestProvider } from "./helpers";

const T = (s: string) => Date.parse(J(s));
const day = () => buildSnapshot(scenarioInput("day"), 10);
const noBits = (): Bitmap => ({ w: 0, h: 8, on: new Uint8Array(0) });
const empty = (now: string, sessions = [] as ReturnType<typeof session>[]) =>
  buildSnapshot({ now: T(now), machines: [], sessions, tasks: [], planItems: [], dayPlan: null, downloads: [] }, 10);

describe("chart geometry", () => {
  it("coverage: each 5-minute dot holds the share of it that was active", () => {
    const c = coverage([[T("2026-10-02 10:02"), T("2026-10-02 10:13")]], T("2026-10-02 10:00"), 4);
    expect([...c].map((v) => Math.round(v * 10) / 10)).toEqual([0.6, 1, 0.6, 0]);
  });
  it("layout of the 14:20 scenario: 9–21, tracks in first-start order", () => {
    const L = layoutChart(day());
    expect([L.h0, L.h1, L.nowMin]).toEqual([9, 21, 14 * 60 + 20]);
    expect(L.machines).toEqual(["macmini", "win11"]);
    expect(L.tracks.map((t) => [t.taskId, t.running, t.runningOn, t.minutes])).toEqual([
      ["T20260918-02", true, ["macmini"], 150],
      ["T20260929-01", false, [], 90],
      [null, false, [], 30],
      ["T20261001-01", true, ["win11"], 10],
    ]);
  });
  it("only today's part of a cross-midnight session; the axis widens to midnight", () => {
    const L = layoutChart(empty("2026-10-02 08:00", [session("X", "2026-10-01 23:30", "2026-10-02 00:20")]));
    expect([L.h0, L.tracks[0].minutes]).toEqual([0, 20]);
    expect(geometry(L, 1000, chartHeight(L), PITCH).cov[0][0][0]).toBeCloseTo(1);      // the first dot (00:00–00:04) fully active
  });
  it("no sessions: no tracks", () => {
    expect(layoutChart(empty("2026-10-05 09:00")).tracks).toEqual([]);
  });
  it("the dot count comes from the width: pitch stays PITCH, each dot holds (h1 − h0) h / ndot", () => {
    const L = layoutChart(day()), g = geometry(L, 600, chartHeight(L), PITCH), ndot = Math.floor((600 - 24) / PITCH);
    expect([g.pitch, g.ndot]).toEqual([PITCH, ndot]);
    expect(g.minPerDot).toBe(((L.h1 - L.h0) * 60) / ndot);
    expect(g.nowIdx).toBe(Math.floor((14 * 60 + 20 - 9 * 60) / g.minPerDot));
    expect(g.cov).toHaveLength(L.tracks.length);
    expect(g.cov[0].map((c) => c.length)).toEqual([ndot, ndot]);
  });
  it("rows flex with the height: (h − TOP − BOT) / tracks, between ROW_MIN and 40 (prototype: rowH = room / tracks)", () => {
    expect([TOP, BOT]).toEqual([24, 20]);
    const withTracks = (n: number) => layoutChart(buildSnapshot({
      now: T("2026-10-02 18:00"), machines: [], planItems: [], dayPlan: null, downloads: [],
      tasks: Array.from({ length: n }, (_, i) => task(`T${i}`, `task ${i}`)),
      sessions: Array.from({ length: n }, (_, i) => session(`S${i}`, "2026-10-02 09:00", "2026-10-02 10:00", { task_id: `T${i}` })),
    }, 10));
    const L8 = withTracks(8);
    expect(L8.tracks).toHaveLength(8);
    expect(geometry(L8, 600, 228, PITCH).rowH).toBe(23);                  // (228 − 44) / 8
    expect(geometry(withTracks(2), 600, 600, PITCH).rowH).toBe(40);       // capped
    expect(geometry(withTracks(20), 600, 228, PITCH).rowH).toBe(ROW_MIN);  // floored: the body scrolls
    expect(ROW_MIN).toBeGreaterThanOrEqual(21);                     // a dense 8px CJK label lights 7 rows × 3px (T10 F2)
    expect(chartHeight(L8, 23)).toBe(228);
    const g = geometry(L8, 600, 228, PITCH);
    expect(hitTest(L8, g, g.dotX(10), g.rowY(5, 0))?.track.taskId).toBe("T5");
  });
  it("dot centres stay on the PITCH lattice", () => {
    const L = layoutChart(day()), g = geometry(L, 913, chartHeight(L), PITCH, 1, 2);
    for (let i = 0; i < g.ndot; i += 17) expect(((g.dotX(i) - 1) % PITCH + PITCH) % PITCH).toBe(0);
  });
  it("a day that starts before 9:00 (06–21) still fills the chart width", () => {
    const L = layoutChart(empty("2026-10-02 10:00", [session("E", "2026-10-02 06:10", "2026-10-02 06:40")]));
    expect(L.h0).toBe(6);
    for (const w of [600, 1000, 1100, 1480]) {
      const g = geometry(L, w, chartHeight(L), PITCH), span = g.dotX(g.ndot - 1) + g.pitch / 2 - g.dotX(0) + g.pitch / 2;
      expect(span / (w - 24)).toBeGreaterThanOrEqual(0.97);
      expect(g.dotX(g.ndot - 1) + g.pitch / 2).toBeLessThanOrEqual(w);
    }
  });
  it("hitTest finds the session under the pointer, nothing above the rows", () => {
    const L = layoutChart(day()), g = geometry(L, 1000, chartHeight(L), PITCH);
    const x = g.dotX((10 * 60 - L.h0 * 60) / g.minPerDot), y = g.rowY(0, 0);   // 10:00 on the WL / macmini row
    expect(hitTest(L, g, x, y)?.session?.id).toBe("S4");
    expect(hitTest(L, g, x, TOP - 1)).toBeNull();
    expect(hitTest(L, g, x, TOP + g.rowH * L.tracks.length + 1)).toBeNull();
  });
});

describe("drawing never shows the future", () => {
  it("里: no lit dot right of now", () => {
    const L = layoutChart(day()), g = geometry(L, 1000, chartHeight(L), PITCH), { ctx, calls } = rec();
    drawUra(ctx, L, g, null, noBits);
    const litDots = calls.filter((c) => c.op === "arc" && c.fill.startsWith("#"));
    expect(litDots.length).toBeGreaterThan(0);
    expect(Math.max(...litDots.map((c) => c.args[0] as number))).toBeLessThanOrEqual(g.dotX(g.nowIdx) + 0.001);
  });
  it("表: no bar extends right of now", () => {
    const L = layoutChart(day()), g = geometry(L, 1000, chartHeight(L), OMOTE_UNIT), { ctx, calls } = rec();
    drawOmote(ctx, L, g, null);
    const bars = calls.filter((c) => c.op === "fillRect" && c.args[3] === 8);
    expect(bars.length).toBeGreaterThan(0);
    expect(Math.max(...bars.map((c) => (c.args[0] as number) + (c.args[2] as number)))).toBeLessThanOrEqual(g.dotX(g.nowIdx) + g.pitch / 2);
  });
  it("表: hour ticks sit at the stretched axis (no 5-min-per-dot assumption)", () => {
    const L = layoutChart(day()), g = geometry(L, 913, chartHeight(L), OMOTE_UNIT), { ctx, calls } = rec();
    drawOmote(ctx, L, g, null);
    const at = (s: string) => calls.find((c) => c.op === "fillText" && c.args[0] === s)!.args[1] as number;
    expect(at("15")).toBe(Math.round(g.dotX((6 * 60) / g.minPerDot) - g.pitch / 2));
    expect(g.dotX(g.ndot) - g.pitch / 2).toBeGreaterThanOrEqual(913 - 12 - 3);     // the last hour ends at the last dot's edge
    expect(at("21") + (6 * 2) / 2).toBeLessThanOrEqual(913);                      // …and its label stays on the canvas (rec: 6px a char)
  });
  it("表: ECG-paper double grid behind the bars — bold every hour, fine every quarter, the same squares run vertically", () => {
    const L = layoutChart(day()), g = geometry(L, 913, chartHeight(L), OMOTE_UNIT), { ctx, calls } = rec();
    drawOmote(ctx, L, g, null);
    const v = calls.filter((c) => c.op === "fillRect" && c.args[2] === 1 && /^rgba\(184,50,42,/.test(c.fill));
    const h = calls.filter((c) => c.op === "fillRect" && c.args[3] === 1 && /^rgba\(184,50,42,/.test(c.fill));
    const quarters = (L.h1 - L.h0) * 4 + 1;
    expect(v).toHaveLength(quarters);
    expect(v.filter((c) => c.fill === "rgba(184,50,42,.30)")).toHaveLength(L.h1 - L.h0 + 1);
    expect(h.length).toBeGreaterThan(1);
    expect(h.filter((c) => c.fill === "rgba(184,50,42,.24)").length).toBeGreaterThan(0);
    // the grid is drawn before the first bar
    const firstBar = calls.findIndex((c) => c.op === "fillRect" && c.args[3] === 8);
    expect(calls.indexOf(v[v.length - 1])).toBeLessThan(firstBar);
    expect(calls.indexOf(h[h.length - 1])).toBeLessThan(firstBar);
  });
  it("里: quarter-hour ticks, 4 per hour across the stretched axis", () => {
    const L = layoutChart(day()), g = geometry(L, 913, chartHeight(L), PITCH), { ctx, calls } = rec();
    drawUra(ctx, L, g, null, noBits);
    const ticks = calls.filter((c) => c.op === "arc" && c.args[1] === g.h - BOT + 8 && /^rgba\((255,173,58,\.28|255,236,214,\.08)\)$/.test(c.fill));
    expect(ticks).toHaveLength((L.h1 - L.h0) * 4);
  });
  it("hover lifts one track and dims the rest", () => {
    const L = layoutChart(day()), g = geometry(L, 1000, chartHeight(L), PITCH), a = rec(), b = rec();
    drawUra(a.ctx, L, g, null, noBits);
    drawUra(b.ctx, L, g, { taskId: "T20260929-01" }, noBits);
    const alphaAt = (calls: typeof a.calls, ti: number, mi: number) =>
      calls.filter((c) => c.op === "arc" && c.fill.startsWith("#") && c.args[1] === g.rowY(ti, mi)).map((c) => c.alpha);
    expect(Math.max(...alphaAt(b.calls, 1, 1))).toBeGreaterThan(Math.max(...alphaAt(a.calls, 1, 1)));   // BEACON (win11 row) lifted
    expect(Math.max(...alphaAt(b.calls, 2, 0))).toBeLessThan(Math.max(...alphaAt(a.calls, 2, 0)));      // unlinked (macmini row) dimmed
  });
});

describe("<RunChart>", () => {
  it("labels each track with its code, name and today's hours; legend names both machines", async () => {
    const { container } = render(<V2TestProvider><RunChart snap={day()} /></V2TestProvider>);
    await waitFor(() => expect(container.textContent).toContain("上排 macmini · 下排 win11"));
    expect(container.textContent).not.toContain("5 分钟");     // the dot size follows the width (spec §2.1): no fixed legend
    const labs = [...container.querySelectorAll<HTMLElement>(".lab")];
    expect(labs.map((l) => l.dataset.task ?? null)).toEqual(["T20260918-02", "T20260929-01", null, "T20261001-01"]);
    expect(container.textContent).toContain("worklog 改修");
    expect(container.textContent).toContain("2.5H");
    expect(container.querySelector("canvas.dia-cv")).not.toBeNull();
  });
  it("4 tracks: each label keeps its badge, at the default LED size", async () => {
    const { container } = render(<V2TestProvider><RunChart snap={day()} /></V2TestProvider>);
    await waitFor(() => expect(container.querySelectorAll(".lab")).toHaveLength(4));
    expect(container.querySelectorAll(".lab .tbadge")).toHaveLength(3);
    expect(container.querySelector(".dia-body")!.classList.contains("dense")).toBe(false);
  });
  it("8 tracks (T10 verdict 6): no badges, a line-colour bar, and 8px labels and hours that fit the row pitch", async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `T202610${10 + i}-01`);
    const snap = buildSnapshot({ now: T("2026-10-02 18:00"), machines: [], planItems: [], dayPlan: null, downloads: [],
      tasks: ids.map((id, i) => task(id, `社内 勉強会 ${i}`)),
      sessions: ids.map((id, i) => session(`S${i}`, `2026-10-02 ${String(9 + i).padStart(2, "0")}:00`, `2026-10-02 ${String(9 + i).padStart(2, "0")}:30`, { task_id: id })) }, 10);
    const { container } = render(<V2TestProvider><RunChart snap={snap} /></V2TestProvider>);
    await waitFor(() => expect(container.querySelectorAll(".lab")).toHaveLength(8));
    expect(container.querySelector(".dia-body")!.classList.contains("dense")).toBe(true);
    expect(container.querySelectorAll(".lab .tbadge")).toHaveLength(0);
    for (const l of container.querySelectorAll<HTMLElement>(".lab")) expect(l.style.getPropertyValue("--lc")).not.toBe("");
    for (const c of container.querySelectorAll(".lab canvas, .hours canvas")) expect(c.nextElementSibling!.classList.contains("s8")).toBe(true);
  });
  it("an empty day: the empty line, no chart canvas", async () => {
    const { container } = render(<V2TestProvider><RunChart snap={empty("2026-10-05 09:00")} /></V2TestProvider>);
    await waitFor(() => expect(container.textContent).toContain("今天还没有会话"));
    expect(container.querySelector("canvas.dia-cv")).toBeNull();
  });
});

describe("<RunChart> in the page-wide hover link (spec §4.2)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const inShell = (snap: ReturnType<typeof day>) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    return render(
      <V2TestProvider>
        <Shell page="now" titleKey="nav.now"><div className="row run" data-task="T20260918-02" /><RunChart snap={snap} /></Shell>
      </V2TestProvider>,
    );
  };
  it("hovering a task's row lifts that track in the chart", () => {
    const { container } = inShell(day());
    fireEvent.pointerOver(container.querySelector(".row.run")!);
    expect(container.querySelector("canvas.dia-cv")!.getAttribute("data-hover")).toBe("T20260918-02");
    fireEvent.pointerLeave(container.querySelector(".v2-hall")!);
    expect(container.querySelector("canvas.dia-cv")!.getAttribute("data-hover")).toBeNull();
  });
  it("hovering a track lifts the same task's rows", () => {
    const { ctx } = rec();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      return this.classList.contains("dia-cv") ? ctx : null;
    } as never);
    const snap = day(), L = layoutChart(snap), g = geometry(L, 0, 0, PITCH);   // jsdom boxes are 0×0, as RunChart sees them
    const { container } = inShell(snap);
    fireEvent.pointerMove(container.querySelector("canvas.dia-cv")!, { clientX: g.dotX(60 / g.minPerDot), clientY: g.rowY(0, 0) });   // 10:00, WL / macmini
    expect(container.querySelector(".row.run")!.classList.contains("hl")).toBe(true);
    expect(container.querySelector(".v2-hall")!.classList.contains("fx")).toBe(true);
  });
});
