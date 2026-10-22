import { describe, expect, it } from "vitest";
import { TEMPLATES, TEMPLATE_ALIASES } from "../src/report/templates";
import type { SheetKey, TemplateKey } from "../src/report/types";

// TEMPLATES began as a hand-port of templates/agency.toml and templates/site.toml; the two were later
// merged into one. The expectation lives here: this object is the spec, written out in full rather than
// derived from the constant, so that an accidental edit to TEMPLATES shows up as a diff instead of
// passing a test that reads its own answer.
const EXPECTED: Record<TemplateKey, Record<SheetKey, unknown>> = {
  weekly: {
    summary: { enabled: true, title: "サマリー" },
    tasks: {
      enabled: true,
      title: "案件一覧",
      columns: ["requester", "title", "project", "status", "received_at", "done_at", "hours", "week_hours", "deliverables", "thinking"],
      headers: ["依頼元", "案件名", "プロジェクト", "状態", "受領日", "完了日", "累計(h)", "今週(h)", "成果物", "備考"],
    },
    days: { enabled: true, title: "日別作業" },
    deliverables: { enabled: true, title: "成果物" },
    hours: { enabled: true, title: "稼働" },
  },
};

// layoutSheets emits sheets in the order they appear in the template, so the order is behaviour.
const SHEET_ORDER: SheetKey[] = ["summary", "tasks", "days", "deliverables", "hours"];

describe("TEMPLATES", () => {
  it("offers exactly the one template", () => {
    expect(Object.keys(TEMPLATES)).toEqual(["weekly"]);
  });

  it("has every sheet key, in the order the sheets are emitted in", () => {
    expect(Object.keys(TEMPLATES.weekly)).toEqual(SHEET_ORDER);
  });

  for (const key of SHEET_ORDER) {
    it(`matches the expected ${key} sheet`, () => {
      expect(TEMPLATES.weekly[key]).toStrictEqual(EXPECTED.weekly[key]);
    });
  }

  it("answers the retired agency / site names as the one template", () => {
    expect(TEMPLATE_ALIASES).toEqual({ agency: "weekly", site: "weekly" });
  });
});
