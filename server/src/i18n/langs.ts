import type { Context } from "hono";

export const LANGS = ["zh", "ja", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

/** The v2 client's display language (`X-Lang`), or null: the CLI and the old UI get source text. */
export const langOf = (c: Context): Lang | null => {
  const v = c.req.header("X-Lang");
  return isLang(v) ? v : null;
};
