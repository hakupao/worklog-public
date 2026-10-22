// 成果物 verdicts: the collector's model judges what the rule left gray (through the real pending / verdicts routes),
// except what was only written this week (still 待判定); then the user's one × and one ＋.
import { iso } from "./calendar";
import type { SessionRec } from "./sessions";
import type { SeedCtx } from "./types";
import { MACHINES } from "./world";

const THIS_WEEK = "2026-10-13";

export async function seedVerdicts(ctx: SeedCtx, recs: SessionRec[]): Promise<{ model: number; user: number; pending: number }> {
  const firstWriter = new Map<string, SessionRec>();
  const docOf = new Map<string, SessionRec["docs"][number]["doc"]>();
  for (const r of recs) for (const d of r.docs) {
    if (!firstWriter.has(d.path)) firstWriter.set(d.path, r);
    docOf.set(d.path, d.doc);
  }
  let model = 0, pending = 0;
  for (const machine of Object.values(MACHINES)) {
    const { items } = await ctx.api("GET", `/api/ingest/deliverables/pending?machine=${machine}`) as { items: { key: string }[] };
    const verdicts = [];
    for (const { key } of items) {
      const doc = docOf.get(key), w = firstWriter.get(key);
      if (!doc?.model || !w || w.date >= THIS_WEEK) { pending++; continue; }
      verdicts.push({ key, verdict: doc.model.verdict, reason: doc.model.reason });
    }
    if (verdicts.length === 0) continue;
    await ctx.api("POST", "/api/ingest/deliverables/verdicts", { verdicts });
    for (const v of verdicts) await ctx.sql("UPDATE deliverable_verdicts SET judged_at = ?1 WHERE key = ?2", iso(firstWriter.get(v.key)!.endMs + 23 * 60_000), v.key);
    model += verdicts.length;
  }
  // The user's word: a rule-in draft taken out (×), and a model-out memo put back (＋).
  const pick = (suffix: string) => [...firstWriter.keys()].find((k) => k.replaceAll("\\", "/").endsWith(suffix));
  const user: [string | undefined, "in" | "out"][] = [["reports/週次KPI_速報_draft.xlsx", "out"], ["docs/draft/v2-差分メモ.md", "in"]].map(([s, v]) => [pick(s), v as "in" | "out"]);
  let n = 0;
  for (const [key, verdict] of user) {
    if (!key) continue;
    await ctx.api("PUT", "/api/deliverable-verdicts", { key, kind: "file", verdict });
    await ctx.sql("UPDATE deliverable_verdicts SET judged_at = ?1 WHERE key = ?2", iso(firstWriter.get(key)!.endMs + 3 * 3_600_000), key);
    n++;
  }
  return { model, user: n, pending };
}
