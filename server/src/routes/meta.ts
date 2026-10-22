import { Hono } from "hono";
import type { AppEnv } from "../env";
import { hourSlots } from "../runs";
import { splitRequesters } from "../requesters";

export const meta = new Hono<AppEnv>();

meta.get("/stats", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM tasks) AS tasks,
            (SELECT COUNT(*) FROM sessions) AS sessions,
            (SELECT COUNT(*) FROM notes) AS notes`,
  ).first<{ tasks: number; sessions: number; notes: number }>();
  return c.json(row);
});

meta.get("/machines", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT name, last_seen_at FROM machines ORDER BY name",
  ).all();
  return c.json(results);
});

// 24 hourly slots per machine (the 采集 dots on the phone's 此刻); a machine that never sent a heartbeat gets all false.
meta.get("/machines/runs", async (c) => {
  const db = c.env.DB, now = Date.now();
  const since = new Date(now - 25 * 3_600_000).toISOString();
  const [machines, runs, last] = await db.batch([
    db.prepare("SELECT name FROM machines ORDER BY name"),
    db.prepare("SELECT machine, at FROM harvest_runs WHERE at >= ?1").bind(since),
    db.prepare("SELECT machine, MAX(at) AS at FROM harvest_runs GROUP BY machine"),
  ]);
  const byMachine = new Map<string, string[]>();
  for (const r of runs.results as { machine: string; at: string }[]) byMachine.set(r.machine, [...(byMachine.get(r.machine) ?? []), r.at]);
  const lastAt = new Map((last.results as { machine: string; at: string }[]).map((r) => [r.machine, r.at]));
  return c.json((machines.results as { name: string }[]).map(({ name }) => ({
    name, hours: hourSlots(byMachine.get(name) ?? [], now), last_run_at: lastAt.get(name) ?? null,
  })));
});

meta.get("/me", (c) => c.json(c.get("identity")));

meta.get("/requesters", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT DISTINCT requester FROM tasks").all<{ requester: string }>();
  // Individual names, not the stored "A、B" strings: this feeds the pick-one-依頼元 suggestions.
  const names = new Set(results.flatMap((r) => splitRequesters(r.requester)));
  return c.json([...names].sort());
});
