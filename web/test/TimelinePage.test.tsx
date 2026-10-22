import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/api/types";
import { TimelinePage } from "../src/pages/TimelinePage";
import { J, machine, session, task } from "../src/predict/fixtures";
import { Shell } from "../src/ui/Shell";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { note, weekTl } from "./tl-fixtures";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const W40: Session[] = [
  session("a1", "2026-10-01 10:00", "2026-10-01 11:00", { task_id: "A", summary: "設計の見直し", cwd: "/w/a" }),
  session("u1", "2026-10-01 13:00", "2026-10-01 13:30", { summary: "調査", cwd: "/w/b" }),
  session("b1", "2026-10-02 13:30", "2026-10-02 14:10", { task_id: "B", cwd: "/w/a" }),
  session("h1", "2026-10-02 09:00", "2026-10-02 09:30", { task_id: "B", hidden: 1 }),
];
const OLD = session("u0", "2026-09-20 10:00", "2026-09-20 12:00", { summary: "古い調査", cwd: "/w/b" });
let fail = false, failUnlinked = false;
let wallOn = false;
function serve() {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    if (fail) return json({ error: "boom" }, 500);
    if (url.startsWith("/api/machines")) return json([machine("macmini", "2026-10-02 14:12")]);
    if (url.startsWith("/api/weeks/2026-W40/timeline")) {
      const tl = weekTl("2026-W40", "2026-09-28", W40, [note("n1", "2026-10-02T12:00:00", { minutes: 30, text: "打ち合わせ" })], url.includes("include_hidden=1"));
      // 工作时间 (user 10/9): a parallel pair on 10/1 makes it 1.0H beside the 1.5H 累计; the other days are equal
      return json(wallOn ? { ...tl, days: tl.days.map((d) => ({ ...d, wall_minutes: d.date === "2026-10-01" ? 60 : d.minutes })), total_wall_minutes: tl.total_minutes - 30 } : tl);
    }
    if (url.startsWith("/api/weeks/2026-W39/timeline")) return json(weekTl("2026-W39", "2026-09-21", [OLD]));
    if (url.startsWith("/api/weeks/")) return json(weekTl("2026-W41", "2026-10-05", []));
    if (url.startsWith("/api/tasks")) return json([task("A", "alpha 改修"), task("B", "beta 調査")]);
    if (url.startsWith("/api/sessions?unlinked=1")) return failUnlinked ? json({ error: "boom" }, 500) : json([OLD, W40[1]]);
    return json({});
  }));
}
const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (hash: string, withShell = false) => {
  window.location.hash = hash;
  const body = withShell ? <Shell page="timeline" titleKey="nav.timeline"><TimelinePage /></Shell> : <TimelinePage />;
  return render(<V2TestProvider>{body}</V2TestProvider>);
};
const rows = (c: Element) => [...c.querySelectorAll<HTMLElement>(".srow[data-id]")].map((r) => r.dataset.id);

beforeEach(() => { fail = false; failUnlinked = false; wallOn = false; serve(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("TimelinePage", () => {
  it("工作时间 and 累计: the week line carries both; a day shows 累计 under its hours only where they differ", async () => {
    wallOn = true;
    const { container } = page("#/v2/timeline/2026-W40");
    await waitFor(() => expect(ink(container)).toContain("工作 2.2H · 累计 2.7H · 3 个会话"));
    const band = (d: string) => ink(container.querySelector(`.band[data-day="${d}"] .br`)!);
    expect(band("2026-10-01")).toMatch(/^1\.0H\|累计 1\.5H\|/);
    expect(band("2026-10-02")).toMatch(/^1\.2H\|\$/);
  });
  it("the week line, the summary, the 未关联 key with the cross-week count; today's rows listed by default", async () => {
    const { container } = page("#/v2/timeline/2026-W40");
    await waitFor(() => expect(ink(container)).toContain("9/28–10/2 · 第 40 周"));
    expect(ink(container)).toContain("工作 2.7H · 累计 2.7H · 3 个会话");                // 60 + 30 + 40 min + the 30 min note
    expect(ink(container)).toContain("未关联 2 件");
    expect(container.querySelector(".key.warn .lamp.red")).not.toBeNull();
    expect(ink(container)).toContain("已隐藏 1");
    expect(container.querySelectorAll(".band")).toHaveLength(5);
    await waitFor(() => expect(rows(container)).toEqual(["b1", "n:n1"]));
    const b1 = container.querySelector<HTMLElement>('.srow[data-id="b1"]')!;
    expect((await within(b1).findByRole("img", { name: "B" })).getAttribute("height")).toBe("22");   // session row: badge, not code Led
    expect(within(container.querySelector<HTMLElement>('.srow[data-id="n:n1"]')!).queryByRole("img")).toBeNull();   // unlinked note keeps the dim Led
    expect(ink(container)).toContain("10/2（五）");
  });
  it("a band click lists that day and puts it in the address", async () => {
    const { container } = page("#/v2/timeline/2026-W40");
    await waitFor(() => expect(container.querySelectorAll(".band")).toHaveLength(5));
    fireEvent.click(container.querySelector('.band[data-day="2026-10-01"]')!);
    await waitFor(() => expect(rows(container)).toEqual(["a1", "u1"]));
    expect(window.location.hash).toBe("#/v2/timeline/2026-W40?day=2026-10-01");
  });
  it("未关联 filter: every unlinked session across weeks with its date, then this week's notes without a task; off again", async () => {
    const { container } = page("#/v2/timeline/2026-W40");
    await waitFor(() => expect(container.querySelector(".key.warn")).not.toBeNull());
    fireEvent.click(container.querySelector(".key.warn")!);
    await waitFor(() => expect(rows(container)).toEqual(["u0", "u1", "n:n1"]));
    await waitFor(() => expect(ink(container)).toContain("合计为全部（未筛选）"));
    expect(window.location.hash).toBe("#/v2/timeline/2026-W40?unlinked=1");
    expect(container.querySelector(".key.warn")!.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(ink(container)).toContain("9/20 10:00"));
    expect(ink(container)).toContain("未关联 · 全部周");
    expect(ink(container)).toContain("补记 10/2 12:00");                 // a note row says its day in the cross-week list
    fireEvent.click(container.querySelector(".key.warn")!);
    await waitFor(() => expect(rows(container)).toEqual(["b1", "n:n1"]));
  });
  it("已隐藏 refetches with hidden sessions and shows them dimmed", async () => {
    const { container } = page("#/v2/timeline/2026-W40?day=2026-10-02");
    await waitFor(() => expect(ink(container)).toContain("已隐藏 1"));
    fireEvent.click([...container.querySelectorAll(".key.dim")].find((k) => k.textContent?.includes("已隐藏"))!);
    await waitFor(() => expect(rows(container)).toEqual(["h1", "b1", "n:n1"]));
    expect(container.querySelector('.srow[data-id="h1"]')!.classList.contains("hid")).toBe(true);
    await waitFor(() => expect(ink(container.querySelector('.srow[data-id="h1"]')!)).toContain("已隐藏"));
  });
  it("只看此目录 narrows the rows and hides the notes; its key clears it", async () => {
    const { container } = page("#/v2/timeline/2026-W40?day=2026-10-02&dir=%2Fw%2Fa");
    await waitFor(() => expect(rows(container)).toEqual(["b1"]));
    const chip = container.querySelector<HTMLElement>(".key.on[title='/w/a']")!;
    fireEvent.click(chip);
    await waitFor(() => expect(rows(container)).toEqual(["b1", "n:n1"]));
    expect(window.location.hash).toBe("#/v2/timeline/2026-W40?day=2026-10-02");
  });
  it("another week keeps the filter; 本周 comes back", async () => {
    const { container } = page("#/v2/timeline/2026-W40?unlinked=1");
    await waitFor(() => expect(container.querySelectorAll(".band")).toHaveLength(5));
    fireEvent.click(container.querySelector('button[aria-label="上一周"]')!);
    await waitFor(() => expect(ink(container)).toContain("9/21–9/25 · 第 39 周"));
    expect(window.location.hash).toBe("#/v2/timeline/2026-W39?unlinked=1");
    fireEvent.click([...container.querySelectorAll("button.key")].find((b) => b.textContent?.includes("本周"))!);
    await waitFor(() => expect(window.location.hash).toBe("#/v2/timeline/2026-W40?unlinked=1"));
  });
  it("a row opens the drawer in the address", async () => {
    const { container } = page("#/v2/timeline/2026-W40");
    await waitFor(() => expect(rows(container)).toEqual(["b1", "n:n1"]));
    fireEvent.click(container.querySelector('.srow[data-id="b1"]')!);
    expect(window.location.hash).toBe("#/v2/timeline/2026-W40?s=b1");
    fireEvent.keyDown(container.querySelector('.srow[data-id="n:n1"]')!, { key: "Enter" });
    expect(window.location.hash).toBe("#/v2/timeline/2026-W40?n=n1");
  });
  it("＋ 补记 opens the note panel on the selected day", async () => {
    const { container } = page("#/v2/timeline/2026-W40?day=2026-10-01", true);
    await waitFor(() => expect(container.querySelector(".tl-day .key.pri")).not.toBeNull());
    fireEvent.click(container.querySelector(".tl-day .key.pri")!);
    await waitFor(() => expect(document.querySelector<HTMLInputElement>('.v2-note input[type="date"]')?.value).toBe("2026-10-01"));
  });
  it("a failed load says so and can retry", async () => {
    fail = true;
    const { container } = page("#/v2/timeline/2026-W40");
    await waitFor(() => expect(ink(container)).toContain("读取失败"), { timeout: 8000 });
    fail = false;
    fireEvent.click(container.querySelector(".tl-wait button")!);
    await waitFor(() => expect(container.querySelectorAll(".band")).toHaveLength(5));
  }, 10000);
  it("the cross-week list failing says so and can retry — it never reads as 'nothing unlinked'", async () => {
    failUnlinked = true;
    const { container } = page("#/v2/timeline/2026-W40?unlinked=1");
    await waitFor(() => expect(ink(container)).toContain("读取未关联会话失败"), { timeout: 8000 });
    expect(ink(container)).not.toContain("没有未关联的会话");
    expect(ink(container)).toContain("未关联 ?");
    failUnlinked = false;
    fireEvent.click(container.querySelector('.srow.empty[role="alert"] button')!);
    await waitFor(() => expect(rows(container)).toEqual(["u0", "u1", "n:n1"]));
  }, 10000);
  it("the 补记 panel follows the day: opened again for another day, its date changes", async () => {
    const { container } = page("#/v2/timeline/2026-W40?day=2026-10-01", true);
    await waitFor(() => expect(container.querySelector(".tl-day .key.pri")).not.toBeNull());
    fireEvent.click(container.querySelector(".tl-day .key.pri")!);
    await waitFor(() => expect(document.querySelector<HTMLInputElement>('.v2-note input[type="date"]')?.value).toBe("2026-10-01"));
    fireEvent.click(container.querySelector('.band[data-day="2026-09-30"]')!);
    await waitFor(() => expect(ink(container)).toContain("9/30（三）"));
    fireEvent.click(container.querySelector(".tl-day .key.pri")!);
    await waitFor(() => expect(document.querySelector<HTMLInputElement>('.v2-note input[type="date"]')?.value).toBe("2026-09-30"));
  });
});

