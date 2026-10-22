import { describe, expect, it } from "vitest";
import raw from "../wrangler.jsonc?raw";
import { parseJsonc } from "./jsonc";

const cfg = parseJsonc(raw);

describe("static assets config", () => {
  it("serves the SPA from ./public with index.html fallback", () => {
    expect(cfg.assets.directory).toBe("./public");
    expect(cfg.assets.not_found_handling).toBe("single-page-application");
  });

  it("always runs the Worker first for the API, including a bare /api", () => {
    expect(cfg.assets.run_worker_first).toEqual(["/api", "/api/*"]);
  });

  it("keeps API_TOKEN out of the config file", () => {
    expect(raw).not.toMatch(/API_TOKEN/);
  });
});
