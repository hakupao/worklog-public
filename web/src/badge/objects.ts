import { CULLED } from "./culled";
import { OBJECTS } from "./objects.gen";

/** Every object is drawn in a 256-unit box (Phosphor natively; Fluent fitted to 224 and centred by the generator). */
export const OBJECT_BOX = 256;
/** The objects a badge may carry, named "<source>:<name>" (both libraries have a cat), minus the culled ones. */
const culled = new Set(CULLED);
export const BADGE_OBJECTS: readonly string[] = Object.keys(OBJECTS).filter((n) => !culled.has(n));
const listed = new Set(BADGE_OBJECTS);
/** True for a listed (generated and not culled) object: the check a stored `badge_obj` must pass. */
export const isBadgeObject = (name: string): boolean => listed.has(name);
export const OBJECT_SOURCES = ["phosphor", "fluent"] as const;
export type ObjectSource = (typeof OBJECT_SOURCES)[number];
/** The source of a listed object; null for a bare / unknown prefix (controller ruling: no unchecked cast). */
export const objectSource = (name: string): ObjectSource | null => { const i = name.indexOf(":"), p = i < 0 ? "" : name.slice(0, i); return (OBJECT_SOURCES as readonly string[]).includes(p) ? (p as ObjectSource) : null; };
const glyph = (name: string) => (Object.hasOwn(OBJECTS, name) ? OBJECTS[name] : null);
export const objectPath = (name: string): string | null => glyph(name)?.d ?? null;
/** Some Fluent glyphs cut their holes (eyes, patches) with even-odd; nonzero would fill them in. */
export const objectFillRule = (name: string): "nonzero" | "evenodd" => (glyph(name)?.evenodd ? "evenodd" : "nonzero");
/** The object for a task with no stored badge (before B1, or a culled name): stable for the same seed. */
export const pickFallbackObject = (seed: number): string => BADGE_OBJECTS[(seed >>> 0) % BADGE_OBJECTS.length];
