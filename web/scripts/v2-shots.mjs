// Headless screenshots of the v2 pages for the evidence folder (spec §11). Images are gitignored and stay
// local; record what they show in the folder's shots.md. Needs `wrangler dev` (8787) and `vite` (5173) running. Uses the system Chrome; fails if any page logs a console error.
// ST7B=<dir> adds the 统计视图 section (sub-project 7b, shots7b below) from API answers in <dir>; SHOTS=7b runs that
// section alone (vite only, no wrangler).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const OUT = path.resolve(process.argv[2] ?? "../docs/projects/2026-10-20-now-relayout/evidence/shots");
const BASE = process.env.V2_BASE ?? "http://localhost:5173";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGES = ["settings", "now", "timeline"];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
// The app ships no favicon (pre-existing, same on the old UI); stub it so its 404 is not logged as an error.
await ctx.route("**/favicon.ico", (r) => r.fulfill({ status: 204 }));
const page = await ctx.newPage();
const errors = [];
// GET /api/day-plans/<today> answers 404 when no day plan exists (api.dayPlan reads it as null; the old UI makes the same request).
page.on("console", (m) => { if (m.type() === "error" && !(m.location().url.includes("/api/day-plans/") && /404/.test(m.text()))) errors.push(`${page.url()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const settle = () => page.waitForTimeout(2200);
// Pixel-font cuts (led/fonts.ts) are added to document.fonts only once they have loaded, so `need` lists the cuts the
// page must have: the run fails if one is still missing after 8 s (final review C1). Then a short settle.
const fontsSettle = async (ms = 1200, need = []) => {
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(async (need) => {
    const has = () => need.filter((f) => ![...document.fonts].some((x) => x.family.replace(/"/g, "") === f && x.status === "loaded"));
    for (let i = 0; i < 80 && has().length; i++) await new Promise((r) => setTimeout(r, 100));
    return has();
  }, need);
  if (missing.length) errors.push(`${page.url()}: pixel fonts not loaded: ${missing.join(", ")}`);
  await page.waitForTimeout(ms);
};
// Glyph check (final review C1, documented in the relayout shots.md): bits() samples the cut at 4× size at each
// design pixel's block centre (led/bits.ts). (1) The same sampling of "15 19 9" in fp8-sc must equal GLYPH_REF, a
// reference taken from a good run, and must differ from the fallback face (or the reference itself is the fallback).
// (2) The page's own bits() (the dev server's module, so its live cache) must return, for every hour label and day
// number 0–31 and the clock "13:30", the same bitmap as a fresh sampling of the loaded cut: a bitmap cached while the
// cut was still loading fails here. Returns the failures.
const GLYPH_REF = [   // "15 19 9", fp8-sc, Chrome on macOS (2026-10-20)
  "..#..####........#...##........##..",
  ".##..#..........##..#..#......#..#.",
  "..#..###.........#..#..#......#..#.",
  "..#.....#........#...###.......###.",
  "..#.....#........#.....#.........#.",
  ".###.###........###..##........##..",
  "...................................",
  "...................................",
];
const glyphCheck = (tag) => page.evaluate(async ({ tag, REF }) => {
  // the URL the app itself loaded (after an edit Vite serves it as bits.ts?t=…, a separate module with its own cache)
  const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /\/src\/led\/bits\.ts(\?|$)/.test(n)) ?? "/src/led/bits.ts";
  const { bits } = await import(url);
  const K = 4, SIZE = 8, ASC = 6;
  const cv = document.createElement("canvas"), x = cv.getContext("2d", { willReadFrequently: true });
  const raster = (text, family) => {
    x.font = `${SIZE * K}px ${family}`;
    const w = Math.max(1, Math.ceil(x.measureText(text).width / K)), W = w * K;
    cv.width = W; cv.height = SIZE * 2 * K;
    x.font = `${SIZE * K}px ${family}`; x.textBaseline = "alphabetic"; x.fillStyle = "#fff";
    x.clearRect(0, 0, cv.width, cv.height);
    const bl = ASC + 2;
    x.fillText(text, 0, bl * K);
    const d = x.getImageData(0, (bl - ASC) * K, W, SIZE * K).data, c = K >> 1, rows = [];
    for (let y = 0; y < SIZE; y++) { let r = ""; for (let i = 0; i < w; i++) r += d[((y * K + c) * W + i * K + c) * 4 + 3] > 127 ? "#" : "."; rows.push(r); }
    return rows;
  };
  const rowsOf = (b) => Array.from({ length: b.h }, (_, y) => Array.from({ length: b.w }, (_, i) => (b.on[y * b.w + i] ? "#" : ".")).join(""));
  const fails = [], ref = raster("15 19 9", '"fp8-sc"');
  if (ref.join("/") !== REF.join("/")) fails.push(`${tag}: fp8-sc "15 19 9" differs from GLYPH_REF: ${JSON.stringify(ref)}`);
  if (raster("15 19 9", "sans-serif").join("/") === ref.join("/")) fails.push(`${tag}: fp8-sc renders like the fallback face`);
  const strs = [...Array.from({ length: 32 }, (_, i) => String(i)), "13:30"];
  for (const s of strs) if (rowsOf(bits(s, 8, "zh")).join("/") !== raster(s, '"fp8-sc"').join("/")) fails.push(`${tag}: page bits("${s}", 8, zh) is not the fp8-sc cut (stale cache)`);
  return { fails, checked: strs.length };
}, { tag, REF: GLYPH_REF });
const unfocus = () => page.evaluate(() => document.activeElement?.blur());   // no focus ring on shots taken after a dock click
const finish = async () => {
  await browser.close();
  if (errors.length) { console.error("console errors:\n" + errors.join("\n")); process.exit(1); }
  console.log(`ok: screenshots in ${OUT}, no console errors`);
  process.exit(0);
};

// 统计视图 (sub-project 7b): every view's band (section.sv) on its own — 近 4 周 in 里, in 表 with stats.cost /
// stats.review shown and hidden (the page as a whole, through the served prefs), 近 3 个月 in 里 and 表 (shown) —, the
// settings group 统计页视图 in both worlds, one linked hover (a task on the 时间流 legend, 星图 lit with it), then
// 近 3 个月 in 里 measured: each view's first draw while the page scrolls, and the terrain drag's frames
// (perf-7b.json, written into ST7B: not an image, so it would not be ignored in the evidence folder). The API is served here, not by wrangler: ST7B is a folder of real-data answers
// (sessions_<from>_<to>.json, dashboard_<from>_<to>.json, tasks.json — built outside the repo, never committed);
// any other request is an error. Output: ST7B_OUT, else the sub7b evidence folder.
async function shots7b(dir) {
  const out = path.resolve(process.env.ST7B_OUT ?? "../docs/projects/2026-10-05-ui-redesign/evidence/sub7b");
  mkdirSync(out, { recursive: true });
  const DEF = JSON.parse(readFileSync(new URL("../../server/src/prefs/defaults.json", import.meta.url), "utf8"));
  let prefs = structuredClone(DEF);
  const hide = (list) => { prefs = { ...prefs, omote: { ...prefs.omote, hide: list } }; };
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: typeof body === "string" ? body : JSON.stringify(body) });
  const api = async (r) => {
    const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname;
    if (p === "/api/prefs") { if (m === "PUT") prefs = r.request().postDataJSON(); return json(r, prefs); }
    if (p === "/api/me") return json(r, { kind: "token" });
    if (p === "/api/machines") return json(r, [{ name: "macmini", last_seen_at: "2026-10-07T03:00:00Z" }, { name: "win11", last_seen_at: "2026-10-07T03:00:00Z" }]);
    if (p === "/api/reviews") return json(r, []);   // the export has no weekly_reviews
    if (p === "/api/tasks" && m === "GET" && !u.search) return json(r, readFileSync(path.join(dir, "tasks.json"), "utf8"));
    const kind = { "/api/stats/sessions": "sessions", "/api/dashboard": "dashboard" }[p];
    const f = kind && path.join(dir, `${kind}_${u.searchParams.get("from")}_${u.searchParams.get("to")}.json`);
    if (f && existsSync(f)) return json(r, readFileSync(f, "utf8"));
    errors.push(`7b: no answer for ${m} ${p}${u.search}`);
    return json(r, { error: "not served" }, 404);
  };
  const isApi = (u) => u.pathname.startsWith("/api/");
  // warnings are listed too (ECharts reports a call on a disposed chart as one); printed at the end
  const warns = [];
  page.on("console", (m) => { if (m.type() === "warning") warns.push(m.text()); });
  await page.route(isApi, api);
  // the dock is fixed to the window and would sit over a band: hidden by a style rule (a re-render keeps it)
  const dock = (v) => page.evaluate((hide) => {
    let st = document.getElementById("shots-nodock");
    if (hide && !st) { st = document.createElement("style"); st.id = "shots-nodock"; st.textContent = "nav.dock{visibility:hidden!important}"; document.head.append(st); }
    if (!hide) st?.remove();
  }, v === "hidden");
  const go = async (hash) => {
    await page.mouse.move(5, 5);
    // a fresh document each time: a hash-only change would keep the cached prefs (the 表 cost / review passes)
    await page.goto("about:blank");
    await page.goto(`${BASE}/${hash}`); await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForSelector("section.sv[data-view]"); await page.evaluate(() => document.fonts.ready); await settle();
  };
  const ids = () => page.locator("section.sv[data-view]").evaluateAll((els) => els.map((e) => e.dataset.view));
  // each band scrolled in (its body is drawn within 600px of the window), drawn, faded in, then shot alone
  const bands = async (tag) => {
    await dock("hidden");
    for (const id of await ids()) {
      const sec = page.locator(`section.sv[data-view="${id}"]`);
      await sec.scrollIntoViewIfNeeded();
      // drawn = the body has left .wait and holds no wait line (R4: a frame opens on 读取中 before its data is in)
      await page.waitForFunction((id) => !document.querySelector(`section.sv[data-view="${id}"] :is(.sv-b.wait, .sv-pend)`), id);
      await page.waitForTimeout(1800);
      await sec.screenshot({ path: path.join(out, `sv-${id}-${tag}.png`) });
    }
    await dock("");
  };
  hide(DEF.omote.hide);
  await go("#/v2/stats?world=ura"); await bands("4w-ura");
  await go("#/v2/stats?world=omote"); await bands("4w-omote-nocost");
  hide(["now.cost"]);
  await go("#/v2/stats?world=omote"); await bands("4w-omote");
  await go("#/v2/stats?world=ura&range=3m"); await bands("3m-ura");
  await go("#/v2/stats?world=omote&range=3m"); await bands("3m-omote");
  // the settings group: its heading down to the end of its list (taller than the window: a full-page clip)
  for (const world of ["ura", "omote"]) {
    await page.mouse.move(5, 5);
    await page.goto(`${BASE}/#/v2/settings?world=${world}`); await page.waitForSelector("ol.sviews"); await settle();
    const clip = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2.grp-h")].find((e) => e.textContent.includes("统计页视图"));
      const a = h.getBoundingClientRect(), b = document.querySelector("ol.sviews").getBoundingClientRect(), y = window.scrollY;
      const x0 = Math.min(a.left, b.left) - 24, x1 = Math.max(a.right, b.right) + 24;
      return { x: Math.max(0, x0), y: a.top + y - 16, width: x1 - Math.max(0, x0), height: b.bottom - a.top + 40 };
    });
    await dock("hidden");
    await page.screenshot({ path: path.join(out, `sv-settings-${world}.png`), fullPage: true, clip });
    await dock("");
  }
  // linked hover: the window made tall enough for 时间流 and 星图 together, a legend row hovered, both shot at once
  await page.setViewportSize({ width: 1512, height: 1900 });
  await go("#/v2/stats?world=ura");
  await page.locator('section.sv[data-view="stream"]').evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(2600);
  const row = page.locator('section.sv[data-view="stream"] .st-r[data-task]').first();
  await row.hover(); await page.waitForTimeout(700);
  const hov = await page.evaluate(() => {
    const a = document.querySelector('section.sv[data-view="stream"]').getBoundingClientRect();
    const b = document.querySelector('section.sv[data-view="stars"]').getBoundingClientRect();
    return { x: a.left, y: a.top, width: a.width, height: b.bottom - a.top };
  });
  await page.screenshot({ path: path.join(out, "sv-hover-linked-4w-ura.png"), clip: hov });
  await page.setViewportSize({ width: 1512, height: 945 });
  // 近 3 个月 in 里, measured: each band's first draw (from its body leaving .wait with no wait line in it — R4 — to two
  // frames later, and the long tasks in between) while the page scrolls down in steps, then the terrain drag's frame times
  await page.addInitScript(() => {
    const w = window;
    w.__lt = []; w.__open = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
    // a body counts once its view's data is in: a block's wait line is swapped inside the same body, a new view's
    // wait frame is replaced by a new section — so look again on every change, once per view id
    const seen = new Set();
    new MutationObserver(() => {
      for (const el of document.querySelectorAll("section.sv .sv-b:not(.wait)")) {
        const id = el.closest("section.sv")?.dataset.view;
        if (!id || seen.has(id) || el.querySelector(".sv-pend")) continue;
        seen.add(id);
        const t0 = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => w.__open.push({ id, t0, t1: performance.now() })));
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  });
  await page.goto("about:blank");   // a new document, so the init script runs (a hash change would keep the old one)
  await page.goto(`${BASE}/#/v2/stats?world=ura&range=3m`); await page.waitForSelector("section.sv[data-view]");
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500);
  for (let i = 0; i < 400; i++) {
    const done = await page.evaluate(() => { window.scrollBy(0, 400); return window.scrollY + innerHeight >= document.body.scrollHeight - 2; });
    await page.waitForTimeout(250);
    if (done) break;
  }
  await page.waitForTimeout(1500);
  const draws = await page.evaluate(() => {
    const w = window, opens = [...w.__open].sort((a, b) => a.t0 - b.t0);
    return opens.map((o, i) => {
      const end = Math.max(o.t1, opens[i + 1]?.t0 ?? Infinity);
      const lts = w.__lt.filter(([s]) => s >= o.t0 - 1 && s < end);
      return { id: o.id, frames: Math.round(o.t1 - o.t0), longtasks: lts.map(([, d]) => Math.round(d)) };
    });
  });
  const terr = page.locator('section.sv[data-view="terrain"] canvas.sv-terr');
  await terr.evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(1200);
  const tb = await terr.boundingBox();
  await page.evaluate(() => {
    const w = window; w.__fr = []; w.__lt = []; let last = performance.now();
    const tick = (t) => { w.__fr.push(t - last); last = t; if (w.__frOn) requestAnimationFrame(tick); };
    w.__frOn = true; requestAnimationFrame(tick);
  });
  await page.mouse.move(tb.x + tb.width * 0.3, tb.y + tb.height * 0.5); await page.mouse.down();
  for (let i = 1; i <= 60; i++) { await page.mouse.move(tb.x + tb.width * (0.3 + 0.4 * i / 60), tb.y + tb.height * (0.5 - 0.2 * Math.sin(i / 10))); await page.waitForTimeout(16); }
  await page.mouse.up();
  const drag = await page.evaluate(() => { const w = window; w.__frOn = false; return { frames: w.__fr.slice(1).map((x) => Math.round(x * 10) / 10), longtasks: w.__lt.map(([, d]) => Math.round(d)) }; });
  writeFileSync(path.join(dir, "perf-7b.json"), JSON.stringify({ draws, drag }, null, 1));
  await page.unroute(isApi);
  console.log(`7b: ${warns.length} console warnings${warns.length ? ":\n" + [...new Set(warns)].slice(0, 20).join("\n") : ""}`);
}
if (process.env.ST7B) await shots7b(path.resolve(process.env.ST7B));
if (process.env.SHOTS === "7b") await finish();

for (const p of PAGES) {
  for (const world of ["ura", "omote"]) {
    await page.goto(`${BASE}/#/v2/${p}?world=${world}`);
    await page.waitForSelector("nav.dock");
    await settle();
    await shot(`${p}-${world}`);
  }
}
// mid-frames: language switch and world switch, on the settings page in 里
await page.goto(`${BASE}/#/v2/settings?world=ura`);
await page.waitForSelector("nav.dock"); await settle();
await page.getByRole("button", { name: "日本語" }).first().click();
await unfocus(); await page.waitForTimeout(350); await shot("settings-lang-midframe");
await settle(); await shot("settings-lang-after");
await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
await page.keyboard.press("w");
await page.waitForTimeout(600); await shot("settings-world-midframe");
await settle(); await shot("settings-world-after");
await page.keyboard.press("w"); await settle();

// 此刻 (sub-project 2): the four simulated moments in both worlds, the why tooltip, the chart tooltip,
// language and world switches mid-frame on the board. ?sim=1 is a one-off override, never stored.
const MOMENTS = [["1", "morning"], ["2", "day"], ["3", "weekly"], ["4", "wrap"]];
for (const world of ["ura", "omote"]) {
  await page.goto(`${BASE}/#/v2/now?world=${world}&sim=1`);
  await page.waitForSelector("nav.simp"); await settle();
  for (const [k, name] of MOMENTS) { await page.keyboard.press(k); await settle(); await shot(`now-sim-${name}-${world}`); }
}
await page.goto(`${BASE}/#/v2/now?world=ura&sim=1`);
await page.waitForSelector("nav.simp"); await settle();
await page.keyboard.press("2"); await settle();
await page.locator(".row.next").first().hover(); await page.waitForTimeout(400); await shot("now-hover-why");
const cvBox = await page.locator("canvas.dia-cv").boundingBox();
if (cvBox) { await page.mouse.move(cvBox.x + cvBox.width * 0.1, cvBox.y + 50); await page.waitForTimeout(400); await shot("now-chart-tip"); }
await page.mouse.move(5, 5);
await page.getByRole("button", { name: "日本語" }).first().click();
await unfocus(); await page.waitForTimeout(350); await shot("now-lang-midframe");
await settle(); await shot("now-lang-after");
await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
await page.keyboard.press("w");
await page.waitForTimeout(600); await shot("now-world-midframe");
await settle(); await shot("now-world-after");
await page.keyboard.press("w"); await settle();
// 此刻 relayout (2026-10-20, spec §2/§6): the one-screen board at 1512×945 and 1280×800 in both worlds, the 09:05
// moment (?sim=1, key 1), and a heavy day (8 chart tracks, 3 running sessions, 5 plan items) through a route mock.
// Each capture logs the .now-top strip's bottom against the dock's top (names: relayout-<scenario>-<w>x<h>-<world>); the
// 1280×800 live board is shot again scrolled to the bottom (relayout-live-1280x800-scrolled-<world>).
const nowMeasure = (tag) => page.evaluate((tag) => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
  return { tag, viewport: [innerWidth, innerHeight], scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
    strip: r("[data-mod='now.time']"), nowTop: r(".now-top"), dock: r(".dock"), side: r(".now .side"), cost: r("[data-mod='now.cost']"),
    tracks: document.querySelectorAll(".now .lab").length, running: document.querySelectorAll(".row.run:not(.empty)").length, plan: document.querySelectorAll(".row.prow").length,
    // 今日安排: whole rows on show, and the N of 还有 N 条 (T10 F2: the two must add up to the day's items)
    planShown: document.querySelectorAll(".plan .row.prow[data-status]:not(.unseen)").length,
    planMore: Number(document.querySelector(".plan .row.prow.more .ink")?.textContent?.match(/\d+/)?.[0] ?? 0) };
}, tag);
// 运行情报 / AI 费用 heading rows (ruling on decision 9b) and the title block cells: nothing on them may be cut. Every LED / ink on the row must
// end inside its section's content box, the row must not scroll, and AI 费用's figure must sit on the heading's row
// (not wrapped under it). Returns the failures.
const titleFit = (tag) => page.evaluate((tag) => {
  const fails = [];
  for (const id of ["now.info", "now.cost"]) {
    const mod = document.querySelector(`[data-mod='${id}']`);
    if (!mod || mod.getClientRects().length === 0) continue;   // hidden (表 hides now.cost by default)
    const mr = mod.getBoundingClientRect(), right = mr.right - parseFloat(getComputedStyle(mod).paddingRight);
    const sec = mod.querySelector(".sec"), row = [sec, id === "now.cost" ? mod.querySelector(".cost-big") : null].filter(Boolean);
    const sr = sec.getBoundingClientRect();
    for (const el of row) {
      if (el.scrollWidth > el.clientWidth + 1) fails.push(`${tag}: ${id} heading row scrolls (${el.scrollWidth} > ${el.clientWidth})`);
      for (const c of el.querySelectorAll("canvas, .ink")) {
        const r = c.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > right + 1) fails.push(`${tag}: ${id} heading text ends at ${Math.round(r.right)} > ${Math.round(right)}`);
        if (r.top >= sr.bottom - 1) fails.push(`${tag}: ${id} heading text wrapped below the heading row`);
        if (c.tagName === "CANVAS" && c.style.width && r.width < parseFloat(c.style.width) - 0.5) fails.push(`${tag}: ${id} heading LED squeezed (${r.width.toFixed(1)} < ${c.style.width})`);
      }
    }
  }
  // the title block (TimeStrip DateBlock): every cell's LED / ink ends inside the cell's content box, and a fit LED is
  // not squeezed below its own width by the flex cell (that cuts its last dot columns, verdicts-4 #9)
  for (const cell of document.querySelectorAll(".tstrip .tb .c")) {
    const cr = cell.getBoundingClientRect(), cs = getComputedStyle(cell), right = cr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const name = [...cell.classList].find((k) => k.startsWith("c-")) ?? "c";
    for (const c of cell.querySelectorAll("canvas, .ink")) {
      const r = c.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;   // hidden: 里's ink twin is a 1px accessible box, 表's canvas is not shown
      if (r.right > right + 0.5) fails.push(`${tag}: title block ${name} ends at ${r.right.toFixed(1)} > ${right.toFixed(1)}`);
      if (c.tagName === "CANVAS" && c.style.width && r.width < parseFloat(c.style.width) - 0.5) fails.push(`${tag}: title block ${name} LED squeezed (${r.width.toFixed(1)} < ${c.style.width})`);
      if (c.tagName !== "CANVAS" && c.scrollWidth > c.clientWidth + 1) fails.push(`${tag}: title block ${name} ink overflows (${c.scrollWidth} > ${c.clientWidth})`);
    }
  }
  return fails;
}, tag);
const measures = [];
// the cuts 此刻 draws in zh: 8/10/12 sc, the 8px ja wareki and countdown kinds, the ja weekday at 12 (10 when ≤1400px)
const NOW_FONTS = (w) => ["fp8-sc", "fp10-sc", "fp12-sc", "fp8-jp", w > 1400 ? "fp12-jp" : "fp10-jp"];
const glyphRuns = { runs: 0, fails: 0 };
const nowShot = async (name) => {
  await fontsSettle(1200, NOW_FONTS(page.viewportSize().width));
  const g = await glyphCheck(name);
  glyphRuns.runs++; if (g.fails.length) { glyphRuns.fails++; errors.push(...g.fails); }
  const tf = await titleFit(name);
  errors.push(...tf);
  const r = { ...(await nowMeasure(name)), glyphFails: g.fails.length, titleFails: tf.length };
  measures.push(r); console.log("measure " + JSON.stringify(r)); await shot(name);
};
for (const [w, h] of [[1512, 945], [1280, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const world of ["ura", "omote"]) {
    await page.goto("about:blank");
    await page.goto(`${BASE}/#/v2/now?world=${world}`); await page.waitForSelector("nav.dock"); await settle();
    await nowShot(`relayout-live-${w}x${h}-${world}`);
    // below 820px of height the board keeps its 628px and the page scrolls: see the strip once, scrolled clear of the dock
    if (h < 820) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(300);
      await nowShot(`relayout-live-${w}x${h}-scrolled-${world}`);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.goto("about:blank");
    await page.goto(`${BASE}/#/v2/now?world=${world}&sim=1`); await page.waitForSelector("nav.simp"); await settle();
    await page.keyboard.press("1"); await settle();
    await nowShot(`relayout-sim-0905-${w}x${h}-${world}`);
  }
}
// heavy day: the board's data endpoints mocked, everything else (prefs, stats, badges) goes to wrangler dev
{
  const nowMs = Date.now(), MIN = 60_000;
  const jstDate = new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
  const at = (hm) => new Date(`${jstDate}T${hm}:00+09:00`).toISOString();
  const isoWeek = (d) => { const t = new Date(`${d}T00:00:00Z`); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
    const y = t.getUTCFullYear(), j1 = new Date(Date.UTC(y, 0, 4)); return `${y}-W${String(1 + Math.round(((t - j1) / 86400000 - 3 + ((j1.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`; };
  const WEEK = isoWeek(jstDate);
  const TITLES = ["worklog 改修", "BEACON 帳票修正", "ORION-B 統合ファイル作成", "HARBOR2 Mapping 仕様書作成", "LEDGER codelist 検証", "週報テンプレート整理", "社内勉強会 資料", "請求データ 突合"];
  const tasks = TITLES.map((title, i) => ({ id: `T202610${String(10 + i)}-01`, requester: "r", project: "", title, status: "open", received_at: "2026-10-01", done_at: null,
    thinking: "", deliverables: [], hours_manual: null, machine: "macmini", ts: "2026-10-01T09:00:00", updated_at: "2026-10-01T00:00:00Z" }));
  const sess = (id, task_id, machine, a, b) => {
    const minutes = Math.round((Date.parse(b) - Date.parse(a)) / MIN);
    return { id, machine, agent: "claude-code", session_id: `${id}-full`, cwd: "/w", started_at: a, ended_at: b, active_minutes: minutes, turns: 3,
      summary: `${id} summary`, summary_source: "llm", task_id, link_method: "rule", summary_edited: null, minutes_override: null, hidden: 0,
      files_written: [], tokens: { by_model: {}, subagent: {}, cost_usd: 1.5, cost_partial: false }, active_intervals: [[a, b]], ts: a, updated_at: b,
      summary_effective: `${id} summary`, minutes_effective: minutes };
  };
  const iso = (t) => new Date(t).toISOString();
  const sessions = [
    ...tasks.map((t, i) => sess(`S${i}`, t.id, i % 2 ? "win11" : "macmini", at(`${String(9 + (i % 6)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`), at(`${String(9 + (i % 6)).padStart(2, "0")}:${i % 2 ? "55" : "25"}`))),
    sess("R1", tasks[0].id, "macmini", iso(nowMs - 50 * MIN), iso(nowMs - 2 * MIN)),
    sess("R2", tasks[1].id, "macmini", iso(nowMs - 30 * MIN), iso(nowMs - 1 * MIN)),
    sess("R3", tasks[2].id, "win11", iso(nowMs - 20 * MIN), iso(nowMs - 3 * MIN)),
  ];
  const machines = [{ name: "macmini", last_seen_at: iso(nowMs) }, { name: "win11", last_seen_at: iso(nowMs) }];
  const items = tasks.slice(0, 5).map((t, i) => ({ id: `D${i}`, date: jstDate, plan_item_id: null, tasks: [{ id: t.id, title: t.title, status: "open" }], text: t.title, detail: "", sort: i,
    ai_status: i === 0 ? "done" : i === 1 ? "partial" : null, ai_progress: i < 2 ? "進捗あり" : null, ai_evidence: [], ai_note: null, manual_status: null,
    updated_at: iso(nowMs), final_status: i === 0 ? "done" : i === 1 ? "partial" : "none" }));
  const dayPlan = { date: jstDate, started_at: at("09:00"), judged_at: null, judge_machine: null, judge_model: null, updated_at: at("09:00"), items };
  const jsonOk = (r, body) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  const heavy = async (r) => {
    const p = new URL(r.request().url()).pathname;
    if (r.request().method() !== "GET") return r.continue();
    if (p === "/api/machines") return jsonOk(r, machines);
    if (p.startsWith("/api/weeks/")) return jsonOk(r, p.startsWith(`/api/weeks/${WEEK}/`)
      ? { week: WEEK, days: [{ date: jstDate, minutes: 0, sessions, notes: [] }], total_minutes: 0, unassigned: 0, hidden: 0 }
      : { week: "x", days: [], total_minutes: 0, unassigned: 0, hidden: 0 });
    if (p === "/api/tasks") return jsonOk(r, tasks);
    if (p === "/api/plan-items") return jsonOk(r, []);
    if (p.startsWith("/api/day-plans/")) return jsonOk(r, dayPlan);
    // showCostOmote: 表 shows AI 费用 too (hidden there by default), so its heading row is checked in 表 as well
    if (p === "/api/prefs" && showCostOmote) {
      const res = await r.fetch(), pr = await res.json();
      return jsonOk(r, { ...pr, omote: { ...pr.omote, hide: (pr.omote?.hide ?? []).filter((h) => h !== "now.cost") } });
    }
    return r.continue();
  };
  let showCostOmote = false;
  const isApi = (u) => u.pathname.startsWith("/api/");
  await page.setViewportSize({ width: 1512, height: 945 });
  await page.route(isApi, heavy);
  for (const world of ["ura", "omote"]) {
    await page.goto("about:blank");
    await page.goto(`${BASE}/#/v2/now?world=${world}`); await page.waitForSelector("nav.dock"); await page.waitForTimeout(3500);
    await nowShot(`relayout-heavy-1512x945-${world}`);
    const hm = measures[measures.length - 1];
    if (hm.planShown + hm.planMore !== items.length) errors.push(`relayout-heavy-1512x945-${world}: plan rows ${hm.planShown} shown + ${hm.planMore} more != ${items.length} items`);
  }
  // heading-row fit check on the heavy day everywhere: 里 at 1280 too, and 表 with AI 费用 shown (hidden there by
  // default) at both sizes
  const heavyAt = async (w, h, world, name) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("about:blank");
    await page.goto(`${BASE}/#/v2/now?world=${world}`); await page.waitForSelector("nav.dock"); await page.waitForTimeout(3500);
    await nowShot(name);
  };
  await heavyAt(1280, 800, "ura", "relayout-heavy-1280x800-ura");
  showCostOmote = true;
  for (const [w, h] of [[1512, 945], [1280, 800]]) await heavyAt(w, h, "omote", `relayout-heavy-cost-${w}x${h}-omote`);
  showCostOmote = false;
  await page.setViewportSize({ width: 1512, height: 945 });
  // RELAYOUT_LOOP=n: the heavy 里 board n more times, each a fresh load (the glyph race showed on this capture only);
  // each run is glyph-checked and measured, only the last image is kept
  for (let i = 1; i <= Number(process.env.RELAYOUT_LOOP ?? 0); i++) {
    await page.goto("about:blank");
    await page.goto(`${BASE}/#/v2/now?world=ura`); await page.waitForSelector("nav.dock"); await page.waitForTimeout(3500);
    await nowShot(`relayout-heavy-1512x945-ura-loop`);
    const hm = measures[measures.length - 1];
    hm.tag = `relayout-heavy-1512x945-ura-loop-${i}`;
    if (hm.planShown + hm.planMore !== items.length) errors.push(`${hm.tag}: plan rows ${hm.planShown} shown + ${hm.planMore} more != ${items.length} items`);
  }
  await page.unroute(isApi);
}
console.log(`glyph check: ${glyphRuns.runs} captures, ${glyphRuns.fails} failed`);
writeFileSync(path.join(OUT, "relayout-measures.json"), JSON.stringify(measures, null, 1));
await page.setViewportSize({ width: 1512, height: 945 });
// settings: the prediction rules group
await page.goto(`${BASE}/#/v2/settings?world=ura`);
await page.waitForSelector("nav.dock"); await settle();
await page.getByRole("heading", { name: "预判规则" }).evaluate((el) => el.scrollIntoView({ block: "start" })); await page.waitForTimeout(300);
await shot("settings-predict-ura");

// 时间线 (sub-project 3): a week with work (TL_WEEK, default this week), the 未关联 filter, a session drawer
// in both worlds, language and world switches mid-frame. TL_SESSION picks the drawer's session (else the first row).
const TL = `${BASE}/#/v2/timeline${process.env.TL_WEEK ? `/${process.env.TL_WEEK}` : ""}`;
const q = (h, extra) => `${h}${h.includes("?") ? "&" : "?"}${extra}`;
for (const world of ["ura", "omote"]) {
  await page.goto(q(TL, `world=${world}`)); await page.waitForSelector(".tl .band"); await settle();
  await shot(`timeline-week-${world}`);
  await page.goto(q(TL, `world=${world}&unlinked=1`)); await page.waitForSelector(".tl .band"); await settle();
  await shot(`timeline-unlinked-${world}`);
  await page.goto(q(TL, `world=${world}`)); await page.waitForSelector(".tl .band"); await settle();
  const row = process.env.TL_SESSION ? page.locator(`.srow[data-id="${process.env.TL_SESSION}"]`) : page.locator(".srow[data-id]").first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(700); await shot(`timeline-drawer-${world}`); await page.keyboard.press("Escape"); await settle(); }
  else errors.push(`no row to open a drawer on (TL_WEEK=${process.env.TL_WEEK ?? "this week"}, TL_SESSION=${process.env.TL_SESSION ?? "-"})`);
}
// the reused 新建案件 dialog (TaskForm) opened from inside the glass drawer: is it on top and usable?
await page.goto(q(TL, "world=ura")); await page.waitForSelector(".tl .band"); await settle();
const first = page.locator(".srow[data-id]:not(.note)").first();
if (await first.count()) {
  await first.click(); await page.waitForTimeout(700);
  await page.locator(".v2-drawer .acts-row button").first().click();
  await page.locator(".v2-drawer select.task-select").selectOption("__new__"); await page.waitForTimeout(500);
  await shot("timeline-newtask-dialog");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await settle();
} else errors.push("no session row for the new-task dialog shot");
await page.goto(q(TL, "world=ura")); await page.waitForSelector(".tl .band"); await settle();
const band = await page.locator(".tl .band canvas").first().boundingBox();
if (band) { await page.mouse.move(band.x + band.width * 0.45, band.y + band.height / 2); await page.waitForTimeout(400); await shot("timeline-hover"); }
else errors.push("no band to hover");
await page.mouse.move(5, 5);
await page.getByRole("button", { name: "日本語" }).first().click();
await unfocus(); await page.waitForTimeout(350); await shot("timeline-lang-midframe");
await settle(); await shot("timeline-lang-after");
await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
await page.keyboard.press("w");
await page.waitForTimeout(600); await shot("timeline-world-midframe");
await settle(); await shot("timeline-world-after");
await page.keyboard.press("w"); await settle();
// 此刻 today's plan rows (sub-project 3, user 10/6) in the 14:20 scenario
for (const world of ["ura", "omote"]) {
  await page.goto(`${BASE}/#/v2/now?world=${world}&sim=1`); await page.waitForSelector("nav.simp"); await settle();
  await page.keyboard.press("2"); await settle(); await shot(`now-plan-rows-${world}`);
}

// 案件 (sub-project 4): the board (all statuses) and a drawer in both worlds, the drawer scrolled to its
// sessions and danger zone, the delete confirm step, language and world switches mid-frame. TK_TASK picks
// the drawer's task (else the first row).
for (const world of ["ura", "omote"]) {
  await page.goto(`${BASE}/#/v2/tasks?status=all&world=${world}`); await page.waitForSelector(".tk .trow"); await settle();
  await shot(`tasks-${world}`);
  const id = process.env.TK_TASK ?? await page.locator(".trow[data-id]").first().getAttribute("data-id");
  await page.goto(`${BASE}/#/v2/tasks/${id}?status=all&world=${world}`); await page.waitForSelector(".v2-drawer.on .dw-b"); await settle();
  await shot(`tasks-drawer-${world}`);
  await page.locator(".v2-drawer .dw-b").evaluate((el) => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(300);
  await shot(`tasks-drawer-bottom-${world}`);
}
await page.goto(`${BASE}/#/v2/tasks?status=all&world=ura`); await page.waitForSelector(".tk .trow"); await settle();
const free = page.locator(".v2-drawer .danger button:not([disabled])");
for (const id of await page.locator(".trow[data-id]").evaluateAll((els) => els.map((e) => e.dataset.id))) {
  await page.goto(`${BASE}/#/v2/tasks/${id}?status=all&world=ura`); await page.waitForSelector(".v2-drawer.on .danger"); await page.waitForTimeout(600);
  if (await free.count()) { await free.click(); await page.locator(".v2-drawer .dw-b").evaluate((el) => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(300); await shot("tasks-delete-confirm"); await page.keyboard.press("Escape"); break; }
}
await page.keyboard.press("Escape"); await settle();
await page.getByRole("button", { name: "日本語" }).first().click();
await unfocus(); await page.waitForTimeout(350); await shot("tasks-lang-midframe");
await settle(); await shot("tasks-lang-after");
await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
await page.keyboard.press("w");
await page.waitForTimeout(600); await shot("tasks-world-midframe");
await settle(); await shot("tasks-world-after");
await page.keyboard.press("w"); await settle();

// 计划 (sub-project 5): the board in both worlds (today, a day not started, the closed list open), a 今日安排
// drawer and a plan item drawer in both worlds, the flip's second line, language and world switches mid-frame.
// PL_DATE picks a started day other than today for the past-day shot (else yesterday); PL_EMPTY a day not started.
// a hash-only goto keeps the scroll: back to the top first, so each shot starts at the board
const plDay = async (q) => { await page.goto(`${BASE}/#/v2/plan${q}`); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForSelector(".pl .pl-day .sec"); await settle(); };
for (const world of ["ura", "omote"]) {
  await plDay(`?world=${world}`); await unfocus(); await shot(`plan-${world}`);
  const d = await page.locator(".drow[data-id]").first().getAttribute("data-id").catch(() => null);
  if (d) { await plDay(`?world=${world}&day=${encodeURIComponent(d)}`); await page.waitForSelector(".v2-drawer.on .dw-b"); await settle(); await shot(`plan-day-drawer-${world}`); }
  const p = await page.locator(".ttrow[data-id]").first().getAttribute("data-id").catch(() => null);
  if (p) { await plDay(`?world=${world}&item=${encodeURIComponent(p)}`); await page.waitForSelector(".v2-drawer.on .dw-b"); await settle(); await shot(`plan-item-drawer-${world}`); }
}
await plDay(`/${process.env.PL_EMPTY ?? "2030-01-07"}?world=ura`); await shot("plan-not-started");
await plDay("?world=ura");
await page.getByRole("button", { name: /查看已完成/ }).click(); await unfocus(); await page.waitForTimeout(600);
await page.locator(".pl-tt").evaluate((el) => el.scrollIntoView({ block: "end" })); await page.waitForTimeout(300); await shot("plan-closed");
await plDay("?world=ura"); await page.waitForTimeout(8600); await shot("plan-flip");      // the rows' second line (8 s rhythm)
await page.getByRole("button", { name: "日本語" }).first().click();
await unfocus(); await page.waitForTimeout(350); await shot("plan-lang-midframe");
await settle(); await shot("plan-lang-after");
await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
await page.keyboard.press("w");
await page.waitForTimeout(600); await shot("plan-world-midframe");
await settle(); await shot("plan-world-after");
await page.keyboard.press("w"); await settle();

// 週報 (sub-project 6): every sheet in both worlds (日別作業 for 派遣元 and 現場), the 未关联 warning, a cell drawer
// for each template, an in-place edit open on 案件一覧, language and world switches mid-frame. RP_WEEK picks the
// week (else this week); RP_CELL / RP_CELL_SITE pick the drawers' cells (`<taskId or ->|<YYYY-MM-DD>`, else the
// first cell). RP_CELL_XDAY, when given, adds a 現場 drawer on a cross-midnight session's cell; RP_CELL_MOVED /
// RP_CELL_MOVED_SITE, when given, a 派遣元 / 現場 drawer on a cell whose 日付 / 案件 was edited (the 已移动 block).
const RP = `${BASE}/#/v2/report${process.env.RP_WEEK ? `/${process.env.RP_WEEK}` : ""}`;
const rpGo = async (extra, sel = ".rp .rp-view") => { await page.mouse.move(5, 5); await page.goto(q(RP, extra)); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForSelector(sel); await settle(); };
const rpCell = async (env) => process.env[env] ?? await page.locator(".rp-days .cell[data-cell]").first().getAttribute("data-cell");
for (const world of ["ura", "omote"]) {
  await rpGo(`world=${world}`, ".rp-days .blk"); await unfocus(); await shot(`report-days-${world}`);
  if (await page.locator(".rp-warn").count()) await page.locator(".rp-top").screenshot({ path: path.join(OUT, `report-warn-${world}.png`) });
  else errors.push("no 未关联 warning on the 週報 page (the week needs an unlinked session)");
  const cell = await rpCell("RP_CELL");
  await rpGo(`world=${world}&cell=${encodeURIComponent(cell)}`, ".v2-drawer.on .rp-dw"); await shot(`report-drawer-${world}`);
  await rpGo(`world=${world}&tpl=site`, ".rp-days .blk"); await unfocus(); await shot(`report-days-site-${world}`);
  const siteCell = await rpCell("RP_CELL_SITE");
  await rpGo(`world=${world}&tpl=site&cell=${encodeURIComponent(siteCell)}`, ".v2-drawer.on .rp-dw"); await shot(`report-drawer-site-${world}`);
  if (process.env.RP_CELL_XDAY) { await rpGo(`world=${world}&tpl=site&cell=${encodeURIComponent(process.env.RP_CELL_XDAY)}`, ".v2-drawer.on .rp-dw"); await shot(`report-drawer-site-xday-${world}`); }
  for (const [env, tpl, name] of [["RP_CELL_MOVED", "", "report-drawer-moved"], ["RP_CELL_MOVED_SITE", "&tpl=site", "report-drawer-site-moved"]]) {
    if (!process.env[env]) continue;
    await rpGo(`world=${world}${tpl}&cell=${encodeURIComponent(process.env[env])}`, ".v2-drawer.on .rp-dw .moved"); await shot(`${name}-${world}`);
  }
  // 成果物 is a 現場 sheet only (an agency address with sheet=deliverables falls back to 日別作業)
  for (const s of ["tasks", "summary", "hours", "deliverables"]) { await rpGo(`world=${world}&sheet=${s}${s === "deliverables" ? "&tpl=site" : ""}`); await unfocus(); await shot(`report-${s}-${world}`); }
  await rpGo(`world=${world}&sheet=tasks`, ".rp-tasks .trw");
  await page.locator(".rp-tasks .trw [data-col=title] .rp-ed[role=button]").first().click(); await page.waitForTimeout(400);
  await shot(`report-tasks-edit-${world}`);
  await page.keyboard.press("Escape"); await settle();
}
await rpGo("world=ura", ".rp-days .blk");
await page.getByRole("button", { name: "日本語" }).first().click();
await unfocus(); await page.waitForTimeout(350); await shot("report-lang-midframe");
await settle(); await shot("report-lang-after");
await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
await page.keyboard.press("w");
await page.waitForTimeout(600); await shot("report-world-midframe");
await settle(); await shot("report-world-after");
await page.keyboard.press("w"); await settle();

// 统计 (sub-project 7): the whole page in both worlds (近 4 周, then 近 3 个月), a tip on the daily bars, 表 with
// stats.cost hidden (the default) and shown, language and world switches mid-frame. The page is taller than the
// window: full-page shots.
const ST = `${BASE}/#/v2/stats`;
const stGo = async (extra) => { await page.mouse.move(5, 5); await page.goto(q(ST, extra)); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForSelector(".stp .st-figs"); await settle(); };
// the dock is fixed to the window: in a full-page shot it would sit over the middle of the page, so hide it there
const full = async (name) => {
  await page.evaluate(() => { document.querySelector("nav.dock").style.visibility = "hidden"; });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await page.evaluate(() => { document.querySelector("nav.dock").style.visibility = ""; });
};
for (const world of ["ura", "omote"]) {
  await stGo(`world=${world}`); await full(`stats-${world}`);
  await stGo(`world=${world}&range=3m`); await full(`stats-3m-${world}`);
}
// the tip on the latest day with work (from the right, the first bar whose tip is not 0h)
await stGo("world=ura&range=3m");
const daily = page.locator("canvas.st-daily");
// the stats views mount lazily (7b): scroll down in steps until the daily bars exist
for (let i = 0; i < 80 && !(await daily.count()); i++) { await page.evaluate(() => window.scrollBy(0, 600)); await page.waitForTimeout(150); }
await daily.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
const dBox = await daily.boundingBox();
let tipped = false;
if (dBox) for (let f = 0.99; f > 0 && !tipped; f -= 0.005) {
  await page.mouse.move(dBox.x + dBox.width * f, dBox.y + dBox.height * 0.6); await page.waitForTimeout(40);
  const m = await page.evaluate(() => document.querySelector(".tip.on .m")?.textContent ?? null);
  if (m && m !== "0h") { tipped = true; await page.waitForTimeout(300); await shot("stats-daily-tip"); }
}
if (!tipped) errors.push("no day with work to hover on the daily bars");
await page.mouse.move(5, 5);
// stored prefs from before sub-project 7 lack stats.cost in their hide list (brief assumption 7): set it either way, then restore
const costBox = page.getByLabel("统计 · AI 费用");
const setCost = async (on) => {
  await page.goto(`${BASE}/#/v2/settings?world=omote`); await page.waitForSelector("nav.dock"); await settle();
  if ((await costBox.isChecked()) !== on) { await costBox.click(); await page.waitForFunction(([l, v]) => [...document.querySelectorAll("label")].find((e) => e.textContent.includes(l))?.querySelector("input").checked === v, ["统计 · AI 费用", on]); await page.waitForTimeout(800); }
};
await page.goto(`${BASE}/#/v2/settings?world=omote`); await page.waitForSelector("nav.dock"); await settle();
const costWas = await costBox.isChecked();
await setCost(false); await stGo("world=omote"); await full("stats-omote-nocost");
await setCost(true); await stGo("world=omote"); await full("stats-omote-cost");
await setCost(costWas);
await stGo("world=ura");
await page.getByRole("button", { name: "日本語" }).first().click();
await unfocus(); await page.waitForTimeout(350); await shot("stats-lang-midframe");
await settle(); await full("stats-lang-after");
await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
await page.keyboard.press("w");
await page.waitForTimeout(600); await shot("stats-world-midframe");
await settle(); await shot("stats-world-after");
await page.keyboard.press("w"); await settle();

// 说明 (sub-project 7): the guide in both worlds in Chinese, in Japanese (the "Chinese only" note line), a chapter
// key's jump, language and world switches mid-frame.
const usGo = async (extra) => { await page.mouse.move(5, 5); await page.goto(`${BASE}/#/v2/usage?${extra}`); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForSelector(".us .us-doc h2"); await settle(); };
for (const world of ["ura", "omote"]) {
  await usGo(`world=${world}`); await shot(`usage-${world}`);
  await page.getByRole("button", { name: "日本語" }).first().click(); await unfocus(); await settle();
  if (!(await page.locator(".us-note").count())) errors.push("no Chinese-only note on the 说明 page in Japanese");
  await shot(`usage-ja-${world}`);
  await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
}
await usGo("world=ura");
const keys = page.locator(".us-toc button");
await keys.nth(Math.min(5, (await keys.count()) - 1)).click(); await page.waitForTimeout(600); await shot("usage-jump");
await usGo("world=ura");
await page.getByRole("button", { name: "日本語" }).first().click();
await unfocus(); await page.waitForTimeout(350); await shot("usage-lang-midframe");
await settle(); await shot("usage-lang-after");
await page.getByRole("button", { name: "中文" }).first().click(); await unfocus(); await settle();
await page.keyboard.press("w");
await page.waitForTimeout(600); await shot("usage-world-midframe");
await settle(); await shot("usage-world-after");
await page.keyboard.press("w"); await settle();

await finish();
