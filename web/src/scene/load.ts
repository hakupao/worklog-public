/** The scene chunk (ascii.rest and its scenes, plus vendor/), fetched once; a failed fetch is forgotten so the next call retries
 *  (pattern: pages/stats/EChart.tsx). Only this file may import ./registry, and only dynamically (D11). */
let chunk: Promise<typeof import("./registry")> | null = null;
export const loadScenes = (): Promise<typeof import("./registry")> =>
  (chunk ??= import("./registry").catch((e: unknown) => { chunk = null; throw e; }));
