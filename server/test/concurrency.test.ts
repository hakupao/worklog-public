import { describe, expect, it } from "vitest";
import { buildGuardedUpdate, isUniqueViolation, nextUpdatedAt } from "../src/concurrency";

describe("nextUpdatedAt", () => {
  it("is strictly greater than previous when previous is in the future relative to now", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const next = nextUpdatedAt(future);
    expect(Date.parse(next)).toBeGreaterThan(Date.parse(future));
  });

  it("is >= now when previous is in the past", () => {
    const before = Date.now();
    const past = new Date(before - 60_000).toISOString();
    const next = nextUpdatedAt(past);
    expect(Date.parse(next)).toBeGreaterThanOrEqual(before);
  });

  it("a non-date previous falls back to now rather than producing Invalid Date/NaN", () => {
    const before = Date.now();
    const next = nextUpdatedAt("not-a-date");
    expect(next).not.toBe("Invalid Date");
    expect(Number.isNaN(Date.parse(next))).toBe(false);
    expect(Date.parse(next)).toBeGreaterThanOrEqual(before);
    // It can never match a stored row anyway: the WHERE clause compares the raw string, and this
    // value is never derived from (nor equal to) the bogus input.
  });
});

describe("isUniqueViolation", () => {
  it("recognizes a D1 unique-constraint error", () => {
    expect(isUniqueViolation(new Error("D1_ERROR: UNIQUE constraint failed: tasks.id"))).toBe(true);
  });

  it("does not misidentify a different error", () => {
    expect(isUniqueViolation(new Error("D1_ERROR: NOT NULL constraint failed: tasks.title"))).toBe(false);
  });

  it("does not misidentify a non-Error value", () => {
    expect(isUniqueViolation("UNIQUE constraint failed")).toBe(false);
  });
});

describe("buildGuardedUpdate", () => {
  it("builds correct SQL text and arg order for a two-key patch", () => {
    const before = Date.now();
    const { sql, args } = buildGuardedUpdate(
      "tasks",
      ["title", "status"],
      { title: "new", status: "done" },
      "T1",
      "2020-01-01T00:00:00.000Z",
    );
    expect(sql).toBe("UPDATE tasks SET title = ?1, status = ?2, updated_at = ?3 WHERE id = ?4 AND updated_at = ?5");
    expect(args).toHaveLength(5);
    expect(args[0]).toBe("new");
    expect(args[1]).toBe("done");
    expect(Date.parse(args[2] as string)).toBeGreaterThanOrEqual(before);
    expect(args[3]).toBe("T1");
    expect(args[4]).toBe("2020-01-01T00:00:00.000Z");
  });

  it("throws for a key not in the allow-list", () => {
    expect(() =>
      buildGuardedUpdate("tasks", ["title"], { "title = 'x' --": "x" }, "T1", "2020-01-01T00:00:00.000Z"),
    ).toThrow("column not allowed");
    expect(() =>
      buildGuardedUpdate("tasks", ["title"], { updated_at: "hacked" }, "T1", "2020-01-01T00:00:00.000Z"),
    ).toThrow("column not allowed");
  });

  it("always includes the optimistic-concurrency WHERE clause", () => {
    const { sql } = buildGuardedUpdate("notes", ["text"], { text: "x" }, "N1", "2020-01-01T00:00:00.000Z");
    expect(sql).toContain("AND updated_at = ?");
  });
});
