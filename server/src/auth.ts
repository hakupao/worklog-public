import type { MiddlewareHandler } from "hono";
import { verifyAccessJwt } from "./access";
import type { AppEnv } from "./env";

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}

// Rollout order matters: set TEAM_DOMAIN and POLICY_AUD BEFORE enabling Cloudflare Access on the
// zone. Once Access is on, it injects Cf-Access-Jwt-Assertion on every request, and an unconfigured
// verifier denies any presented JWT outright (fail closed) rather than falling back to the bearer
// check.
export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (jwt) {
    // A presented JWT is authoritative: if it does not verify, do not fall back to the bearer token.
    const identity = await verifyAccessJwt(jwt, c.env);
    if (!identity) return c.json({ error: "unauthorized" }, 401);
    c.set("identity", identity);
    return next();
  }
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!c.env.API_TOKEN || !safeEqual(token, c.env.API_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("identity", { kind: "token" });
  await next();
};
