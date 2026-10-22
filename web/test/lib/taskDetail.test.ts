import { describe, expect, it } from "vitest";
import type { Session } from "../../src/api/types";
import { parseTaskHours, relativeToCwd, sortSessionsByStartedAt } from "../../src/lib/taskDetail";

const s = (id: string, started_at: string, cwd: string, files: string[]): Session => ({
  id, machine: "m", agent: "claude-code", session_id: id, cwd, started_at, ended_at: started_at,
  active_minutes: 1, turns: 1, summary: "", summary_source: "llm", task_id: "T", link_method: "manual",
  summary_edited: null, minutes_override: null, hidden: 0, files_written: files, tokens: null, active_intervals: null,
  ts: "", updated_at: "", summary_effective: "", minutes_effective: 1,
});

describe("lib/taskDetail (moved out of the old TaskDrawer, shared with the v2 案件 drawer)", () => {
  it("relativeToCwd: under the cwd → relative; Windows compares either separator and any case, keeps the path's spelling", () => {
    expect(relativeToCwd("/w/repo/a/b.md", "/w/repo")).toBe("a/b.md");
    expect(relativeToCwd("/w/repo/a/b.md", "/w/repo/")).toBe("a/b.md");
    expect(relativeToCwd("/w/other/b.md", "/w/repo")).toBe("/w/other/b.md");
    expect(relativeToCwd("/w/repo", "/w/repo")).toBe("/w/repo");
    expect(relativeToCwd("C:\\Work\\Repo\\Docs\\x.xlsx", "c:/work/repo")).toBe("Docs\\x.xlsx");
    expect(relativeToCwd("/a.md", "/")).toBe("/a.md");
  });
  it("sortSessionsByStartedAt compares instants, not strings", () => {
    const a = s("A", "2026-09-22T09:30:00+09:00", "/", []), b = s("B", "2026-09-22T00:40:00Z", "/", []);
    expect(sortSessionsByStartedAt([b, a]).map((x) => x.id)).toEqual(["A", "B"]);
  });
  it("parseTaskHours allows a whole task's total (well past one day's 24h)", () => {
    expect(parseTaskHours("120")).toEqual({ ok: true, minutes: 7200 });
    expect(parseTaskHours("abc").ok).toBe(false);
  });
});
