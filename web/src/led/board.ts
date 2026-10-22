import type { Glyph, LedFx } from "../prefs/types";
import { compose, EMPTY_COMPOSED, type Composed, type Seg } from "./compose";
import type { PixelSize } from "./fonts";
import { FX, fxDuration } from "./fx";
import { lattice, PITCH } from "./lattice";
import { kick, unkick, type Animated } from "./loop";
import { motion, reducedMotion } from "./motion";
import { dpr, sprite } from "./sprite";

export interface BoardOpts {
  pitch?: number; size?: PixelSize; glyph?: Glyph; color?: string; align?: "left" | "right" | "center";
  marquee?: boolean; dim?: number; glow?: number; radius?: number; scale?: number; snap?: boolean;
}
export interface SetOpts { animate?: boolean; fx?: LedFx; fromBlank?: boolean; glyph?: Glyph; color?: string }
export interface Dot { x: number; y: number; c: string; k: number }

const ROLL_MS = 460;
const eo3 = (t: number) => 1 - Math.pow(1 - t, 3);

/** One LED line on one canvas (spec §10.1 led/board.ts). */
export class Board implements Animated {
  readonly cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  pitch: number; size: PixelSize; glyph: Glyph; color: string; align: "left" | "right" | "center";
  marquee: boolean; dim: number; glow: number; radius: number; scale: number; snap: boolean;
  w = 0; h = 0; offX = 0; offY = 0; nx = 0; ny = 0; oy = 0;
  cur: Composed | null = null; prev: Composed | null = null; t = 1; t0 = 0;
  fx: LedFx | null = null;
  rc: DOMRect | null = null; v = 1; gd = 0; O: { x: number; y: number } | null = null;   // page-space timing (scan / ripple)
  pd: { prev: Composed | null; cur: Composed | null; nx: number; A: Dot[]; B: Dot[]; pairs: [Dot | null, Dot | null][] | null } | null = null;
  private sig: string | null = null;
  private scroll = 0; private hold = 0; private last = 0; private started = false; private hovering = false;
  private bg: HTMLCanvasElement | null = null;
  private disposed = false;

  constructor(cv: HTMLCanvasElement, o: BoardOpts = {}) {
    this.cv = cv; this.ctx = cv.getContext("2d");
    this.pitch = o.pitch ?? PITCH; this.size = o.size ?? 10; this.glyph = o.glyph ?? "zh";
    this.color = o.color ?? "#ffad3a"; this.align = o.align ?? "left";
    this.marquee = o.marquee !== false; this.dim = o.dim ?? 0; this.glow = o.glow ?? 1;
    this.radius = o.radius ?? 0.46; this.scale = o.scale ?? 1; this.snap = o.snap ?? true;
    this.resize();
  }

  resize(): void {
    if (this.disposed) return;
    const r = this.cv.getBoundingClientRect(), D = dpr();
    this.w = r.width; this.h = r.height;
    this.cv.width = Math.max(1, Math.round(r.width * D)); this.cv.height = Math.max(1, Math.round(r.height * D));
    this.ctx?.setTransform(D, 0, 0, D, 0, 0);
    Object.assign(this, lattice(r, { x: window.scrollX, y: window.scrollY }, this.pitch, this.snap));
    this.bg = null; this.pd = null;
    this.draw();
  }

  set(v: string | Seg[], o: SetOpts = {}): void {
    if (this.disposed) return;
    const fx: LedFx | null = o.animate === false ? null : (o.fx ?? motion.fx.data);
    const animate = o.animate !== false && fx !== "none" && !reducedMotion();
    if (o.glyph) this.glyph = o.glyph;
    if (o.color) this.color = o.color;
    const segs = typeof v === "string" ? [{ t: v }] : v;
    const sig = JSON.stringify(segs) + this.glyph + this.color;
    if (sig === this.sig && !o.fromBlank) return;
    this.sig = sig;
    this.fx = fx;
    this.geo(fx);
    this.prev = o.fromBlank ? EMPTY_COMPOSED(this.size) : this.cur;
    this.cur = compose(segs, this.size, this.glyph, this.color);
    this.scroll = 0; this.hold = 0; this.started = false; this.pd = null;
    this.t = animate && this.prev ? 0 : 1;
    this.t0 = performance.now();
    this.draw();
    if (this.t < 1 || this.overflows()) kick(this);
  }

  dispose(): void { this.disposed = true; unkick(this); }

  overflows(): boolean { return this.marquee && this.hovering && !!this.cur && this.cur.w * this.scale > this.nx && !reducedMotion(); }

  /** Long text scrolls only while hovered (spec §4.2 motion budget); leaving snaps it back. */
  hover(on: boolean): void {
    if (this.disposed || on === this.hovering) return;
    this.hovering = on; this.scroll = 0; this.last = 0;
    if (on) { this.started = true; this.hold = 600; if (this.overflows()) kick(this); }
    else { this.hold = 0; this.draw(); }
  }

  /** Page-space timing: the sweep and the wave are timed in page coordinates, so the page sees one of each. */
  private geo(fx: LedFx | null) {
    this.rc = this.cv.getBoundingClientRect();
    if (fx === "scan") { this.v = window.innerWidth / 750; this.gd = (this.rc.right + 30) / this.v + 60; }
    if (fx === "ripple") {
      const O = motion.origin ?? { x: -40, y: window.innerHeight / 2 }, r = this.rc;
      this.O = O; this.v = Math.hypot(window.innerWidth, window.innerHeight) / 1000;
      const far = Math.max(...[[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => Math.hypot(x - O.x, y - O.y)));
      this.gd = far / this.v + 160;
    }
  }

  frame(ts: number): boolean {
    if (this.disposed) return false;
    let more = false;
    if (this.t < 1) { this.t = Math.min(1, ((ts - this.t0) * (motion.speed || 1)) / this.duration()); more = true; }
    if (this.overflows() && this.t >= 1) {
      // PIDS-style marquee: hold, crawl left one LED at a time, hold at the end, jump back.
      if (!this.last) this.last = ts;
      const dt = ts - this.last; this.last = ts;
      const span = this.cur!.w * this.scale - this.nx + 2;
      if (this.hold > 0) { this.hold -= dt; if (this.hold <= 0 && this.scroll >= span) { this.scroll = 0; this.hold = 5000; } }
      else { this.scroll = Math.min(span, this.scroll + dt / 55); if (this.scroll >= span) this.hold = 1600; }
      if (this.scroll === 0 && this.hold <= 0 && !this.started) { this.started = true; this.hold = 5000; }
      more = true;
    } else this.last = 0;
    this.draw();
    return more;
  }

  duration(): number { return this.fx && this.fx !== "roll" && FX[this.fx] ? fxDuration(this.fx, this) : ROLL_MS; }

  private background(): HTMLCanvasElement | null {
    const c = document.createElement("canvas"); c.width = this.cv.width; c.height = this.cv.height;
    const x = c.getContext("2d"); if (!x) return null;
    const D = dpr(); x.scale(D, D);
    x.fillStyle = `rgba(255,236,214,${this.dim})`;
    const p = this.pitch, r = p * this.radius * 0.78;
    if (this.dim > 0) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      x.beginPath(); x.arc(this.offX + i * p + p / 2, this.offY + j * p + p / 2, r, 0, 6.2832); x.fill();
    }
    return c;
  }

  private clear() {
    const ctx = this.ctx!;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.bg) this.bg = this.background();
    if (this.bg) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.bg, 0, 0); ctx.restore(); }
  }

  draw(): void {
    if (this.disposed || !this.ctx) return;
    if (this.prev && this.t < 1 && this.fx && this.fx !== "roll" && FX[this.fx]) return this.drawFx();
    this.clear();
    if (!this.cur) return;
    const S = this.scale, oy = Math.floor((this.ny - this.size * S) / 2);
    const place = (bm: Composed, dx: number, dy: number, colShift?: (gx: number) => number) => {
      const bw = bm.w * S, ox = this.align === "right" ? this.nx - bw : this.align === "center" ? Math.floor((this.nx - bw) / 2) : 0;
      for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) {
        const c = bm.col[y * bm.w + x]; if (!c) continue;
        for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
          const gx = ox + x * S + a - dx; if (gx < 0 || gx >= this.nx) continue;
          const gy = oy + y * S + b + dy + (colShift ? colShift(gx) : 0);
          if (gy < 0 || gy >= this.ny) continue;
          this.dot(gx, gy, c);
        }
      }
    };
    if (this.prev && this.t < 1) {
      // roll: each column rolls up, staggered left to right
      const H = this.size * S + 2;
      const shift = (gx: number) => { const lag = (gx / Math.max(1, this.nx)) * 0.45; return Math.round(eo3(Math.max(0, Math.min(1, (this.t - lag) / 0.55))) * H); };
      place(this.prev, 0, 0, (gx) => -shift(gx));
      place(this.cur, 0, H, (gx) => -shift(gx));
    } else place(this.cur, Math.floor(this.scroll), 0);
    this.ctx.globalAlpha = 1;
  }

  dotsOf(bm: Composed | null): Dot[] {
    if (!bm || !bm.w) return [];
    const S = this.scale, oy = Math.floor((this.ny - this.size * S) / 2), bw = bm.w * S;
    const ox = this.align === "right" ? this.nx - bw : this.align === "center" ? Math.floor((this.nx - bw) / 2) : 0, out: Dot[] = [];
    this.oy = oy;
    for (let y = 0; y < bm.h; y++) for (let x = 0; x < bm.w; x++) {
      const c = bm.col[y * bm.w + x]; if (!c) continue;
      for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
        const gx = ox + x * S + a; if (gx < 0 || gx >= this.nx) continue;
        out.push({ x: gx, y: oy + y * S + b, c, k: bm.kc[x] ?? 0 });
      }
    }
    return out;
  }

  /** One LED at lattice cell (x, y): alpha a, radius multiplier rm, glow multiplier g. */
  dot(x: number, y: number, c: string, a = 1, rm = 1, g = 1): void {
    if (!this.ctx || a <= 0.01) return;
    const glow = Math.max(0, this.glow * g + (g > 1 ? (g - 1) * 0.35 : 0));
    const sp = sprite(c, this.pitch * this.radius * (Math.round(rm * 10) / 10), Math.round(glow * 4) / 4);
    if (!sp) return;
    const p = this.pitch;
    this.ctx.globalAlpha = Math.min(1, a);
    this.ctx.drawImage(sp.c, this.offX + x * p + p / 2 - sp.s / 2, this.offY + y * p + p / 2 - sp.s / 2, sp.s, sp.s);
  }

  private drawFx() {
    this.clear();
    if (!this.pd || this.pd.prev !== this.prev || this.pd.cur !== this.cur || this.pd.nx !== this.nx) {
      this.pd = { prev: this.prev, cur: this.cur, nx: this.nx, A: this.dotsOf(this.prev), B: this.dotsOf(this.cur), pairs: null };
    }
    const d = this.duration();
    FX[this.fx!]!(this, this.pd.A, this.pd.B, this.t, this.t * d, d);
    this.ctx!.globalAlpha = 1;
  }
}
