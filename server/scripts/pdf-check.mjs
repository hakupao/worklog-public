// server/scripts/pdf-check.mjs
// Prints every PDF_FIXTURES entry with the system Chrome exactly as Browser Run does (same HTML, same __fit),
// then asserts the content fits (window.__fit over=false, the real one-page check: the sheet clips, so pdfinfo pages=1 is only
// a backstop), the expected fit step and fonts per fixture, no Type 3 font in pdffonts (Google Fonts CSS is made static first, staticFonts), and writes a PNG per fixture for a look. Exit 1 on any failure.
// Usage: node scripts/pdf-check.mjs [outDir]   (from server/; needs Chrome, poppler, network for Google Fonts)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

const here = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(process.argv[2] ?? path.join(here, "../.pdf-check"));
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

const entry = path.join(OUT, "entry.mjs");
await build({
  stdin: { contents: `export { renderReportHtml } from "../src/report/pdf/html.ts"; export { staticFonts } from "../src/report/pdf/fonts.ts"; export { PDF_FIXTURES } from "../test/fixtures/pdf-data.ts";`,
    resolveDir: here, loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: entry, logLevel: "warning",
});
const { renderReportHtml, staticFonts, PDF_FIXTURES } = await import(entry);
const { chromium } = createRequire(path.join(here, "../../web/package.json"))("playwright-core");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
// Last fit step each fixture must end at ("-" = none, a RegExp = any matching step) and the font family it must have loaded.
const EXPECT = { "ja-w40": [/^spread$/, "Shippori Mincho"], zh: [/^spread$/, "Noto Serif SC"], "en-long": ["-", "Shippori Mincho"], empty: [/^spread$/, "Shippori Mincho"],
  "en-mid": ["fit3", "Shippori Mincho"], "en-overflow": ["trim", "Shippori Mincho"], "en-extreme": ["clamp", "Shippori Mincho"],
  "ja-sparse": [/^spread$/, "Shippori Mincho"], "ja-5lines": [/^grow[12]$/, "Shippori Mincho"], "en-single-line": ["clamp", "Shippori Mincho"], "hand-edited": ["clamp", "Shippori Mincho"] };
let failed = 0;
for (const [name, data] of Object.entries(PDF_FIXTURES)) {
  const page = await browser.newPage();
  await page.setContent(await staticFonts(renderReportHtml(data)), { waitUntil: "networkidle", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const fit = await page.evaluate(() => window.__fit());
  const file = path.join(OUT, `${name}.pdf`);
  writeFileSync(file, await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
  await page.close();
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file], { encoding: "utf8" }))[1]);
  execFileSync("pdftoppm", ["-png", "-r", "80", "-singlefile", file, path.join(OUT, name)]);
  const pf = execFileSync("pdffonts", [file], { encoding: "utf8" });
  const type3 = pf.split("\n").slice(2).filter((l) => /\bType 3\b/.test(l));
  writeFileSync(path.join(OUT, `${name}.pdffonts.txt`), pf);
  const [step, font] = EXPECT[name] ?? ["-", ""];
  const last = fit.steps.at(-1) ?? "-";
  const needFill = name === "ja-w40" || name === "ja-sparse";
  const ok = pages === 1 && !fit.over && (!needFill || fit.fill >= 0.85) && (step instanceof RegExp ? step.test(last) : last === step) && fit.fonts.includes(font) && type3.length === 0 && pf.split("\n").length > 3;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: pages=${pages} steps=${fit.steps.join(",") || "-"} over=${fit.over} fill=${fit.fill.toFixed(2)} fonts=${fit.fonts.join("|")} type3=${type3.length}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
