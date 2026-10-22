// web/scripts/m-overflow.mjs
// Phone-width overflow check for #/m/* (spec §7 / §9). Needs `vite` on 5173 only: the API is answered here from a
// stress fixture — 80-character task names, 500-character summaries, an unbreakable Latin word, 0 and 60 sessions a
// day, a cross-midnight session, $12,345.67+ cost. Visits every view at 360 / 390 / 430px in dark and light, opens
// the sheets, and fails (exit 1) if any element crosses the screen edge, the page scrolls sideways, or the console
// logs an error. Screenshots: OUT (gitignored). PAGES=now,tl limits the visits to those pages.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const OUT = path.resolve(process.argv[2] ?? "../docs/projects/2026-10-13-mobile/evidence/overflow");
const BASE = process.env.M_BASE ?? "http://localhost:5173";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ONLY = process.env.PAGES ? process.env.PAGES.split(",") : null;
const WIDTHS = [360, 390, 430], THEMES = ["dark", "light"];
mkdirSync(OUT, { recursive: true });

// ---- fixture (today = 2026-10-13, ISO week W42 starts Monday 10/12) ----
const J = (d, hm) => new Date(`${d}T${hm}:00+09:00`).toISOString();
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const LONG_TITLE = "長い案件名".repeat(16);
const WORD = "Supercalifragilisticexpialidocious".repeat(4);
const LONG_SUM = "とても長い要約の文章です。".repeat(40).slice(0, 500);
const task = (id, title, status = "open", requester = "営業部の担当者さん（とても長い依頼元名）") => ({ id, requester, project: "", title, status, received_at: "2026-10-01", done_at: null, thinking: "", deliverables: [WORD + ".xlsx"], hours_manual: null, machine: "macmini", ts: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });
const CJK40 = "長い案件名".repeat(8);   // exactly 40 CJK characters
const TASKS = [task("T1", LONG_TITLE), task("T2", "月次集計"), task("T3", WORD, "hold"), task("T4", "完了した案件", "done"), task("T5", CJK40)];
const STATE = { wall: false };   // set per visit: today's 工作时间 = 59999 minutes (999:59)
let seq = 0;
const sess = (date, from, to, o = {}) => {
  const id = `s${++seq}`, mins = Math.max(1, Math.round((Date.parse(J(date, to)) - Date.parse(J(date, from))) / 6e4));
  return { id, machine: seq % 2 ? "macmini" : "win11", agent: seq % 3 ? "claude-code" : "codex", session_id: id, cwd: "/w", started_at: J(date, from), ended_at: J(date, to), active_minutes: mins, turns: 3, summary: LONG_SUM, summary_source: "llm", task_id: seq % 4 ? "T1" : null, link_method: "auto", summary_edited: null, minutes_override: null, hidden: 0, files_written: [], tokens: null, active_intervals: null, artifacts: [], ts: J(date, to), updated_at: J(date, to), summary_effective: seq % 5 ? LONG_SUM : WORD, minutes_effective: mins, minutes_on_day: mins, ...o };
};
const pad = (n) => String(n).padStart(2, "0");
const BY_DAY = {
  "2026-10-13": Array.from({ length: 60 }, (_, i) => { const a = 8 * 60 + i * 8; return sess("2026-10-13", `${pad(Math.floor(a / 60))}:${pad(a % 60)}`, `${pad(Math.floor((a + 7) / 60))}:${pad((a + 7) % 60)}`); }),
  "2026-10-12": [],
  "2026-10-11": [sess("2026-10-10", "23:30", "23:59", { ended_at: J("2026-10-11", "01:00"), minutes_on_day: 60 })],
};
const mondayOf = (w) => addDays("2026-10-12", (Number(w.slice(-2)) - 42) * 7);
function timeline(w) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(mondayOf(w), i), sessions = BY_DAY[date] ?? (date < "2026-10-13" ? [sess(date, "10:00", "11:30")] : []);
    const minutes = sessions.reduce((n, s) => n + s.minutes_on_day, 0);
    return { date, minutes, wall_minutes: STATE.wall && date === "2026-10-13" ? 59999 : Math.round(minutes * 0.8), sessions, notes: [] };
  });
  const total = days.reduce((n, d) => n + d.minutes, 0);
  return { week: w, days, total_minutes: total, total_wall_minutes: Math.round(total * 0.8), unassigned: 0, hidden: 0 };
}
const dayItem = (id, text, o = {}) => ({ id, date: "2026-10-13", plan_item_id: null, tasks: [], text, detail: "", sort: Number(id.slice(1)), ai_status: null, ai_progress: null, ai_evidence: [], ai_note: null, manual_status: null, updated_at: "2026-10-13T00:00:00Z", final_status: "none", ...o });
const DAY_PLAN = { date: "2026-10-13", started_at: "2026-10-13T00:00:00Z", judged_at: null, judge_machine: null, judge_model: null, updated_at: "2026-10-13T00:00:00Z",
  items: [dayItem("D1", LONG_TITLE, { detail: LONG_SUM, ai_status: "partial", final_status: "partial" }), dayItem("D2", WORD, { manual_status: "done", final_status: "done" }), dayItem("D3", "短い")] };
const DETAIL = { task: TASKS[0], sessions: BY_DAY["2026-10-13"].slice(0, 15), notes: [], total_minutes: 99999,
  auto_deliverables: [{ kind: "file", key: `/very/long/path/${WORD}/${LONG_TITLE}.xlsx`, keys: [], title: null, verdict: "in", source: "rule", reason: "", sessions: [], last_at: "2026-10-13T00:00:00Z" }] };
const DASH = { range: {}, prev_range: {}, overview: { minutes: 599999, active_days: 20, sessions: 999, tasks_done: 3, tokens: 123456789, cost_usd: 12345.67, cost_partial: true },
  overview_prev: {}, time: { by_project: [], by_requester: [], by_task: Array.from({ length: 8 }, (_, i) => ({ task_id: `T${i}`, title: i === 1 ? CJK40 : i ? `案件 ${i}` : LONG_TITLE, minutes: 5000 - i * 400 })), unlinked_minutes: 300, unlinked_note_minutes: 0, weekly: [] },
  ai: {}, rhythm: {}, output: {}, hints: [], requesters: [] };
const PREFS = JSON.parse(readFileSync(new URL("../../server/src/prefs/defaults.json", import.meta.url), "utf8"));

const errors = [];
const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function api(r) {
  const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
  if (m !== "GET") return json(r, { error: "read-only check" }, 405);
  if (p === "/api/prefs") return json(r, PREFS);
  if (p === "/api/me") return json(r, { kind: "token" });
  if (p === "/api/machines/runs") return json(r, [{ name: "macmini", hours: Array.from({ length: 24 }, (_, h) => h % 3 !== 1), last_run_at: J("2026-10-13", "15:59") }, { name: "win11", hours: Array(24).fill(false), last_run_at: null }]);
  if (p === "/api/machines") return json(r, [{ name: "macmini", last_seen_at: J("2026-10-13", "15:59") }, { name: "win11", last_seen_at: J("2026-10-13", "12:00") }]);
  if (/^\/api\/weeks\/\d{4}-W\d{2}\/timeline$/.test(p)) return json(r, timeline(p.split("/")[3]));
  if (p === "/api/tasks/totals") return json(r, TASKS.map((x, i) => ({ id: x.id, total_minutes: 99999 - i * 9000, last_date: "2026-10-13" })));
  if (p === "/api/tasks") return json(r, TASKS);
  if (p.startsWith("/api/tasks/")) return json(r, { ...DETAIL, task: TASKS.find((x) => x.id === decodeURIComponent(p.split("/")[3])) ?? TASKS[0] });
  if (p === "/api/plan-items") return json(r, []);
  if (p === "/api/day-plans/2026-10-13") return json(r, DAY_PLAN);
  if (p.startsWith("/api/day-plans/")) return json(r, { error: "no plan" }, 404);
  if (p === "/api/report-downloads") return json(r, []);
  if (p === "/api/dashboard") return json(r, DASH);
  errors.push(`unserved ${m} ${p}${u.search}`);
  return json(r, { error: "not served" }, 404);
}

// ---- visits: [page, hash, optional selector to click open a sheet, optional STATE overrides] ----
const VISITS = [
  ["now", "#/m/now"], ["now", "#/m/now", ".m-spin"], ["now", "#/m/now", null, { wall: true }],
  ["tl", "#/m/tl"], ["tl", "#/m/tl?un=1"], ["tl", "#/m/tl/2026-10-12"], ["tl", "#/m/tl/2026-10-11"], ["tl", "#/m/tl", ".m-main button.m-row"],
  ["plan", "#/m/plan"], ["plan", "#/m/plan/2026-10-14"], ["plan", "#/m/plan", ".m-open"],
  ["tasks", "#/m/tasks"], ["tasks", "#/m/tasks/T1"], ["tasks", "#/m/tasks/T5"],
  ["stats", "#/m/stats?range=today"], ["stats", "#/m/stats"], ["stats", "#/m/stats?range=month"],
].filter(([p]) => !ONLY || ONLY.includes(p));

const failures = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
for (const theme of THEMES) for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", colorScheme: theme });
  await ctx.clock.setFixedTime(new Date("2026-10-13T16:00:00+09:00"));
  await ctx.addInitScript((th) => { try { localStorage.setItem("wl-m-theme", th); } catch { /* ignore */ } }, theme);
  await ctx.route("**/favicon.ico", (r) => r.fulfill({ status: 204 }));
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await ctx.route("https://fonts.gstatic.com/**", (r) => r.fulfill({ status: 200, contentType: "font/woff2", body: "" }));
  await ctx.route((u) => u.pathname.startsWith("/api/"), api);
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error" && !/\/api\/day-plans\/.*404|status of 404/.test(msg.text() + msg.location().url)) errors.push(`${theme}/${width} ${page.url()}: ${msg.text()}`); });
  page.on("pageerror", (e) => errors.push(`${theme}/${width} ${page.url()}: ${e.message}`));
  for (const [name, hash, open, state] of VISITS) {
    STATE.wall = !!state?.wall;
    await page.goto("about:blank");
    await page.goto(`${BASE}/${hash}`);
    await page.waitForSelector(".m-main");
    await page.waitForFunction(() => !document.querySelector(".m-skel"), null, { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    if (open) { await page.click(open); await page.waitForSelector(".m-sheet .m-sheet-body > *"); await page.waitForFunction(() => !document.querySelector(".m-sheet .m-skel"), null, { timeout: 15000 }); }
    const label = `${theme}/${width}/${hash}${open ? " +sheet" : ""}${state?.wall ? " +wall59999" : ""}`;
    const bad = await page.evaluate(() => {
      const W = window.innerWidth, out = [];
      if (document.documentElement.scrollWidth > W) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
      for (const el of document.querySelectorAll(".m-app *, .m-tabs *, .m-sheet *")) {
        if (el.closest(".m-chips") && !el.classList.contains("m-chips")) continue;   // the chip row scrolls inside itself
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > W + 0.5 || r.left < -0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).replace(/\s+/g, ".")} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
      }
      // text must stay inside its own box (.m-t1 ellipsizes by design and is excluded)
      for (const el of document.querySelectorAll(".m-app .m-t2, .m-app .m-wrap, .m-app .m-num, .m-app .m-side, .m-app .m-lab, .m-sheet .m-t2, .m-sheet .m-wrap, .m-sheet .m-num, .m-sheet .m-side, .m-sheet .m-lab")) {
        if (el.scrollWidth > el.clientWidth + 1) out.push(`text ${el.tagName.toLowerCase()}.${String(el.className).replace(/\s+/g, ".")} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      }
      // nothing may stick out of its card / sheet body
      for (const box of document.querySelectorAll(".m-card, .m-sheet-body")) {
        const b = box.getBoundingClientRect();
        for (const el of box.querySelectorAll("*")) {
          if (el.closest(".m-chips") || el.classList.contains("m-status")) continue;   // m-status: invisible 44px tap area that deliberately reaches into the gutter; its .m-x mark is still checked
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > b.right + 0.5 || r.left < b.left - 0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).replace(/\s+/g, ".")} [${Math.round(r.left)}, ${Math.round(r.right)}] outside ${String(box.className)} [${Math.round(b.left)}, ${Math.round(b.right)}]`);
        }
      }
      return out.slice(0, 8);
    });
    if (state?.wall && !(await page.locator('.m-dotnum[aria-label="999:59"]').count())) bad.push("工作时间 999:59 not rendered");   // the dot digits carry their text in aria-label
    if (bad.length) failures.push(`${label}: ${bad.join("; ")}`);
    await page.screenshot({ path: path.join(OUT, `${name}-${theme}-${width}-${hash.replace(/[^\w]+/g, "_")}${open ? "-sheet" : ""}${state?.wall ? "-wall" : ""}.png`) });
  }
  await ctx.close();
}
// desktop shell at phone width with the device opted out: lets a human see the fixed 手机版 pill (not counted).
// isMobile is off on purpose: the desktop page is ~858px wide, which a mobile emulation would lay out wide and crop to 390.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await ctx.clock.setFixedTime(new Date("2026-10-13T16:00:00+09:00"));
  await ctx.addInitScript(() => { try { localStorage.setItem("wl-mobile", "off"); } catch { /* ignore */ } });
  await ctx.route("**/favicon.ico", (r) => r.fulfill({ status: 204 }));
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await ctx.route("https://fonts.gstatic.com/**", (r) => r.fulfill({ status: 200, contentType: "font/woff2", body: "" }));
  await ctx.route((u) => u.pathname.startsWith("/api/"), api);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/v2/now`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "v2-pill-390.png") });
  await ctx.close();
}
await browser.close();
if (errors.length) console.error("console / API errors:\n" + errors.join("\n"));
if (failures.length) console.error("overflow:\n" + failures.join("\n"));
if (errors.length || failures.length) process.exit(1);
console.log(`ok: ${VISITS.length} views × ${WIDTHS.length} widths × ${THEMES.length} themes, nothing crosses the screen; screenshots in ${OUT}`);
