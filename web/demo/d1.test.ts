// The demo's D1 shim (d1.ts) against the D1 behaviour server/src relies on.
import initSqlJs from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { DemoD1 } from "./d1";

let db: DemoD1;
beforeEach(async () => {
  const SQL = await initSqlJs();
  db = new DemoD1(new SQL.Database());
  await db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE, flag INTEGER, b BLOB);
    CREATE TABLE p (id TEXT PRIMARY KEY);
    CREATE TABLE c (id TEXT PRIMARY KEY, p TEXT NOT NULL REFERENCES p(id));`);
});

describe("DemoD1", () => {
  it("exec runs every statement and counts them", async () => {
    expect(await db.exec("INSERT INTO p VALUES ('a'); INSERT INTO p VALUES ('b')")).toMatchObject({ count: 2 });
  });

  it("binds booleans as 0/1, rejects undefined, and bind() returns a new statement", async () => {
    const ins = db.prepare("INSERT INTO t (name, flag) VALUES (?1, ?2)");
    await ins.bind("x", true).run();
    await ins.bind("y", false).run();
    expect((await db.prepare("SELECT name, flag FROM t ORDER BY id").all()).results).toEqual([{ name: "x", flag: 1 }, { name: "y", flag: 0 }]);
    expect(() => ins.bind("z", undefined)).toThrow(/D1_TYPE_ERROR/);
  });

  it("answers D1's shapes: first, first(col), all, run meta, raw", async () => {
    const r = await db.prepare("INSERT INTO t (name, b) VALUES (?, ?)").bind("x", new Uint8Array([1, 2])).run();
    expect(r).toMatchObject({ success: true, results: [], meta: { changes: 1, last_row_id: 1, rows_written: 1 } });
    expect(await db.prepare("SELECT * FROM t").first()).toEqual({ id: 1, name: "x", flag: null, b: [1, 2] });
    expect(await db.prepare("SELECT name FROM t").first("name")).toBe("x");
    expect(await db.prepare("SELECT name FROM t WHERE id = 9").first()).toBeNull();
    await expect(db.prepare("SELECT name FROM t").first("nope")).rejects.toThrow(/D1_COLUMN_NOTFOUND/);
    expect(await db.prepare("SELECT id, name FROM t").raw({ columnNames: true })).toEqual([["id", "name"], [1, "x"]]);
    // a SELECT after a write reports no changes (sqlite3_changes would still say 1)
    expect((await db.prepare("SELECT * FROM t").all()).meta.changes).toBe(0);
    // an UPDATE that matches nothing reports 0
    expect((await db.prepare("UPDATE t SET flag = 1 WHERE id = 9").run()).meta.changes).toBe(0);
  });

  it("batch is one transaction: a failure rolls every statement back and keeps SQLite's message", async () => {
    await db.prepare("INSERT INTO t (name) VALUES ('x')").run();
    const ok = await db.batch([db.prepare("UPDATE t SET flag = 2"), db.prepare("SELECT flag FROM t")]);
    expect(ok.map((r) => r.meta.changes)).toEqual([1, 0]);
    expect(ok[1].results).toEqual([{ flag: 2 }]);
    const bad = db.batch([db.prepare("INSERT INTO t (name) VALUES ('y')"), db.prepare("INSERT INTO t (name) VALUES ('x')")]);
    await expect(bad).rejects.toThrow(/UNIQUE constraint failed/);
    expect(await db.prepare("SELECT count(*) AS n FROM t").first("n")).toBe(1);
    // the connection is usable after the rollback
    expect((await db.batch([db.prepare("INSERT INTO t (name) VALUES ('z')")]))[0].meta.changes).toBe(1);
  });

  it("an integer beyond int32 is stored, read and matched as an integer in an INTEGER column", async () => {
    await db.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").bind("big", 5_000_000_000).run();
    await db.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").bind("neg", -30_000_000_000).run();
    expect((await db.prepare("SELECT flag, typeof(flag) AS ty FROM t ORDER BY id").all()).results)
      .toEqual([{ flag: 5_000_000_000, ty: "integer" }, { flag: -30_000_000_000, ty: "integer" }]);
    expect(await db.prepare("SELECT name FROM t WHERE flag = ?").bind(5_000_000_000).first("name")).toBe("big");
  });

  it("enforces foreign keys, as D1 does", async () => {
    await expect(db.prepare("INSERT INTO c VALUES ('1', 'missing')").run()).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("keeps working after dump()", async () => {
    await db.prepare("INSERT INTO p VALUES ('a')").run();
    expect((await db.dump()).byteLength).toBeGreaterThan(0);
    expect(await db.prepare("SELECT count(*) AS n FROM p").first("n")).toBe(1);
    await expect(db.prepare("INSERT INTO c VALUES ('1', 'missing')").run()).rejects.toThrow(/FOREIGN KEY/);
  });
});
