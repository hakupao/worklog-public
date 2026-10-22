import { describe, expect, it, vi } from "vitest";
import { downloadPdf } from "../src/pages/report/pdf";

const deps = (res: Response | (() => Response)) => ({
  fetch: vi.fn(async () => (typeof res === "function" ? res() : res)) as unknown as typeof fetch,
  save: vi.fn(), navigate: vi.fn(),
});

describe("downloadPdf", () => {
  it("saves the PDF under the server's file name pattern", async () => {
    const d = deps(new Response(new Blob(["%PDF"]), { status: 200, headers: { "Content-Type": "application/pdf" } }));
    expect(await downloadPdf("2026-W40", "en", d)).toEqual({ ok: true });
    expect(d.fetch).toHaveBeenCalledWith("/api/reports/2026-W40/pdf?lang=en", { credentials: "same-origin", redirect: "manual" });
    expect(d.save).toHaveBeenCalledWith(expect.any(Blob), "2026-W40-en.pdf");
  });

  it("an expired Access session (opaque redirect / 401) navigates to the same URL instead", async () => {
    const opaque = Object.defineProperty(new Response(null, { status: 200 }), "type", { value: "opaqueredirect" });
    const d = deps(opaque);
    expect(await downloadPdf("2026-W40", "ja", d)).toEqual({ ok: true });
    expect(d.navigate).toHaveBeenCalledWith("/api/reports/2026-W40/pdf?lang=ja");
    const d2 = deps(new Response("", { status: 401 }));
    await downloadPdf("2026-W40", "ja", d2);
    expect(d2.navigate).toHaveBeenCalled();
  });

  it("busy → {ok:false, busy: seconds}; any other failure → busy null; nothing saved", async () => {
    const busy = deps(new Response(JSON.stringify({ error: "pdf busy", retry_after: 20 }), { status: 503, headers: { "Retry-After": "20" } }));
    expect(await downloadPdf("2026-W40", "ja", busy)).toEqual({ ok: false, busy: 20 });
    const fail = deps(new Response(JSON.stringify({ error: "pdf failed" }), { status: 502 }));
    expect(await downloadPdf("2026-W40", "ja", fail)).toEqual({ ok: false, busy: null });
    const offline = { ...deps(new Response()), fetch: vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch };
    expect(await downloadPdf("2026-W40", "ja", offline)).toEqual({ ok: false, busy: null });
    expect(busy.save).not.toHaveBeenCalled();
  });
});
