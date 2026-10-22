import { env, exports } from "cloudflare:workers";
import { SignJWT, importJWK } from "jose";

const BASE = "http://worklog.test";

export function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return (exports as any).default.fetch(new Request(BASE + path, init));
}

export function api(path: string, init: RequestInit = {}): Promise<Response> {
  return rawFetch(path, {
    ...init,
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

// Storage isolation is per test FILE, so tests within a file share the DB.
export async function resetDb(): Promise<void> {
  const db = (env as any).DB as D1Database;
  await db.batch(
    ["sessions", "tasks", "notes", "machines", "report_overrides", "weekly_reviews",
     "day_plan_item_tasks", "plan_item_tasks", "day_plan_items", "day_plans", "plan_items", "prefs", "report_downloads", "translations", "report_digests", "pdf_compose", "deliverable_verdicts", "harvest_runs"].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
}

export async function signAccessJwt(
  claims: Record<string, unknown> = {},
  opts: { aud?: string; iss?: string; exp?: string | number | null } = {},
) {
  const key = await importJWK(JSON.parse((env as any).TEST_ACCESS_PRIVATE_JWK), "RS256");
  let jwt = new SignJWT({ email: "me@example.com", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(opts.iss ?? "https://test.cloudflareaccess.com")
    .setAudience(opts.aud ?? "test-aud")
    .setIssuedAt();
  // exp: null omits the claim entirely; otherwise a string ("5m") or a number is an absolute
  // Unix timestamp in seconds.
  if (opts.exp !== null) jwt = jwt.setExpirationTime(opts.exp ?? "5m");
  return jwt.sign(key);
}

export async function accessApi(
  path: string,
  init: RequestInit = {},
  claims: Record<string, unknown> = {},
): Promise<Response> {
  return rawFetch(path, {
    ...init,
    headers: {
      "Cf-Access-Jwt-Assertion": await signAccessJwt(claims),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
