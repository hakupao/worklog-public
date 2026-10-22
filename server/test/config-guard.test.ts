import { describe, expect, it } from "vitest";
import cfg from "../wrangler.jsonc?raw";

// TEST_ACCESS_JWKS_JSON (and its companion TEST_ACCESS_PRIVATE_JWK) exist only to let the test
// suite verify Access JWTs without a network call. If either ever leaked into the deployed
// config, production would trust a fixed, publicly-known test keypair instead of Cloudflare's
// real Access certs. Guard against that drifting in.
describe("wrangler config", () => {
  it("never sets a TEST_ACCESS_* var", () => {
    expect(cfg).not.toContain("TEST_ACCESS");
  });
});

// Every branch cron.ts dispatches on must be a configured trigger, and nothing else (B1 fix round 3 removed the badge cron:
// Cloudflare never fired the third trigger, see docs/projects/2026-10-14-task-badges/evidence/failures/b1_deploy_attempt_2.md).
describe("cron triggers", async () => {
  const { DIGEST_CRON } = await import("../src/cron");
  const crons: string[] = JSON.parse(/"crons":\s*(\[[^\]]*\])/.exec(cfg)![1]);
  it("lists exactly the schedules cron.ts dispatches on", () => {
    expect([...crons].sort()).toEqual([DIGEST_CRON, "*/5 * * * *"].sort());
  });
});
