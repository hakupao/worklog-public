import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const body = (week: string, text: string, force?: boolean) => JSON.stringify({
  week, text, model: "haiku", stats_json: "{}", machine: "macmini", ...(force === undefined ? {} : { force }),
});
const post = (week: string, text: string, force?: boolean) =>
  api("/api/reviews", { method: "POST", body: body(week, text, force) });

describe("/api/reviews", () => {
  beforeEach(resetDb);

  it("stores the first review for a week and keeps it against a second write", async () => {
    expect(await (await post("2026-W39", "first")).json()).toEqual({ stored: true });
    expect(await (await post("2026-W39", "second")).json()).toEqual({ stored: false });
    const r = await (await api("/api/reviews/2026-W39")).json() as any;
    expect(r.text).toBe("first");
    expect(r.stats_json).toBe("{}");
  });

  it("replaces the review when forced", async () => {
    await post("2026-W39", "first");
    expect(await (await post("2026-W39", "again", true)).json()).toEqual({ stored: true });
    expect(((await (await api("/api/reviews/2026-W39")).json()) as any).text).toBe("again");
  });

  it("lists newest first without stats_json and honours limit", async () => {
    await post("2026-W38", "a"); await post("2026-W40", "c"); await post("2026-W39", "b");
    const list = await (await api("/api/reviews?limit=2")).json() as any[];
    expect(list.map((r) => r.week)).toEqual(["2026-W40", "2026-W39"]);
    expect(list[0]).not.toHaveProperty("stats_json");
    expect((await api("/api/reviews?limit=2.5")).status).toBe(200);
  });

  it("answers 404 for a missing week and 400 for a malformed one", async () => {
    const missing = await api("/api/reviews/2026-W41");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "no review" });
    expect(await (await api("/api/nonexistent-route")).json()).not.toEqual({ error: "no review" });
    expect((await api("/api/reviews/2026-41")).status).toBe(400);
    expect((await post("2026-W60", "x")).status).toBe(400);
    expect((await api("/api/reviews", { method: "POST", body: JSON.stringify({ week: "2026-W39" }) })).status).toBe(400);
  });
});
