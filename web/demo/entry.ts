// The demo site's entry (vite.config.ts swaps it in for /src/main.tsx in `--mode demo` only, so the production bundle
// never references anything under demo/). Order matters: the clock first, then the database and the in-page app,
// then the real UI (src/main.tsx), which only starts once every /api/ call has somewhere to go.
import "./clock-install";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
// scripts/build-demo-db.mjs writes it; ?url gives it a content hash, so a redeploy never pairs new code with a cached old database
import dbUrl from "./demo.sqlite?url";
import { createDemoApp, toAppRequest, type DemoApp } from "./app";
import { mountBanner } from "./banner";
import { installFetch } from "./fetch";

/** `?world=omote|ura` and `?lang=zh|ja|en` (before the #hash) preset those prefs, so a link — the README's, the
 *  screenshot script's — can open the demo in a given world and language. The database resets on reload anyway. */
async function applyQueryPrefs(app: DemoApp): Promise<void> {
  const q = new URLSearchParams(location.search);
  const world = q.get("world"), lang = q.get("lang");
  const patch: Record<string, string> = {};
  if (world === "ura" || world === "omote") patch.world = world;
  if (lang === "zh" || lang === "ja" || lang === "en") patch.lang = lang;
  if (!Object.keys(patch).length) return;
  const call = async (method: string, body?: object) => app.fetch(await toAppRequest(new Request(
    new URL("/api/prefs", location.origin), { method, body: body ? JSON.stringify(body) : undefined, headers: body ? { "Content-Type": "application/json" } : {} })));
  const prefs = (await (await call("GET")).json()) as object;
  const res = await call("PUT", { ...prefs, ...patch });
  if (!res.ok) console.warn("[demo] could not apply ?world/?lang", res.status, await res.text());
}

async function boot(): Promise<void> {
  const [SQL, bytes] = await Promise.all([
    initSqlJs({ locateFile: () => wasmUrl }),
    fetch(dbUrl).then((r) => {
      if (!r.ok) throw new Error(`demo.sqlite: HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const app = createDemoApp(new SQL.Database(new Uint8Array(bytes)));
  await applyQueryPrefs(app);
  installFetch(app);
  mountBanner();
  await import("../src/main");
}

boot().catch((e) => {
  console.error("[demo] could not start", e);
  const root = document.getElementById("root");
  if (root) root.textContent = `The demo could not start: ${e instanceof Error ? e.message : String(e)}`;
});
