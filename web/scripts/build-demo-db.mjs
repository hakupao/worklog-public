#!/usr/bin/env node
// Produces web/demo/demo.sqlite for the demo site (PLAN D4): bundles demo/build-db.ts with the server code
// (Vite SSR build; only sql.js stays external) and runs it. The seed module is demo/seed/index.ts. Not in demo/public:
// demo/entry.ts imports it with ?url, so the built file name carries a content hash.
// Usage: node scripts/build-demo-db.mjs [out file]
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedModule = path.join(web, "demo/seed/index.ts");
const outDir = path.join(web, "node_modules/.cache/worklog-demo");
const outFile = path.resolve(process.argv[2] ?? path.join(web, "demo/demo.sqlite"));

console.log(`seed: ${path.relative(web, seedModule)}`);
await build({
  configFile: false,
  root: web,
  logLevel: "warn",
  resolve: {
    alias: {
      "demo-seed": seedModule,
      "@cloudflare/puppeteer": path.join(web, "demo/stubs/puppeteer.ts"),
      "@anthropic-ai/sdk": path.join(web, "demo/stubs/anthropic.ts"),
    },
  },
  ssr: { noExternal: true, external: ["sql.js"] },
  build: {
    ssr: path.join(web, "demo/build-db.ts"),
    outDir,
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rolldownOptions: { output: { format: "esm", entryFileNames: "build-db.mjs" } },
  },
});

const run = spawnSync(process.execPath, [path.join(outDir, "build-db.mjs"), path.resolve(web, "../server/migrations"), outFile], { stdio: "inherit" });
process.exit(run.status ?? 1);
