import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { Env, Identity } from "./env";

type KeySet = Parameters<typeof jwtVerify>[1];
let remote: { domain: string; keys: KeySet } | undefined;

function keySet(env: Env, domain: string): KeySet {
  // Test-only: a local JWKS so the suite never touches the network. Never set this in production.
  if (env.TEST_ACCESS_JWKS_JSON) return createLocalJWKSet(JSON.parse(env.TEST_ACCESS_JWKS_JSON));
  if (!remote || remote.domain !== domain) {
    remote = {
      domain,
      keys: createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`)),
    };
  }
  return remote.keys;
}

export async function verifyAccessJwt(token: string, env: Env): Promise<Identity | null> {
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) return null;
  // Cloudflare's `iss` claim never has a trailing slash; normalize once so a pasted TEAM_DOMAIN
  // with one doesn't silently 401 every Access request.
  const domain = env.TEAM_DOMAIN.replace(/\/+$/, "");
  try {
    const { payload } = await jwtVerify(token, keySet(env, domain), {
      issuer: domain,
      audience: env.POLICY_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["exp"],
    });
    if (typeof payload.email === "string" && payload.email) return { kind: "user", email: payload.email };
    if (typeof payload.common_name === "string" && payload.common_name) {
      return { kind: "service", name: payload.common_name };
    }
    return null;
  } catch {
    return null;
  }
}
