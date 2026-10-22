import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const put = (key: string, kind: string, verdict: string, source: string) =>
  db().prepare("INSERT INTO deliverable_verdicts (key, kind, verdict, source, reason, judged_at) VALUES (?1, ?2, ?3, ?4, NULL, '2026-10-11T00:00:00Z')")
    .bind(key, kind, verdict, source).run();

describe("migration 0015 deliverable_verdicts", () => {
  beforeEach(resetDb);

  it("keeps one verdict per key, and a later model insert with DO NOTHING leaves a user verdict alone", async () => {
    await put("/p/成果物/a.md", "file", "out", "user");
    await db()
      .prepare(`INSERT INTO deliverable_verdicts (key, kind, verdict, source, reason, judged_at)
                VALUES ('/p/成果物/a.md', 'file', 'in', 'model', 'r', '2026-10-11T01:00:00Z') ON CONFLICT(key) DO NOTHING`)
      .run();
    const r = await db().prepare("SELECT verdict, source FROM deliverable_verdicts").all();
    expect(r.results).toEqual([{ verdict: "out", source: "user" }]);
    await expect(put("/p/成果物/a.md", "file", "in", "model")).rejects.toThrow();
  });

  it("rejects an unknown kind, verdict or source", async () => {
    await expect(put("k1", "page", "in", "user")).rejects.toThrow();
    await expect(put("k2", "file", "gray", "user")).rejects.toThrow();
    await expect(put("k3", "file", "in", "admin")).rejects.toThrow();
    await put("https://claude.ai/artifact/a1", "artifact", "in", "rule");
  });
});
