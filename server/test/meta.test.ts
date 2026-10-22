import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

describe("meta", () => {
  beforeEach(resetDb);

  it("stats are zero on empty db", async () => {
    const r = await api("/api/stats");
    expect(await r.json()).toEqual({ tasks: 0, sessions: 0, notes: 0 });
  });

  it("machines is empty on empty db", async () => {
    const r = await api("/api/machines");
    expect(await r.json()).toEqual([]);
  });
});
