import { readQuery, withQuery } from "../route";
import type { Lang, World } from "./types";

/** `?world=` / `?lang=` in the hash query: a one-off view, never written to prefs. */
export function readOverrides(hash: string): { world?: World; lang?: Lang } {
  const q = readQuery(hash), out: { world?: World; lang?: Lang } = {};
  const w = q.get("world"), l = q.get("lang");
  if (w === "ura" || w === "omote") out.world = w;
  if (l === "zh" || l === "ja" || l === "en") out.lang = l;
  return out;
}
export const withoutOverride = (hash: string, key: "world" | "lang") => withQuery(hash, { [key]: null });
