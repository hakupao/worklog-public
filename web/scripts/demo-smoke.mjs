#!/usr/bin/env node
// Smoke test of the built demo site (web/dist-demo, `npm run build:demo` first). Starts `vite preview --mode demo`
// (or uses DEMO_URL), opens every desktop page and every phone page in the system Chrome, and fails on any console
// error, page error, failed request or non-2xx /api answer inside the page; checks that the demo strip covers no
// control; then calls every GET route the UI can reach through the in-page app with representative parameters,
// which must all answer 2xx. Prints a table. Usage: node scripts/demo-smoke.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { DEMO_NOW } from "../demo/clock.ts";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4174;
const BASE_PATH = process.env.DEMO_BASE ?? "/worklog-public/";
const URL0 = process.env.DEMO_URL ?? `http://localhost:${PORT}${BASE_PATH}`;
const DESKTOP = ["now", "timeline", "tasks", "plan", "report", "stats", "usage", "settings"];   // src/route.ts V2_PAGES
const PHONE = ["now", "tl", "tasks", "plan", "stats"];                                          // src/m/route.ts M_PAGES
/** Non-2xx /api answers a page may get by design: GET /api/day-plans/<date> is 404 `no plan` for a day that was not
 *  started (api.dayPlan reads it as null). Each entry: [method, path regexp, status, body regexp]. */
const EXPECTED = [["GET", /^\/api\/day-plans\/\d{4}-\d{2}-\d{2}$/, 404, /no plan/]];

let preview = null;
async function startPreview() {
  if (process.env.DEMO_URL) return;
  preview = spawn(process.execPath, [path.join(web, "node_modules/vite/bin/vite.js"), "preview", "--mode", "demo", "--port", String(PORT), "--strictPort"],
    { cwd: web, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DEMO_BASE: BASE_PATH } });
  let log = "";
  preview.stdout.on("data", (d) => { log += d; });
  preview.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(URL0)).ok) return; } catch { /* not up yet */ }
    if (preview.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite preview did not come up on ${URL0}\n${log}`);
}

// --- dates from the demo clock (JST) ---
const DAY = 86_400_000;
const jstDate = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
function isoWeek(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
  return `${d.getUTCFullYear()}-W${String(1 + Math.round((d - jan4) / (7 * DAY))).padStart(2, "0")}`;
}
const today = jstDate(DEMO_NOW);
const weeks = [0, 1, 2, 5].map((n) => isoWeek(jstDate(DEMO_NOW - n * 7 * DAY)));
const monthAgo = jstDate(DEMO_NOW - 30 * DAY), weekAgo = jstDate(DEMO_NOW - 6 * DAY);

const rows = [];
const fail = (what, detail) => rows.push({ what, ok: false, detail });
const pass = (what, detail = "") => rows.push({ what, ok: true, detail });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  await startPreview();

  /** Opens one page fresh and waits until the in-page app has been quiet for a moment. */
  async function visit(ctx, hash, label, check) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`));
    page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
    await page.goto(`${URL0}${hash}`, { waitUntil: "load" });
    await page.waitForFunction(() => (document.getElementById("root")?.children.length ?? 0) > 0 && (window.__demoApi?.length ?? 0) > 0, null, { timeout: 20_000 })
      .catch(() => errors.push("no content / no /api call within 20 s"));
    // quiet: no new /api call for 1 s
    let n = -1;
    for (let i = 0; i < 40; i++) {
      const m = await page.evaluate(() => window.__demoApi?.length ?? 0);
      if (m === n) break;
      n = m;
      await page.waitForTimeout(1000);
    }
    const api = await page.evaluate(() => window.__demoApi ?? []);
    for (const e of api) {
      if (e.status >= 200 && e.status < 300) continue;
      if (EXPECTED.some(([m, p, s, b]) => m === e.method && p.test(e.path.split("?")[0]) && s === e.status && b.test(e.body ?? ""))) continue;
      errors.push(`api ${e.method} ${e.path} -> ${e.status} ${e.body ?? ""}`);
    }
    const extra = check ? await check(page) : "";
    if (typeof extra === "string" && extra.startsWith("FAIL")) errors.push(extra);
    if (errors.length) fail(label, errors.join(" | ").slice(0, 600));
    else pass(label, `${api.length} api calls${extra ? ` · ${extra}` : ""}`);
    return page;
  }

  /** The strip must be there, and no visible control may sit under it. */
  const bannerCheck = (page) => page.evaluate(() => {
    const bar = document.getElementById("demo-banner");
    if (!bar || !bar.textContent?.includes("GitHub")) return "FAIL banner missing";
    const b = bar.getBoundingClientRect();
    const hits = [];
    for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab], [tabindex]:not([tabindex='-1'])")) {
      if (bar.contains(el) || el.closest(".demo-pv")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
      if (r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom) hits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.textContent ?? "").trim().slice(0, 20)}"`);
    }
    return hits.length ? `FAIL banner covers ${hits.join(", ")}` : `banner ${Math.round(b.width)}×${Math.round(b.height)} "${bar.querySelector(".t")?.textContent?.slice(0, 12)}…"`;
  });

  // --- desktop ---
  const desk = await browser.newContext({ viewport: { width: 1512, height: 945 } });
  let crawlPage = null;
  for (const p of DESKTOP) {
    const page = await visit(desk, `#/v2/${p}`, `desktop #/v2/${p}`, bannerCheck);
    if (p === "now") crawlPage = page; else await page.close();
  }
  // a narrower desktop window, where the dock and the strip are closest
  const narrow = await browser.newContext({ viewport: { width: 760, height: 900 } });
  for (const p of ["now", "timeline", "report"]) await (await visit(narrow, `#/v2/${p}`, `desktop 760px #/v2/${p}`, bannerCheck)).close();

  // --- phone ---
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  for (const p of PHONE) await (await visit(phone, `#/m/${p}`, `phone #/m/${p}`, bannerCheck)).close();
  const redirect = await visit(phone, "#/v2/timeline", "phone redirect #/v2/timeline → #/m/tl", async (page) => {
    await page.waitForTimeout(300);
    const h = await page.evaluate(() => location.hash);
    return h.startsWith("#/m/tl") ? `landed on ${h}` : `FAIL landed on ${h}`;
  });
  await redirect.close();

  // --- clock: the page and the server both run on the demo clock ---
  const clock = await crawlPage.evaluate(async () => {
    const r = await fetch("/api/day-plans/" + new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10));
    return { now: new Date().toISOString(), dayPlan: r.status };
  });
  const drift = Date.parse(clock.now) - DEMO_NOW;
  if (drift >= 0 && drift < 10 * 60_000 && clock.dayPlan === 200) pass("clock", `page now ${clock.now} (DEMO_NOW + ${Math.round(drift / 1000)} s); today's day plan 200`);
  else fail("clock", JSON.stringify(clock));

  // --- no model in the demo: generation answers 503 (the composer shows 生成不可用), nothing throws ---
  const gen = await crawlPage.evaluate(async (week) => {
    const r = await fetch(`/api/reports/${week}/pdf/compose/generate`, { method: "POST" });
    return { status: r.status, body: await r.text() };
  }, weeks[0]);
  if (gen.status === 503 && /generation unavailable/.test(gen.body)) pass("POST …/pdf/compose/generate (LLM)", `503 ${gen.body}`);
  else fail("POST …/pdf/compose/generate (LLM)", `${gen.status} ${gen.body}`);

  // --- the strip follows the UI language (<html lang>) ---
  const strip = await crawlPage.evaluate(async () => {
    const h = document.documentElement, old = h.lang, out = {};
    for (const l of ["ja", "en", "zh-CN"]) { h.lang = l; await new Promise((r) => setTimeout(r, 0)); out[l] = document.querySelector("#demo-banner .t")?.textContent; }
    h.lang = old;
    return out;
  });
  if (strip.ja?.startsWith("デモ") && strip.en?.startsWith("Demo") && strip["zh-CN"]?.startsWith("演示站")) pass("demo strip language", Object.values(strip).map((t) => t.slice(0, 8)).join(" / "));
  else fail("demo strip language", JSON.stringify(strip));

  // --- every GET route through the in-page app ---
  const tasks = await crawlPage.evaluate(() => fetch("/api/tasks").then((r) => r.json()));
  const taskId = tasks[0]?.id;
  const reviews = await crawlPage.evaluate(() => fetch("/api/reviews?limit=8").then((r) => r.json()));
  const reviewWeek = reviews[0]?.week;
  const routes = [
    "/api/health", "/api/me", "/api/stats", "/api/machines", "/api/machines/runs", "/api/requesters", "/api/prefs",
    "/api/tasks", "/api/tasks?status=open", "/api/tasks?status=done,dropped", "/api/tasks/totals",
    ...(taskId ? [`/api/tasks/${encodeURIComponent(taskId)}`] : []),
    "/api/sessions?unlinked=1",
    "/api/plan-items", "/api/plan-items?status=closed",
    `/api/day-plans/${today}`, `/api/day-plans/${today}/judge-input`,
    "/api/dashboard", `/api/dashboard?from=${weekAgo}&to=${today}`, `/api/dashboard?from=${monthAgo}&to=${today}`, `/api/dashboard?from=${today}&to=${today}`,
    `/api/stats/sessions?from=${monthAgo}&to=${today}`, `/api/stats/sessions?from=${today}&to=${today}`,
    "/api/reviews?limit=8", ...(reviewWeek ? [`/api/reviews/${reviewWeek}`] : []),
    "/api/reports/range/bounds", `/api/reports/range/xlsx?from=${weeks[2]}&to=${weeks[0]}&lang=zh`,
    "/api/ingest/deliverables/pending?machine=demo-mac",
    ...weeks.flatMap((w) => [
      `/api/weeks/${w}/timeline`, `/api/weeks/${w}/timeline?include_hidden=1`, `/api/report-downloads?week=${w}`,
      `/api/reports/${w}/weekly`, `/api/reports/${w}/digest-inputs`,
      ...["zh", "ja", "en"].flatMap((l) => [`/api/reports/${w}/pdf/compose?lang=${l}`]),
    ]),
    ...["zh", "ja", "en"].flatMap((l) => [`/api/reports/${weeks[0]}/weekly/xlsx?lang=${l}`, `/api/reports/${weeks[0]}/pdf?lang=${l}`]),
  ];
  const results = await crawlPage.evaluate(async (routes) => {
    const out = [];
    for (const p of routes) {
      for (const lang of [null, "zh", "en"]) {
        const t0 = performance.now();
        const r = await fetch(p, { headers: lang ? { "X-Lang": lang } : {} });
        const body = await r.arrayBuffer();
        out.push({ p, lang, status: r.status, type: r.headers.get("Content-Type") ?? "", bytes: body.byteLength, ms: Math.round(performance.now() - t0),
          text: r.ok ? "" : new TextDecoder().decode(body).slice(0, 200) });
      }
    }
    return out;
  }, routes);
  for (const r of results) {
    const what = `GET ${r.p}${r.lang ? ` [X-Lang ${r.lang}]` : ""}`;
    if (r.status >= 200 && r.status < 300) pass(what, `${r.status} ${r.type.split(";")[0]} ${r.bytes} B ${r.ms} ms`);
    else fail(what, `${r.status} ${r.text}`);
  }

  // --- downloads, through the report page's own keys: ↓ xlsx → range panel → 下载 (an <a href="/api/…">), ↓ PDF ---
  const dl = await browser.newContext({ viewport: { width: 1512, height: 945 }, acceptDownloads: true });
  const rp = await visit(dl, `#/v2/report/${weeks[1]}`, `desktop #/v2/report/${weeks[1]}`);
  const pageErrors = [];
  rp.on("pageerror", (e) => pageErrors.push(e.message));
  rp.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  await rp.click("button.key.pri.xlsx");
  const [download] = await Promise.all([rp.waitForEvent("download", { timeout: 10_000 }).catch(() => null), rp.click("a.rx-go")]);
  if (download && /\.xlsx$/.test(download.suggestedFilename())) pass("↓ xlsx → 下载 link", `download ${download.suggestedFilename()}`);
  else fail("↓ xlsx → 下载 link", "no download");
  await rp.click("button.key.pri.pdf");
  // a composition older than the week's data asks first (.cmp-ask); then 仍然下载
  const first = await rp.waitForSelector(".demo-pv iframe, .cmp-ask", { timeout: 10_000 }).catch(() => null);
  if (first && await first.evaluate((el) => el.matches(".cmp-ask *, .cmp-ask"))) await rp.click(".cmp-ask button.key.dim");
  const pv = await rp.waitForSelector(".demo-pv iframe", { timeout: 10_000 }).catch(() => null);
  const sheet = pv && await (await pv.contentFrame())?.waitForSelector(".sheet", { timeout: 5000 }).catch(() => null);
  const dlRow = await rp.evaluate(() => (window.__demoApi ?? []).filter((e) => /\/pdf\?/.test(e.path)).map((e) => e.status).join(","));
  if (sheet && !pageErrors.length) pass("↓ PDF → print preview overlay", `GET …/pdf ${dlRow}; renderReportHtml page in .demo-pv`);
  else fail("↓ PDF → print preview overlay", `${sheet ? "" : "overlay or .sheet missing; "}${pageErrors.join(" | ")}`);
  await dl.close();
} finally {
  await browser.close();
  preview?.kill();
}

// --- table ---
const w = Math.min(90, Math.max(...rows.map((r) => r.what.length)));
for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.what.padEnd(w)}  ${r.detail}`);
const bad = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - bad}/${rows.length} passed${bad ? `, ${bad} FAILED` : ""}`);
process.exit(bad ? 1 : 0);
