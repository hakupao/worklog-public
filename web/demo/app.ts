// The real Worker (server/src/index.ts) wired to the demo: D1 is the sql.js shim, the token is "demo", there is no
// model key (every LLM path answers "unavailable" or skips) and no Browser Run. Used by the page (entry.ts) and by the
// build that seeds demo.sqlite (build-db.ts), so both run exactly the same server code.
import "./polyfills";
import type { Database } from "sql.js";
import worker from "../../server/src/index";
import { pdfDeps } from "../../server/src/report/pdf/browser";
import { DemoD1 } from "./d1";

export const DEMO_TOKEN = "demo";

// GET /api/reports/:week/pdf needs a Browser binding to get past its 503. The binding is never called: htmlToPdf is
// replaced, and returns the page's own HTML in place of the printed PDF (the route still records the download).
const browser = { fetch: () => Promise.reject(new Error("Browser Run is not available in the demo")) };
pdfDeps.htmlToPdf = async (_binding: unknown, html: string) =>
  ({ pdf: new TextEncoder().encode(html), fit: { over: false, steps: [], fonts: [] } });

export interface DemoApp {
  DB: DemoD1;
  /** One request through the Hono app, as the Worker runtime would hand it over. */
  fetch(req: Request): Promise<Response>;
}

export function createDemoApp(db: Database): DemoApp {
  const DB = new DemoD1(db);
  const env = { DB, API_TOKEN: DEMO_TOKEN, DIGESTS_AUTO: "off", BROWSER: browser };
  const ctx = {
    waitUntil(p: Promise<unknown>) { Promise.resolve(p).catch((e) => console.warn("[demo] background task failed", e)); },
    passThroughOnException() {},
    props: {},
  };
  return { DB, fetch: (req) => Promise.resolve(worker.fetch(req, env as never, ctx as never)) };
}

/** A request for the app: same method, headers and body, the bearer token added, on the app's own origin. */
export async function toAppRequest(req: Request): Promise<Request> {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.set("Authorization", `Bearer ${DEMO_TOKEN}`);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  return new Request(`https://demo.invalid${url.pathname}${url.search}`, { method: req.method, headers, body });
}
