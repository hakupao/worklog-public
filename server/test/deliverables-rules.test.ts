import { describe, expect, it } from "vitest";
import { classifyPath, sameFileKey } from "../src/deliverables/rules";

const v = (p: string) => classifyPath(p).verdict;

describe("classifyPath (成果物 rule; representative paths)", () => {
  it("a kind nobody hands over is out, whatever the folder", () => {
    expect(classifyPath("/p/ATLAS/成果物/tool.py")).toEqual({ verdict: "out", reason: "kind" });
    for (const p of ["/p/a.json", "/p/a.ts", "/p/notes.txt", "/p/run.sh", "/p/Makefile"]) expect(v(p)).toBe("out");
  });
  it("an agent's or a workflow's process folder is out", () => {
    expect(classifyPath("/w/.superpowers/brainstorm/1/content/page.html")).toEqual({ verdict: "out", reason: "dir:.superpowers" });
    for (const p of ["/w/docs/projects/x/evidence/step_01_audit.md", "/w/BEACON/pitch/draft/work/q3_notes.md",
      "C:\\Users\\b\\AppData\\Local\\Temp\\claude\\x\\scratchpad\\flow.html", "/w/docs/plans/2026-10-09-x.md",
      "/w/.omc/plans/p.md", "/w/WBS/archive/README.md"]) expect(v(p)).toBe("out");
  });
  it("a process document's name is out", () => {
    for (const p of ["/w/RETROSPECTIVE_sprint4.md", "/w/CLAUDE.md", "/w/AGENTS.md", "/w/docs/PROGRESS.md", "/w/PLAN.md",
      "/w/PLAN-color-tokens.md", "/w/eval/runs/r7_b2/audit_summary.md", "/w/retry/step2_instruction_draft.md", "/w/x_prompt.md",
      "/p/ATLAS/scripts/slides/atlas-intro.template.html", "/p/成果物/3.1-設計/docs/template/README.md"]) expect(v(p)).toBe("out");
  });
  it("a 成果物 / Report / presentation folder is in", () => {
    expect(classifyPath("/p/ATLAS/成果物/2.3-設計資料/DOC-0201-画面一覧.md")).toEqual({ verdict: "in", reason: "dir:deliverable" });
    expect(v("/p/Acme/DOCMERGE/Report/20261005-画面遷移の見直し.md")).toBe("in");
    expect(v("/p/atlas/docs/presentation/2026-09-29_中间汇报.html")).toBe("in");
  });
  it("the rest — design documents, notes, READMEs — is the model's (gray)", () => {
    for (const p of ["/p/LEDGER/spec/modules/03-billing/billing-03-API.md", "/p/DocMergeTool_SAMPLES/x/05_Memo/質問リスト.html",
      "/p/LEDGER/decisions/ADR-007.md", "/p/data-wiki/deploy/README.md"]) expect(v(p)).toBe("gray");
  });
  it("one file through two mounts is one key", () => {
    expect(sameFileKey("/Volumes/Data/Projects/LEDGER/decisions/ADR-007.md")).toBe(sameFileKey("/Users/b/Code/LEDGER/decisions/ADR-007.md"));
    expect(sameFileKey("C:\\p\\LEDGER\\decisions\\ADR-007.md")).toBe("ledger/decisions/adr-007.md");
  });
});
