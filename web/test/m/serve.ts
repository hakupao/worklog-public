import { vi } from "vitest";
export const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
/** Stub fetch with an ordered prefix table: the first matching prefix answers. Unmatched URLs get {}. */
export function route(table: [string, unknown | (() => Response | Promise<Response>)][]) {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    for (const [p, b] of table) if (url.startsWith(p)) return typeof b === "function" ? (b as () => Response)() : json(b);
    return json({});
  }));
}
