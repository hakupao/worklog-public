import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const session = (id: string, started_at: string, over: Record<string, unknown> = {}) => ({
  id, machine: "macmini", agent: "claude-code", session_id: id + "-full", cwd: "/w",
  started_at, ended_at: started_at, active_minutes: 60, turns: 5, summary: "auto " + id,
  summary_source: "llm", task_id: null, link_method: "none", ts: "2026-09-21T12:00:00", ...over,
});
const ingest = (sessions: unknown[]) =>
  api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions }) });
const dash = async (q: string) => api(`/api/dashboard${q}`);

describe("GET /api/dashboard", () => {
  beforeEach(resetDb);

  it("counts a done task's automatic 成果物 with its hand-picked ones, minus what the user took out", async () => {
    const put = await api("/api/tasks/T20260922-01", { method: "PUT", body: JSON.stringify({
      requester: "A", project: "P", title: "設計", status: "done", received_at: "2026-09-21", done_at: "2026-09-24",
      thinking: "", deliverables: ["memo.md"], hours_manual: null, machine: "macmini", ts: "2026-09-24T00:00:00",
    }) });
    expect(put.status).toBe(200);
    await ingest([session("Sdel", "2026-09-22T01:00:00Z", {
      task_id: "T20260922-01", link_method: "manual",
      files_written: ["/w/成果物/a.md", "/w/成果物/b.md", "/w/src/x.ts", "/w/docs/gray.md"],
      artifacts: [{ url: "https://claude.ai/artifact/A", title: "頁", artifact_id: "a", ts: "2026-09-22T01:30:00Z" }],
    })]);
    await api("/api/deliverable-verdicts", { method: "PUT", body: JSON.stringify({ key: "/w/成果物/b.md", kind: "file", verdict: "out" }) });
    const d = await (await dash("?from=2026-09-21&to=2026-09-27")).json() as any;
    // memo.md + 成果物/a.md + the Artifact; b.md was taken out, x.ts is code, gray.md is not judged yet.
    expect(d.output.done_tasks.map((r: any) => r.deliverables)).toEqual([3]);
    expect(d.hints.find((h: any) => h.id === "done-no-deliverable")).toBeUndefined();
  });

  it("rejects a malformed range", async () => {
    expect((await dash("?from=2026-09-29&to=2026-09-01")).status).toBe(400);
    expect((await dash("?from=2026-09-01")).status).toBe(400);
  });

  it("defaults to the last 28 days", async () => {
    const body = await (await dash("")).json() as any;
    expect(body.range.to >= body.range.from).toBe(true);
    expect(body.rhythm.daily).toHaveLength(28);
  });

  it("matches the week timeline's total minutes", async () => {
    await ingest([
      session("Smon", "2026-09-20T15:30:00Z", { active_minutes: 40 }),
      session("Stue", "2026-09-22T01:00:00Z", { active_minutes: 50 }),
      session("Sout", "2026-09-27T15:00:00Z", { active_minutes: 70 }),
    ]);
    const note = await api("/api/notes", { method: "POST", body: JSON.stringify({
      date: "2026-09-23", machine: "macmini", text: "memo", minutes: 15, task_id: null,
    }) });
    expect(note.status).toBe(201);
    const d = await (await dash("?from=2026-09-21&to=2026-09-27")).json() as any;
    const t = await (await api("/api/weeks/2026-W39/timeline")).json() as any;
    expect(d.overview.minutes).toBe(t.total_minutes);
    expect(d.overview.minutes).toBe(105);
    expect(d.hints.map((h: any) => h.id)).toContain("unlinked");
  });
});
