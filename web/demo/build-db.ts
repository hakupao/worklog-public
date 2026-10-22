// Builds demo.sqlite (PLAN D4): an empty sql.js database, server/migrations applied in order, then the seed module run
// through the real app on the demo clock. Bundled and run by scripts/build-demo-db.mjs, which picks the seed module
// ("demo-seed": seed/index.ts) and passes the paths below.
import "./clock-install";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
// @ts-expect-error resolved by the bundler (scripts/build-demo-db.mjs)
import { seed } from "demo-seed";
import { createDemoApp, toAppRequest } from "./app";
import { DEMO_NOW } from "./clock";
import type { Seed, SeedContext } from "./seed-context";

const [migrationsDir, outFile] = process.argv.slice(2);
if (!migrationsDir || !outFile) throw new Error("usage: build-db.mjs <migrations dir> <out file>");

const SQL = await initSqlJs();
const db = new SQL.Database();
const app = createDemoApp(db);

const files = readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
for (const f of files) await app.DB.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
// What wrangler's migration runner records; harmless here, and lets the file be inspected like a D1 export.
db.run("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
for (const f of files) db.run("INSERT INTO d1_migrations (name) VALUES (?)", [f]);

let calls = 0;
const ctx: SeedContext = {
  async api(method, p, body) {
    calls++;
    const req = new Request(`https://demo.invalid${p}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await app.fetch(await toAppRequest(req));
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 500)}`);
    if (!text) return undefined as never;
    try { return JSON.parse(text); } catch { return text as never; }
  },
  async sql(query, ...params) {
    return (await app.DB.prepare(query).bind(...params).all()).results as never;
  },
  now: new Date(DEMO_NOW),
};

await (seed as Seed)(ctx);

db.run("VACUUM");
const bytes = db.export();
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, bytes);
const check = new SQL.Database(bytes);
const counts = ["tasks", "sessions", "notes", "plan_items", "day_plans", "weekly_reviews", "report_digests"].map((t) => {
  try { return `${t} ${check.exec(`SELECT count(*) FROM ${t}`)[0].values[0][0]}`; } catch { return `${t} ?`; }
});
console.log(`demo.sqlite: ${files.length} migrations, ${calls} API calls, ${(bytes.byteLength / 1024).toFixed(0)} KiB → ${outFile}`);
console.log(`  ${counts.join(" · ")}`);
