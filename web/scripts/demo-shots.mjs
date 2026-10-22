#!/usr/bin/env node
// Screenshots of the built demo site (web/dist-demo, `npm run build:demo` first) for the README. They are written into
// dist-demo/shots/ and published with the GitHub Pages site, never committed (the README points at the Pages URLs).
// Starts `vite preview --mode demo` like demo-smoke.mjs; the demo strip is removed so the shots show the product only.
//
//   node scripts/demo-shots.mjs            # CHROME=<path to Chrome/Chromium>, DEMO_BASE=/worklog-public/ by default
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(web, "dist-demo/shots");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4175;
const BASE_PATH = process.env.DEMO_BASE ?? "/worklog-public/";
const ROOT = `http://localhost:${PORT}${BASE_PATH}`;

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/** [file, hash route, world, lang, device]. No full-page shots: a view draws only once it is on screen. */
const SHOTS = [
  ["now-ura.jpg", "#/v2/now", "ura", "en", DESKTOP],
  ["now-omote.jpg", "#/v2/now", "omote", "en", DESKTOP],
  ["now-ura-ja.jpg", "#/v2/now", "ura", "ja", DESKTOP],
  ["timeline.jpg", "#/v2/timeline", "ura", "en", DESKTOP],
  ["tasks.jpg", "#/v2/tasks", "omote", "en", DESKTOP],
  ["plan.jpg", "#/v2/plan", "ura", "en", DESKTOP],
  ["report.jpg", "#/v2/report", "omote", "ja", DESKTOP],
  ["stats.jpg", "#/v2/stats", "ura", "en", { ...DESKTOP, viewport: { width: 1440, height: 1700 } }],
  ["mobile-now.jpg", "#/m/now", "ura", "ja", PHONE],
  ["mobile-tl.jpg", "#/m/tl", "omote", "en", PHONE],
];

if (!existsSync(path.join(web, "dist-demo/index.html"))) throw new Error("dist-demo/ is missing: run `npm run build:demo` first");
mkdirSync(out, { recursive: true });

const preview = spawn(process.execPath, [path.join(web, "node_modules/vite/bin/vite.js"), "preview", "--mode", "demo", "--port", String(PORT), "--strictPort"],
  { cwd: web, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DEMO_BASE: BASE_PATH } });
let log = "";
preview.stdout.on("data", (d) => { log += d; });
preview.stderr.on("data", (d) => { log += d; });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let failed = 0;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(ROOT)).ok) break; } catch { /* not up yet */ }
    if (i > 100 || preview.exitCode !== null) throw new Error(`vite preview did not come up on ${ROOT}\n${log}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const [file, hash, world, lang, device] of SHOTS) {
    const ctx = await browser.newContext({ ...device, locale: lang === "en" ? "en-US" : lang === "ja" ? "ja-JP" : "zh-CN", timezoneId: "Asia/Tokyo" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${ROOT}?world=${world}&lang=${lang}${hash}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#root")?.childElementCount, null, { timeout: 30_000 });
    // fonts, the LED reveal and chart entry animations settle in about two seconds
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3500);
    await page.evaluate(() => document.getElementById("demo-banner")?.remove());
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 88 });
    if (errors.length) { failed++; console.error(`✗ ${file}: ${errors.join(" | ")}`); } else console.log(`✓ ${file}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.kill();
}
if (failed) process.exit(1);
