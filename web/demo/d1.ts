// A D1Database over a sql.js Database (PLAN D1/D2): the subset server/src uses — prepare().bind().first()/all()/run()/raw(),
// batch() (one transaction, rolled back on error) and exec() — with D1's result shapes and bind rules. sql.js is
// synchronous, so every call below runs to completion before another request's call can start, which is what makes a
// batch atomic without locks. D1 enforces foreign keys; sql.js does not by default, so the shim turns them on.
import type { Database, SqlValue, Statement } from "sql.js";

type Bound = SqlValue;
type Row = Record<string, unknown>;
export interface D1Meta {
  duration: number; changes: number; last_row_id: number; rows_read: number; rows_written: number;
  changed_db: boolean; size_after: number; served_by: string;
}
export interface D1Result<T = Row> { results: T[]; success: true; meta: D1Meta }

/** D1's errors read "D1_ERROR: <sqlite message>"; callers match on the SQLite text (concurrency.ts), which stays inside. */
function d1Error(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith("D1_")) return e as Error;
  return new Error(`D1_ERROR: ${msg}`, { cause: e });
}

function convert(v: unknown, i: number): Bound {
  if (v === null) return null;
  switch (typeof v) {
    case "string": return v;
    // sql.js 1.14 has no int64 bind (only bind_int / bind_double): an integer beyond int32 goes as REAL — a bigint
    // would go as TEXT, which is worse — and an INTEGER column stores it as an integer again, which is what D1 gives.
    case "number": return v;
    case "boolean": return v ? 1 : 0;
    case "bigint":
      if (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(v);
      break;
    case "object":
      if (v instanceof ArrayBuffer) return new Uint8Array(v);
      if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      break;
  }
  throw new Error(`D1_TYPE_ERROR: Type '${v === undefined ? "undefined" : typeof v}' not supported for value '${String(v)}' (parameter ${i + 1})`);
}

/** A BLOB comes back from D1 as an array of byte values. */
const out = (v: SqlValue): unknown => (v instanceof Uint8Array ? Array.from(v) : v);

class Shim {
  private changesStmt: Statement;
  private rowidStmt: Statement;
  constructor(readonly db: Database) {
    db.run("PRAGMA foreign_keys = ON");
    this.changesStmt = db.prepare("SELECT total_changes()");
    this.rowidStmt = db.prepare("SELECT last_insert_rowid()");
  }
  private scalar(s: Statement): number {
    try { s.step(); return Number(s.get()[0]); } finally { s.reset(); }
  }
  /** Runs one statement to completion: column names, rows as arrays, and D1's meta. */
  execute(sql: string, params: Bound[]): { columns: string[]; rows: unknown[][]; meta: D1Meta } {
    const t0 = performance.now();
    const before = this.scalar(this.changesStmt);
    let stmt: Statement;
    try { stmt = this.db.prepare(sql); } catch (e) { throw d1Error(e); }
    const rows: unknown[][] = [];
    let columns: string[];
    try {
      if (params.length) stmt.bind(params);
      columns = stmt.getColumnNames();
      while (stmt.step()) rows.push(stmt.get().map(out));
    } catch (e) {
      throw d1Error(e);
    } finally {
      stmt.free();
    }
    // sqlite3_changes() keeps the last write's count through later SELECTs, so only a statement that moved
    // total_changes() reports it.
    const changes = this.scalar(this.changesStmt) !== before ? this.db.getRowsModified() : 0;
    return {
      columns, rows,
      meta: {
        duration: performance.now() - t0, changes, last_row_id: this.scalar(this.rowidStmt),
        rows_read: rows.length, rows_written: changes, changed_db: changes > 0, size_after: 0, served_by: "sql.js (demo)",
      },
    };
  }
}

const objects = (columns: string[], rows: unknown[][]): Row[] =>
  rows.map((r) => { const o: Row = {}; columns.forEach((c, i) => { o[c] = r[i]; }); return o; });

class PreparedStatement {
  constructor(private owner: DemoD1, readonly sql: string, readonly params: Bound[] = []) {}
  private get shim(): Shim { return this.owner.shim; }
  /** A new statement: D1 statements are immutable, so a prepared one can be bound twice. */
  bind(...values: unknown[]): PreparedStatement {
    return new PreparedStatement(this.owner, this.sql, values.map(convert));
  }
  /** For batch(): the same result object all() gives. */
  resultSync(): D1Result {
    const r = this.shim.execute(this.sql, this.params);
    return { results: objects(r.columns, r.rows), success: true, meta: r.meta };
  }
  async first<T = unknown>(column?: string): Promise<T | null> {
    const r = this.shim.execute(this.sql, this.params);
    if (!r.rows.length) return null;
    const row = objects(r.columns, r.rows.slice(0, 1))[0];
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column] as T;
  }
  async all<T = Row>(): Promise<D1Result<T>> { return this.resultSync() as D1Result<T>; }
  async run<T = Row>(): Promise<D1Result<T>> { return this.resultSync() as D1Result<T>; }
  async raw<T = unknown[]>(opts?: { columnNames?: boolean }): Promise<T[]> {
    const r = this.shim.execute(this.sql, this.params);
    return (opts?.columnNames ? [r.columns, ...r.rows] : r.rows) as T[];
  }
}

export class DemoD1 {
  /** @internal the statement runner; replaced after dump() */
  shim: Shim;
  constructor(readonly db: Database) { this.shim = new Shim(db); }
  prepare(sql: string): PreparedStatement { return new PreparedStatement(this, sql); }
  /** All statements in one transaction, in order; any failure rolls them all back and rejects. */
  async batch<T = Row>(statements: PreparedStatement[]): Promise<D1Result<T>[]> {
    if (!statements.length) return [];
    this.db.run("BEGIN");
    try {
      const results = statements.map((s) => s.resultSync());
      this.db.run("COMMIT");
      return results as D1Result<T>[];
    } catch (e) {
      try { this.db.run("ROLLBACK"); } catch { /* already rolled back by SQLite */ }
      throw d1Error(e);
    }
  }
  /** Several statements as one string (migrations): D1 answers how many ran and how long it took. */
  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const t0 = performance.now();
    let count = 0;
    try {
      for (const stmt of this.db.iterateStatements(sql)) {
        try { while (stmt.step()); } finally { stmt.free(); }
        count++;
      }
    } catch (e) {
      throw d1Error(e);
    }
    return { count, duration: performance.now() - t0 };
  }
  async dump(): Promise<ArrayBuffer> {
    const bytes = this.db.export();
    this.shim = new Shim(this.db);   // export() reopens the database: prepared statements and pragmas are gone
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}
