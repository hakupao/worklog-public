const svgNS = "http://www.w3.org/2000/svg";
let defs: SVGDefsElement | null = null;
const ids = new WeakMap<HTMLElement, string>();
let n = 0;

export function canRefract(): boolean {
  return !!(window as unknown as { chrome?: unknown }).chrome && typeof CSS !== "undefined" && !!CSS.supports?.("backdrop-filter", "url(#x)");
}
function ensureDefs(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
  (svg as unknown as HTMLElement).style.position = "absolute";
  defs = document.createElementNS(svgNS, "defs") as SVGDefsElement;
  svg.appendChild(defs); document.body.appendChild(svg);
  return defs;
}
/** Displacement map: rounded-rect SDF with a squircle bezel, refracting only within `edge` px of the rim. */
function lensMap(w: number, h: number, rad: number, edge: number): string {
  const k = 0.5, Wm = Math.max(2, Math.round(w * k)), Hm = Math.max(2, Math.round(h * k));
  const c = document.createElement("canvas"); c.width = Wm; c.height = Hm;
  const x = c.getContext("2d"); if (!x) return "";
  const img = x.createImageData(Wm, Hm), d = img.data, hw = w / 2, hh = h / 2;
  rad = Math.min(rad, hw, hh);
  for (let j = 0; j < Hm; j++) for (let i = 0; i < Wm; i++) {
    const px = (i + 0.5) / k - hw, py = (j + 0.5) / k - hh, qx = Math.abs(px) - (hw - rad), qy = Math.abs(py) - (hh - rad);
    const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)), inn = Math.min(Math.max(qx, qy), 0), dist = -(out + inn - rad);
    let nx = 0, ny = 0, sl = 0;
    if (dist >= 0 && dist < edge) {
      const u = 1 - dist / edge, xx = 1 - u;                 // 1 at the rim → 0 at the bezel's inner edge
      // squircle surface y = (1-(1-x)^4)^(1/4): steep at the rim, flat inside
      const slope = Math.pow(1 - Math.pow(1 - xx, 4), -0.75) * Math.pow(1 - xx, 3);
      sl = Math.min(1, slope * 0.9);
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (Math.sign(px) * qx) / l; ny = (Math.sign(py) * qy) / l; }
      else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
    }
    const o = (j * Wm + i) * 4; d[o] = 128 - nx * sl * 127; d[o + 1] = 128 - ny * sl * 127; d[o + 2] = 128; d[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL();
}

export function applyGlass(el: HTMLElement): void {
  if (!canRefract()) return;
  const r = el.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height);
  if (w < 4 || h < 4) return;
  const blur = el.dataset.blur ?? "3";
  const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 20;
  const edge = Number(el.dataset.edge || Math.min(12, Math.min(w, h) * 0.25));
  let id = ids.get(el);
  if (!id) { id = `lg2f${n++}`; ids.set(el, id); }
  let f = document.getElementById(id) as SVGFilterElement | null;
  if (!f) { f = document.createElementNS(svgNS, "filter") as SVGFilterElement; f.id = id; ensureDefs().appendChild(f); }
  const key = `${w}x${h}r${rad}e${edge}`;
  if (f.dataset.key !== key) {
    const map = lensMap(w, h, rad, edge);
    if (!map) return;
    f.dataset.key = key;
    f.setAttribute("x", "0"); f.setAttribute("y", "0"); f.setAttribute("width", String(w)); f.setAttribute("height", String(h));
    f.setAttribute("filterUnits", "userSpaceOnUse"); f.setAttribute("color-interpolation-filters", "sRGB");
    f.innerHTML = `<feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>`
      + `<feDisplacementMap in="SourceGraphic" in2="m" scale="${(edge * 2.4).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/>`;
  }
  const v = `url(#${id}) blur(${blur}px) saturate(165%) brightness(1.08)`;
  el.style.backdropFilter = v;
  (el.style as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter = v;
}

export function refreshGlass(): void { document.querySelectorAll<HTMLElement>(".lg2").forEach(applyGlass); }

/** The rim light pools toward the pointer (--la angle, --ro opacity); see the .lg2::before rule in v2.css. */
export function installGlassPointer(): () => void {
  const move = (e: PointerEvent) => {
    document.querySelectorAll<HTMLElement>(".lg2").forEach((el) => {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      el.style.setProperty("--la", `${((Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90).toFixed(1)}deg`);
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right), dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      el.style.setProperty("--ro", (0.35 + 0.65 * Math.max(0, 1 - Math.hypot(dx, dy) / 260)).toFixed(2));
    });
  };
  let to = 0;
  const resize = () => { clearTimeout(to); to = window.setTimeout(refreshGlass, 120); };
  document.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("resize", resize);
  return () => { document.removeEventListener("pointermove", move); window.removeEventListener("resize", resize); clearTimeout(to); };
}
