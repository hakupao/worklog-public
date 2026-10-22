import { describe, expect, it } from "vitest";
import { deriveTask, type DeriveSession, type StoredVerdict } from "../src/deliverables/derive";

const sess = (id: string, over: Partial<DeriveSession> = {}): DeriveSession => ({
  id, hidden: 0, ended_at: "2026-10-09T01:00:00Z", files_written: [], artifacts: null, ...over,
});
const v = (key: string, verdict: "in" | "out", source: StoredVerdict["source"], judged_at = "2026-10-10T00:00:00Z"): StoredVerdict =>
  ({ key, kind: key.startsWith("https://") ? "artifact" : "file", verdict, source, reason: `${source} said`, judged_at });
const map = (...vs: StoredVerdict[]) => new Map(vs.map((x) => [x.key, x]));
const pick = (items: ReturnType<typeof deriveTask>) => items.map((i) => [i.key, i.verdict, i.source]);

describe("deriveTask", () => {
  it("applies the rule, leaves code out entirely, and marks gray files pending", () => {
    const items = deriveTask([], [sess("S1", { files_written: [
      "/p/成果物/report.md", "/p/src/a.ts", "/p/.omc/plans/x.md", "/p/docs/design.md",
    ] })], new Map());
    expect(pick(items)).toEqual([
      ["/p/成果物/report.md", "in", "rule"],
      ["/p/.omc/plans/x.md", "out", "rule"],
      ["/p/docs/design.md", "pending", null],
    ]);
  });

  it("takes user over model over rule", () => {
    const files = ["/p/成果物/a.md", "/p/docs/b.md", "/p/docs/c.md"];
    const items = deriveTask([], [sess("S1", { files_written: files })], map(
      v("/p/成果物/a.md", "out", "user"),
      v("/p/docs/b.md", "in", "model"),
      v("/p/docs/c.md", "out", "model"),
    ));
    expect(pick(items)).toEqual([
      ["/p/成果物/a.md", "out", "user"], ["/p/docs/b.md", "in", "model"], ["/p/docs/c.md", "out", "model"],
    ]);
    expect(items[1].reason).toBe("model said");
  });

  it("one file through two mounts is one item, and a × on either path hides both", () => {
    const a = "/Volumes/Data/Projects/X/docs/spec.md";
    const b = "/Users/me/Code/X/docs/spec.md";
    const sessions = [sess("S1", { files_written: [a] }), sess("S2", { files_written: [b], ended_at: "2026-10-10T05:00:00Z" })];
    const [item] = deriveTask([], sessions, map(v(a, "in", "model"), v(b, "out", "user")));
    expect(item).toMatchObject({ key: a, keys: [a, b], verdict: "out", source: "user", sessions: ["S1", "S2"],
      last_at: "2026-10-10T05:00:00Z" });
  });

  it("the latest user verdict wins when two paths of a group carry one", () => {
    const a = "/m1/X/docs/spec.md", b = "/m2/X/docs/spec.md";
    const [item] = deriveTask([], [sess("S1", { files_written: [a, b] })],
      map(v(a, "out", "user", "2026-10-10T00:00:00Z"), v(b, "in", "user", "2026-10-11T00:00:00Z")));
    expect(item.verdict).toBe("in");
  });

  it("leaves hidden sessions out", () => {
    const items = deriveTask([], [
      sess("S1", { hidden: 1, files_written: ["/p/成果物/hidden.md"],
        artifacts: [{ url: "https://claude.ai/artifact/H", title: "h", artifact_id: null, ts: "2026-10-09T00:00:00Z" }] }),
      sess("S2", { files_written: ["/p/成果物/shown.md"] }),
    ], new Map());
    expect(items.map((i) => i.key)).toEqual(["/p/成果物/shown.md"]);
  });

  it("does not repeat what was picked by hand (same path, relative to the cwd, another mount, or same url)", () => {
    const items = deriveTask(
      ["/p/成果物/a.md", "成果物/rel/B.md", "/other/mount/p/y/成果物/d.md", "https://claude.ai/artifact/A"],
      [sess("S1", {
        files_written: ["/p/成果物/a.md", "/p/成果物/rel/b.md", "/m/p/y/成果物/d.md", "/p/成果物/c.md", "/p/x成果物/rel/B.md"],
        artifacts: [{ url: "https://claude.ai/artifact/A", title: "a", artifact_id: "a", ts: "2026-10-09T00:00:00Z" }],
      })],
      new Map(),
    );
    // A suffix counts only at a segment boundary: x成果物/rel/B.md is another file.
    expect(items.map((i) => i.key)).toEqual(["/p/成果物/c.md", "/p/x成果物/rel/B.md"]);
  });

  it("a bare file name picked by hand names only the file under the session's cwd, not every file of that name", () => {
    const items = deriveTask(["README.md"], [sess("S1", { cwd: "/r/repoA", files_written: [
      "/r/repoA/README.md", "/r/repoA/成果物/README.md", "/r/repoB/docs/README.md",
    ] })], new Map());
    expect(items.map((i) => i.key)).toEqual(["/r/repoA/成果物/README.md", "/r/repoB/docs/README.md"]);
  });

  it("a file seen under two paths gets the same rule whichever session is read first (gray wins, then in)", () => {
    const a = "/Users/b/tmp/X/docs/a.md", b = "/Volumes/D/P/X/docs/a.md";   // tmp → out; the other → gray
    const asc = deriveTask([], [sess("S1", { files_written: [a] }), sess("S2", { files_written: [b] })], new Map());
    const desc = deriveTask([], [sess("S2", { files_written: [b] }), sess("S1", { files_written: [a] })], new Map());
    expect(asc[0].verdict).toBe("pending");
    expect(desc[0].verdict).toBe("pending");
  });

  it("an Artifact is in by default, keeps its latest title, and can be taken out by url", () => {
    const url = "https://claude.ai/artifact/A";
    const sessions = [
      sess("S1", { artifacts: [{ url, title: "新", artifact_id: "a", ts: "2026-10-10T00:00:00Z" }] }),
      sess("S2", { artifacts: [{ url, title: "旧", artifact_id: "a", ts: "2026-10-09T00:00:00Z" },
        { url: "https://claude.ai/code/artifact/u-1", title: null, artifact_id: null, ts: "2026-10-09T00:00:00Z" }] }),
    ];
    const items = deriveTask([], sessions, new Map());
    expect(items).toEqual([
      { kind: "artifact", key: url, keys: [url], title: "新", verdict: "in", source: "rule", reason: "artifact",
        sessions: ["S1", "S2"], last_at: "2026-10-10T00:00:00Z" },
      expect.objectContaining({ key: "https://claude.ai/code/artifact/u-1", title: null, verdict: "in" }),
    ]);
    expect(deriveTask([], sessions, map(v(url, "out", "user")))[0]).toMatchObject({ verdict: "out", source: "user" });
  });
});
