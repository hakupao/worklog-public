import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setApiLang } from "../../src/api/client";

describe("X-Lang header", () => {
  afterEach(() => { setApiLang(null); vi.restoreAllMocks(); });

  it("sends the language when set, nothing when null", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    setApiLang("en");
    await api.tasks();
    expect(new Headers(f.mock.calls[0][1]!.headers).get("X-Lang")).toBe("en");
    f.mockResolvedValue(new Response("[]", { status: 200 }));
    setApiLang(null);
    await api.tasks();
    expect(new Headers(f.mock.calls[1][1]!.headers).get("X-Lang")).toBeNull();
  });

  it("keeps Content-Type alongside X-Lang on writes", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    setApiLang("zh");
    await api.patchNote("N1", "u", { text: "x" });
    const h = new Headers(f.mock.calls[0][1]!.headers);
    expect([h.get("X-Lang"), h.get("Content-Type")]).toEqual(["zh", "application/json"]);
  });
});
