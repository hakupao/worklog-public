// What build-db.ts hands the seed module (web/demo/seed/index.ts).

export interface SeedContext {
  /** One call through the real app with the demo bearer token; resolves to the parsed JSON (undefined for 204) and
   *  throws on any non-2xx with the status and body in the message. */
  api<T = any>(method: string, path: string, body?: unknown): Promise<T>;
  /** One raw statement against the database (for what no route writes); rows for a SELECT, [] otherwise. */
  sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T[]>;
  /** DEMO_NOW (clock.ts) as a Date. The global clock is already shifted to it, so Date.now() agrees. */
  now: Date;
}

export type Seed = (ctx: SeedContext) => Promise<void>;
