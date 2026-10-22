// Shared types of the demo seed. Everything here is fictional demo data (docs/projects/2026-10-22-demo-site/PLAN.md S2).

/** What the demo runtime (web/demo/build-db.ts) hands the seed: the real Hono app behind `api`, raw SQL on the same
 *  database (always awaited here), and DEMO_NOW. */
export type { SeedContext as SeedCtx } from "../seed-context";

export type Lang = "ja" | "zh" | "en";
/** One text in the three UI languages. */
export type Tri = { ja: string; zh: string; en: string };
/** A text as typed in its source language, with the other two as its translations. */
export type Said = { tri: Tri; src: Lang };

export type MachineKey = "mac" | "win";
export type Agent = "claude-code" | "codex";

/** server/src/schemas.ts SessionTokens, as JSON. */
export type ModelTokens = { input: number; output: number; cache_read: number; cache_write_5m: number; cache_write_1h: number; reasoning: number };
export type SessionTokens = { by_model: Record<string, ModelTokens>; subagent: Record<string, ModelTokens>; cost_usd: number | null; cost_partial: boolean };

/** server/src/schemas.ts SessionIn, as the collector sends it. */
export interface SessionBody {
  id: string; machine: string; agent: Agent; session_id: string; cwd: string;
  started_at: string; ended_at: string; active_minutes: number; turns: number;
  summary: string; summary_source: "llm" | "fallback";
  task_id: string | null; link_method: "auto-dir" | "auto-time" | "manual" | "none";
  files_written: string[]; tokens: SessionTokens; active_intervals: [string, string][];
  artifacts: { url: string; title: string | null; artifact_id: string | null; ts: string }[];
  ts: string;
}
