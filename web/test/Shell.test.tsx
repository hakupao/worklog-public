import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../src/api/queries";
import { usePrefs, __resetPrefsQueueForTests } from "../src/prefs/usePrefs";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { Shell } from "../src/ui/Shell";
import { getWorld, applyWorld } from "../src/world/store";
import { __resetWorldForTests, setWorldFxSource, setWorldPersist } from "../src/world/transitions";
import { Led } from "../src/ui/Led";
import { V2TestProvider } from "./helpers";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
// jsdom has no canvas 2D and prints "Not implemented" on every getContext call; answer null quietly.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetWorldForTests(); applyWorld("ura"); window.location.hash = ""; });

function renderShell(over: { lang?: "zh" | "ja" | "en"; setLang?: (l: string) => void; machines?: { name: string; last_seen_at: string }[] } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    if (url.includes("/api/machines")) return json(over.machines ?? [{ name: "macmini", last_seen_at: "2026-10-05T09:00:00Z" }, { name: "win11", last_seen_at: "2026-10-05T08:00:00Z" }]);
    if (url.includes("/api/tasks") || url.includes("/api/requesters")) return json([]);   // NoteForm's 案件 picker
    return json({});
  }));
  const ctxSetLang = vi.fn(over.setLang ?? (() => {}));
  const ui = render(
    <V2TestProvider lang={over.lang}>
      <ShellWithSetLang setLang={ctxSetLang}><Shell page="settings" titleKey="nav.settings"><Led text="WL" task="T1" /><Led text="other" task="T2" /></Shell></ShellWithSetLang>
    </V2TestProvider>,
  );
  return { ...ui, setLang: ctxSetLang };
}
// Re-provide the context with a spy setLang (V2TestProvider's is a no-op).
import type { ReactNode } from "react";
import { V2Context, useV2 } from "../src/ui/context";
function ShellWithSetLang({ setLang, children }: { setLang: (l: string) => void; children: ReactNode }) {
  const ctx = useV2();
  return <V2Context.Provider value={{ ...ctx, setLang: setLang as never }}>{children}</V2Context.Provider>;
}

describe("Shell", () => {
  it("dock lists seven pages, the language switch, the world switch, settings, 补记 and the 手机版 link", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "页面" });
    const links = [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["#/v2/now", "#/v2/timeline", "#/v2/tasks", "#/v2/plan", "#/v2/report", "#/v2/stats", "#/v2/usage", "#/v2/settings"]);
    expect(nav.querySelector('a[href="#/m/now"]')).toBeNull();                 // its own pill, not in the clipped dock
    expect(screen.getByRole("link", { name: "手机版" }).getAttribute("href")).toBe("#/m/now");
    expect(screen.getByRole("group", { name: "界面语言" }).querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /切换表世界/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "补记" })).toBeTruthy();
    expect(nav.querySelector('a[href="#/v2/settings"]')!.getAttribute("aria-current")).toBe("page");
  });

  it("header shows each machine's last collection in Tokyo time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));   // Tokyo 19:00 on 10/5: both collections are today
    const { container } = renderShell();
    await screen.findByText((_, el) => el?.classList.contains("ink") === true && /MAC 18:00 已收集/.test(el.textContent ?? ""));
    expect(container.querySelector(".v2-hd")!.textContent).toMatch(/WIN 17:00 已收集/);
  });

  it("header dates a machine whose last collection was not today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
    const { container } = renderShell({ machines: [{ name: "macmini", last_seen_at: "2026-10-05T09:00:00Z" }, { name: "win11", last_seen_at: "2026-10-04T08:00:00Z" }] });
    await screen.findByText((_, el) => el?.classList.contains("ink") === true && /WIN 10\/4 17:00 已收集/.test(el.textContent ?? ""));
    expect(container.querySelector(".v2-hd")!.textContent).toMatch(/MAC 18:00 已收集/);
  });

  it("W toggles the world, but not while typing in an input", async () => {
    setWorldFxSource(() => "scan"); applyWorld("ura");
    renderShell();
    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { key: "w" });
    expect(getWorld()).toBe("ura");
    await act(async () => { fireEvent.keyDown(document.body, { key: "w" }); });
    expect(getWorld()).toBe("omote");
    input.remove();
  });

  it("Q toggles squint; modifiers are ignored", () => {
    const { container } = renderShell();
    const hall = container.querySelector(".v2-hall")!;
    fireEvent.keyDown(document.body, { key: "q", metaKey: true });
    expect(hall.classList.contains("squint")).toBe(false);
    fireEvent.keyDown(document.body, { key: "q" });
    expect(hall.classList.contains("squint")).toBe(true);
  });

  it("hovering a task lights every element of that task and dims the rest", () => {
    const { container } = renderShell();
    const hall = container.querySelector(".v2-hall")!;
    const t1 = container.querySelector('canvas[data-task="T1"]')!;
    fireEvent.pointerOver(t1);
    expect(hall.classList.contains("fx")).toBe(true);
    expect([...container.querySelectorAll(".hl")].every((e) => (e as HTMLElement).dataset.task === "T1")).toBe(true);
    expect(container.querySelectorAll('[data-task="T1"].hl')).toHaveLength(2);     // canvas + ink twin
    fireEvent.pointerLeave(hall);
    expect(hall.classList.contains("fx")).toBe(false);
  });

  it("clicking the current page's link does not navigate or fade", () => {
    window.location.hash = "#/v2/settings";
    renderShell();
    const a = screen.getByRole("navigation", { name: "页面" }).querySelector('a[href="#/v2/settings"]')!;
    fireEvent.click(a);
    expect(window.location.hash).toBe("#/v2/settings");
  });

  it("language buttons call setLang with the button as origin", () => {
    const { setLang } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    expect(setLang).toHaveBeenCalledWith("ja", expect.any(HTMLButtonElement));
  });

  it("补记 opens the note form in a panel and Escape closes it", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "补记" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.className).toContain("lg2");
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Shell clock and overrides", () => {
  it("the header date rolls over at Tokyo midnight from the same 1s tick as the clock", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-05T14:59:58Z"));          // 23:59:58 JST, Mon 5 Oct
    const { container } = renderShell({ lang: "en" });
    const date = () => container.querySelector(".v2-date .ink")!.textContent;
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(date()).toMatch(/OCT 5, 2026/);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(date()).toMatch(/OCT 6, 2026/);
  });

  it("switching language / world on the dock drops only that override from the hash, then writes prefs", async () => {
    __resetPrefsQueueForTests();
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      if (url.includes("/api/prefs")) {
        if (init?.method === "PUT") { const b = JSON.parse(String(init.body)); puts.push(b); return json(b); }
        return json(DEFAULT_PREFS);
      }
      if (url.includes("/api/machines") || url.includes("/api/tasks") || url.includes("/api/requesters")) return json([]);
      return json({});
    }));
    window.location.hash = "#/v2/settings?world=omote&lang=ja";
    const Real = () => {
      const { prefs, setPrefs, resetPrefs } = usePrefs();
      setWorldPersist((w) => setPrefs((p) => ({ ...p, world: w })));
      return (
        <V2Context.Provider value={{ prefs, lang: prefs.lang, setPrefs, resetPrefs, setLang: (l) => setPrefs((p) => ({ ...p, lang: l })) }}>
          <Shell page="settings" titleKey="nav.settings"><span /></Shell>
        </V2Context.Provider>
      );
    };
    render(<QueryClientProvider client={createQueryClient()}><Real /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(window.location.hash).toBe("#/v2/settings?world=omote");
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ lang: "en", world: DEFAULT_PREFS.world });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Switch front/ })); });
    expect(window.location.hash).toBe("#/v2/settings");
    await vi.waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toMatchObject({ lang: "en", world: getWorld() });
  });
});
