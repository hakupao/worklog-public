import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
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

export default defineConfig({
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
