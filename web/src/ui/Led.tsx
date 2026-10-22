import { useEffect, useLayoutEffect, useRef } from "react";
import { enter, swap } from "../ink/fx";
import { glyphOf, htmlLang } from "../i18n/t";
import { Board } from "../led/board";
import { clipSegs, segsWidth, type Seg } from "../led/compose";
import { loadPixelFont } from "../led/fonts";
import { PITCH } from "../led/lattice";
import { motion } from "../led/motion";
import { registerSlot, unregisterSlot, type Slot } from "../led/registry";
import type { Glyph } from "../prefs/types";
import { useWorld } from "../world/store";
import { useV2 } from "./context";
import { C, TIER_GLOW } from "./palette";

export type LedSeg = { t: string; kind?: "live" | "alert" | "dim" | "code"; color?: string; glyph?: Glyph };
export interface LedProps {
  text: string | LedSeg[]; tier?: 0 | 1 | 2 | 3; size?: 8 | 10 | 12; scale?: 1 | 2; color?: string;
  ui?: boolean; fit?: boolean; clip?: boolean; align?: "left" | "right" | "center"; task?: string; still?: boolean; className?: string;
  /** 表: the type wraps to its cell instead of one cut line (LedLines, the 週報 cells — S2c §1). */
  wrapInk?: boolean;
}

const KIND_COLOR = { live: C.GREEN, alert: C.RED, dim: C.DIM } as const;
const KIND_CLASS = { live: "i-g", alert: "i-r", dim: "i-dim", code: "i-code" } as const;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HEX = /^#[0-9a-f]{3,8}$/i;   // every palette colour is a hex literal; anything else never reaches a style attribute
const segsOf = (v: string | LedSeg[]): LedSeg[] => (typeof v === "string" ? [{ t: v }] : v);

export function Led({ text, tier = 1, size = 10, scale = 1, color = C.AMBER, ui = false, fit = false, clip = false, align, task, still = false, className, wrapInk = false }: LedProps) {
  const { lang } = useV2(), world = useWorld();
  const cvRef = useRef<HTMLCanvasElement>(null), inkRef = useRef<HTMLSpanElement>(null);
  const boardRef = useRef<Board | null>(null);
  const last = useRef<{ key: string; lang: string; world: string; color: string } | null>(null);
  const glyph: Glyph = glyphOf(lang);       // data text arrives in the display language too (S1 X-Lang)
  const inkLang = htmlLang(lang);
  const segs = segsOf(text);
  const key = JSON.stringify(segs);

  // LED segments for the board as it is laid out right now: kinds → colours, then fit / clip to the width.
  const ledSegs = (b: Board): Seg[] => {
    let out: Seg[] = segs.map((s) => ({ t: s.t, glyph: s.glyph, color: s.kind && s.kind !== "code" ? KIND_COLOR[s.kind] : s.color }));
    if (fit) {
      const px = `${Math.ceil((segsWidth(out, size, glyph) * scale + 1) * PITCH + PITCH)}px`;
      if (b.cv.style.width !== px) { b.cv.style.width = px; b.resize(); }
    }
    if (clip) {
      const avail = Math.floor((b.cv.getBoundingClientRect().width - PITCH) / PITCH);
      out = clipSegs(out, avail, (x) => segsWidth(x, size, glyph) * scale, C.DIM);
    }
    return out;
  };
  // A resize re-lays the text (re-clips, re-fits) without animating — prototype hall.js relayout().
  const relayout = useRef<() => void>(() => {});
  relayout.current = () => {
    const b = boardRef.current;
    if (!b || !last.current) return;
    b.resize();
    b.set(ledSegs(b), { animate: false, glyph, color });
  };

  // Board lifetime = component lifetime; the slot is how the world transitions find this board.
  useLayoutEffect(() => {
    const cv = cvRef.current!, ink = inkRef.current!;
    cv.style.height = `${(size * scale + 1) * PITCH + PITCH}px`;
    const b = new Board(cv, { size, scale, color, glyph, align, marquee: !clip && !fit && !wrapInk, glow: TIER_GLOW[tier], snap: true });
    boardRef.current = b;
    const slot: Slot = { board: b, ink };
    registerSlot(slot);
    const enterH = () => b.hover(true), leaveH = () => b.hover(false);
    cv.addEventListener("pointerenter", enterH); cv.addEventListener("pointerleave", leaveH);
    let ro: ResizeObserver | null = null, rt = 0;
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => relayout.current()); });
      ro.observe(cv.parentElement ?? cv);
    }
    return () => {
      ro?.disconnect(); cancelAnimationFrame(rt);
      cv.removeEventListener("pointerenter", enterH); cv.removeEventListener("pointerleave", leaveH);
      unregisterSlot(slot); b.dispose(); boardRef.current = null; last.current = null;
    };
    // a board is rebuilt only when its geometry options change
  }, [size, scale, tier, clip, fit, align, wrapInk]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const b = boardRef.current, ink = inkRef.current;
    if (!b || !ink) return;
    let cancelled = false;
    // every cut a segment draws in (a ja segment in a zh UI: countdown kinds, holiday names), not just the page's
    Promise.all([...new Set(segs.map((s) => s.glyph ?? glyph))].map((g) => loadPixelFont(size, g))).then(() => {
      if (cancelled || boardRef.current !== b) return;
      const prev = last.current;
      const trig = !prev ? "load" : prev.world !== world ? "world" : prev.lang !== lang ? (ui ? "lang" : "data") : prev.key !== key ? "data" : prev.color !== color ? "color" : null;
      last.current = { key, lang, world, color };
      if (!trig) return;

      // ink twin (always written; it is the accessible text in both worlds)
      const html = segs.map((s) => {
        const cls = s.kind ? KIND_CLASS[s.kind] : "";
        const style = s.kind === "code" && s.color && HEX.test(s.color) ? ` style="--lc:${esc(s.color)}"` : "";
        return `<span lang="${s.glyph ? (s.glyph === "ja" ? "ja" : "zh-CN") : inkLang}"${cls ? ` class="${cls}"` : ""}${style}>${esc(s.t)}</span>`;
      }).join("");
      if (trig !== "color") swap(ink, html, trig === "lang" ? "lang" : "data", world === "omote" && !still && (trig === "lang" || trig === "data") ? undefined : "none");
      // 表 page entrance: each twin enters once its text exists (Shell cannot: the text arrives after the font).
      if (trig === "load" && world === "omote") enter([ink]);

      // LED. The first text re-measures: the board was sized when it was created, and a parent that never resizes
      // after that (no ResizeObserver change to re-lay it) would keep that early width (计划 page, sub-project 5).
      if (trig === "load") b.resize();
      const bsegs = ledSegs(b);
      if (trig === "world" || trig === "color") { b.resize(); b.set(ledSegs(b), { animate: false, glyph, color }); return; }
      if (still && trig !== "load") { b.set(bsegs, { animate: false, glyph, color }); return; }
      if (world === "omote") { b.set(bsegs, { animate: false, glyph, color }); return; }
      if (trig === "load") b.set(bsegs, { fx: motion.fx.load, fromBlank: true, glyph, color });
      else if (trig === "lang") b.set(bsegs, { fx: motion.fx.lang, glyph, color });
      else b.set(bsegs, { fx: motion.fx.data, glyph, color });
    });
    return () => { cancelled = true; };
    // tier / align rebuild the board above, so they must re-run this to draw on the new one
  }, [key, lang, world, glyph, size, scale, color, fit, clip, tier, align]); // eslint-disable-line react-hooks/exhaustive-deps

  const big = scale > 1 ? " x2" : "", blk = wrapInk ? " iwrap" : clip || !fit ? " iblk" : "";
  return (
    <>
      <canvas ref={cvRef} aria-hidden="true" data-tier={tier} data-task={task} className={className} />
      <span ref={inkRef} className={`ink t${tier} s${size}${big}${blk}`} data-task={task} />
    </>
  );
}
