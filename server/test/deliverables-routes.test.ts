import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;

async function task(id: string, title = "設計書", deliverables: string[] = []) {
  await db().prepare(
    `INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
     VALUES (?1, 'A社', 'LEDGER', ?2, 'open', '2026-10-01', '', ?3, 'macmini', 't', 'u')`,
  ).bind(id, title, JSON.stringify(deliverables)).run();
}
async function session(id: string, over: { machine?: string; task_id?: string | null; hidden?: number; files?: string[]; artifacts?: unknown[] } = {}) {
  await db().prepare(
    `INSERT INTO sessions (id, machine, agent, session_id, cwd, started_at, ended_at, active_minutes, turns, summary,
                           summary_source, task_id, link_method, ts, updated_at, files_written, hidden, artifacts)
     VALUES (?1, ?2, 'claude-code', ?1 || '-x', '/p', '2026-10-09T00:00:00Z', '2026-10-09T01:00:00Z', 60, 3, 's', 'llm',
             ?3, 'auto-dir', 't', 'u', ?4, ?5, ?6)`,
  ).bind(id, over.machine ?? "macmini", over.task_id === undefined ? "T1" : over.task_id, JSON.stringify(over.files ?? []),
    over.hidden ?? 0, over.artifacts ? JSON.stringify(over.artifacts) : null).run();
}
const pending = (machine: string) => api(`/api/ingest/deliverables/pending?machine=${machine}`);
const modelSays = (verdicts: unknown[]) =>
  api("/api/ingest/deliverables/verdicts", { method: "POST", body: JSON.stringify({ verdicts }) });
const userSays = (body: unknown) => api("/api/deliverable-verdicts", { method: "PUT", body: JSON.stringify(body) });
const auto = async (id = "T1") => ((await (await api(`/api/tasks/${id}`)).json()) as any).auto_deliverables;

describe("deliverables routes", () => {
  beforeEach(resetDb);

  it("pending lists one path per gray file, for that machine's linked, not-hidden sessions, with the 案件", async () => {
    await task("T1");
    await session("S1", { files: ["/p/docs/a.md", "/p/成果物/b.md", "/p/src/c.ts", "/p/.omc/d.md"] });
    await session("S2", { files: ["/q/p/docs/a.md", "/p/docs/e.md"] }); // a.md again through another mount
    await session("S3", { machine: "win11", files: ["C:\\p\\docs\\w.md"] });
    await session("S4", { hidden: 1, files: ["/p/docs/hidden.md"] });
    await session("S5", { task_id: null, files: ["/p/docs/unlinked.md"] });
    await session("S6", { task_id: "T-gone", files: ["/p/docs/orphan.md"] });

    const r = (await (await pending("macmini")).json()) as any;
    expect(r).toEqual({
      total: 2,
      items: [
        { key: "/p/docs/a.md", task_id: "T1", task_title: "設計書", project: "LEDGER" },
        { key: "/p/docs/e.md", task_id: "T1", task_title: "設計書", project: "LEDGER" },
      ],
    });
    expect(((await (await pending("win11")).json()) as any).items.map((i: any) => i.key)).toEqual(["C:\\p\\docs\\w.md"]);
    expect((await api("/api/ingest/deliverables/pending")).status).toBe(400);
  });

  it("a judged file leaves pending, through either of its paths", async () => {
    await task("T1");
    await session("S1", { files: ["/p/docs/a.md", "/p/docs/e.md"] });
    await session("S2", { files: ["/q/p/docs/a.md"] });
    expect(await (await modelSays([{ key: "/q/p/docs/a.md", verdict: "in", reason: "設計書" }])).json()).toEqual({ inserted: 1 });
    expect(((await (await pending("macmini")).json()) as any).items.map((i: any) => i.key)).toEqual(["/p/docs/e.md"]);
    expect((await auto()).find((d: any) => d.key === "/p/docs/a.md")).toMatchObject({ verdict: "in", source: "model", reason: "設計書" });
  });

  it("a model verdict never overwrites another verdict, and the user's always does", async () => {
    await task("T1");
    await session("S1", { files: ["/p/docs/a.md"] });
    expect((await userSays({ key: "/p/docs/a.md", kind: "file", verdict: "out" })).status).toBe(200);
    expect(await (await modelSays([{ key: "/p/docs/a.md", verdict: "in" }])).json()).toEqual({ inserted: 0 });
    expect((await auto())[0]).toMatchObject({ verdict: "out", source: "user" });

    await userSays({ key: "/p/docs/a.md", kind: "file", verdict: "in" });
    expect((await auto())[0]).toMatchObject({ verdict: "in", source: "user" });
    const rows = await db().prepare("SELECT COUNT(*) AS n FROM deliverable_verdicts").first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it("an Artifact is in on the task detail and comes out by url", async () => {
    await task("T1");
    const url = "https://claude.ai/artifact/A";
    await session("S1", { artifacts: [{ url, title: "週報ページ", artifact_id: "a", ts: "2026-10-09T00:30:00Z" }] });
    expect(await auto()).toEqual([{ kind: "artifact", key: url, keys: [url], title: "週報ページ", verdict: "in",
      source: "rule", reason: "artifact", sessions: ["S1"], last_at: "2026-10-09T00:30:00Z" }]);
    await userSays({ key: url, kind: "artifact", verdict: "out" });
    expect((await auto())[0]).toMatchObject({ verdict: "out", source: "user" });
  });

  it("rejects malformed bodies", async () => {
    expect((await modelSays([{ key: "", verdict: "in" }])).status).toBe(400);
    expect((await modelSays([{ key: "/a.md", verdict: "maybe" }])).status).toBe(400);
    expect((await userSays({ key: "/a.md", kind: "file", verdict: "in", source: "model" })).status).toBe(400);
    expect((await userSays({ key: "/a.md", kind: "page", verdict: "in" })).status).toBe(400);
    expect(await (await modelSays([])).json()).toEqual({ inserted: 0 });
  });
});
