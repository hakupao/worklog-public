export type Env = {
  DB: D1Database;
  API_TOKEN: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  TEST_ACCESS_JWKS_JSON?: string;
  ANTHROPIC_API_KEY?: string;
  BROWSER?: Fetcher;
  DIGESTS_AUTO?: string;
};

export type Identity =
  | { kind: "user"; email: string }
  | { kind: "service"; name: string }
  | { kind: "token" };

export type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
