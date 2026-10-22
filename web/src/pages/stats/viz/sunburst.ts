// 依頼元旭日 (`sunburst`, lab s13 on 7b's terms): three rings — requester → task → machine — whose arcs are wall
// clock. A task's minutes come from splitBy over the range (concurrent tasks split evenly, U17) and are divided
// evenly among its requesters (splitRequesters); a task's slice splits among machines in proportion to that task's
// own per-machine wall clock (splitBy over its sessions alone). Unlinked time is its own requester slice; a task the
// table does not know, or one without a requester, goes to a 「no requester」 slice. The inner ring adds up to the
// range's wall clock.
import type { Task } from "../../../api/types";
import { splitRequesters } from "../../../lib/requesters";
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { C, inkOf, lineColor, mix } from "../../../ui/palette";
import { lattice } from "./dayview";
import { segments, splitBy, type Prepared, type Seg } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];

/** Requester keys besides names: unlinked time, and a task with no known requester. */
export const UNLINKED = "";
export const NO_REQ = "\u0000";

/** An arc: [a0, a1) radians clockwise from the top. */
interface Arc { v: number; a0: number; a1: number }
export interface SunReq extends Arc { req: string; ri: number }
export interface SunTask extends Arc { req: string; task: string }
export interface SunMach extends Arc { req: string; task: string; machine: string }
export interface Sunburst { total: number; rings: [SunReq[], SunTask[], SunMach[]] }

const TAU = Math.PI * 2;
const byV = <T extends { v: number }>(key: (x: T) => string) => (a: T, b: T) => b.v - a.v || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

export function deriveSunburst(prep: Prepared, segs: Seg[], tasks: ReadonlyMap<string, Task>): Sunburst {
  const byTask = splitBy(segs, prep, (s) => s.task_id ?? "");
  // each task's own machine split, as shares of its own wall clock
  const machShare = new Map<string, [string, number][]>();
  for (const k of byTask.keys()) {
    const sessions = prep.sessions.filter((s) => (s.task_id ?? "") === k);
    const sub: Prepared = { ...prep, sessions, byId: new Map(sessions.map((s) => [s.id, s])) };
    const m = splitBy(segments(sub), sub, (s) => s.machine), tot = [...m.values()].reduce((a, v) => a + v, 0);
    machShare.set(k, [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([mc, v]) => [mc, tot ? v / tot : 0]));
  }
  const reqs = new Map<string, Map<string, number>>();
  for (const [k, v] of byTask) {
    const rq = k === "" ? [UNLINKED] : splitRequesters(tasks.get(k)?.requester ?? "");
    const names = rq.length ? rq : [NO_REQ];
    for (const r of names) {
      const ts = reqs.get(r) ?? new Map<string, number>();
      ts.set(k, (ts.get(k) ?? 0) + v / names.length);
      reqs.set(r, ts);
    }
  }
  const total = [...byTask.values()].reduce((a, v) => a + v, 0);
  const rings: Sunburst["rings"] = [[], [], []];
  const ang = (v: number) => (total ? (v / total) * TAU : 0);
  let a = 0;
  [...reqs].map(([req, ts]) => ({ req, ts, v: [...ts.values()].reduce((m, v) => m + v, 0) }))
    .sort(byV((x) => x.req))
    .forEach(({ req, ts, v }, ri) => {
      const a0 = a;
      [...ts].map(([task, tv]) => ({ task, v: tv })).sort(byV((x) => x.task)).forEach(({ task, v: tv }) => {
        const b0 = a;
        for (const [machine, f] of machShare.get(task)!) {
          rings[2].push({ req, task, machine, v: tv * f, a0: a, a1: a + ang(tv * f) });
          a += ang(tv * f);
        }
        rings[1].push({ req, task, v: tv, a0: b0, a1: a });
      });
      rings[0].push({ req, ri, v, a0, a1: a });
    });
  return { total, rings };
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas height both worlds share
export const SUN_HEIGHT = 190 * U;
/** Ring bands as fractions of the radius (lab): requester, task, machine. */
const BANDS: [number, number][] = [[0.25, 0.52], [0.55, 0.88], [0.91, 0.98]];
const WIN = "#bfe6ff";                                    // Win11 on the outer ring (lab C.BLUE)

/** The rings as drawn (px): centre and radius. */
export interface SunGeom { cx: number; cy: number; R: number }

/** The ring (0 requester, 1 task, 2 machine) and arc under the point; null in the centre, between rings or outside. */
export function sunAt(g: SunGeom, sb: Sunburst, px: number, py: number): { ring: 0 | 1 | 2; i: number } | null {
  const dx = px - g.cx, dy = py - g.cy, r = Math.hypot(dx, dy) / g.R;
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += TAU;
  for (const ring of [0, 1, 2] as const) {
    if (r < BANDS[ring][0] || r >= BANDS[ring][1]) continue;
    const i = (sb.rings[ring] as Arc[]).findIndex((z) => a >= z.a0 && a < z.a1);
    return i < 0 ? null : { ring, i };
  }
  return null;
}

const fk = (hover: string | null, task: string) => (hover === null ? 1 : task === hover ? 1.25 : 0.3);
const ringOf = (r: number, R: number) => BANDS.findIndex(([a, b]) => r >= a * R && r < b * R);

export function drawSunUra(x: CanvasRenderingContext2D, sb: Sunburst, hover: string | null, g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn?: BitsFn): SunGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), ny = Math.floor((g.h - g.offY) / P), cx = Math.floor(nx / 2), cy = Math.floor(ny / 2), R = Math.min(nx, ny) / 2 - 4;   // C3: a narrow canvas fits the width
  const b0 = BANDS[1][0] * R, b1 = BANDS[1][1] * R, rm = (b0 + b1) / 2;
  x.save();
  for (let i = Math.max(0, Math.floor(cx - R)); i <= Math.min(nx - 1, Math.ceil(cx + R)); i++) for (let j = Math.max(0, Math.floor(cy - R)); j <= Math.min(ny - 1, Math.ceil(cy + R)); j++) {
    const dx = i - cx, dy = j - cy, r = Math.hypot(dx, dy), k = ringOf(r, R);
    if (k < 0) continue;
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += TAU;
    const z = (sb.rings[k] as (SunReq | SunTask | SunMach)[]).find((q) => a >= q.a0 && a < q.a1);
    if (!z) { L.off(i, j, 0.04); continue; }
    if ((a - z.a0) * r < 0.7 || (z.a1 - a) * r < 0.7) { L.off(i, j, 0.03); continue; }
    if (k === 0) { const q = z as SunReq; L.dot(i, j, q.req === UNLINKED || q.req === NO_REQ ? C.DIM : q.ri === 0 ? C.WARM : C.AMBER, q.ri % 2 ? 0.45 : 0.8, q.ri === 0 ? 0.6 : 0.4); }
    else if (k === 1) {
      // tier 3 (G3 c3): the arc's first dots (0.7 <= d < 3.7 along it) form a 3-dot capsule in the band colour mixed 45% to white, full
      // glow; the first and third column keep the band colour at the ring's innermost / outermost dot (rounded ends). 未关联 and arcs
      // shorter than 6 dots at the mid radius: unchanged.
      const q = z as SunTask, d = (a - z.a0) * r;
      const cap = q.task && (z.a1 - z.a0) * rm >= 6 && d >= 0.7 && d < 3.7 && !((d < 1.7 || d >= 2.7) && (r - b0 < 1 || b1 - r < 1));
      L.dot(i, j, cap ? mix(lineColor(q.task), "#ffffff", 0.45) : lineColor(q.task || null), cap ? Math.min(1, fk(hover, q.task)) : 0.85 * fk(hover, q.task), cap ? 1 : hover !== null && q.task === hover ? 0.9 : 0.6);
    }
    else { const q = z as SunMach; L.dot(i, j, /^win/i.test(q.machine) ? WIN : C.AMBER, (/^win/i.test(q.machine) ? 0.7 : 0.4) * (hover !== null && hover !== q.task ? 0.3 : 1), 0.4); }
  }
  L.text(String(Math.round(sb.total / 60)), cx, cy - 10, "center", 1, C.AMBER, 8, 2);
  L.text("h", cx, cy + 8, "center", 0.5, C.AMBER);
  x.restore();
  return { cx: g.offX + cx * P + P / 2, cy: g.offY + cy * P + P / 2, R: R * P };
}

export function drawSunOmote(x: CanvasRenderingContext2D, sb: Sunburst, hover: string | null, g: { w: number; h: number }, font: (weight: number) => string, label: string): SunGeom {
  x.clearRect(0, 0, g.w, g.h);
  const cx = g.w / 2, cy = g.h / 2, R = Math.min(g.w, g.h) / 2 - 4 * U;
  sb.rings.forEach((ring, k) => (ring as (SunReq | SunTask | SunMach)[]).forEach((z) => {
    const r0 = BANDS[k][0] * R, r1 = BANDS[k][1] * R, a0 = z.a0 - Math.PI / 2, a1 = Math.max(a0, z.a1 - Math.PI / 2 - 0.004);
    x.beginPath(); x.arc(cx, cy, r1, a0, a1); x.arc(cx, cy, r0, a1, a0, true); x.closePath();
    x.fillStyle = k === 0 ? ((z as SunReq).ri % 2 ? "#5b6573" : "#0f1c2e")
      : k === 1 ? inkOf(lineColor((z as SunTask).task || null)) : inkOf(/^win/i.test((z as SunMach).machine) ? WIN : C.AMBER);   // the legend's amber Mac / blue Win11 (P3)
    const task = k === 1 ? (z as SunTask).task : "", al = k && hover !== null && hover !== (z as SunTask).task ? 0.3 : 1;
    x.globalAlpha = al;
    x.fill();
    x.globalAlpha = 1;
    if (task && r1 * (a1 - a0) >= 6) {                // tier 3 (G3 c3): a 1.75 px bright outer edge, clipped to the arc; 未关联: none
      x.save(); x.clip(); x.beginPath(); x.arc(cx, cy, r1 - 0.875, a0, a1); x.globalAlpha = al;
      x.strokeStyle = mix(inkOf(lineColor(task)), "#ffffff", 0.55); x.lineWidth = 1.75; x.stroke(); x.restore();
    }
  }));
  x.font = font(600).replace("11px", "22px"); x.textAlign = "center"; x.textBaseline = "alphabetic"; x.fillStyle = "#0b1626";
  x.fillText(label, cx, cy + 8);
  return { cx, cy, R };
}
