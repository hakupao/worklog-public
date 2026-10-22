import type { Context } from "hono";
import { z } from "zod";
import type { SheetKey } from "./report/types";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ReviewIn = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  text: z.string().min(1).max(20_000),
  model: z.string().min(1).max(100),
  stats_json: z.string().max(500_000),
  machine: z.string().min(1).max(100),
  force: z.boolean().optional(),
});

export const TaskIn = z.object({
  requester: z.string().min(1),
  project: z.string().default(""),
  title: z.string().min(1),
  status: z.enum(["open", "done", "hold"]),
  received_at: dateStr,
  done_at: dateStr.nullable().default(null),
  thinking: z.string().default(""),
  deliverables: z.array(z.string()).default([]),
  hours_manual: z.number().min(0).nullable().default(null),
  machine: z.string().min(1),
  ts: z.string().min(1),
});

export const TaskCreate = z
  .object({
    requester: z.string().min(1), title: z.string().min(1), project: z.string().default(""),
    received_at: dateStr.optional(),              // 缺省 = 今天（JST）
    thinking: z.string().default(""), machine: z.string().min(1).default("web"),
  })
  .strict();

export const TaskPatch = z
  .object({
    updated_at: z.string().min(1),
    requester: z.string().min(1).optional(), title: z.string().min(1).optional(), project: z.string().optional(),
    status: z.enum(["open", "done", "hold"]).optional(), received_at: dateStr.optional(),
    done_at: dateStr.nullable().optional(), thinking: z.string().optional(),
    deliverables: z.array(z.string()).optional(), hours_manual: z.number().min(0).nullable().optional(),
  })
  .strict();

export const NoteIn = z.object({
  text: z.string().min(1),
  task_id: z.string().nullable().default(null),
  minutes: z.number().int().nullable().default(null),
  machine: z.string().min(1),
  ts: z.string().min(1),
});

export const NoteCreate = z
  .object({
    text: z.string().min(1), task_id: z.string().min(1).nullable().default(null),
    minutes: z.number().int().min(0).nullable().default(null),
    date: dateStr.optional(),                      // 缺省 = 今天（JST）；用于补记过去某天的工作
    machine: z.string().min(1).default("web"),
  })
  .strict();

export const NotePatch = z
  .object({
    updated_at: z.string().min(1), text: z.string().min(1).optional(),
    task_id: z.string().min(1).nullable().optional(), minutes: z.number().int().min(0).nullable().optional(),
  })
  .strict();

const Horizon = z.enum(["daily", "week", "near", "far"]);
const weekStr = z.string().regex(/^\d{4}-W\d{2}$/);
export const PlanItemCreate = z
  .object({
    horizon: Horizon, text: z.string().trim().min(1).max(2000),
    task_ids: z.array(z.string().min(1)).max(20).default([]),
    until_date: dateStr.nullable().default(null),
  })
  .strict();
export const PlanItemPatch = z
  .object({
    updated_at: z.string().min(1),
    text: z.string().trim().min(1).max(2000).optional(), horizon: Horizon.optional(),
    task_ids: z.array(z.string().min(1)).max(20).optional(), status: z.enum(["active", "done", "dropped"]).optional(),
    until_date: dateStr.nullable().optional(), sort: z.number().int().optional(), week: weekStr.optional(),
  })
  .strict();

export const DayStatus = z.enum(["done", "partial", "none"]);
export const JudgementIn = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/), model: z.string().min(1).max(100), machine: z.string().min(1).max(100),
    items: z.array(z.object({
      id: z.string().min(1), status: DayStatus, progress: z.string().max(200),
      evidence: z.array(z.string()).max(50), note: z.string().max(500),
    })).max(100),
  })
  .strict();
export const DayPlanItemCreate = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(), detail: z.string().max(4000).default(""),
    task_ids: z.array(z.string().min(1)).max(20).optional(), plan_item_id: z.string().min(1).optional(),
  })
  .strict()
  .refine((b) => b.text !== undefined || b.plan_item_id !== undefined, { message: "text or plan_item_id required", path: ["text"] });
export const DayPlanItemPatch = z
  .object({
    updated_at: z.string().min(1),
    text: z.string().trim().min(1).max(2000).optional(), detail: z.string().max(4000).optional(),
    task_ids: z.array(z.string().min(1)).max(20).optional(), sort: z.number().int().optional(),
    manual_status: DayStatus.nullable().optional(),
  })
  .strict();
export const isDate = (s: string) => dateStr.safeParse(s).success && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const TOKEN_COUNT = z.number().int().min(0);
const ModelTokens = z.record(
  z.string().min(1),
  z.object({
    input: TOKEN_COUNT, output: TOKEN_COUNT, cache_read: TOKEN_COUNT,
    cache_write_5m: TOKEN_COUNT, cache_write_1h: TOKEN_COUNT, reasoning: TOKEN_COUNT,
  }),
);
// A session's token usage as the collector computed it. `subagent` is the part of `by_model` its
// subagents used (already included there); cost_usd is null when no model it used has a price.
export const SessionTokens = z.object({
  by_model: ModelTokens,
  subagent: ModelTokens,
  cost_usd: z.number().min(0).nullable(),
  cost_partial: z.boolean(),
});

const ActiveIntervals = z.array(z.tuple([z.string().min(1), z.string().min(1)]));

// The Artifact pages a session published (see migrations/0015). title / artifact_id are null when the tool result
// carried none (the older claude.ai/code/artifact/<uuid> links have no artifact_id).
export const SessionArtifact = z.object({
  url: z.string().min(1),
  title: z.string().nullable(),
  artifact_id: z.string().nullable(),
  ts: z.string().min(1),
});
export type SessionArtifact = z.infer<typeof SessionArtifact>;
const SessionArtifacts = z.array(SessionArtifact);

export const SessionIn = z.object({
  id: z.string().min(2),
  machine: z.string().min(1),
  agent: z.enum(["claude-code", "codex"]),
  session_id: z.string().min(1),
  cwd: z.string(),
  started_at: z.string().min(1),
  ended_at: z.string().min(1),
  active_minutes: z.number().int().min(0),
  turns: z.number().int().min(0),
  summary: z.string(),
  summary_source: z.enum(["llm", "fallback"]),
  task_id: z.string().nullable().default(null),
  link_method: z.enum(["auto-dir", "auto-time", "manual", "none"]),
  // No default on purpose: absent (a client from before this field) must leave the stored list
  // alone, while [] from a current client means "wrote nothing" and replaces it.
  files_written: z.array(z.string()).optional(),
  // Absent (an older client or a parked body) and null (a session whose log recorded no usage)
  // both leave the stored value alone; only an object replaces it.
  tokens: SessionTokens.nullable().optional(),
  // The collector's activity clusters as [start, end] instants (see migrations/0006). Absent (an
  // older client or a parked body) and null (the Python model's default, serialized as null) both
  // leave the stored value alone, as tokens does.
  active_intervals: ActiveIntervals.nullable().optional(),
  // The Artifacts the session published. Absent (an older client) and null (the Python model's default) leave the
  // stored value alone, as active_intervals does; [] from a current client means "published none" and replaces it.
  artifacts: SessionArtifacts.nullable().optional(),
  ts: z.string().min(1),
});

export const IngestIn = z.object({
  machine: z.string().min(1),
  sessions: z.array(SessionIn).max(500),
});

export const HeartbeatIn = z.object({
  machine: z.string().min(1).max(100),
  new: z.number().int().min(0),
  updated: z.number().int().min(0),
});

const SessionRef = { agent: z.enum(["claude-code", "codex"]), session_id: z.string().min(1) };

// The pre-tokens backfill body. Still accepted: machines that have not pulled keep sending it.
export const SessionFilesIn = z.object({
  sessions: z.array(z.object({ ...SessionRef, files_written: z.array(z.string()) })).max(500),
});

// `wl harvest --refresh-meta`: everything the collector derives from a log without summarizing it.
// tokens null = the log recorded no usage, which keeps what is stored (as ingest does).
// active_intervals and artifacts absent (an older client) or null keep what is stored too; this is the
// backfill path for sessions harvested before those columns existed.
export const SessionMetaIn = z.object({
  sessions: z
    .array(z.object({
      ...SessionRef, files_written: z.array(z.string()), tokens: SessionTokens.nullable(),
      active_intervals: ActiveIntervals.nullable().optional(),
      artifacts: SessionArtifacts.nullable().optional(),
    }))
    .max(500),
});

// The collector's model verdicts on files the rule left gray (plan 2026-10-09-deliverables §3.4).
export const DeliverableModelVerdicts = z.object({
  verdicts: z
    .array(z.object({ key: z.string().min(1), verdict: z.enum(["in", "out"]), reason: z.string().max(500).default("") }))
    .max(500),
});

// The user's × (out) or ＋ (in) on an automatic 成果物: a file's key, or an Artifact's url.
export const DeliverableUserVerdict = z
  .object({ key: z.string().min(1), kind: z.enum(["file", "artifact"]), verdict: z.enum(["in", "out"]) })
  .strict();

export const SessionPatch = z
  .object({
    updated_at: z.string().min(1),
    summary_edited: z.string().nullable().optional(), // null = 恢复自动摘要
    minutes_override: z.number().int().min(0).nullable().optional(), // null = 恢复自动工时
    hidden: z.boolean().optional(),
    task_id: z.string().min(1).nullable().optional(), // 任何取值都使 link_method='manual'
  })
  .strict();

const SHEET_KEYS = ["summary", "tasks", "days", "deliverables", "hours"] as const satisfies readonly SheetKey[];

// A human edit to one generated report cell. `value` may be the empty string: blanking a cell is an
// edit like any other, and the way back to the computed value is DELETE, not an empty PUT.
export const OverridePut = z
  .object({
    sheet: z.enum(SHEET_KEYS),
    row_key: z.string().min(1),
    column: z.string().min(1),
    value: z.string(),
  })
  .strict();

// The same cell named in a query string, with nothing to write. `.omit` keeps the strictness, so a
// query that carries anything else is rejected rather than silently deleting a different cell.
export const OverrideDelete = OverridePut.omit({ value: true });

// An AI digest line edited by hand, or handed back to the cron.
// The week's oneliner: at most 120 code points after trim (= ONELINER_CAP in report/digests.ts); "" clears it.
const ONELINER = z.string().trim().refine((s) => Array.from(s).length <= 120, "oneliner: at most 120 characters");
export const DigestPatch = z.union([
  z.object({ text: z.string().min(1).max(1600) }).strict(),
  z.object({ oneliner: ONELINER }).strict(),
  z.object({ regenerate: z.literal(true) }).strict(),
]);

// A digest written back by the local generator: full (guarded by the input hash), only the PDF line, or only the
// week's missing oneliner.
// A translation can run ~3x the Japanese it renders (1600 chars of week text), hence the wide maxima (R14).
// A generated oneliner is cut to 120 on write (capLines), not refused, hence the wider maximum.
const One = z.string().trim().min(1).max(600);
const Tr = z.object({ text: z.string().trim().min(1).max(6000), pdf_text: z.string().trim().min(1).max(3000), oneliner: One.optional() }).strict();
const TrPdf = z.object({ pdf_text: z.string().trim().min(1).max(3000) }).strict();
export const DigestGenerated = z.union([
  z.object({
    text: z.string().trim().min(1).max(2000), pdf_text: z.string().trim().min(1).max(3000),
    oneliner: z.string().trim().min(1).max(400).optional(),
    inputs_hash: z.string().min(1).max(128), model: z.string().min(1).max(80), zh: Tr, en: Tr,
  }).strict(),
  z.object({
    pdf_only: z.literal(true), source_text: z.string().min(1).max(2000), pdf_text: z.string().trim().min(1).max(3000),
    model: z.string().min(1).max(80), zh: TrPdf, en: TrPdf,
  }).strict(),
  z.object({
    oneliner_only: z.literal(true), source_text: z.string().min(1).max(2000), oneliner: z.string().trim().min(1).max(400),
    model: z.string().min(1).max(80), zh: z.object({ oneliner: One }).strict(), en: z.object({ oneliner: One }).strict(),
  }).strict(),
]);

export function invalid(c: Context, error: z.ZodError) {
  return c.json(
    {
      error: "invalid",
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    },
    400,
  );
}
