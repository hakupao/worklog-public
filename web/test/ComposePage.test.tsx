import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeOut } from "../src/api/types";
import { fitWhenReady } from "../src/pages/report/compose/ComposePage";
import { GENERATING_RETRY_MS, TRANSLATING_POLL_MS } from "../src/pages/report/compose/useCompose";
import { ReportPage } from "../src/pages/ReportPage";
import { V2TestProvider } from "./helpers";
import { json } from "./rp-serve";

const WEEK = "2026-W41";
const base = (o: Partial<ComposeOut> = {}): ComposeOut => ({
  week: WEEK, inherited: true, updated_at: null, edited: false, generated_at: null, generating: false, translating: false,
  translate_failed: false, stale: { selection: false, inputs: false }, text: null,
  items: [
    { id: "A", mode: "show", title: "帳票修正", requester: "田中", minutes: 120 },
    { id: "B", mode: "show", title: "API 確認", requester: "鈴木", minutes: 60 },
    { id: "__unassigned", mode: "show", title: "その他・調査", requester: "", minutes: 30 },
  ], ...o,
});
let calls: Array<{ m: string; u: string; b: any }> = [];
/** `holdPut`: each PUT waits until the test calls the release it is handed (in arrival order). */
function serve(view: ComposeOut, o: { generate?: () => Response | Promise<Response>; holdPut?: Array<() => void>; holdText?: Array<() => void> } = {}) {
  let cur = view;
  vi.stubGlobal("fetch", vi.fn(async (u: string, init: RequestInit = {}) => {
    const m = init.method ?? "GET", b = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ m, u: String(u), b });
    if (String(u).includes("/pdf/preview")) return new Response("<html><body>PREVIEW</body></html>", { headers: { "Content-Type": "text/html" } });
    if (String(u).includes("/compose/generate")) return o.generate ? o.generate() : json(cur = { ...cur, text: { summary: ["■ x"], days: {} }, generated_at: "2026-10-09T01:00:00Z" });
    if (m === "PUT" && String(u).includes("/pdf/compose?")) {
      if (o.holdPut) await new Promise<void>((res) => o.holdPut!.push(res));
      cur = { ...cur, inherited: false, updated_at: `t${calls.length}`, items: b.items.map((i: any) => ({ ...cur.items.find((x) => x.id === i.id)!, mode: i.mode })) };
      return json(cur);
    }
    if (m === "PUT" && String(u).includes("/pdf/compose/text")) {
      if (o.holdText) await new Promise<void>((res) => o.holdText!.push(res));
      cur = { ...cur, edited: true, translating: false, text: { summary: b.summary, days: b.days } };
      return json(cur);
    }
    if (String(u).includes("/pdf/compose")) return json(cur);
    return json([]);
  }));
}
const page = (week = WEEK) => { window.location.hash = `#/v2/report/${week}/pdf`; return render(<V2TestProvider><ReportPage /></V2TestProvider>); };
const names = (c: Element, sel: string) => [...c.querySelectorAll(`${sel} .cmp-row .nm`)].map((e) => e.textContent);
const loaded = (c: Element) => waitFor(() => expect(c.querySelector('[data-id="A"]')).not.toBeNull());

describe("ComposePage", () => {
  beforeEach(() => { calls = []; vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.location.hash = ""; });

  it("lists the worked 案件 and moves a row to その他 at once, saving with updated_at null first", async () => {
    serve(base());
    const { container } = page();
    await waitFor(() => expect(names(container, ".cmp-show")).toEqual(["帳票修正", "API 確認", "その他・調査"]));
    fireEvent.click(container.querySelector('[data-id="B"] button[data-mode="other"]')!);
    expect(names(container, ".cmp-show")).toEqual(["帳票修正", "その他・調査"]);
    expect(names(container, ".cmp-other")).toEqual(["API 確認"]);
    await waitFor(() => expect(calls.find((c) => c.m === "PUT")?.b).toEqual({ updated_at: null,
      items: [{ id: "A", mode: "show" }, { id: "__unassigned", mode: "show" }, { id: "B", mode: "other" }] }));
  });

  it("B3b: a compose row shows the S badge (22 px) where the code Led was; the 未割当 row keeps `----`", async () => {
    serve(base());
    const { container } = page();
    await loaded(container);
    const b = container.querySelector<HTMLElement>('.cmp-row[data-id="A"] .code > .tbadge[data-task="A"]')!;
    expect(b.style.height).toBe("22px");
    expect(container.querySelector('.cmp-row[data-id="A"] .code .ink')).toBeNull();
    const un = container.querySelector('.cmp-row[data-id="__unassigned"] .code')!;
    expect(un.querySelector(".tbadge")).toBeNull();
    await waitFor(() => expect(un.querySelector(".ink")!.textContent).toBe("----"));
  });

  it("two quick changes are saved in order, the second with the first's token", async () => {
    serve(base());
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector('[data-id="B"] button[data-mode="hide"]')!);
    fireEvent.click(container.querySelector('[data-id="A"] button.dn')!);
    await waitFor(() => expect(calls.filter((c) => c.m === "PUT")).toHaveLength(2));
    const puts = calls.filter((c) => c.m === "PUT");
    expect(puts[0].b.updated_at).toBeNull();
    expect(puts[1].b.updated_at).not.toBeNull();
  });

  it("an older save's reply never undoes a newer local change", async () => {
    const held: Array<() => void> = [];
    serve(base(), { holdPut: held });
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector('[data-id="B"] button[data-mode="hide"]')!);
    fireEvent.click(container.querySelector('[data-id="A"] button[data-mode="other"]')!);
    await waitFor(() => expect(held).toHaveLength(1));
    await act(async () => { held[0](); });
    await waitFor(() => expect(held).toHaveLength(2));          // the second PUT went out after the first answered
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });   // the first reply has reached the query cache
    expect(names(container, ".cmp-other")).toEqual(["帳票修正"]);
    expect(names(container, ".cmp-hide")).toEqual(["API 確認"]);
    await act(async () => { held[1](); });
    await waitFor(() => expect(calls.filter((c) => c.m === "PUT")[1].b.items).toEqual(
      [{ id: "__unassigned", mode: "show" }, { id: "A", mode: "other" }, { id: "B", mode: "hide" }]));
    expect(names(container, ".cmp-other")).toEqual(["帳票修正"]);
  });

  it("asks the server for a preview of the draft (debounced) and shows it in the iframe", async () => {
    serve(base());
    const { container } = page();
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(container.querySelector<HTMLIFrameElement>("iframe.cmp-pv")?.getAttribute("srcdoc")).toContain("PREVIEW"));
    expect(calls.some((c) => c.u.includes("/pdf/preview?lang=ja"))).toBe(true);
  });

  it("generate locks the button while the request is in flight; a failure shows the reason and frees it", async () => {
    let answer!: () => void;
    serve(base(), { generate: () => new Promise<Response>((res) => { answer = () => res(json({ error: "generate failed", reason: "order:ja" }, 502)); }) });
    const { container } = page();
    await loaded(container);
    const btn = container.querySelector<HTMLButtonElement>("button.cmp-gen")!;
    fireEvent.click(btn);
    await waitFor(() => expect(calls.some((c) => c.u.includes("/compose/generate"))).toBe(true));
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    await act(async () => { answer(); });
    await waitFor(() => expect(container.textContent).toContain("order:ja"));
    expect(btn.disabled).toBe(false);
  });

  it("nothing left to write about (422) says so in the UI language", async () => {
    serve(base(), { generate: () => json({ error: "nothing to generate" }, 422) });
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>("button.cmp-gen")!);
    await waitFor(() => expect(container.textContent).toContain("没有可写的案件"));
    expect(container.textContent).not.toContain("nothing to generate");
  });

  it("a hidden-leak refusal (500) says so in the UI language, not the raw error", async () => {
    serve(base(), { generate: () => json({ error: "hidden leak" }, 500) });
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>("button.cmp-gen")!);
    await waitFor(() => expect(container.textContent).toContain("隐藏案件的内容混入了输入，未生成"));
    expect(container.textContent).not.toContain("hidden leak");
  });

  it("a successful generate shows 已按当前选择生成", async () => {
    serve(base());
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>("button.cmp-gen")!);
    await waitFor(() => expect(container.textContent).toContain("已按当前选择生成"));
    expect(calls.some((c) => c.m === "POST" && c.u.includes("/compose/generate"))).toBe(true);
  });

  it("409 generating says 正在生成… and reads the view again after 20 s", async () => {
    serve(base(), { generate: () => json({ error: "generating" }, 409) });
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>("button.cmp-gen")!);
    await waitFor(() => expect(container.textContent).toContain("正在生成…"));
    const gets = () => calls.filter((c) => c.m === "GET" && c.u.includes("/pdf/compose?")).length;
    const before = gets();
    await act(async () => { await vi.advanceTimersByTimeAsync(GENERATING_RETRY_MS); });
    await waitFor(() => expect(gets()).toBeGreaterThan(before));
    await waitFor(() => expect(container.textContent).not.toContain("正在生成…"));
  });

  it("no API key greys the button and says 生成不可用", async () => {
    serve(base(), { generate: () => json({ error: "generation unavailable" }, 503) });
    const { container } = page();
    await loaded(container);
    const btn = container.querySelector<HTMLButtonElement>("button.cmp-gen")!;
    fireEvent.click(btn);
    await waitFor(() => expect(container.textContent).toContain("生成不可用"));
    expect(btn.disabled).toBe(true);
  });

  it("stale selection shows the status line and the download asks first", async () => {
    serve(base({ text: { summary: ["■ x"], days: {} }, generated_at: "2026-10-09T01:00:00Z", stale: { selection: true, inputs: false }, inherited: false, updated_at: "t" }));
    const { container } = page();
    await waitFor(() => expect(container.textContent).toContain("选择已变更，文字未更新"));
    fireEvent.click(container.querySelector("button.cmp-pdf")!);
    expect(container.textContent).toContain("被隐藏的案件可能还在文字里");
    expect(calls.some((c) => c.u.includes("/pdf?lang="))).toBe(false);
  });

  it("先生成 in the stale-download bar still asks first when the text was edited", async () => {
    serve(base({ text: { summary: ["■ x"], days: {} }, edited: true, generated_at: "2026-10-09T01:00:00Z", stale: { selection: true, inputs: false }, inherited: false, updated_at: "t" }));
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector("button.cmp-pdf")!);
    fireEvent.click(container.querySelector(".cmp-ask button.key.pri")!);
    expect(container.textContent).toContain("重新生成会覆盖手改");
    expect(calls.some((c) => c.u.includes("/generate"))).toBe(false);
  });

  it("a view that says another request is generating shows 正在生成… and a locked button", async () => {
    serve(base({ generating: true }));
    const { container } = page();
    await loaded(container);
    expect(container.querySelector(".cmp-status")?.textContent).toBe("正在生成…");
    expect(container.querySelector<HTMLButtonElement>("button.cmp-gen")!.disabled).toBe(true);
  });

  it("a language switched to mid-save reads its view again once the save answers", async () => {
    const held: Array<() => void> = [];
    serve(base(), { holdPut: held });
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector('[data-id="B"] button[data-mode="other"]')!);
    await waitFor(() => expect(held).toHaveLength(1));
    const zh = [...container.querySelectorAll<HTMLButtonElement>(".rp-ctl [aria-pressed]")].find((b) => b.textContent?.includes("中文"))!;
    fireEvent.click(zh);                                   // 中文's view is read before the save landed: B still own row
    await waitFor(() => expect(calls.some((c) => c.u.includes("/pdf/compose?lang=zh"))).toBe(true));
    await waitFor(() => expect(names(container, ".cmp-show")).toEqual(["帳票修正", "API 確認", "その他・調査"]));
    await act(async () => { held[0](); });
    await waitFor(() => expect(names(container, ".cmp-other")).toEqual(["API 確認"]));
  });

  it("an edited text asks before regenerating", async () => {
    serve(base({ text: { summary: ["■ x"], days: {} }, edited: true, generated_at: "2026-10-09T01:00:00Z", inherited: false, updated_at: "t" }));
    const { container } = page();
    await loaded(container);
    fireEvent.click(container.querySelector<HTMLButtonElement>("button.cmp-gen")!);
    expect(container.textContent).toContain("重新生成会覆盖手改");
    expect(calls.some((c) => c.u.includes("/generate"))).toBe(false);
  });

  it("a failed retranslation says 翻译未完成", async () => {
    serve(base({ text: { summary: ["■ x"], days: {} }, edited: true, translate_failed: true, generated_at: "2026-10-09T01:00:00Z", inherited: false, updated_at: "t" }));
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".cmp-text")?.textContent).toContain("翻译未完成"));
  });

  it("a text edit waits for its save (the retranslation): 翻译中 and a busy field until the PUT answers, no polling meanwhile", async () => {
    const held: Array<() => void> = [];
    serve(base({ text: { summary: ["■ x"], days: {} }, generated_at: "2026-10-09T01:00:00Z", inherited: false, updated_at: "t" }), { holdText: held });
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".cmp-text [role=button]")).not.toBeNull());
    fireEvent.click(container.querySelector(".cmp-text [role=button]")!);
    const box = container.querySelector(".cmp-text textarea")!;
    fireEvent.change(box, { target: { value: "■ y" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(calls.find((c) => c.m === "PUT" && c.u.includes("/compose/text"))?.b).toEqual({ lang: "ja", summary: ["■ y"], days: {} });
    expect(container.querySelector(".cmp-text")!.textContent).toContain("翻译中…");
    expect(container.querySelector(".cmp-text .inline-edit.is-busy")).not.toBeNull();
    const gets = () => calls.filter((c) => c.m === "GET" && c.u.includes("/pdf/compose?")).length;
    const before = gets();
    await act(async () => { await vi.advanceTimersByTimeAsync(TRANSLATING_POLL_MS * 2); });
    expect(gets()).toBe(before);                         // its own save is not polled for
    await act(async () => { held[0](); });
    await waitFor(() => expect(container.querySelector(".cmp-text")!.textContent).not.toContain("翻译中…"));
    expect(container.querySelector(".cmp-text [role=button]")!.textContent).toBe("■ y");
  });

  it("a view that says another request is translating is re-read every few seconds", async () => {
    serve(base({ text: { summary: ["■ x"], days: {} }, translating: true, generated_at: "2026-10-09T01:00:00Z", inherited: false, updated_at: "t" }));
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".cmp-text")?.textContent).toContain("翻译中…"));
    const gets = () => calls.filter((c) => c.m === "GET" && c.u.includes("/pdf/compose?")).length;
    const before = gets();
    await act(async () => { await vi.advanceTimersByTimeAsync(TRANSLATING_POLL_MS + 100); });
    await waitFor(() => expect(gets()).toBeGreaterThan(before));
  });

  it("while a generation runs (this page or elsewhere) the text cannot be edited", async () => {
    serve(base({ text: { summary: ["■ x"], days: { "2026-10-05": ["d"] } }, generating: true, generated_at: "2026-10-09T01:00:00Z", inherited: false, updated_at: "t" }));
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll(".cmp-text [role=button]")).toHaveLength(1));
    for (const el of container.querySelectorAll(".cmp-text [role=button]")) {
      expect(el.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(el);
    }
    expect(container.querySelector(".cmp-text textarea")).toBeNull();
  });

  it("this page's own generation also blocks editing the text until it answers", async () => {
    let answer!: () => void;
    serve(base({ text: { summary: ["■ x"], days: {} }, generated_at: "2026-10-09T01:00:00Z", inherited: false, updated_at: "t" }),
      { generate: () => new Promise<Response>((res) => { answer = () => res(json({ error: "generate failed", reason: "r" }, 502)); }) });
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".cmp-text [role=button]")).not.toBeNull());
    fireEvent.click(container.querySelector<HTMLButtonElement>("button.cmp-gen")!);
    await waitFor(() => expect(container.querySelector(".cmp-text [role=button]")!.getAttribute("aria-disabled")).toBe("true"));
    await act(async () => { answer(); });
    await waitFor(() => expect(container.querySelector(".cmp-text [role=button]")!.getAttribute("aria-disabled")).toBeNull());
  });

  it("fitWhenReady: the preview is fitted only once its fonts are ready; at once when there is no font API", async () => {
    let ready!: () => void;
    const fit = vi.fn();
    fitWhenReady({ __fit: fit, document: { fonts: { ready: new Promise<void>((r) => { ready = r; }) } } } as never);
    await Promise.resolve();
    expect(fit).not.toHaveBeenCalled();
    ready();
    await waitFor(() => expect(fit).toHaveBeenCalledOnce());
    const now = vi.fn();
    fitWhenReady({ __fit: now, document: {} } as never);
    await waitFor(() => expect(now).toHaveBeenCalledOnce());
    expect(() => fitWhenReady(null)).not.toThrow();
  });

  it("at the cap the switches that would pass it are disabled, with the reason; folding the last その他 back allows 6", async () => {
    const items = [...Array.from({ length: 5 }, (_, i) => ({ id: `T${i}`, mode: "show" as const, title: `案件${i}`, requester: "", minutes: 50 - i })),
      { id: "O", mode: "other" as const, title: "雑務", requester: "", minutes: 5 }, { id: "H", mode: "hide" as const, title: "隠し", requester: "", minutes: 3 }];
    serve(base({ items }));
    const { container } = page();
    await waitFor(() => expect(container.querySelector('[data-id="T0"]')).not.toBeNull());
    expect(container.textContent).toContain("PDF 一页最多 5 个单列（无并入时 6 个）");
    expect(container.querySelector<HTMLButtonElement>('[data-id="H"] button[data-mode="show"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-id="H"] button[data-mode="other"]')!.disabled).toBe(false);
    const back = container.querySelector<HTMLButtonElement>('[data-id="O"] button[data-mode="show"]')!;
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    expect(names(container, ".cmp-show")).toHaveLength(6);
    expect(container.querySelector<HTMLButtonElement>('[data-id="H"] button[data-mode="show"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-id="H"] button[data-mode="other"]')!.disabled).toBe(true);
    await waitFor(() => expect(calls.find((c) => c.m === "PUT")?.b.items.filter((i: any) => i.mode === "show")).toHaveLength(6));
  });

  it("below the cap there is no cap note", async () => {
    serve(base());
    const { container } = page();
    await loaded(container);
    expect(container.textContent).not.toContain("PDF 一页最多");
  });

  it("the cap reason and the editable text's label are in the UI language (ja)", async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `T${i}`, mode: "show" as const, title: `案件${i}`, requester: "", minutes: 50 - i }));
    serve(base({ items, text: { summary: ["■ 案件0：済"], days: {} }, generated_at: "2026-10-09T01:00:00Z", inherited: false, updated_at: "t" }));
    window.location.hash = `#/v2/report/${WEEK}/pdf`;
    const { container } = render(<V2TestProvider lang="ja"><ReportPage /></V2TestProvider>);
    await waitFor(() => expect(container.querySelector(".cmp-text [role=button]")).not.toBeNull());
    expect(container.textContent).toContain("PDF の単独行は最大 5 件");
    const label = container.querySelector(".cmp-text [role=button]")!.getAttribute("aria-label")!;
    expect(label).toContain("クリックで編集");
    expect(label).not.toContain("点击编辑");
  });

  it("pages weeks within the composer and links back to the same week's 週報", async () => {
    serve(base({ week: "2026-W30" }));
    const { container } = page("2026-W30");             // a past week: this week's 週報 address has no week in it
    await loaded(container);
    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>(".rp-ctl a.key")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("#/v2/report/2026-W29/pdf");
    expect(hrefs).toContain("#/v2/report/2026-W31/pdf");
    expect(hrefs).toContain("#/v2/report/2026-W30");
  });

  it("an invalid week shows the not-available state and asks the server nothing", async () => {
    serve(base());
    const { container } = page("2026-W99");
    await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.querySelector(".cmp-row")).toBeNull();
    expect(calls.some((c) => c.u.includes("/pdf/compose"))).toBe(false);
  });

  it("the 週報 page has an 编排 key to this week's composer", async () => {
    serve(base());
    window.location.hash = `#/v2/report/${WEEK}`;
    const { container } = render(<V2TestProvider><ReportPage /></V2TestProvider>);
    await waitFor(() => expect(container.querySelector("a.cmp-open")?.getAttribute("href")).toBe(`#/v2/report/${WEEK}/pdf`));
  });
});
