import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../src/api/queries";
import { usePlanQueue } from "../src/pages/plan/write";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { V2Context } from "../src/ui/context";

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={createQueryClient()}>
    <V2Context.Provider value={{ prefs: DEFAULT_PREFS, lang: "zh", setPrefs: () => {}, resetPrefs: () => {}, setLang: () => {} }}>{children}</V2Context.Provider>
  </QueryClientProvider>
);
afterEach(() => { vi.unstubAllGlobals(); });
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };

describe("usePlanQueue (the drawers' writes)", () => {
  it("runs writes one after another, in click order — the second starts only after the first is done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const { result } = renderHook(() => usePlanQueue(), { wrapper: wrap });
    const log: string[] = [], g = gate();
    const a = result.current(async () => { log.push("a+"); await g.p; log.push("a-"); return 1; }, { key: "a" });
    const b = result.current(async () => { log.push("b"); return 2; }, { key: "b" });
    await waitFor(() => expect(log).toEqual(["a+"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual(["a+"]);                                   // b waits while a is open
    g.open();
    expect(await a).toBe(1);
    expect(await b).toBe(2);
    expect(log).toEqual(["a+", "a-", "b"]);
  });
  it("the same key as the write just before, still pending, is dropped; A → B → A sends all three (review A)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const { result } = renderHook(() => usePlanQueue(), { wrapper: wrap });
    const sent: string[] = [], g = gate();
    const job = (k: string) => result.current(async () => { sent.push(k); await g.p; return k; }, { key: k });
    void job("done"); const dup = job("done");
    void job("auto"); const last = job("done");
    expect(await dup).toBeUndefined();
    g.open();
    expect(await last).toBe("done");
    expect(sent).toEqual(["done", "auto", "done"]);
  });
  it("a failure does not stop the queue; rethrow hands it to the caller instead of a toast", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const { result } = renderHook(() => usePlanQueue(), { wrapper: wrap });
    const err = await result.current(async () => { throw new Error("boom"); }, { rethrow: true }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await result.current(async () => "next")).toBe("next");
  });
});
