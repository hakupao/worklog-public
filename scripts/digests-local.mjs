// scripts/digests-local.mjs — writes the 週報 digests on this machine (design 2026-10-08-s2c §2.3) while the
// Worker's API generation is off (DIGESTS_AUTO). Per report week: read the inputs from the server, ask `claude -p`
// for {lines, pdf_lines} plus zh / en (the week also its cover oneliner), write them back (the server refuses a stale
// input or a hand-edited line). A week whose oneliner is missing and that was not regenerated in this run (its text was
// edited by hand) gets one oneliner-only call beside the PDF-only pass.
// Usage: node scripts/digests-local.mjs [--from 2026-W30] [--to 2026-W41] [--all] [--dry-run] [--model opus] [--concurrency 3] [--claude <cmd>] [--base <url>]
// One-time audited backfill (plan 2026-10-13-xlsx-range-report, Task 13) of the weeks' missing oneliners:
//   node scripts/digests-local.mjs --oneliners --from <W> [--to <W>] (--save <file> | --load <file>)
// --save only generates and writes the JSON file [{ week, source_text, oneliner, zh, en }] (no PUT); --load only PUTs
// that file's entries whose week is within --from..--to (no claude; the others are counted, all ignored → exit 1). A text that moved on since --save is skipped (409).
// Range: --to defaults to this report week, --from to the week before --to (the cron's range, R11). Older weeks only with
// an explicit --from: a report already handed in must not be rewritten from later 備考 / titles by default.
// Server: --base, else WORKLOG_API, else config.toml api_url — i.e. production unless one of the first two is set.
// --dry-run: only GETs the inputs and prints each week's todo; never runs claude, never writes. Exit 1 if anything failed.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keepOtherInPdf } from "./digests-pdf-other.mjs";
import { LOCAL, LOCAL_ONE, LOCAL_WEEK, checkLines, checkOne, checkWeek, onelinerBody, onelinerLong, onelinerTodo } from "./digests-local-prompts.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) =>
  a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : []).filter((x) => x.length));
const MODEL = args.model ?? "opus", CONC = Number(args.concurrency ?? 3);
const DRY = !!args["dry-run"], CLAUDE = args.claude ?? "claude";   // --dry-run only lists the todo: no claude, no PUT
const die = (msg) => { console.error(msg); process.exit(1); };
if (!Number.isInteger(CONC) || CONC < 1) die(`--concurrency must be an integer >= 1 (got ${args.concurrency})`);
for (const k of ["from", "to"]) if (k in args && !/^\d{4}-W\d{2}$/.test(args[k])) die(`--${k} must look like 2026-W41 (got ${args[k]})`);
const ONE = !!args.oneliners;
if (ONE) {
  if (!("from" in args)) die("--oneliners needs --from");
  if (("save" in args) === ("load" in args)) die("--oneliners needs exactly one of --save <file> / --load <file>");
  const f = args.save ?? args.load;
  if (typeof f !== "string") die(`--${"save" in args ? "save" : "load"} needs a file path`);
}

// --- config: api_url from config.toml (repo root), credentials from ~/.worklog/credentials.toml (flat TOML) ---
const toml = (p) => !existsSync(p) ? {} : Object.fromEntries(readFileSync(p, "utf8").split("\n")
  .map((l) => /^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
const cfg = toml(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "config.toml"));
const cred = toml(path.join(homedir(), ".worklog", "credentials.toml"));
const BASE = args.base ?? process.env.WORKLOG_API ?? cfg.api_url;
const TOKEN = process.env.WORKLOG_TOKEN ?? cred.api_token;
if (!BASE) die("no server URL: set api_url in config.toml, WORKLOG_API, or --base");
if (!TOKEN) die("no API token: set api_token in ~/.worklog/credentials.toml or WORKLOG_TOKEN");
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json",
  "User-Agent": "worklog-digests-local/1 (+node)",   // Cloudflare rejects requests without a real UA (error 1010)
  ...(cred.access_client_id && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE ?? "") ? { "CF-Access-Client-Id": cred.access_client_id, "CF-Access-Client-Secret": cred.access_client_secret } : {}),
};
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await r.text();
  return { status: r.status, json: (() => { try { return JSON.parse(text); } catch { return text; } })() };
};

// --- weeks: ISO week arithmetic on the key (the server's report week shares the key) ---
const weekKey = (d) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`; };
const mondayOf = (key) => { const [y, w] = key.split("-W").map(Number); const j4 = new Date(Date.UTC(y, 0, 4));
  const m = new Date(j4); m.setUTCDate(j4.getUTCDate() - ((j4.getUTCDay() || 7) - 1) + (w - 1) * 7); return m; };
const shift = (key, n) => { const m = mondayOf(key); m.setUTCDate(m.getUTCDate() + 7 * n); return weekKey(m); };
// This report week = the ISO week of the coming Friday (05:00 JST day): good enough for a default bound.
const now = new Date(Date.now() + 9 * 3600e3 - 5 * 3600e3), toFri = (5 - now.getUTCDay() + 7) % 7;
const thisWeek = weekKey(new Date(now.getTime() + toFri * 86400e3));
const TO = args.to ?? thisWeek, FROM = args.from ?? shift(TO, -1);   // R11: this week + last week unless --from
const weeks = []; for (let w = FROM; w <= TO; w = shift(w, 1)) weeks.push(w);

// --- claude -p: the full system prompt (the server's + a local part from digests-local-prompts.mjs); `check` validates the reply ---
function claude(system, input, check) {
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(path.join(tmpdir(), "wl-digest-"));
    // claude runs in an empty temp dir (no project settings / CLAUDE.md); a relative script path in --claude must survive that
    const [cmd, ...pre] = CLAUDE.split(" ").map((t, i) => i > 0 && existsSync(t) ? path.resolve(t) : t);
    const p = spawn(cmd, [...pre, "-p", "--setting-sources", "", "--no-session-persistence", "--model", MODEL, "--system-prompt", system],
      { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("claude timed out")); }, 180_000);
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); rmSync(cwd, { recursive: true, force: true }); reject(new Error(`cannot run ${cmd}: ${e.code ?? e.message}`)); });
    p.on("close", (code) => {
      clearTimeout(timer); rmSync(cwd, { recursive: true, force: true });
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`));
      try {
        const j = JSON.parse(out.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
        if (!check(j)) throw new Error("shape");
        resolve(j);
      } catch (e) { reject(new Error(`bad JSON from claude: ${out.slice(0, 200)}`)); }
    });
    p.stdin.on("error", (e) => { clearTimeout(timer); reject(new Error(`claude stdin: ${e.code ?? e.message}`)); });   // EPIPE: claude exited early
    p.stdin.end(input);
  });
}
const namesBlock = (names) => !names?.length ? "" :
  `\n\n## 案件名の訳（ja｜zh｜en。zh・en の行ではこの名前をそのまま使う）\n${names.map((n) => `- ${n.ja}｜${n.zh}｜${n.en}`).join("\n")}`;
const join = (a) => a.map((s) => String(s).trim()).filter(Boolean).join("\n");

async function pool(items, fn) {
  const q = [...items]; await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) await fn(q.shift()); }));
}

let failed = 0;
// Over the length target: one more try; the retry wins when it fits, else the first reply stays (a failed retry too).
const oneliner = async (system, text, names) => {
  const ask = () => claude(system.oneliner + LOCAL_ONE, `## 今週のまとめ\n${text}${namesBlock(names)}`, checkOne);
  const j = await ask();
  if (!onelinerLong(j)) return j;
  const k = await ask().catch(() => j);
  if (!onelinerLong(k)) return k;
  console.error("oneliner over 40 字 / 25 words after a retry: kept the first reply");
  return j;
};

// --- --oneliners: the one-time audited backfill (--save generates into a file, --load writes that file) ---
if (ONE && DRY) {
  for (const week of weeks) {
    const r = await call("GET", `/api/reports/${week}/digest-inputs`).catch((e) => ({ status: 0, json: String(e) }));
    if (r.status !== 200) { failed++; console.error(week, "inputs", r.status, r.json); continue; }
    console.log(week, "oneliner_missing", onelinerTodo(r.json.items, new Set()).length > 0);
  }
} else if (ONE && args.save) {
  const out = [];
  for (const week of weeks) {
    const r = await call("GET", `/api/reports/${week}/digest-inputs`).catch((e) => ({ status: 0, json: String(e) }));
    if (r.status !== 200) { failed++; console.error(week, "inputs", r.status, r.json); continue; }
    const { system, items, names } = r.json;
    await pool(onelinerTodo(items, new Set()), async (i) => {
      try {
        const j = await oneliner(system, i.text, names);
        out.push({ week, source_text: i.text, oneliner: j.oneliner.trim(), zh: j.zh.oneliner.trim(), en: j.en.oneliner.trim() });
      } catch (e) { failed++; console.error(week, "oneliner", String(e)); }
    });
  }
  out.sort((a, b) => a.week.localeCompare(b.week));
  writeFileSync(args.save, JSON.stringify(out, null, 2) + "\n");
  console.log("saved", out.length, "→", args.save, failed ? `(${failed} failed)` : "");
} else if (ONE) {
  const all = JSON.parse(readFileSync(args.load, "utf8")), entries = all.filter((e) => e.week >= FROM && e.week <= TO);
  const stat = { filled: 0, skipped: 0, failed: 0, outside: all.length - entries.length };   // outside --from..--to: not written
  if (stat.outside) console.error(`${stat.outside} of ${all.length} entries outside ${FROM}..${TO}: ignored`);
  if (all.length && !entries.length) failed++;   // every entry ignored: almost surely the wrong range
  for (const e of entries) {
    try {
      const res = await call("PUT", `/api/reports/${e.week}/digests/week/generated`, onelinerBody(e, MODEL));
      if (res.status === 200) stat.filled++; else { (res.status === 404 || res.status === 409 ? stat.skipped++ : stat.failed++); console.error(e.week, "oneliner", res.status, res.json); }
    } catch (err) { stat.failed++; console.error(e.week, "oneliner", String(err)); }
  }
  failed += stat.failed;
  console.log("load", JSON.stringify(stat));
}

for (const week of ONE ? [] : weeks) {
  const stat = { generated: 0, pdf: 0, oneliner: 0, skipped: 0, failed: 0 };
  const regenerated = new Set();   // "" once this run wrote the week line (with its oneliner)
  const run = async (dayOnly) => {
    let r;
    try { r = await call("GET", `/api/reports/${week}/digest-inputs`); } catch (e) { console.error(week, "inputs", String(e)); stat.failed++; return; }
    if (r.status !== 200) { console.error(week, "inputs", r.status, r.json); stat.failed++; return; }
    const { system, items, names, limits } = r.json;
    const todo = items.filter((i) => (dayOnly ? i.day !== "" : i.day === "") && !i.edited && (args.all || !i.fresh));
    const pdfTodo = items.filter((i) => (dayOnly ? i.day !== "" : i.day === "") && i.pdf_missing);
    if (DRY) {
      console.log(week, dayOnly ? "days" : "week", "→", todo.map((i) => i.day || "week"), "pdf-only", pdfTodo.map((i) => i.day || "week"),
        ...(dayOnly ? [] : ["oneliner", onelinerTodo(items, new Set(todo.map((i) => i.day))).map(() => "week")]));
      return;
    }
    await pool(todo, async (i) => {
      try {
        // a week reply's text is judged by the line check alone; a bad / missing oneliner is just not sent (NULL), and a
        // later run's onelinerTodo refills it from the stored text (not this run: its item still holds the old text)
        const j = await claude(i.day ? system.day + LOCAL : system.week + LOCAL_WEEK, i.input + namesBlock(names), checkLines);
        const one = !i.day && checkWeek(j);
        if (!i.day && !one) console.error(week, "week", "oneliner missing or malformed in the reply: not written");
        if (!i.day && keepOtherInPdf(j)) {   // week only: a day's PDF version is one line by design
          const cap = limits?.[i.day ? "day" : "week"]?.pdf, over = cap && [...join(j.pdf_lines)].length > cap;
          console.log(week, i.day || "week", "R17: その他 line missing from pdf_lines, appended" + (over ? ` but over the cap (${cap}) — the server will drop it` : ""));
        }
        const res = await call("PUT", `/api/reports/${week}/digests/${i.day || "week"}/generated`, {
          text: join(j.lines), pdf_text: join(j.pdf_lines), inputs_hash: i.hash, model: `${MODEL}-local`,
          ...(one ? { oneliner: j.oneliner.trim() } : {}),   // the week's cover oneliner, from the same reply
          zh: { text: join(j.zh.lines), pdf_text: join(j.zh.pdf_lines), ...(one ? { oneliner: j.zh.oneliner.trim() } : {}) },
          en: { text: join(j.en.lines), pdf_text: join(j.en.pdf_lines), ...(one ? { oneliner: j.en.oneliner.trim() } : {}) } });
        if (res.status === 200) { stat.generated++; if (!i.day) regenerated.add(""); } else { (res.status === 404 || res.status === 409 ? stat.skipped++ : stat.failed++); console.error(week, i.day || "week", res.status, res.json); }
      } catch (e) { stat.failed++; console.error(week, i.day || "week", String(e)); }
    });
    await pool(pdfTodo, async (i) => {
      try {
        const j = await claude((i.day ? system.day : system.week) + LOCAL, `## 手で直した本文（これだけを根拠に pdf_lines を作る。lines はこの本文をそのまま行に分けて返す）\n${i.text}${namesBlock(names)}`, checkLines);
        const res = await call("PUT", `/api/reports/${week}/digests/${i.day || "week"}/generated`, {
          pdf_only: true, source_text: i.text, pdf_text: join(j.pdf_lines), model: `${MODEL}-local`,
          zh: { pdf_text: join(j.zh.pdf_lines) }, en: { pdf_text: join(j.en.pdf_lines) } });
        if (res.status === 200) stat.pdf++; else { (res.status === 404 || res.status === 409 ? stat.skipped++ : stat.failed++); console.error(week, i.day || "week", "pdf", res.status, res.json); }
      } catch (e) { stat.failed++; console.error(week, i.day || "week", "pdf", String(e)); }
    });
    if (dayOnly) return;
    // the week text was not regenerated (e.g. edited by hand) and has no oneliner: one call from the stored text
    await pool(onelinerTodo(items, regenerated), async (i) => {
      try {
        const j = await oneliner(system, i.text, names);
        const res = await call("PUT", `/api/reports/${week}/digests/week/generated`,
          onelinerBody({ week, source_text: i.text, oneliner: j.oneliner, zh: j.zh.oneliner, en: j.en.oneliner }, MODEL));
        if (res.status === 200) stat.oneliner++; else { (res.status === 404 || res.status === 409 ? stat.skipped++ : stat.failed++); console.error(week, "week", "oneliner", res.status, res.json); }
      } catch (e) { stat.failed++; console.error(week, "week", "oneliner", String(e)); }
    });
  };
  await run(true);    // days first: the week's input is built from the stored day lines
  await run(false);
  failed += stat.failed;
  console.log(week, JSON.stringify(stat));
}
process.exit(failed ? 1 : 0);
