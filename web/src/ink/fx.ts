import { motion, reducedMotion } from "../led/motion";
import type { InkFx } from "../prefs/types";

const EO = "cubic-bezier(.23,1,.32,1)", EI = "cubic-bezier(.55,0,1,.45)", TEAL = "#0e7c86";
const TYPE_KF: Keyframe[] = [{ opacity: 0, color: TEAL }, { opacity: 1, color: TEAL, offset: 0.02 }, { opacity: 1 }];
const D = (ms: number) => ms / (motion.speed || 1);
const canAnimate = () => typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
const target = new WeakMap<HTMLElement, string>();

export function changedMask(oldText: string, newText: string): boolean[] {
  const o = Array.from(oldText);
  return Array.from(newText).map((ch, k) => o[k] !== ch);
}

function chars(root: Element): HTMLSpanElement[] {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes: Text[] = [], out: HTMLSpanElement[] = [];
  while (tw.nextNode()) nodes.push(tw.currentNode as Text);
  for (const n of nodes) {
    const f = document.createDocumentFragment();
    for (const ch of Array.from(n.data)) { const s = document.createElement("span"); s.className = "ch"; s.textContent = ch; f.appendChild(s); out.push(s); }
    n.replaceWith(f);
  }
  return out;
}
function stage(el: HTMLElement, oldHTML: string) {
  const w = document.createElement("span"); w.className = "iw";
  while (el.firstChild) w.appendChild(el.firstChild);
  el.appendChild(w);
  const g = document.createElement("span"); g.className = "iw ink-ghost"; g.setAttribute("aria-hidden", "true"); g.innerHTML = oldHTML;
  el.appendChild(g);
  el.classList.add("swapping");
  return { w, g };
}
function done(el: HTMLElement, html: string, anims: Animation[]) {
  Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => {
    if (target.get(el) === html) { el.innerHTML = html; el.classList.remove("swapping"); }
  });
}
let beamAt = 0;
function beam(dir: "h" | "v", dur: number) {             // one page-wide teal sweep per batch of swaps
  const now = performance.now(); if (now - beamAt < 200) return; beamAt = now;
  const b = document.createElement("div"); b.className = `ink-beam ${dir}`; document.body.appendChild(b);
  const kf = dir === "h" ? [{ transform: "translateX(-4px)" }, { transform: `translateX(${window.innerWidth}px)` }]
    : [{ transform: "translateY(-4px)" }, { transform: `translateY(${window.innerHeight}px)` }];
  b.animate(kf, { duration: dur, easing: "cubic-bezier(.65,0,.35,1)" }).finished.then(() => b.remove(), () => b.remove());
}
const center = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };
const textOf = (html: string) => { const t = document.createElement("span"); t.innerHTML = html; return t.textContent ?? ""; };

export function swap(el: HTMLElement, html: string, trig: "lang" | "data", fx?: InkFx): void {
  const old = target.get(el) ?? el.innerHTML;
  if (old === html) return;
  const eff: InkFx = reducedMotion() || !canAnimate() ? "none" : (fx ?? motion.ofx[trig]);
  if (canAnimate() && typeof el.getAnimations === "function") el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  target.set(el, html);
  el.innerHTML = html; el.classList.remove("swapping");
  if (eff === "none" || !old) return;
  const anims: Animation[] = [];
  if (eff === "fade") {
    anims.push(el.animate([{ opacity: 0, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0)" }], { duration: D(320), easing: EO }));
  } else if (eff === "slide") {
    const { w, g } = stage(el, old);
    anims.push(w.animate([{ transform: "translateY(85%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: D(440), easing: EO }));
    anims.push(g.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-85%)", opacity: 0 }], { duration: D(320), easing: EI, fill: "forwards" }));
  } else if (eff === "roll") {                                // odometer: only the characters that changed roll
    const { w, g } = stage(el, old), nc = chars(w), oc = chars(g), mask = changedMask(textOf(old), textOf(html));
    nc.forEach((c, k) => {
      if (!mask[k]) { if (oc[k]) oc[k].style.visibility = "hidden"; return; }
      anims.push(c.animate([{ transform: "translateY(90%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: D(380), delay: D(k * 22), easing: EO, fill: "backwards" }));
    });
    oc.forEach((c, k) => {
      if (c.style.visibility === "hidden") return;
      anims.push(c.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-90%)", opacity: 0 }], { duration: D(300), delay: D(k * 22), easing: EI, fill: "both" }));
    });
  } else if (eff === "type") {
    const { w, g } = stage(el, old), nc = chars(w);
    anims.push(g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D(120), fill: "forwards" }));
    nc.forEach((c, k) => anims.push(c.animate(TYPE_KF, { duration: D(260), delay: D(90 + k * 26), fill: "backwards" })));
  } else if (eff === "bleed") {
    const { w, g } = stage(el, old);
    anims.push(w.animate([{ filter: "blur(7px)", opacity: 0, letterSpacing: ".22em" }, { filter: "blur(0)", opacity: 1, letterSpacing: "normal" }], { duration: D(560), easing: EO }));
    anims.push(g.animate([{ filter: "blur(0)", opacity: 1 }, { filter: "blur(6px)", opacity: 0 }], { duration: D(260), fill: "forwards" }));
  } else if (eff === "scan") {                                // page-wide sweep: each element is rewritten as the line passes it
    const sweep = D(800), r = el.getBoundingClientRect(), delay = Math.max(0, r.left / window.innerWidth) * sweep, len = Math.max(60, (r.width / window.innerWidth) * sweep);
    const { w, g } = stage(el, old);
    anims.push(w.animate([{ clipPath: "inset(-20% 100% -20% 0)" }, { clipPath: "inset(-20% 0 -20% 0)" }], { duration: len, delay, easing: "linear", fill: "backwards" }));
    anims.push(g.animate([{ clipPath: "inset(-20% 0 -20% 0)" }, { clipPath: "inset(-20% 0 -20% 100%)" }], { duration: len, delay, easing: "linear", fill: "both" }));
    beam("h", sweep);
  } else if (eff === "ripple") {
    const O = motion.origin ?? { x: 0, y: window.innerHeight / 2 }, c = center(el);
    const delay = (Math.hypot(c.x - O.x, c.y - O.y) / Math.hypot(window.innerWidth, window.innerHeight)) * D(800);
    const { w, g } = stage(el, old);
    anims.push(w.animate([{ opacity: 0, transform: "scale(.94)", filter: "blur(3px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: D(380), delay, easing: EO, fill: "backwards" }));
    anims.push(g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D(160), delay, fill: "both" }));
  }
  done(el, html, anims);
}

export function enter(els: Element[], fx?: InkFx, root: HTMLElement = document.body): void {
  const eff: InkFx = reducedMotion() || !canAnimate() ? "none" : (fx ?? motion.ofx.load);
  if (eff === "none") return;
  if (eff === "scan") {
    const d = D(1100);
    root.animate([{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: d, easing: "cubic-bezier(.65,0,.35,1)" });
    if (root === document.body) beam("v", d);
    return;
  }
  if (eff === "fade") { root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D(500), easing: EO }); return; }
  const O = motion.origin ?? { x: 0, y: window.innerHeight / 2 }, diag = Math.hypot(window.innerWidth, window.innerHeight);
  const shown = els.filter((e) => (e as HTMLElement).offsetParent !== null || e.tagName === "CANVAS");
  for (const el of shown) {
    const c = center(el);
    if (eff === "rise") el.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
      { duration: D(480), delay: D((Math.max(0, c.r.top) / window.innerHeight) * 650 + (Math.max(0, c.r.left) / window.innerWidth) * 120), easing: EO, fill: "backwards" });
    else if (eff === "ripple") el.animate([{ opacity: 0, transform: "scale(.94)", filter: "blur(3px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: D(420), delay: D((Math.hypot(c.x - O.x, c.y - O.y) / diag) * 800), easing: EO, fill: "backwards" });
    else if (eff === "type" && el.tagName !== "CANVAS") {
      const h = el as HTMLElement, html = h.innerHTML, base = D((Math.max(0, c.r.top) / window.innerHeight) * 500);
      target.set(h, html);
      const anims = chars(h).map((ch, k) => ch.animate(TYPE_KF, { duration: D(260), delay: base + D(k * 22), fill: "backwards" }));
      done(h, html, anims);
    } else if (eff === "type") el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: D(400), delay: D(300), fill: "backwards" });
  }
}
