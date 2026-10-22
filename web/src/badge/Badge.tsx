import { useEffect, useState } from "react";
import type { World } from "../prefs/types";
import { useTaskBadgesVersion } from "../ui/taskBadges";
import { useWorld } from "../world/store";
import { badgeBitmapUrl, badgeSvgUrl, canRaster, peekBadgeBitmap, type BadgeSpec } from "./cache";
import { RATIO } from "./geom";
import { levelFor } from "./lod";

/** A task's badge (spec §2): the level follows the displayed height, the material follows the world (`world` overrides
 *  the v2 store — the phone shell has its own theme). With a canvas the SVG is never put in an <img>: the browser would
 *  parse it a second time (B2 profile: SVG parse is the largest cost). A sized placeholder holds the place until the
 *  cached bitmap is ready; without a canvas (jsdom) or when rasterising fails, the SVG is shown. */
export function Badge({ spec, height, title, alt, world: forced, className }: {
  spec: BadgeSpec; height: number; title?: string; alt?: string; world?: World; className?: string;
}) {
  const store = useWorld(), world = forced ?? store, level = levelFor(height), dpr = window.devicePixelRatio || 1;
  const width = Math.round(height * RATIO), label = alt ?? title ?? "";
  const bv = useTaskBadgesVersion();
  const key = `${spec.id}|${spec.obj}|${spec.color}|${level}|${world}|${height}|${dpr}|${bv}`;
  const ready = canRaster() ? peekBadgeBitmap(spec, level, world, height, dpr) : undefined;
  const [late, setLate] = useState<{ for: string; url: string } | null>(null);
  useEffect(() => {
    if (!canRaster() || ready) return;
    let live = true;
    void badgeBitmapUrl(spec, level, world, height, dpr).then((url) => { if (live) setLate({ for: key, url: url ?? badgeSvgUrl(spec, level, world) }); });
    return () => { live = false; };
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- key encodes spec, level, world, height and dpr
  const src = !canRaster() ? badgeSvgUrl(spec, level, world) : ready ?? (late && late.for === key ? late.url : null);
  if (!src) return <span role="img" aria-label={label} title={title} className={className} style={{ display: "inline-block", width, height }} />;
  return <img className={className} src={src} height={height} width={width} alt={label} title={title} draggable={false} />;
}
