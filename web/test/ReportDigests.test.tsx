import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestOut, ReportPreview } from "../src/api/types";
import { ToastHost } from "../src/components/Toast";
import type { Lang } from "../src/prefs/types";
import { ReportPage } from "../src/pages/ReportPage";
import { J, session, task } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { dayRow, json, preview, rpServer } from "./rp-serve";
import { weekTl } from "./tl-fixtures";

// report week 2026-W40: Saturday 09-26 … Friday 10-02; today = Friday 10-02 (the week is still running)
const T1 = task("T20260901-01", "alpha 改修");
const dg = (text: string, o: Partial<DigestOut> = {}): DigestOut => ({ text, pdf_text: null, edited: false, stale: false, updated_at: "2026-10-02T04:00:00Z", oneliner: null, oneliner_edited: false, ...o });
const sessions = [
  session("a1", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id, summary: "帳票の修正" }),
  session("a2", "2026-09-28 13:00", "2026-09-28 13:30", { task_id: T1.id, summary: "見直し" }),
];
const days = [dayRow("S:a1", "2026-09-28", "alpha 改修", "帳票の修正", 60), dayRow("S:a2", "2026-09-28", "alpha 改修", "見直し", 30)];
const withDigests = (p: ReportPreview, digests: ReportPreview["digests"]): ReportPreview => ({ ...p, digests });
const DIGESTS = { week: dg("帳票の修正を進めた一週間。", { edited: true }), days: { "2026-09-28": dg("帳票を直して見直した。", { stale: true }) } };
const serve = (digests: ReportPreview["digests"] = DIGESTS, digestsAuto = true) => rpServer({
  digestsAuto,
  previews: {
    "2026-W40/weekly": withDigests(preview("2026-W40", { days }), digests),
  },
  timelines: { "2026-W40": weekTl("2026-W40", "2026-09-28", sessions, []) },
  tasks: [T1],
});

const ink = (el: Element | null) => (el ? [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|") : "");
const page = (hash: string, lang?: Lang) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={lang}><ReportPage /><ToastHost /></V2TestProvider>);
};
const wk = (c: Element) => c.querySelector(".rp-dg")!;
const dayRowEl = (c: Element) => c.querySelector(".rp-days .dgr")!;
const toasts = () => [...document.querySelectorAll(".toast")].map((e) => (e.textContent ?? "").replace(/✕$/, ""));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); applyWorld("ura"); window.location.hash = ""; localStorage.clear(); });

describe("週報 — week digest", () => {
  it("the week's line under its label, 进行中 while the week runs, the edited mark; no lang on the data text", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(container.querySelector(".rp-dg")).not.toBeNull());
    expect(ink(wk(container).querySelector(".hd"))).toContain("本周概要");
    expect(ink(wk(container).querySelector(".hd"))).toContain("进行中");
    expect(ink(wk(container).querySelector(".hd"))).toContain("已手改");
    expect(wk(container).querySelector(".tx")!.textContent).toBe("帳票の修正を進めた一週間。");
    // the data text carries no lang (the LED label's accessible twin is UI text and does)
    expect(wk(container).querySelector(".tx[lang], .tx [lang]")).toBeNull();
    // between the warning line and the tabs
    const top = container.querySelector(".rp-top")!;
    expect([...top.children].indexOf(wk(container).closest(".rp-top > *")!)).toBeLessThan([...top.children].indexOf(top.querySelector(".rp-tabs")!));
  });

  it("no line yet: 还没有总结; a stale line says 待更新 / Needs update (no promise of a refresh)", async () => {
    serve({ week: null, days: {} });
    const a = page("#/v2/report");
    await waitFor(() => expect(a.container.querySelector(".rp-dg")).not.toBeNull());
    expect(wk(a.container).querySelector(".tx")!.textContent).toBe("还没有总结");
    a.unmount();
    serve({ week: dg("古い要約", { stale: true }), days: {} });
    const b = page("#/v2/report", "en");
    await waitFor(() => expect(b.container.querySelector(".rp-dg")).not.toBeNull());
    expect(ink(wk(b.container).querySelector(".hd"))).toContain("Needs update");
    expect(ink(wk(b.container).querySelector(".hd"))).not.toContain("Edited");
  });

  it("an edit PATCHes the text and shows the answer; ↻ asks for a regenerate, says so and re-reads in 40 s", async () => {
    const s = serve();
    const timer = vi.spyOn(window, "setTimeout");
    const { container, unmount } = page("#/v2/report");
    await waitFor(() => expect(container.querySelector(".rp-dg .tx [role=button]")).not.toBeNull());
    fireEvent.click(container.querySelector(".rp-dg .tx [role=button]")!);
    const box = container.querySelector(".rp-dg textarea")!;
    fireEvent.change(box, { target: { value: "書き直した要約" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(s.calls.map((c) => [c.method, c.url, c.body])).toContainEqual(["PATCH", "/api/reports/2026-W40/digests/week", { text: "書き直した要約" }]));
    await waitFor(() => expect(wk(container).querySelector(".tx")!.textContent).toBe("書き直した要約"));

    fireEvent.click(screen.getByRole("button", { name: "重新生成总结" }));
    await waitFor(() => expect(s.calls.at(-1)).toMatchObject({ method: "PATCH", url: "/api/reports/2026-W40/digests/week", body: { regenerate: true } }));
    await waitFor(() => expect(toasts()).toContain("已请求重新生成，稍后刷新"));
    const at = timer.mock.calls.findIndex((c) => c[1] === 40_000);
    expect(at).toBeGreaterThan(-1);
    const id = timer.mock.results[at].value;
    const clear = vi.spyOn(window, "clearTimeout");
    unmount();
    expect(clear).toHaveBeenCalledWith(id);
  });
  it("R12: ↻ while DIGESTS_AUTO is off says the line is only marked and schedules no re-read", async () => {
    const s = serve(DIGESTS, false);
    const timer = vi.spyOn(window, "setTimeout");
    const { container } = page("#/v2/report");
    await waitFor(() => expect(container.querySelector(".rp-dg .tx [role=button]")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "重新生成总结" }));
    await waitFor(() => expect(s.calls.at(-1)).toMatchObject({ method: "PATCH", url: "/api/reports/2026-W40/digests/week", body: { regenerate: true } }));
    await waitFor(() => expect(toasts()).toContain("已标记，下次本机生成时重写"));
    expect(toasts()).not.toContain("已请求重新生成，稍后刷新");
    expect(timer.mock.calls.some((c) => c[1] === 40_000)).toBe(false);
  });

  it("S2c R4: a two-line week digest shows both lines, its line break kept; an edit keeps the \\n", async () => {
    const s = serve({ week: dg("帳票の修正を進めた。\n移行の準備も始めた。"), days: {} });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(container.querySelector(".rp-dg .tx [role=button]")).not.toBeNull());
    const ed = wk(container).querySelector(".tx .rp-ed")!;
    expect(ed.textContent).toBe("帳票の修正を進めた。\n移行の準備も始めた。");
    fireEvent.click(container.querySelector(".rp-dg .tx [role=button]")!);
    const box = container.querySelector(".rp-dg textarea")!;
    fireEvent.change(box, { target: { value: "一行目\n二行目" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(s.calls.map((c) => [c.method, c.url, c.body])).toContainEqual(["PATCH", "/api/reports/2026-W40/digests/week", { text: "一行目\n二行目" }]));
  });
});

describe("digest text in v2.css (S2c §1.1 / R4: every line, line breaks kept, both worlds)", () => {
  const css = readFileSync("src/styles/v2.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const bodyOf = (sel: string) => rules.filter((r) => r.sel.split(",").some((x) => x.trim() === sel)).map((r) => r.body).join(";");

  it("no hover overlay is left", () => {
    expect(css).not.toContain("data-full");
  });
  it("the week block keeps its breaks with no clamp or max-height", () => {
    const wk = bodyOf("html.v2 .rp .rp-dg .tx") + ";" + bodyOf("html.v2 .rp .rp-dg .rp-ed");
    expect(wk).toMatch(/white-space:pre-(wrap|line)/);
    expect(wk).not.toMatch(/line-clamp|max-height/);
  });
  it("report cells, 考え方, 成果物 and paths are never cut: no clamp, no ellipsis, no nowrap", () => {
    // every rule, in either world, that styles the report's prose: 作業内容, 考え方, 成果物, paths, digests
    const prose = rules.filter((r) => /\.rp\b[^,]*\.(txt|think|dl|path|dg)\b/.test(r.sel));
    expect(prose.length).toBeGreaterThan(10);
    // G4 (user decision): the one exception is a 当日案件 title, one line with an ellipsis (full title on hover)
    const dt = prose.filter((r) => /\.dt li>\.tt\b/.test(r.sel));
    expect(dt.map((r) => r.body).join(";")).toMatch(/text-overflow:ellipsis/);
    for (const r of prose.filter((x) => !dt.includes(x))) expect(r.body, r.sel).not.toMatch(/line-clamp|ellipsis|nowrap|max-height|-webkit-box/);
  });
});

describe("日別作業 — day digests and cells in full", () => {
  it("当日案件 right after the header, on the matrix's columns: the 案件 worked that day, no AI line; -- for a day without one", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(container.querySelector(".rp-days .blk")).not.toBeNull());
    const row = dayRowEl(container);
    expect(row.previousElementSibling!.classList.contains("mx-h")).toBe(true);
    expect(ink(row.querySelector(".lb"))).toBe("当日案件");
    const cells = [...row.querySelectorAll(".dg")];
    expect(cells).toHaveLength(5);
    // the stored day digest (帳票を直して見直した。) is not shown — only the 案件's title
    expect([...cells[0].querySelectorAll("li")].map((e) => e.textContent)).toEqual(["alpha 改修"]);   // the badge draws no text
    expect(cells[0].querySelector("[role=button]")).toBeNull();
    // B3b: each line is an S badge (16 px) then the title; the dot rules are gone
    const li = cells[0].querySelector("li")!;
    const b = li.firstElementChild as HTMLElement;
    expect(b.classList.contains("tbadge")).toBe(true);
    expect(b.style.height).toBe("16px");
    expect(b.nextElementSibling!.textContent).toBe("alpha 改修");
    expect(cells.slice(1).map((e) => e.textContent)).toEqual(["--", "--", "--", "--"]);
  });

  it("every cell lists each source with its minutes — never folded, no switch", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(container.querySelector(".rp-days .blk")).not.toBeNull());
    expect(container.querySelector(".blk .pr .cell")!.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector(".rp-fold")).toBeNull();
  });
});

describe("週報 — input polish", () => {
  it("a polished week line shows 润 (its address is the week's empty day); none without meta", async () => {
    serve({ week: dg("帳票の修正を進めた一週間。", { polish: { text: { raw: "ちょうひょう", pinned: false } } }), days: {} });
    const a = page("#/v2/report");
    await waitFor(() => expect(wk(a.container).querySelector('button[aria-label="已润色"]')).not.toBeNull());
    a.unmount();
    serve();
    const b = page("#/v2/report");
    await waitFor(() => expect(b.container.querySelector(".rp-dg .tx [role=button]")).not.toBeNull());
    expect(b.container.querySelector('button[aria-label="已润色"]')).toBeNull();
  });
});

describe("週報 — oneliner", () => {
  it("shows the week's oneliner under 本周概要, and the fallback hint when there is none", async () => {
    serve({ ...DIGESTS, week: dg("帳票の修正を進めた一週間。", { oneliner: "帳票を直した" }) });
    const a = page("#/v2/report");
    await waitFor(() => expect(a.container.querySelector(".rp-dg .one")).not.toBeNull());
    expect(a.container.querySelector(".rp-dg .one")!.textContent).toContain("帳票を直した");
    a.unmount();
    serve({ ...DIGESTS, week: dg("本文") });
    const b = page("#/v2/report");
    await waitFor(() => expect(b.container.querySelector(".rp-dg .one")).not.toBeNull());
    expect(b.container.querySelector(".rp-dg .one")!.textContent).toContain("（还没有：xlsx 里用主要案件名代替）");
  });

  it("an edit sends PATCH { oneliner } for the week and shows the answer with the edited mark", async () => {
    const s = serve({ ...DIGESTS, week: dg("本文", { oneliner: "古い一言" }) });
    const { container } = page("#/v2/report");
    fireEvent.click(await screen.findByRole("button", { name: "一句话：古い一言（点击编辑）" }));
    const box = screen.getByRole("textbox", { name: "一句话" });
    fireEvent.change(box, { target: { value: "新しい一言" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(s.calls.map((c) => [c.method, c.url, c.body])).toContainEqual(["PATCH", "/api/reports/2026-W40/digests/week", { oneliner: "新しい一言" }]));
    await waitFor(() => expect(container.querySelector(".rp-dg .one")!.textContent).toContain("新しい一言"));
    expect(container.querySelector(".rp-dg .one .pen")).not.toBeNull();
  });

  it("a 400 the server refused: the field keeps the draft and says the server's reason", async () => {
    const s = serve({ ...DIGESTS, week: dg("本文", { oneliner: "古い一言" }) });
    page("#/v2/report");
    fireEvent.click(await screen.findByRole("button", { name: "一句话：古い一言（点击编辑）" }));
    s.failNext((m, u) => (m === "PATCH" && u === "/api/reports/2026-W40/digests/week"
      ? new Response(JSON.stringify({ error: "invalid", issues: [{ path: "oneliner", message: "oneliner is too long" }] }), { status: 400, headers: { "Content-Type": "application/json" } })
      : null));
    const box = screen.getByRole("textbox", { name: "一句话" });
    fireEvent.change(box, { target: { value: "新しい一言" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("oneliner is too long")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "一句话" })).toHaveValue("新しい一言");
  });

  it("read-only (another week's preview kept on screen): the fallback hint is dimmed like the editable one", async () => {
    const s = serve({ ...DIGESTS, week: dg("本文") });
    s.db.previews["2026-W39/weekly"] = withDigests(preview("2026-W39", { days }), { ...DIGESTS, week: dg("本文") });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(container.querySelector(".rp-dg .one")).not.toBeNull());
    let open!: () => void;
    const g = new Promise<void>((r) => { open = r; });
    s.failNext((m, u) => (m === "GET" && u === "/api/reports/2026-W39/weekly" ? g.then(() => json(s.db.previews["2026-W39/weekly"])) : null));
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    await waitFor(() => expect(container.querySelector(".rp-dg .one .rp-ed.ro")).not.toBeNull());
    expect(container.querySelector(".rp-dg .one .rp-ed.ro .none")!.textContent).toBe("（还没有：xlsx 里用主要案件名代替）");
    await act(async () => { open(); });
  });

  it("over 120 characters: the field says so and nothing is sent; empty clears it", async () => {
    const s = serve({ ...DIGESTS, week: dg("本文", { oneliner: "古い一言" }) });
    const { container } = page("#/v2/report");
    fireEvent.click(await screen.findByRole("button", { name: "一句话：古い一言（点击编辑）" }));
    const box = screen.getByRole("textbox", { name: "一句话" });
    fireEvent.change(box, { target: { value: "あ".repeat(121) } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("最多 120 字")).toBeInTheDocument();
    expect(s.calls.filter((c) => c.method === "PATCH")).toEqual([]);
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(s.calls.map((c) => [c.method, c.url, c.body])).toContainEqual(["PATCH", "/api/reports/2026-W40/digests/week", { oneliner: "" }]));
    await waitFor(() => expect(container.querySelector(".rp-dg .one")!.textContent).toContain("（还没有：xlsx 里用主要案件名代替）"));
  });
});
