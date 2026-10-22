// server/src/report/pdf/browser.ts
// Browser Run (design 2026-10-08 §4.2): load the report HTML into a headless Chromium on Cloudflare, let its fonts
// arrive, fit it to one page (__fit, pdf/html.ts) and print. Never navigates to the site (it sits behind Access).
// Workers Free: 1 new browser per 20 s, 10 min a day — a launch refused for that is PdfBusy.
import puppeteer from "@cloudflare/puppeteer";
import { staticFonts } from "./fonts";

/** hiddenLines: a composed sheet's summary lines not shown whole (html.ts COMPOSED_FIT_JS); they make it over. */
export type Fit = { over: boolean; steps: string[]; fonts: string[]; hiddenLines?: number };

export class PdfBusy extends Error {
  constructor(public retryAfter: number) { super("Browser Run is busy"); }
}

// The wording Task 1 recorded for a refused launch (s3_spike.md); "429" covers both the rate and the daily limit.
const BUSY = /\b429\b|rate limit|time limit/i;

/** Seconds to wait before retrying a refused launch, or null when the failure is something else.
 *  The daily allowance ("Browser time limit exceeded for today") will not come back within the hour. */
export function busyAfter(message: string): number | null {
  if (/time limit/i.test(message)) return 3600;
  return BUSY.test(message) ? 20 : null;
}

export async function htmlToPdf(binding: Fetcher, html: string): Promise<{ pdf: Uint8Array; fit: Fit }> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  try {
    browser = await puppeteer.launch(binding);
  } catch (e) {
    const after = busyAfter(String((e as Error)?.message ?? e));
    if (after !== null) throw new PdfBusy(after);
    throw e;
  }
  try {
    const page = await browser.newPage();
    await page.setContent(await staticFonts(html), { waitUntil: "networkidle0", timeout: 30_000 });
    // A string, not a function: this file is typed without the DOM lib.
    const fit = (await page.evaluate("document.fonts.ready.then(() => window.__fit())")) as Fit;
    if (!fit || typeof fit.over !== "boolean") throw new Error("__fit missing");
    if (fit.fonts.length === 0) console.error("[pdf] web fonts missing", fit.fonts);
    if (fit.over) console.error("[pdf] still over one page after", fit.steps, fit.hiddenLines ? `${fit.hiddenLines} summary line(s) not shown whole` : "");
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, pageRanges: "1" });
    return { pdf, fit };
  } finally {
    await browser.close().catch((e) => console.error("[pdf] close failed", e));
  }
}

/** The renderer the route calls; tests swap it (no browser in vitest). */
export const pdfDeps = { htmlToPdf };
