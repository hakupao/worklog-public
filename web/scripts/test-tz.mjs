#!/usr/bin/env node
// Standing proof that jst.ts's Tokyo-time math is correct under any host time zone, on any OS.
// `TZ=<zone> vitest run ...` (a shell env-var prefix) is POSIX-only: it is not a valid command
// on Windows cmd/PowerShell, and this project has a Windows onboarding path (see
// docs/plans/2026-09-22-web-service-plan2b-web-ui.md). Spawning vitest as a child
// process with TZ set on `env` works identically on every platform, with no extra dependency
// (no cross-env) — Node reads TZ from the environment at process startup, which is also why each
// zone gets its own fresh child process rather than reassigning `process.env.TZ` mid-run: Node
// only picks up TZ when a process starts, not when an already-running process's env changes.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// vitest's package.json only exports a handful of subpaths — "./vitest.mjs" (its `bin` target)
// is not one of them, so `require.resolve("vitest/vitest.mjs")` throws. "./package.json" IS
// exported, so resolve that and find its sibling `vitest.mjs`, the same file `bin` points at.
const require = createRequire(import.meta.url);
const vitestPkgPath = require.resolve("vitest/package.json");
const vitestBin = path.join(path.dirname(vitestPkgPath), "vitest.mjs");

const ZONES = ["America/New_York", "Pacific/Kiritimati"];

for (const zone of ZONES) {
  console.log(`\n=== tz-sensitive tests under TZ=${zone} ===`);
  const result = spawnSync(process.execPath, [vitestBin, "run", "test/lib", "test/i18n.test.ts", "test/predict-time.test.ts", "test/cal.test.ts", "test/predict-snapshot.test.ts", "test/predict-scenarios.test.ts", "test/timeline-state.test.ts", "test/timeline-week.test.ts", "test/timeline-chart.test.tsx", "test/tasks-layout.test.ts", "test/TasksPage.test.tsx", "test/TaskDrawer.test.tsx", "test/plan-state.test.ts", "test/plan-layout.test.ts", "test/PlanPage.test.tsx", "test/PlanDrawer.test.tsx", "test/predict-rules.test.ts", "test/NowRows.test.tsx", "test/report-state.test.ts", "test/report-matrix.test.ts", "test/report-data.test.tsx", "test/ReportPage.test.tsx", "test/ReportDays.test.tsx", "test/report-bar.test.ts", "test/ReportDrawer.test.tsx", "test/ReportTasks.test.tsx", "test/ReportSheets.test.tsx", "test/stats-state.test.ts", "test/stats-data.test.tsx", "test/stats-sessions.test.tsx", "test/stats-hints.test.ts", "test/StatsPage.test.tsx", "test/StatsSections.test.tsx", "test/stats-bar.test.ts", "test/stats-daily.test.ts", "test/stats-heat.test.ts", "test/StatsRhythm.test.tsx", "test/StatsReview.test.tsx", "test/viz-day.test.ts", "test/viz-wall.test.ts", "test/statsViews.test.ts", "test/StatsViewsSettings.test.tsx", "test/ViewFrame.test.tsx", "test/Views.test.tsx", "test/viz-ec.test.ts", "test/EChart.test.tsx", "test/EChartChunk.test.tsx", "test/EChartChunkWorld.test.tsx", "test/ViewEcharts.test.tsx", "test/viz-headlines.test.ts", "test/viz-waterfall.test.ts", "test/viz-calendar.test.ts", "test/ViewHand.test.tsx", "test/viz-river.test.ts", "test/viz-dial.test.ts", "test/ViewRiverDial.test.tsx", "test/viz-stream.test.ts", "test/viz-stars.test.ts", "test/viz-fingerprint.test.ts", "test/ViewStreamStars.test.tsx", "test/viz-terrain.test.ts", "test/ViewTerrain.test.tsx", "test/viz-compute.test.ts", "test/viz-density.test.ts", "test/viz-plans.test.ts", "test/viz-sunburst.test.ts", "test/ViewComputePlans.test.tsx", "test/viz-flow.test.ts", "test/ViewFlow.test.tsx", "test/ViewsAudit.test.tsx", "test/useCanvas.test.tsx", "test/sprite.test.ts", "test/UsagePage.test.tsx", "test/m/format.test.ts", "test/m/Timeline.test.tsx", "test/m/Plan.test.tsx", "test/m/Stats.test.tsx", "test/m/stats-range.test.ts", "test/m/Now.test.tsx"], {
    cwd: webRoot,
    env: { ...process.env, TZ: zone },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`\nfailed to run vitest under TZ=${zone}:`, result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\ntz-sensitive tests failed under TZ=${zone} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}
