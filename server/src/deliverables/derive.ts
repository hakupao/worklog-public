// A 案件's automatic 成果物, derived on read (plan docs/projects/2026-10-09-deliverables §3.2): the files its not-hidden
// sessions wrote and the Artifact pages they published, each given a verdict — the user's × / ＋ first, then the
// model's, then the rule (rules.ts). Nothing here is stored; deliverable_verdicts holds only the verdicts the rule
// cannot give. One pure function, so the task drawer and the 週報 read the same list.

import { classifyPath, sameFileKey } from "./rules";

export type VerdictSource = "rule" | "model" | "user";

/** A deliverable_verdicts row. */
export interface StoredVerdict {
  key: string;
  kind: "file" | "artifact";
  verdict: "in" | "out";
  source: VerdictSource;
  reason: string | null;
  judged_at: string;
}

/** What derive needs of a session: its decoded files_written / artifacts (effective.ts) and when it ended. */
export interface DeriveSession {
  id: string;
  /** Where the session ran; a one-segment hand pick (README.md) names only the file directly under it. */
  cwd?: string;
  hidden: number | boolean;
  ended_at: string;
  files_written: string[];
  artifacts: { url: string; title: string | null; artifact_id: string | null; ts: string }[] | null;
}

export interface AutoDeliverable {
  kind: "file" | "artifact";
  /** The key a verdict is written under: the first path the group was seen with, or the Artifact's url. */
  key: string;
  /** Every stored path of the group (one file reached through two mounts), or [url]. A user verdict covers all. */
  keys: string[];
  /** The Artifact's latest title; null for a file. */
  title: string | null;
  /** "pending" = the rule left it to the model, which has not judged it yet. */
  verdict: "in" | "out" | "pending";
  source: VerdictSource | null;
  reason: string;
  /** The not-hidden sessions that wrote / published it, in the order given. */
  sessions: string[];
  /** When it was last produced: the latest of those sessions' ended_at (a file carries no time of its own), or the
   *  Artifact's latest publish time. */
  last_at: string;
}

const PRECEDENCE: Record<VerdictSource, number> = { user: 3, model: 2, rule: 1 };

/** The strongest stored verdict among `keys` (user > model > rule), the latest one on a tie. */
function strongest(keys: string[], verdicts: Map<string, StoredVerdict>): StoredVerdict | undefined {
  let best: StoredVerdict | undefined;
  for (const k of keys) {
    const v = verdicts.get(k);
    if (!v) continue;
    if (!best || PRECEDENCE[v.source] > PRECEDENCE[best.source] ||
        (PRECEDENCE[v.source] === PRECEDENCE[best.source] && v.judged_at > best.judged_at)) best = v;
  }
  return best;
}

const later = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a);

const normPath = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

/** Whether a hand-picked deliverable names this written file. The web stores a pick relative to the session's cwd
 *  (成果物/x/DOC.md), or absolute: one of two or more segments is a path suffix of the file, and a pick through
 *  another mount still shares the last three segments. A bare file name (README.md) is only the file directly under
 *  one of the writing sessions' cwds: as a suffix it would hide every README.md of the 案件. */
function pickedBy(manual: string[]): (path: string, cwds: string[]) => boolean {
  const picks = manual.map(normPath);
  const tails = new Set(manual.filter((m) => normPath(m).split("/").filter(Boolean).length >= 3).map(sameFileKey));
  return (path, cwds) => {
    const p = normPath(path);
    if (tails.has(sameFileKey(path))) return true;
    return picks.some((m) => p === m || (m.includes("/")
      ? p.endsWith(`/${m}`)
      : cwds.some((c) => p === `${normPath(c).replace(/\/+$/, "")}/${m}`)));
  };
}

/** The rule for a file seen under several paths: gray if any path is (the model decides), else in if any is, else the
 *  first path's out. Independent of the order the sessions were read in. */
function classifyGroup(keys: string[]) {
  const all = keys.map(classifyPath);
  return all.find((r) => r.verdict === "gray") ?? all.find((r) => r.verdict === "in") ?? all[0];
}

/**
 * Every candidate of one 案件 with its verdict. Files of a kind nobody hands over (rule "out: kind" — code, data,
 * config) are left out entirely; every other out stays in the list, so the drawer can offer ＋ on it. A candidate
 * already among the task's hand-picked deliverables (see pickedBy, or the same url) is left out too: it is shown
 * there, once.
 */
export function deriveTask(
  manual: string[],
  sessions: DeriveSession[],
  verdicts: Map<string, StoredVerdict>,
): AutoDeliverable[] {
  const isPicked = pickedBy(manual);
  const pickedUrls = new Set(manual);
  const files = new Map<string, { keys: string[]; sessions: string[]; cwds: string[]; last_at: string }>();
  const pages = new Map<string, { title: string | null; sessions: string[]; last_at: string }>();

  for (const s of sessions) {
    if (s.hidden) continue;
    for (const p of s.files_written) {
      const g = sameFileKey(p);
      const f = files.get(g) ?? files.set(g, { keys: [], sessions: [], cwds: [], last_at: s.ended_at }).get(g)!;
      if (!f.keys.includes(p)) f.keys.push(p);
      if (s.cwd && !f.cwds.includes(s.cwd)) f.cwds.push(s.cwd);
      if (!f.sessions.includes(s.id)) f.sessions.push(s.id);
      f.last_at = later(f.last_at, s.ended_at);
    }
    for (const a of s.artifacts ?? []) {
      const page = pages.get(a.url);
      if (!page) { pages.set(a.url, { title: a.title, sessions: [s.id], last_at: a.ts }); continue; }
      if (Date.parse(a.ts) >= Date.parse(page.last_at)) { page.last_at = a.ts; page.title = a.title ?? page.title; }
      else page.title ??= a.title;
      if (!page.sessions.includes(s.id)) page.sessions.push(s.id);
    }
  }

  const out: AutoDeliverable[] = [];
  for (const [g, f] of files) {
    if (f.keys.some((k) => isPicked(k, f.cwds))) continue;
    const rule = classifyGroup(f.keys);
    if (rule.verdict === "out" && rule.reason === "kind") continue;
    const stored = strongest(f.keys, verdicts);
    out.push({
      kind: "file", key: f.keys[0], keys: f.keys, title: null,
      ...(stored
        ? { verdict: stored.verdict, source: stored.source, reason: stored.reason ?? "" }
        : rule.verdict === "gray"
          ? { verdict: "pending" as const, source: null, reason: "" }
          : { verdict: rule.verdict, source: "rule" as const, reason: rule.reason }),
      sessions: f.sessions, last_at: f.last_at,
    });
  }
  for (const [url, p] of pages) {
    if (pickedUrls.has(url)) continue;
    // Every published page is a 成果物 unless the user took it out (user decision 10/9).
    const stored = strongest([url], verdicts);
    out.push({
      kind: "artifact", key: url, keys: [url], title: p.title,
      ...(stored
        ? { verdict: stored.verdict, source: stored.source, reason: stored.reason ?? "" }
        : { verdict: "in" as const, source: "rule" as const, reason: "artifact" }),
      sessions: p.sessions, last_at: p.last_at,
    });
  }
  return out;
}

/** deliverable_verdicts as a map by key. The whole table in one read: a 案件 can have hundreds of written files, more
 *  than one statement can bind (D1 allows 100 parameters), and the table only grows with files ever judged. */
export async function loadVerdicts(db: D1Database): Promise<Map<string, StoredVerdict>> {
  const { results } = await db.prepare("SELECT * FROM deliverable_verdicts").all<StoredVerdict>();
  return new Map(results.map((v) => [v.key, v]));
}
