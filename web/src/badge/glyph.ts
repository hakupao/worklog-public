import { resolveBadge, type BadgeSpec } from "./cache";
import { objectFillRule, objectPath } from "./objects";

/** Tier 2 of the badge language (spec §2.5): the badge's object as a one-colour silhouette, no capsule, no landscape. */
export interface Glyph { d: string; rule: "nonzero" | "evenodd"; color: string; box: 256 }

export function glyphFor(spec: BadgeSpec): Glyph {
  const { obj, color } = resolveBadge(spec);       // same fallback as <Badge> for culled / unknown names
  return { d: objectPath(obj) ?? "", rule: objectFillRule(obj), color, box: 256 };
}
