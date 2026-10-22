// The demo's fictional dataset (docs/projects/2026-10-22-demo-site/PLAN.md S2): about eight weeks of a contract
// engineer's AI-assisted work, written through the real API wherever a route can write it, and with SQL only where
// the route would stamp the server's "now" or no route exists. Deterministic: seeded streams, no clock of its own.
import { TODAY, iso, isoWeekOf, jstDate, jstMs, naive } from "./calendar";
import { seedVerdicts } from "./deliverables";
import { Translations } from "./i18n";
import { NOTES } from "./notes";
import { seedRuns } from "./ops";
import { seedPlans } from "./plans";
import { Progress } from "./progress";
import { seedDigests, seedDownloads, seedOverrides, seedReviews } from "./report";
import { buildSessions, type SessionRec } from "./sessions";
import type { SeedCtx } from "./types";
import { MACHINES, PERSONA, TASKS } from "./world";

export type { SeedCtx } from "./types";

/** Hours a 案件 was quoted at by hand (the stats page compares them with the sessions). */
const HOURS_MANUAL: Record<string, number> = { "T20260822-01": 6, "T20260916-01": 8 };

export async function seed(ctx: SeedCtx): Promise<void> {
  if (jstDate(ctx.now.toISOString()) !== TODAY) throw new Error(`demo seed is written for ${TODAY} (JST); got ${ctx.now.toISOString()}`);
  const tr = new Translations();

  // English by default for the public demo; the UI switches to 中文 / 日本語 (and ?lang= presets it).
  await ctx.api("PUT", "/api/prefs", { lang: "en", report: { name: PERSONA.name } });

  // 案件: PUT is the CLI's upsert, which takes the id, status and dates as given.
  for (const x of TASKS) {
    const ts = naive(jstMs(x.received, 9 * 60 + 30));
    await ctx.api("PUT", `/api/tasks/${x.id}`, {
      requester: x.requester, project: x.project, title: x.title.ja, status: x.end?.status ?? "open", received_at: x.received,
      done_at: x.end?.status === "done" ? x.end.date : null, thinking: x.thinking.tri[x.thinking.src], deliverables: x.deliverables,
      hours_manual: HOURS_MANUAL[x.id] ?? null, machine: x.machine === "win" ? MACHINES.win : MACHINES.mac, ts,
    });
    const at = iso(jstMs(x.received, 9 * 60 + 31));
    tr.add("task", x.id, "title", x.title, "ja", at);
    tr.add("task", x.id, "thinking", x.thinking.tri, x.thinking.src, at);
    if (x.projectTr) tr.add("task", x.id, "project", x.projectTr, "ja", at);
    else tr.identity("task", x.id, "project", x.project, at);
  }

  const recs = buildSessions();
  for (const m of ["mac", "win"] as const) {
    const mine = recs.filter((r) => r.machine === m).map((r) => r.body);
    for (let i = 0; i < mine.length; i += 150) await ctx.api("POST", "/api/ingest/sessions", { machine: MACHINES[m], sessions: mine.slice(i, i + 150) });
  }
  await applyEdits(ctx, recs);
  for (const r of recs) {
    const at = iso(r.endMs + 10 * 60_000);
    if (r.edit) tr.add("session", r.body.id, "summary", r.edit.tri, r.edit.src, at);
    else if (r.said) tr.add("session", r.body.id, "summary", r.said.tri, r.said.src, at);
  }

  for (const n of NOTES) {
    await ctx.api("PUT", `/api/notes/${n.id}`, { text: n.raw ?? n.tri[n.src], task_id: n.task, minutes: n.minutes, machine: "web", ts: n.ts });
    tr.add("note", n.id, "text", n.tri, n.src, iso(Date.parse(`${n.ts}+09:00`) + 15_000), n.raw);
  }

  const prog = new Progress(recs);
  await seedPlans(ctx, prog, tr);
  // Digests last among the writes they read (tasks, sessions, notes, plans), or their input hashes go stale.
  await seedDigests(ctx, prog);
  await seedReviews(ctx, recs, tr);
  await seedOverrides(ctx, recs, tr);
  await seedVerdicts(ctx, recs);
  await tr.flush(ctx);
  await seedDownloads(ctx);
  // After the last ingest: machines.last_seen_at is the collection time, not the moment the seed ran.
  await seedRuns(ctx, recs);
  await ctx.api("GET", "/api/tasks");   // fills any 案件 badge the PUTs left unassigned
}

/** The edits a person made in the timeline drawer: hide chats, rewrite three summaries, correct two durations. */
async function applyEdits(ctx: SeedCtx, recs: SessionRec[]) {
  const edited = recs.filter((r) => r.hide || r.edit || r.override !== undefined);
  const weeks = new Map<string, Map<string, string>>();
  for (const r of edited) {
    const week = isoWeekOf(r.date);
    if (!weeks.has(week)) {
      const tl = await ctx.api("GET", `/api/weeks/${week}/timeline?include_hidden=1`);
      const tokens = new Map<string, string>();
      for (const d of tl.days) for (const s of d.sessions) tokens.set(s.id, s.updated_at);
      weeks.set(week, tokens);
    }
    const updated_at = weeks.get(week)!.get(r.body.id);
    if (!updated_at) throw new Error(`session ${r.body.id} not on the ${week} timeline`);
    await ctx.api("PATCH", `/api/sessions/${r.body.id}`, {
      updated_at,
      ...(r.hide ? { hidden: true } : {}),
      ...(r.edit ? { summary_edited: r.edit.tri[r.edit.src] } : {}),
      ...(r.override !== undefined ? { minutes_override: r.override } : {}),
    });
  }
}
