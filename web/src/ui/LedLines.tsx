import { useLayoutEffect, useRef, useState } from "react";
import { glyphOf } from "../i18n/t";
import { segsWidth, wrapSegs } from "../led/compose";
import { loadPixelFont } from "../led/fonts";
import { PITCH } from "../led/lattice";
import { useWorld } from "../world/store";
import { useV2 } from "./context";
import { Led, type LedProps, type LedSeg } from "./Led";

/** A Led that shows all of its text: in 表 the type wraps (one Led, wrapping ink); in 里 the text is cut into lines at
 *  the cell's width, one LED board per line (design 2026-10-08-s2c §1.3). The width is read off the first line's
 *  canvas and turned into columns exactly as Led's `clip` does — (px − PITCH) / PITCH against segsWidth × scale — so a line
 *  never needs the `clip` each board still carries as a last guard. Re-cut on resize and on a new text. */
export function LedLines(props: Omit<LedProps, "clip" | "fit" | "wrapInk">) {
  const world = useWorld(), { lang } = useV2();
  const host = useRef<HTMLSpanElement>(null);
  const segs: LedSeg[] = typeof props.text === "string" ? [{ t: props.text }] : props.text;
  const size = props.size ?? 10, scale = props.scale ?? 1, glyph = glyphOf(lang), key = JSON.stringify(segs);
  // the cut belongs to the text it was made for: a new text shows whole (each board clipped) until it is cut again
  const [cut, setCut] = useState<{ key: string; lines: LedSeg[][] } | null>(null);
  const lines = cut?.key === key ? cut.lines : [segs];
  useLayoutEffect(() => {
    if (world === "omote") return;
    const el = host.current;
    if (!el) return;
    let alive = true;
    const recut = () => Promise.all([...new Set(segs.map((s) => s.glyph ?? glyph))].map((g) => loadPixelFont(size, g))).then(() => {
      if (!alive) return;
      const avail = Math.floor(((el.querySelector("canvas") ?? el).getBoundingClientRect().width - PITCH) / PITCH);
      if (avail <= 0) return;
      const next = wrapSegs(segs, avail, (x) => segsWidth(x, size, glyph) * scale);
      setCut((prev) => (prev?.key === key && JSON.stringify(prev.lines) === JSON.stringify(next) ? prev : { key, lines: next }));
    });
    void recut();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => void recut()) : null;
    ro?.observe(el);
    return () => { alive = false; ro?.disconnect(); };
  }, [world, key, size, scale, glyph]); // eslint-disable-line react-hooks/exhaustive-deps
  if (world === "omote") return <Led {...props} wrapInk />;
  return (
    <span ref={host} className={`ledlines${props.className ? ` ${props.className}` : ""}`}>
      {lines.map((l, i) => <Led key={i} {...props} className={undefined} text={l} clip />)}
    </span>
  );
}
