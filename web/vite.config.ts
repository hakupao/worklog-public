import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vite";
import { defineConfig, type Plugin } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

// `build.emptyOutDir` wipes server/public/, including the .gitkeep that keeps the
// (otherwise git-ignored) directory present before the first `npm run build`. Restore it
// once the bundle is written so `git status` stays clean after a build.
const restorePublicGitkeep: Plugin = {
  name: "restore-public-gitkeep",
  closeBundle() {
    writeFileSync(path.resolve(here, "../server/public/.gitkeep"), "");
  },
};

// `vite build --mode demo` (npm run build:demo): the static demo site (docs/projects/2026-10-22-demo-site/PLAN.md),
// the real UI and the real Worker app in one page over sql.js. Its entry is demo/entry.ts, swapped in for
// /src/main.tsx here, so the production build below never references anything under demo/.
const demoEntry: Plugin = {
  name: "demo-entry",
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      const out = html.replace('src="/src/main.tsx"', 'src="/demo/entry.ts"');
      if (out === html) throw new Error("demo-entry: index.html no longer loads /src/main.tsx");
      // no favicon is shipped; on a project page /favicon.ico is the user site's, so ask for none at all
      return out.replace("</head>", '  <link rel="icon" href="data:," />\n  </head>');
    },
  },
};
const demo = (): UserConfig => ({
  plugins: [react(), demoEntry],
  base: process.env.DEMO_BASE ?? "/worklog-public/",
  publicDir: "demo/public",   // copied as is, unhashed; demo.sqlite is imported by demo/entry.ts (?url) instead
  resolve: {
    alias: {
      "@cloudflare/puppeteer": path.resolve(here, "demo/stubs/puppeteer.ts"),
      "@anthropic-ai/sdk": path.resolve(here, "demo/stubs/anthropic.ts"),
    },
  },
  build: { outDir: "dist-demo", emptyOutDir: true, chunkSizeWarningLimit: 4096 },
  server: { fs: { allow: [".", "../docs/guide", "../server"] } },
});

export default defineConfig(({ mode }) => mode === "demo" ? demo() : {
  plugins: [react(), restorePublicGitkeep],
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
  server: {
    // The help page imports docs/guide/usage.md (`?raw`) from outside web/.
    fs: { allow: [".", "../docs/guide"] },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        headers: { Authorization: `Bearer ${process.env.WORKLOG_DEV_TOKEN ?? "dev-token"}` },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // above test/setup.ts' 10s asyncUtilTimeout, so a wait that runs out fails with its own message under load
    testTimeout: 20_000,
  },
});
