import { env } from "cloudflare:workers";
import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { accessApi, api, rawFetch, signAccessJwt } from "./helpers";

const withJwt = (jwt: string, extra: Record<string, string> = {}) =>
  rawFetch("/api/me", { headers: { "Cf-Access-Jwt-Assertion": jwt, ...extra } });

describe("access jwt", () => {
  it("accepts a valid user JWT without any bearer token", async () => {
    const r = await accessApi("/api/me");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ kind: "user", email: "me@example.com" });
  });

  it("identifies a service token by common_name", async () => {
    const jwt = await signAccessJwt({ email: undefined, common_name: "abc.access" });
    const r = await withJwt(jwt);
    expect(await r.json()).toEqual({ kind: "service", name: "abc.access" });
  });

  it("bearer-only callers are identified as token", async () => {
    expect(await (await api("/api/me")).json()).toEqual({ kind: "token" });
  });

  it("rejects a JWT for another audience", async () => {
    expect((await withJwt(await signAccessJwt({}, { aud: "someone-else" }))).status).toBe(401);
  });

  it("rejects a JWT from another issuer", async () => {
    expect((await withJwt(await signAccessJwt({}, { iss: "https://evil.cloudflareaccess.com" }))).status).toBe(401);
  });

  it("rejects an expired JWT", async () => {
    expect((await withJwt(await signAccessJwt({}, { exp: Math.floor(Date.now() / 1000) - 60 }))).status).toBe(401);
  });

  it("rejects garbage", async () => {
    expect((await withJwt("not.a.jwt")).status).toBe(401);
  });

  it("an invalid JWT is NOT rescued by a valid bearer token", async () => {
    const r = await withJwt("not.a.jwt", { Authorization: "Bearer test-token" });
    expect(r.status).toBe(401);
  });

  it("health stays public", async () => {
    expect((await rawFetch("/api/health")).status).toBe(200);
  });

  it("rejects a token without an exp claim", async () => {
    const jwt = await signAccessJwt({}, { exp: null });
    expect((await withJwt(jwt)).status).toBe(401);
  });

  it("rejects a token with neither email nor common_name", async () => {
    const jwt = await signAccessJwt({ email: undefined });
    expect((await withJwt(jwt)).status).toBe(401);
  });

  it("rejects a well-formed token signed by a different key", async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwt = await new SignJWT({ email: "me@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://test.cloudflareaccess.com")
      .setAudience("test-aud")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    expect((await withJwt(jwt)).status).toBe(401);
  });
});

describe("access jwt — verifier not configured", () => {
  // TEAM_DOMAIN / POLICY_AUD unset is the state this code runs in FIRST in production, before
  // Cloudflare Access is turned on for the zone. It must fail closed: a presented JWT is denied
  // outright, even alongside a valid bearer token, while the deployed bearer-only collector keeps
  // working. Rollout order matters: set TEAM_DOMAIN/POLICY_AUD before enabling Access, since Access
  // injects Cf-Access-Jwt-Assertion on every request once active.
  const unconfigured = { ...(env as any), TEAM_DOMAIN: undefined, POLICY_AUD: undefined };
  const fetchMe = (headers: Record<string, string>) =>
    app.fetch(new Request("http://worklog.test/api/me", { headers }), unconfigured);

  it("rejects a valid signed JWT", async () => {
    const jwt = await signAccessJwt();
    const r = await fetchMe({ "Cf-Access-Jwt-Assertion": jwt });
    expect(r.status).toBe(401);
  });

  it("rejects a valid JWT even alongside a valid bearer token", async () => {
    const jwt = await signAccessJwt();
    const r = await fetchMe({ "Cf-Access-Jwt-Assertion": jwt, Authorization: "Bearer test-token" });
    expect(r.status).toBe(401);
  });

  it("still accepts the bearer token alone (the deployed collector's path)", async () => {
    const r = await fetchMe({ Authorization: "Bearer test-token" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ kind: "token" });
  });
});

describe("access jwt — trailing slash in TEAM_DOMAIN", () => {
  // A pasted TEAM_DOMAIN with a trailing slash must not change the issuer Cloudflare puts in the
  // JWT (which never has one). Without normalizing, this 401s every Access request.
  const trailingSlash = { ...(env as any), TEAM_DOMAIN: "https://test.cloudflareaccess.com/" };

  it("accepts a valid JWT whose issuer has no trailing slash", async () => {
    const jwt = await signAccessJwt();
    const r = await app.fetch(
      new Request("http://worklog.test/api/me", { headers: { "Cf-Access-Jwt-Assertion": jwt } }),
      trailingSlash,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ kind: "user", email: "me@example.com" });
  });
});
