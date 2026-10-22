import { flushSync } from "react-dom";
import { cl, eio, lerp } from "../led/ease";
import { pairSlots } from "../led/fx";
import { motion, reducedMotion } from "../led/motion";
import { slots, type Slot } from "../led/registry";
import { dpr, sprite } from "../led/sprite";
import type { World, WorldFx } from "../prefs/types";
import { applyWorld, getWorld } from "./store";

let busy = false;
let persist: (w: World) => void = () => {};
let worldFxSource: () => WorldFx = () => "scan";
export const setWorldPersist = (fn: (w: World) => void) => { persist = fn; };
export const setWorldFxSource = (fn: () => WorldFx) => { worldFxSource = fn; };
export const isWorldBusy = () => busy;
export function __resetWorldForTests() { busy = false; persist = () => {}; worldFxSource = () => "scan"; }

const H = () => document.documentElement;
const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const EASE = "cubic-bezier(.65,0,.35,1)";
const apply = (w: World) => flushSync(() => applyWorld(w));
function ensure(id: string) { if (!document.getElementById(id)) { const d = document.createElement("div"); d.id = id; document.body.appendChild(d); } }

type VT = { ready: Promise<void>; finished: Promise<void> };
async function vt(to: World, kind: "scan" | "flip" | "print") {
  const start = (document as unknown as { startViewTransition?: (cb: () => void) => VT }).startViewTransition;
  ensure("wbeam"); ensure("whead");
  if (typeof start !== "function") { apply(to); return; }
  H().classList.add(`vt-${kind}`);
  const tr = start.call(document, () => apply(to));
  try {
    try { await tr.ready; } catch { return; }
    const sp = motion.speed || 1, vh = window.innerHeight;
    const A = (k: Keyframe[] | PropertyIndexedKeyframes, o: KeyframeAnimationOptions, pe: string) =>
      H().animate(k, { fill: "both", ...o, pseudoElement: pe });
    const NEW = "::view-transition-new(root)", OLD = "::view-transition-old(root)";
    if (kind === "scan") {                               // a teal CT/ultrasound band sweeps down, revealing the new world
      const d = 1500 / sp;
      A({ clipPath: ["inset(0 0 100% 0)", "inset(0 0 0% 0)"] }, { duration: d, easing: EASE }, NEW);
      A({ transform: ["translateY(-4px)", `translateY(${vh}px)`] }, { duration: d, easing: EASE }, "::view-transition-group(wbeam)");
    } else if (kind === "flip") {
      const d = 1150 / sp;
      A({ transform: ["perspective(1800px) rotateY(0deg)", "perspective(1800px) rotateY(90deg) scale(.92)"] }, { duration: d * 0.45, easing: "cubic-bezier(.55,0,1,.45)" }, OLD);
      A({ transform: ["perspective(1800px) rotateY(-90deg) scale(.92)", "perspective(1800px) rotateY(0deg) scale(1)"] }, { duration: d * 0.55, delay: d * 0.45, easing: "cubic-bezier(.34,1.3,.64,1)" }, NEW);
    } else {                                             // print
      const d = 2000 / sp;
      if (to === "omote") {
        A({ clipPath: ["inset(0 0 0% 0)", "inset(0 0 100% 0)"], filter: ["brightness(1)", "brightness(1.5)"] }, { duration: d * 0.38, easing: "cubic-bezier(.3,0,.8,.4)" }, OLD);
        A({ clipPath: ["inset(0 0 100% 0)", "inset(0 0 0% 0)"] }, { duration: d * 0.55, delay: d * 0.45, easing: EASE }, NEW);
        A({ transform: ["translateY(-12px)", `translateY(${vh - 6}px)`], opacity: [1, 1] }, { duration: d * 0.55, delay: d * 0.45, easing: EASE }, "::view-transition-group(whead)");
        A({ opacity: [0, 1, 1, 0] }, { duration: d * 0.57, delay: d * 0.44 }, "::view-transition-new(whead)");
      } else {
        A({ transform: ["translateY(0)", `translateY(${-vh - 30}px)`] }, { duration: d * 0.38, easing: "cubic-bezier(.5,0,.9,.3)" }, OLD);
        A({ clipPath: ["inset(0 0 100% 0)", "inset(0 0 0% 0)"] }, { duration: d * 0.58, delay: d * 0.4, easing: "cubic-bezier(.2,.6,.3,1)" }, NEW);
        A({ opacity: [0, 0.85, 0.1, 0.6, 0.15, 1, 1], offset: [0, 0.06, 0.11, 0.18, 0.24, 0.36, 1] }, { duration: d * 0.58, delay: d * 0.4 }, NEW);
        A({ opacity: [0, 0] }, { duration: d }, "::view-transition-new(whead)");
      }
    }
    try { await tr.finished; } catch { /* a skipped transition still completed the switch */ }
  } finally {
    H().classList.remove(`vt-${kind}`);
  }
}

type P = { x: number; y: number; c: string; a?: number; r?: number; g?: number };
const fontOf = (cs: CSSStyleDeclaration) => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
const hex = (c: string) => { const m = c.match(/\d+(\.\d+)?/g); return m ? "#" + m.slice(0, 3).map((v) => (+v | 0).toString(16).padStart(2, "0")).join("") : c; };
const inView = (r: DOMRect) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;

function collectLED(list: Slot[]): Map<Slot, P[]> {
  return new Map(list.map((s) => {
    const b = s.board;
    if (!b.cur) return [s, []];
    const r = b.cv.getBoundingClientRect(); if (!inView(r)) return [s, []];
    const a = +getComputedStyle(b.cv).opacity || 1, p = b.pitch;
    return [s, b.dotsOf(b.cur).map((d) => ({ x: r.left + b.offX + d.x * p + p / 2, y: r.top + b.offY + d.y * p + p / 2, c: d.c, a, r: p * b.radius, g: b.glow }))
      .filter((d) => d.y > -4 && d.y < window.innerHeight + 4)];
  }));
}

/** Ink glyph samples per slot. Leaves are re-queried on every pass: a font swap relayouts the page
 *  and the twins are re-rendered (spec §6.2, a prototype pitfall). */
async function sampleInk(list: Slot[]): Promise<Map<Slot, P[]>> {
  const leavesNow = () => {
    const leaves: { el: Element; s: Slot; box: HTMLElement }[] = [];
    list.forEach((s) => {
      const { ink } = s;
      if (!ink.isConnected || !inView(ink.getBoundingClientRect())) return;
      const ls = [...ink.querySelectorAll("span")].filter((s) => !s.querySelector("span"));
      (ls.length ? ls : [ink]).forEach((el) => { if (el.textContent?.trim()) leaves.push({ el, s, box: ink }); });
    });
    return leaves;
  };
  await Promise.all(leavesNow().map(({ el }) => document.fonts.load(fontOf(getComputedStyle(el)), el.textContent ?? "").catch(() => undefined)));
  await document.fonts.ready; await raf();
  const W = window.innerWidth, Hh = window.innerHeight, st = 1.7;
  const oc = document.createElement("canvas"); oc.width = W; oc.height = Hh;
  const o = oc.getContext("2d", { willReadFrequently: true }), out = new Map<Slot, P[]>(list.map((s) => [s, []]));
  if (!o) return out;
  for (const { el, s, box } of leavesNow()) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), clip = box.getBoundingClientRect();
    o.clearRect(0, 0, W, Hh); o.font = fontOf(cs); (o as unknown as { letterSpacing: string }).letterSpacing = cs.letterSpacing;
    o.fillStyle = "#000"; o.textBaseline = "alphabetic";
    const m = o.measureText(el.textContent ?? "");
    o.fillText(el.textContent ?? "", r.left, r.top + m.fontBoundingBoxAscent);
    const x0 = Math.max(0, Math.floor(Math.max(r.left, clip.left))), x1 = Math.min(W, Math.ceil(Math.min(r.right, clip.right)));
    const y0 = Math.max(0, Math.floor(r.top)), y1 = Math.min(Hh, Math.ceil(r.bottom) + 2);
    if (x1 <= x0 || y1 <= y0) continue;
    const d = o.getImageData(x0, y0, x1 - x0, y1 - y0).data, ww = x1 - x0, c = hex(cs.color);
    for (let y = 0; y < y1 - y0; y += st) for (let x = 0; x < ww; x += st)
      if (d[((y | 0) * ww + (x | 0)) * 4 + 3] > 110) out.get(s)!.push({ x: x0 + x, y: y0 + y, c });
  }
  return out;
}

async function ink(to: World, org: { x: number; y: number }) {
  const list = slots(), toO = to === "omote", D = dpr();
  const ov = document.createElement("canvas"); ov.id = "wov";
  ov.width = window.innerWidth * D; ov.height = window.innerHeight * D;
  const x = ov.getContext("2d");
  if (!x) { apply(to); return; }
  x.scale(D, D);
  const W = window.innerWidth, Hh = window.innerHeight, maxR = Math.hypot(W, Hh) + 20, PAPER = "#f4f5f7", DARK = "#040506";
  const bg = (u: number) => {       // paper (or dark) opens as a circle from the switch, under the flying dots
    x.globalAlpha = 1;
    if (toO) { x.fillStyle = DARK; x.fillRect(0, 0, W, Hh); x.fillStyle = PAPER; x.beginPath(); x.arc(org.x, org.y, eio(cl((u - 0.02) / 0.42)) * maxR, 0, 6.2832); x.fill(); }
    else { x.fillStyle = PAPER; x.fillRect(0, 0, W, Hh); x.fillStyle = DARK; x.beginPath(); x.arc(org.x, org.y, eio(cl((u - 0.3) / 0.55)) * maxR, 0, 6.2832); x.fill(); }
  };
  try {
  let led: Map<Slot, P[]>, ik: Map<Slot, P[]>;
  if (toO) { led = collectLED(list); bg(0); document.body.appendChild(ov); H().classList.add("inking"); apply("omote"); await raf(); ik = await sampleInk(slots()); }
  else { ik = await sampleInk(list); bg(0); document.body.appendChild(ov); H().classList.add("inking"); apply("ura"); await raf(); await raf(); led = collectLED(slots()); }
  const pr = pairSlots(led, ik);     // by slot: a module hidden in 表 has a board on one side only (spec §6.2)
  const dur = 1900 / (motion.speed || 1), t0 = performance.now();
  let revealed = false;
    await new Promise<void>((done, fail) => {
      const tick = (now: number) => {
        const u = Math.min(1, (now - t0) / dur);
        try {
        if (u >= 0.8 && !revealed) { revealed = true; H().classList.remove("inking"); }
        const fade = 1 - cl((u - 0.8) / 0.2);
        x.clearRect(0, 0, W, Hh);
        x.save(); x.globalAlpha = fade; bg(u); x.restore();
        for (const [L, I] of pr) {
          if (L && I) {
            const v = eio(cl((u - 0.1 - (L.x / W) * 0.22) / 0.6)), k = toO ? v : 1 - v, sw = Math.sin(Math.PI * v);
            const px = toO ? lerp(L.x, I.x, v) : lerp(I.x, L.x, v), py = (toO ? lerp(L.y, I.y, v) : lerp(I.y, L.y, v)) - sw * 6;
            const la = (L.a ?? 1) * (1 - k) * (toO ? fade : 1);
            if (la > 0.01) { const s = sprite(L.c, (L.r ?? 1.2) * lerp(1, 0.55, k), Math.round(((L.g ?? 1) * (1 - k) + sw * 0.8) * 4) / 4); if (s) { x.globalAlpha = la; x.drawImage(s.c, px - s.s / 2, py - s.s / 2, s.s, s.s); } }
            const ia = k * 0.92 * fade; if (ia > 0.01) { x.globalAlpha = ia; x.fillStyle = I.c; x.fillRect(px - 0.7, py - 0.7, 1.4, 1.4); }
          } else if (L) {          // a module hidden in 表: burns out going in, ignites late coming back
            const v = toO ? cl((u - 0.05) / 0.3) : cl((u - 0.55) / 0.25), a = (toO ? 1 - v : v) * (L.a ?? 1);
            if (a > 0.01) { const s = sprite(toO && v < 0.4 ? "#ffe2b0" : L.c, (L.r ?? 1.2) * (1 + (toO ? 0.5 * Math.sin(Math.PI * v) : 0)), toO ? 1 + v : 1); if (s) { x.globalAlpha = a; x.drawImage(s.c, L.x - s.s / 2, L.y - s.s / 2, s.s, s.s); } }
          } else if (I) { const a = (toO ? cl((u - 0.5) / 0.3) : 1 - cl(u / 0.3)) * fade * 0.92; if (a > 0.01) { x.globalAlpha = a; x.fillStyle = I.c; x.fillRect(I.x - 0.7, I.y - 0.7, 1.4, 1.4); } }
        }
        x.globalAlpha = 1;
        } catch (e) { fail(e); return; }
        if (u < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  } finally {
    ov.remove(); H().classList.remove("inking");
  }
}


export async function toggleWorld(origin?: Element | null): Promise<void> {
  if (busy) return;
  busy = true;
  const to: World = getWorld() === "ura" ? "omote" : "ura";
  try {
    const kind = worldFxSource();
    if (reducedMotion()) apply(to);
    else if (kind === "ink") {
      const r = origin?.getBoundingClientRect() ?? { left: window.innerWidth - 60, top: window.innerHeight - 40, width: 0, height: 0 };
      await ink(to, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    } else await vt(to, kind);
  } catch (e) {
    console.error("[world] switch failed", e);     // e.g. no pseudoElement support in animate()
  } finally {
    busy = false;
  }
  // Persist whatever actually happened: a transition that failed after the flip still flipped.
  if (getWorld() === to) persist(to);
}

export function leave(go: () => void): void {
  const el = (document.querySelector(".v2-hall") as HTMLElement | null) ?? document.body;
  if (reducedMotion() || typeof el.animate !== "function") { go(); return; }
  const anim = el.animate([{ opacity: 1, filter: "brightness(1)" }, { opacity: 0, filter: "brightness(1.6)" }],
    { duration: 220 / (motion.speed || 1), fill: "forwards", easing: "ease-in" });
  // Navigate, then drop the held fade a frame later: whatever renders next must not inherit a dark page.
  const done = () => { go(); requestAnimationFrame(() => anim.cancel()); };
  anim.finished.then(done, done);
}
