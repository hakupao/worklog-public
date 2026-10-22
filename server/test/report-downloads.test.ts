import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, rawFetch, resetDb } from "./helpers";

const WEEK = "2026-W39";
// workers-types' Response.json() returns unknown; the other route tests cast the same way.
const body = async (r: Response) => (await r.json()) as any;
const downloads = async (week = WEEK) => body(await api(`/api/report-downloads?week=${week}`));

describe("report downloads", () => {
  beforeEach(resetDb);

  it("an xlsx download is recorded per week, under the one template", async () => {
    const r = await api(`/api/reports/${WEEK}/weekly/xlsx`);
    expect(r.status).toBe(200);
    await r.arrayBuffer();
    const rows = await downloads();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ week: WEEK, template: "weekly" });
    expect(Number.isNaN(Date.parse(rows[0].at))).toBe(false);
  });

  it("a second download moves `at`; one under a retired template name is the same row", async () => {
    await (await api(`/api/reports/${WEEK}/weekly/xlsx`)).arrayBuffer();
    const first = (await downloads())[0].at as string;
    await new Promise((r) => setTimeout(r, 5));
    await (await api(`/api/reports/${WEEK}/agency/xlsx`)).arrayBuffer();
    await (await api(`/api/reports/${WEEK}/site/xlsx`)).arrayBuffer();
    const rows = await downloads();
    expect(rows.map((x: { template: string }) => x.template)).toEqual(["weekly"]);
    expect(rows[0].at > first).toBe(true);
  });

  it("lists the rows written before the templates merged too (any row means downloaded)", async () => {
    await (env as any).DB.prepare(
      `INSERT INTO report_downloads (week, template, at) VALUES ('${WEEK}', 'site', '2026-09-26T00:00:00.000Z')`,
    ).run();
    await (await api(`/api/reports/${WEEK}/weekly/xlsx`)).arrayBuffer();
    expect((await downloads()).map((x: { template: string }) => x.template)).toEqual(["weekly", "site"]);
  });

  it("a failed download records nothing", async () => {
    expect((await api("/api/reports/2026-W99/weekly/xlsx")).status).toBe(400);
    expect((await api(`/api/reports/${WEEK}/nope/xlsx`)).status).toBe(404);
    expect((await api(`/api/reports/${WEEK}/weekly`)).status).toBe(200);   // the JSON preview is not a download
    expect(await downloads()).toEqual([]);
    expect(await downloads("2026-W99")).toEqual({ error: "invalid week" });
  });

  it("GET needs a valid week and returns only that week", async () => {
    expect((await api("/api/report-downloads")).status).toBe(400);
    expect((await api("/api/report-downloads?week=W39")).status).toBe(400);
    await (await api(`/api/reports/${WEEK}/weekly/xlsx`)).arrayBuffer();
    await (await api("/api/reports/2026-W40/weekly/xlsx")).arrayBuffer();
    expect((await downloads()).map((x: { week: string }) => x.week)).toEqual([WEEK]);
  });

  it("the download still succeeds when the record cannot be written", async () => {
    await (env as any).DB.prepare("DROP TABLE report_downloads").run();
    try {
      const r = await api(`/api/reports/${WEEK}/weekly/xlsx`);
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Type")).toContain("spreadsheetml");
      await r.arrayBuffer();
    } finally {
      await (env as any).DB.prepare(
        "CREATE TABLE report_downloads (week TEXT NOT NULL, template TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (week, template))",
      ).run();
    }
  });

  it("needs auth like every other /api route", async () => {
    const r = await rawFetch(`/api/report-downloads?week=${WEEK}`);
    expect(r.status).toBe(401);
  });
});
