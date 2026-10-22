// What a written file is, as a 成果物 (plan docs/projects/2026-10-09-deliverables §3.3): the rule decides the
// obvious cases — a kind nobody hands over, an agent's working notes, a step's prompt — and a 成果物 folder; the rest
// is left to the model (gray). The single copy of the rule: the web and the dashboard hints read it from here.

export type RuleVerdict = "in" | "out" | "gray";
export interface RuleResult { verdict: RuleVerdict; reason: string }

/** Kinds that are handed over as documents (or opened as pages). Code, config, data and logs never are. */
export const DOC_EXTENSIONS = [".md", ".html", ".htm", ".pdf", ".docx", ".doc", ".xlsx", ".xlsm", ".xls", ".pptx", ".ppt", ".csv"];

/** Directories, at any depth, that hold an agent's or a workflow's process: plans, evidence, reviews, prompts,
 *  scratch. Compared lower-cased. */
export const PROCESS_DIRS = [
  "sdd", "evidence", "failures", "checkpoints", "subagent_prompts", "superpowers", ".superpowers", ".omc", ".claude",
  ".codex", "scratchpad", "reviews", "plans", "work", ".work", "tmp", "temp", "cleanup", "brainstorm",
  "handoffs", "tests", "test", "fixtures", "node_modules", ".github", "attempts", "archive", "template", "templates",
];

/** File names of process documents: the plan / retro / progress of a run, agent instructions, prompts, steps. */
const PROCESS_NAME = /^(plan|plan[-_].*|retrospective.*|claude|agents|_?progress.*|handoff.*|todo|changelog|contributing|audit.*|step[-_]?\d+.*|.*prompt.*|.*instruction.*|.*\.template)\.[a-z]+$/i;

/** Directories that hold what is handed over: a path through one is a 成果物 without asking. */
const DELIVERABLE_DIR = /^(成果物|納品物?|交付物|deliverables?|reports?|presentations?)$/i;

const extOf = (name: string) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(i).toLowerCase() : ""; };

export function classifyPath(path: string): RuleResult {
  const segs = path.split(/[\\/]/).filter(Boolean);
  const name = segs.pop() ?? "";
  const dirs = segs.map((s) => s.toLowerCase());
  if (!DOC_EXTENSIONS.includes(extOf(name))) return { verdict: "out", reason: "kind" };
  const proc = dirs.find((d) => PROCESS_DIRS.includes(d));
  if (proc) return { verdict: "out", reason: `dir:${proc}` };
  if (PROCESS_NAME.test(name)) return { verdict: "out", reason: "name" };
  if (segs.some((d) => DELIVERABLE_DIR.test(d))) return { verdict: "in", reason: "dir:deliverable" };
  return { verdict: "gray", reason: "" };
}

/** The same file reached through two mounts (/Volumes/Data/Projects/X/a.md and ~/Code/X/a.md) is one
 *  成果物: within one 案件, files are one when their last three path segments match (case-insensitive). */
export const sameFileKey = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-3).join("/").toLowerCase();
