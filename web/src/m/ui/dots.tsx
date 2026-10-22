import type { JSX } from "react";
import { BLANK, F57, ICON } from "./glyphs";

/** A bitmap as round dots. "1" lit, "0" unlit (at `dim` opacity; skipped when dim is 0), "s" a gap never drawn.
 *  The SVG scales down with its container (width 100%, max = natural width), so long numbers never overflow. */
export function DotGrid({ rows, cell, dim, className, fill }: { rows: string[]; cell: number; dim: number; className?: string; fill?: string }) {
  const W = rows[0].length * cell, H = rows.length * cell, r = cell * 0.42;
  const dots: JSX.Element[] = [];
  rows.forEach((row, y) => [...row].forEach((b, x) => {
    if (b === "s" || (b === "0" && !dim)) return;
    dots.push(<circle key={`${x}.${y}`} cx={x * cell + cell / 2} cy={y * cell + cell / 2} r={r} opacity={b === "1" ? undefined : dim} />);
  }));
  return (
    <svg className={`m-dots${className ? ` ${className}` : ""}`} viewBox={`0 0 ${W} ${H}`} width={W} style={{ maxWidth: W, width: "100%" }}
      fill={fill ?? "currentColor"} aria-hidden="true">{dots}</svg>
  );
}

export const textRows = (s: string): string[] =>
  Array.from({ length: 7 }, (_, r) => [...s].map((ch) => (F57[ch] ?? BLANK)[r]).join("s"));

/** 工作时间 / 累计耗时: a string of digits, "." and ":" in 5×7 dots, the unit in Doto beside it. */
export function DotNum({ text, unit, label }: { text: string; unit?: string; label?: string }) {
  return (
    <span className="m-dotnum" role="img" aria-label={label ?? text + (unit ?? "")}>
      <DotGrid rows={textRows(text)} cell={6} dim={0.08} />
      {unit && <small aria-hidden="true">{unit}</small>}
    </span>
  );
}

/** How many of n dots to light: none for nothing, at least one for anything. */
export function litCount(value: number, max: number, n: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(n, Math.max(1, Math.round((value / max) * n)));
}

export function DotBar({ value, max, n = 32, cell = 9.5 }: { value: number; max: number; n?: number; cell?: number }) {
  const k = litCount(value, max, n);
  return <DotGrid rows={["1".repeat(k) + "0".repeat(n - k)]} cell={cell} dim={0.16} />;
}

/** One column per day, 8 dots high, 2 wide. */
export function DotSpark({ values }: { values: number[] }) {
  const H = 8, mx = Math.max(0, ...values);
  const lit = values.map((v) => litCount(v, mx, H));
  const rows = Array.from({ length: H }, (_, y) => lit.map((k) => (H - y <= k ? "11" : "00")).join("s"));
  return <DotGrid rows={rows} cell={3.5} dim={0.12} className="m-sparkdots" />;
}

/** 采集: the last 24 hours, oldest first; a dim dot is an hour with no run. */
export function DotUptime({ hours }: { hours: boolean[] }) {
  return <DotGrid rows={[hours.map((h) => (h ? "1" : "0")).join("")]} cell={8.5} dim={0.2} />;
}

/** 统计: one day's column, 3 dots wide and 10 high; today in the tint colour. */
export function DotCol({ value, max, today }: { value: number; max: number; today: boolean }) {
  const H = 10, k = litCount(value, max, H);
  const rows = Array.from({ length: H }, (_, y) => (H - y <= k ? "111" : "000"));
  return <DotGrid rows={rows} cell={7} dim={0.1} fill={today ? "var(--tint)" : undefined} />;
}

/** Tab icon; `m-ico` lets the tab bar size it by height instead of the 100% width. */
export function DotIcon({ name }: { name: keyof typeof ICON }) {
  return <DotGrid rows={[...ICON[name]]} cell={2.2} dim={0} className="m-ico" />;
}
