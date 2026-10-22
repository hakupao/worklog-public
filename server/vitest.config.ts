import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      const { generateKeyPair, exportJWK } = await import("jose");
      const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
      const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
      const privateJwk = { ...(await exportJWK(privateKey)), kid: "test-key", alg: "RS256" };
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            API_TOKEN: "test-token",
            TEAM_DOMAIN: "https://test.cloudflareaccess.com",
            POLICY_AUD: "test-aud",
            TEST_ACCESS_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
            TEST_ACCESS_PRIVATE_JWK: JSON.stringify(privateJwk),
          },
        },
      };
    }),
  ],
  test: { setupFiles: ["./test/apply-migrations.ts"] },
});
