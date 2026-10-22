import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellKind, CellValue, Grid, GridCell, GridRow, ReportPreview } from "../src/api/types";
import { ToastHost } from "../src/components/Toast";
import { PITCH } from "../src/led/lattice";
import type { Lang } from "../src/prefs/types";
import { ReportPage } from "../src/pages/ReportPage";
import { J, task } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { rec, type Call } from "./canvas-rec";
import { V2TestProvider } from "./helpers";
import { preview, rpServer } from "./rp-serve";

// 2026-W40: Monday 09-28 … Sunday 10-04; today = Friday 10-02. The grids are the shapes server/src/report/layout.ts emits.
const c = (column: string, value: CellValue, kind: CellKind, bold = false): GridCell => (bold ? { column, value, kind, bold } : { column, value, kind });
const kv = (row_key: string, label: string, value: CellValue, kind: CellKind): GridRow => ({ row_key, cells: [c("label", label, "text", true), c("value", value, kind)] });
const SUMMARY = (): Grid => ({
  key: "summary", title: "サマリー", freeze_header: false, columns: [{ key: "label", header: null }, { key: "value", header: null }],
  rows: [
    kv("week", "週", "2026-W40", "text"), kv("new", "新規", 2, "int"), kv("done", "完了", 1, "int"), kv("ongoing", "継続", 3, "int"),
    kv("total_hours", "総工数(h)", 12.5, "float"), kv("unassigned_hours", "未割当工数(h)", 0.75, "float"),
    { row_key: "blank", cells: [c("label", null, "text"), c("value", null, "text")] },
    { row_key: "req_header", cells: [c("label", "依頼元", "text", true), c("value", "件数", "text", true)] },
    { row_key: "req:営業部", cells: [c("label", "営業部", "text"), c("value", 2, "int")] },
    { row_key: "req:経理", cells: [c("label", "経理", "text"), c("value", 1, "int")] },
  ],
});
const HOURS = (): Grid => ({
  key: "hours", title: "稼働", freeze_header: true, columns: [{ key: "date", header: "日付" }, { key: "hours", header: "稼働時間(h)" }],
  rows: [
    { row_key: "2026-09-28", cells: [c("date", "2026-09-28", "date"), c("hours", 3.5, "float")] },
    { row_key: "2026-09-29", cells: [c("date", "2026-09-29", "date"), c("hours", 0, "float")] },
    { row_key: "2026-10-01", cells: [c("date", "2026-10-01", "date"), c("hours", 7, "float")] },
    { row_key: "total", cells: [c("date", "合計", "text", true), c("hours", 10.5, "float")] },
  ],
});
const LONG = "projects/2026/基幹/帳票/改修/第二期/docs/specs/final/report-layout-v3.xlsx";
const T1 = { ...task("T20260901-01", "alpha 改修"), deliverables: ["docs/a.md", LONG] };
const T3 = { ...task("T20260920-02", "gamma 完了", "done"), done_at: "2026-09-30", deliverables: ["out/c.pdf"] };
const DELIV = (): Grid => ({
  key: "deliverables", title: "成果物", freeze_header: true,
  columns: [{ key: "title", header: "案件" }, { key: "path", header: "成果物パス" }, { key: "done_at", header: "完了日" }],
  rows: [T1, T3].flatMap((t) => t.deliverables.map((path, i) => ({
    row_key: `${t.id}|${i}`, cells: [c("title", t.title, "text"), c("path", path, "text"), c("done_at", t.done_at, "date")],
  }))),
});
const withSheets = (p: ReportPreview, ...gs: Grid[]): ReportPreview => ({ ...p, sheets: p.sheets.map((g) => gs.find((x) => x.key === g.key) ?? g) });
const KEY = "2026-W40/weekly";
const serve = (p?: ReportPreview) => rpServer({
  previews: { [KEY]: p ?? withSheets(preview("2026-W40"), SUMMARY(), HOURS(), DELIV()) },
  tasks: [T1, T3],
});

const ink = (el: Element | null) => (el ? [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|") : "");
const page = (hash: string, lang?: Lang) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={lang}><ReportPage /><ToastHost /></V2TestProvider>);
};
const writes = (s: ReturnType<typeof rpServer>) => s.calls.map((x) => `${x.method} ${x.method === "PUT" ? JSON.stringify(x.body) : decodeURIComponent(x.url.split("?")[1] ?? "")}`);
const put = (sheet: string, row_key: string, column: string, value: string) => `PUT ${JSON.stringify({ sheet, row_key, column, value })}`;
const edit = (name: RegExp) => screen.getByRole("button", { name });
const enter = (label: string, value: string) => {
  const box = screen.getByRole("textbox", { name: label });
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: "Enter" });
};

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("サマリー", () => {
  const kvs = (c: Element) => [...c.querySelectorAll(".rp-sum .kv")];
  const rqs = (c: Element) => [...c.querySelectorAll(".rp-sum .rq")];
  const ready = async (c: Element) => { await waitFor(() => expect(ink(kvs(c)[5] ?? null)).not.toBe("")); };

  it("the labelled figures: each label a row header, its figure beside it; blank skipped", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=summary");
    await ready(container);
    const left = screen.getByRole("table", { name: "サマリー" });
    const rows = within(left).getAllByRole("row");
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => ink(within(r).getByRole("rowheader")))).toEqual(["週", "新規", "完了", "継続", "総工数(h)", "未割当工数(h)"]);
    expect(rows.map((r) => ink(within(r).getByRole("cell")))).toEqual(["2026-W40", "2", "1", "3", "12.50", "0.75"]);
    expect(kvs(container).map((r) => r.classList.contains("sm"))).toEqual([true, false, false, false, false, false]);
    // no empty row for the xlsx's spacer anywhere
    expect([...container.querySelectorAll(".rp-sum [role=row]")].filter((r) => ink(r) === "")).toHaveLength(0);
  });

  it("依頼元 | 件数 is the right column's header, one row per requester", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=summary");
    await ready(container);
    const right = screen.getByRole("table", { name: "依頼元" });
    expect(within(right).getAllByRole("columnheader").map((h) => ink(h))).toEqual(["依頼元", "件数"]);
    expect(rqs(container).slice(1).map((r) => ink(r))).toEqual(["営業部|2", "経理|1"]);
    expect(rqs(container)[1].querySelector("[role=rowheader] .ink [lang=ja]")).not.toBeNull();
  });

  it("rows go by row_key, not by position", async () => {
    const g = SUMMARY();
    g.rows = [g.rows[5], g.rows[9], g.rows[1], g.rows[6], g.rows[7], g.rows[0], g.rows[8]];
    serve(withSheets(preview("2026-W40"), g, HOURS(), DELIV()));
    const { container } = page("#/v2/report?sheet=summary");
    await waitFor(() => expect(ink(kvs(container)[2] ?? null)).not.toBe(""));
    expect(kvs(container).map((r) => ink(r))).toEqual(["未割当工数(h)|0.75", "新規|2", "週|2026-W40"]);
    expect(rqs(container).map((r) => ink(r))).toEqual(["依頼元|件数", "経理|1", "営業部|2"]);
  });

  it("editing a figure puts it on summary/<row_key>/value; labels and the header never edit", async () => {
    const s = serve();
    const { container } = page("#/v2/report?sheet=summary");
    await ready(container);
    for (const h of container.querySelectorAll(".rp-sum [role=rowheader], .rp-sum [role=columnheader]")) {
      expect(within(h as HTMLElement).queryByRole("button")).toBeNull();
    }
    fireEvent.click(edit(/^新規：2/));
    enter("新規", "3");
    await waitFor(() => expect(writes(s)).toEqual([put("summary", "new", "value", "3")]));
    await waitFor(() => expect(ink(kvs(container)[1])).toBe("新規|3"));
    fireEvent.click(edit(/^営業部：2/));
    enter("営業部", "4");
    await waitFor(() => expect(writes(s)).toEqual([put("summary", "new", "value", "3"), put("summary", "req:営業部", "value", "4")]));
  });

  it("en / ja: labels in the interface language", async () => {
    serve();
    const { container, unmount } = page("#/v2/report?sheet=summary", "en");
    await ready(container);
    expect(kvs(container).map((r) => ink(r.querySelector("[role=rowheader]")))).toEqual(["Week", "New", "Done", "Ongoing", "Total hours", "Unassigned hours"]);
    expect(ink(rqs(container)[0])).toBe("Requester|Tasks");
    unmount();
    const j = page("#/v2/report?sheet=summary", "ja").container;
    await ready(j);
    expect(kvs(j).map((r) => ink(r.querySelector("[role=rowheader]")))).toEqual(["週", "新規", "完了", "継続", "総工数(h)", "未割当工数(h)"]);
    expect(ink(rqs(j)[0])).toBe("依頼元|件数");
  });

  it("renders in 表 too", async () => {
    applyWorld("omote");
    serve();
    const { container } = page("#/v2/report?sheet=summary");
    await ready(container);
    expect(ink(kvs(container)[4])).toBe("総工数(h)|12.50");
  });

  it("S2c §1: a 依頼元 shows its full text — 里 cut into LED lines, 表 type that wraps", async () => {
    serve();
    const { container, unmount } = page("#/v2/report?sheet=summary");
    await ready(container);
    expect(rqs(container)[1].querySelector("[role=rowheader] .ledlines")).not.toBeNull();
    unmount();
    applyWorld("omote");
    serve();
    const o = page("#/v2/report?sheet=summary").container;
    await ready(o);
    const ink = rqs(o)[1].querySelector("[role=rowheader] .ink")!;
    expect(ink.classList.contains("iwrap")).toBe(true);
    expect(ink.classList.contains("iblk")).toBe(false);
  });
});

describe("稼働", () => {
  const hrs = (c: Element) => [...c.querySelectorAll(".rp-hours .hr:not(.hh):not(.total)")];
  const ready = async (c: Element) => { await waitFor(() => expect(ink(hrs(c)[2] ?? null)).toContain("7.00")); };

  it("a header, one row per day (date, weekday, hours), then 合計 — which never edits", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=hours");
    await ready(container);
    expect(ink(container.querySelector(".rp-hours .hh"))).toBe("日付|稼働時間(h)");
    expect(hrs(container).map((r) => ink(r))).toEqual(["2026-09-28|周一|3.50", "2026-09-29|周二|0.00", "2026-10-01|周四|7.00"]);
    const total = container.querySelector(".rp-hours .hr.total")!;
    await waitFor(() => expect(ink(total)).toBe("合計|10.50"));
    expect(within(total as HTMLElement).queryByRole("button")).toBeNull();
    expect(hrs(container).map((r) => r.querySelectorAll("canvas.db").length)).toEqual([1, 1, 1]);
  });

  it("en / ja: header and weekdays in the interface language", async () => {
    serve();
    const { container, unmount } = page("#/v2/report?sheet=hours", "en");
    await ready(container);
    expect(ink(container.querySelector(".rp-hours .hh"))).toBe("DATE|HOURS");
    expect(hrs(container).map((r) => ink(r).split("|")[1])).toEqual(["MON", "TUE", "THU"]);
    await waitFor(() => expect(ink(container.querySelector(".rp-hours .total"))).toBe("TOTAL|10.50"));
    unmount();
    const j = page("#/v2/report?sheet=hours", "ja").container;
    await ready(j);
    expect(hrs(j).map((r) => ink(r).split("|")[1])).toEqual(["月", "火", "木"]);
  });

  it("editing a day's hours puts it on hours/<date>/hours", async () => {
    const s = serve();
    const { container } = page("#/v2/report?sheet=hours");
    await ready(container);
    fireEvent.click(edit(/^稼働時間\(h\)：3\.5/));
    enter("稼働時間(h)", "4");
    await waitFor(() => expect(writes(s)).toEqual([put("hours", "2026-09-28", "hours", "4")]));
    await waitFor(() => expect(ink(hrs(container)[0])).toBe("2026-09-28|周一|4.00"));
  });

  it("group review C4: a day's 日付 edits with a date picker and puts it on hours/<date>/date", async () => {
    const s = serve();
    const { container } = page("#/v2/report?sheet=hours");
    await ready(container);
    fireEvent.click(edit(/^日付：2026-09-28/));
    const box = screen.getByLabelText("日付");
    expect(box.getAttribute("type")).toBe("date");
    fireEvent.change(box, { target: { value: "2026-09-27" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(writes(s)).toEqual([put("hours", "2026-09-28", "date", "2026-09-27")]));
    // the weekday follows the row's own date, not the typed-over text
    await waitFor(() => expect(ink(hrs(container)[0])).toBe("2026-09-27|周一|3.50"));
  });

  describe("the day bars (3 dot rows, scaled to the busiest day on screen)", () => {
    // jsdom boxes are 0×0: give the bar canvases a box and a recording context; every other canvas keeps null
    const bars = () => {
      const recs = new Map<HTMLCanvasElement, Call[]>();
      const box = HTMLCanvasElement.prototype.getBoundingClientRect;
      vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLCanvasElement) {
        return this.classList.contains("db") ? ({ width: 100, height: 15, left: 0, top: 0, right: 100, bottom: 15, x: 0, y: 0 } as DOMRect) : box.call(this);
      });
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        if (!this.classList.contains("db")) return null;
        const r = rec(); recs.set(this, r.calls); return r.ctx;
      } as never);
      return (c: Element) => [...c.querySelectorAll(".rp-hours canvas.db")].map((cv) => recs.get(cv as HTMLCanvasElement) ?? []);
    };
    /** 里: the dot rows drawn (distinct centres) and the lit dots — each arc is followed by its fill (jsdom: a lit LED
     *  is a flat disc in its colour), so lit = every fill that is not the dim track's. */
    const ura = (calls: Call[]) => {
      const arcs = calls.filter((x) => x.op === "arc"), fills = calls.filter((x) => x.op === "fill");
      const d = fills.map((f, i) => ({ fill: f.fill, y: arcs[i].args[1] }));
      return { rows: new Set(d.map((x) => x.y)).size, lit: d.filter((x) => x.fill !== "rgba(255,236,214,.07)").length };
    };
    const ROW = Math.floor(100 / PITCH);   // dots a row on the 100px box

    it("里: three dot rows; 3.5 of 7 lights half the width", async () => {
      const drawn = bars();
      serve();
      const { container } = page("#/v2/report?sheet=hours");
      await ready(container);
      await waitFor(() => expect(drawn(container).every((x) => x.length > 0)).toBe(true));
      // 100px / PITCH dots a row, half of them lit (rounded)
      expect(drawn(container).map(ura)).toEqual([{ rows: 3, lit: 3 * Math.round(ROW / 2) }, { rows: 3, lit: 0 }, { rows: 3, lit: 3 * ROW }]);
    });

    it("表: a printed bar three dot rows (9px) tall", async () => {
      applyWorld("omote");
      const drawn = bars();
      serve();
      const { container } = page("#/v2/report?sheet=hours");
      await ready(container);
      await waitFor(() => expect(drawn(container).every((x) => x.length > 0)).toBe(true));
      const fills = drawn(container).map((x) => x.filter((f) => f.op === "fillRect" && f.args[3] !== 1).map((f) => [f.args[2], f.args[3], f.fill]));
      expect(fills).toEqual([[[50, 9, "#0f1c2e"]], [], [[100, 9, "#0f1c2e"]]]);
    });

    it("an edited day's figure is what its bar (and the scale) stands for", async () => {
      const drawn = bars();
      const s = serve();
      s.db.edits[KEY] = new Map([["hours\u00002026-09-28\u0000hours", "14"]]);
      const { container } = page("#/v2/report?sheet=hours");
      await waitFor(() => expect(ink(hrs(container)[0] ?? null)).toContain("14.00"));
      await waitFor(() => expect(drawn(container).map(ura)).toEqual([{ rows: 3, lit: 3 * ROW }, { rows: 3, lit: 0 }, { rows: 3, lit: 3 * Math.round(ROW / 2) }]));
    });
  });

  it("an empty week: only 合計", async () => {
    serve(preview("2026-W40"));
    const { container } = page("#/v2/report?sheet=hours");
    await waitFor(() => expect(ink(container.querySelector(".rp-hours .total"))).toBe("合計|0.00"));
    expect(hrs(container)).toHaveLength(0);
  });

  it("renders in 表 too", async () => {
    applyWorld("omote");
    serve();
    const { container } = page("#/v2/report?sheet=hours");
    await ready(container);
    expect(ink(hrs(container)[2])).toBe("2026-10-01|周四|7.00");
  });
});

describe("成果物", () => {
  const dvs = (c: Element) => [...c.querySelectorAll(".rp-dlv .dv[data-task]")];
  const ready = async (c: Element) => { await waitFor(() => expect(ink(dvs(c)[2] ?? null)).toContain("9/30")); };

  it("a header, one row per deliverable: code from the row_key, title, path, done date", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=deliverables");
    await ready(container);
    expect(ink(container.querySelector(".rp-dlv .dv:not([data-task])"))).toBe("案件|成果物パス|完了日");
    expect(dvs(container).map((r) => r.getAttribute("data-task"))).toEqual(["T20260901-01", "T20260901-01", "T20260920-02"]);
    expect(dvs(container).map((r) => ink(r))).toEqual(["alpha 改修|--", "alpha 改修|--", "gamma 完了|9/30"]);
    for (const [i, code] of ["0901-01", "0901-01", "0920-02"].entries()) expect(await within(dvs(container)[i] as HTMLElement).findByRole("img", { name: code })).toBeTruthy();
    const paths = dvs(container).map((r) => r.querySelector(".path")!);
    expect(paths.map((p) => p.getAttribute("title"))).toEqual(["docs/a.md", LONG, "out/c.pdf"]);
    expect(paths.map((p) => p.querySelector("bdi")!.getAttribute("dir"))).toEqual(["ltr", "ltr", "ltr"]);
    // preflight R5: data, so lang="ja"
    expect(paths.map((p) => p.getAttribute("lang"))).toEqual(["ja", "ja", "ja"]);
    expect(paths[1].textContent).toBe(LONG);
  });

  it("editing a path puts it on deliverables/<taskId>|<i>/path", async () => {
    const s = serve();
    const { container } = page("#/v2/report?sheet=deliverables");
    await ready(container);
    fireEvent.click(edit(/^成果物パス：docs\/a\.md/));
    enter("成果物パス", "docs/b.md");
    await waitFor(() => expect(writes(s)).toEqual([put("deliverables", "T20260901-01|0", "path", "docs/b.md")]));
    await waitFor(() => expect(dvs(container)[0].querySelector(".path")!.getAttribute("title")).toBe("docs/b.md"));
  });

  it("title and done date edit in place too", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=deliverables");
    await ready(container);
    expect(within(dvs(container)[2] as HTMLElement).getAllByRole("button").map((b) => b.getAttribute("aria-label")!.split("：")[0])).toEqual(["案件", "成果物パス", "完了日"]);
    fireEvent.click(edit(/^完了日：2026-09-30/));
    expect(screen.getByLabelText("完了日").getAttribute("type")).toBe("date");
  });

  it("no deliverables this week: says so, in the interface language", async () => {
    serve(preview("2026-W40"));
    const { container, unmount } = page("#/v2/report?sheet=deliverables", "en");
    await waitFor(() => expect(ink(container.querySelector(".rp-view[data-sheet=deliverables]"))).toBe("No deliverables this week"));
    unmount();
    const z = page("#/v2/report?sheet=deliverables").container;
    await waitFor(() => expect(ink(z.querySelector(".rp-view[data-sheet=deliverables]"))).toBe("本周没有成果物"));
  });

  it("en: header in English", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=deliverables", "en");
    await ready(container);
    expect(ink(container.querySelector(".rp-dlv .dv:not([data-task])"))).toBe("TASK|PATH|DONE");
  });

  it("renders in 表 too", async () => {
    applyWorld("omote");
    serve();
    const { container } = page("#/v2/report?sheet=deliverables");
    await ready(container);
    expect(ink(dvs(container)[2])).toBe("gamma 完了|9/30");
    expect(await within(dvs(container)[2] as HTMLElement).findByRole("img", { name: "0920-02" })).toBeTruthy();
  });

  it("S2c §1: the 案件 title shows its full text — 里 cut into LED lines, 表 type that wraps", async () => {
    serve();
    const { container, unmount } = page("#/v2/report?sheet=deliverables");
    await ready(container);
    expect(dvs(container)[0].querySelector(".nm .ledlines")).not.toBeNull();
    unmount();
    applyWorld("omote");
    serve();
    const o = page("#/v2/report?sheet=deliverables").container;
    await ready(o);
    const ink = dvs(o)[0].querySelector(".nm .ink")!;
    expect(ink.classList.contains("iwrap")).toBe(true);
    expect(ink.classList.contains("iblk")).toBe(false);
  });
});

describe("input polish", () => {
  it("a polished cell shows 润 beside its editor; none without meta", async () => {
    const g = SUMMARY();
    g.rows[1].cells[1] = { ...g.rows[1].cells[1], polish: { raw: "にけん", pinned: false } };
    serve(withSheets(preview("2026-W40"), g, HOURS(), DELIV()));
    const ready = async (c: Element) => { await waitFor(() => expect(ink([...c.querySelectorAll(".rp-sum .kv")][5] ?? null)).not.toBe("")); };
    const { container, unmount } = page("#/v2/report?sheet=summary");
    await ready(container);
    expect(screen.getAllByRole("button", { name: "已润色" })).toHaveLength(1);
    // with a mark the wrapper holds the editor and the mark
    const w = container.querySelector(".pm-w")!;
    expect(w.querySelector(".rp-ed")).not.toBeNull();
    expect(w.querySelector(".pm")).not.toBeNull();
    unmount();
    serve();
    const b = page("#/v2/report?sheet=summary");
    await ready(b.container);
    expect(screen.queryByRole("button", { name: "已润色" })).toBeNull();
    // without one there is no wrapper: the editor is still its slot's direct child
    expect(b.container.querySelector(".pm-w")).toBeNull();
    expect(b.container.querySelector(".rp-sum .kv > .rp-ed, .rp-sum .kv > span > .rp-ed")).not.toBeNull();
  });
});
