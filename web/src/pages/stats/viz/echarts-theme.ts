// The two ECharts themes and fill helpers (U13/U19; lab page-stats-echarts.js registerTheme / dots / fillOf).
// No echarts import: views build their options with these without pulling the ECharts chunk.
import { PITCH } from "../../../led/lattice";
import type { World } from "../../../prefs/types";
import { inkOf as deepen } from "../../../ui/palette";
import { glyphDataUrl, type TaskSil } from "../../../ui/taskGlyph";

/** An ECharts option as the views build it (the chunk's own types stay inside the chunk). */
export type EChartsOptionLike = Record<string, unknown>;

const PX = '"fp12-sc","fp12-jp",monospace';
const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** 里's fill: a lit LED dot on a PITCH tile (an image twice that size drawn at half scale), so any area becomes a dot
 *  field. `color` is #rrggbb. Cached per colour + alpha; without a 2D context (jsdom) the plain rgba colour. */
const PAT = new Map<string, object>();
export function dots(color: string, a = 1): object | string {
  const key = color + a, hit = PAT.get(key);
  if (hit) return hit;
  const [r, g, b] = rgb(color);
  const c = document.createElement("canvas"), S = PITCH * 2;
  c.width = c.height = S;
  const x = c.getContext("2d");
  if (!x) return `rgba(${r},${g},${b},${a})`;
  const up = (v: number) => Math.min(255, v + 60);
  const gr = x.createRadialGradient(PITCH, PITCH, 0, PITCH, PITCH, PITCH);
  gr.addColorStop(0, `rgba(${up(r)},${up(g)},${up(b)},${a})`);
  gr.addColorStop(0.45, `rgba(${r},${g},${b},${a * 0.95})`);
  gr.addColorStop(0.75, `rgba(${r},${g},${b},${a * 0.18})`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, S, S);
  const p = { image: c, repeat: "repeat", scaleX: 0.5, scaleY: 0.5 };
  PAT.set(key, p);
  return p;
}

/** 表 prints amber (the default "content" colour) as ink; a task's line colour is deepened 28% (palette inkOf). */
const AMBER_INK: Record<string, string> = { "#ffad3a": "#0f1c2e", "#ffc46a": "#0f1c2e", "#c98a3a": "#5b6573", "#ffe2b8": "#0b1626", "#fff6e8": "#0b1626" };
const inkOn = (c: string) => AMBER_INK[c] ?? deepen(c);

/** A series fill: 表 ink, 里 the dot pattern. */
export const fillOf = (world: World, c: string, a = 1): object | string => (world === "omote" ? inkOn(c) : dots(c, a));
/** 里's glow on a mark; nothing in 表. */
export const glow = (world: World, c: string, b = 10): { shadowBlur?: number; shadowColor?: string } =>
  (world === "omote" ? {} : { shadowBlur: b, shadowColor: c });
/** Axis label style: the pixel font in 里, the theme's body font in 表. */
export const lab = (world: World): { fontFamily?: string; fontSize?: number } => (world === "omote" ? {} : { fontFamily: PX, fontSize: 12 });

/** Index of the first largest value (> 0); -1 when there is none. */
export function busiest(xs: readonly (number | null)[]): number {
  let at = -1;
  xs.forEach((v, i) => { if (v !== null && v > 0 && (at < 0 || v > xs[at]!)) at = i; });
  return at;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ESC[c]);

/** A tooltip body in the page's tip classes: heading, figure, small line — each plain text, escaped (F1: ECharts
 *  renders the tip as HTML, and a task title can hold `<select>` or `List<String>`). */
export const tipHtml = (h: string, m?: string, s?: string, lead = "") =>
  `<div class="h">${lead}${esc(h)}</div>${m ? `<div class="m">${esc(m)}</div>` : ""}${s ? `<div class="s">${esc(s)}</div>` : ""}`;

/** The S badge as an <img> for a tooltip lead, or "" when the image is not made yet (constraint 8). */
export const tipImg = (url: string | null) => (url ? `<img class="tbimg" src="${esc(url)}" width="51" height="16" alt="">` : "");
/** A task image getter for the tooltips: the badge image url, or null while it is not made. */
export type TipImgFn = (id: string) => string | null;

/** The theme for `init` (里: transparent over the dot field, pixel-font labels, dotted grid, glass tip; 表: paper ink,
 *  hairline grid, the page's body font, read when the chart is built). */
export function themeOf(world: World): EChartsOptionLike {
  if (world === "ura") {
    const axis = {
      axisLine: { lineStyle: { color: "rgba(255,173,58,.28)" } }, axisTick: { show: false },
      axisLabel: { color: "rgba(255,173,58,.5)", fontFamily: PX, fontSize: 12 },
      splitLine: { lineStyle: { color: "rgba(255,236,214,.08)", type: [1, 3] } },
      nameTextStyle: { color: "rgba(255,173,58,.45)", fontFamily: PX, fontSize: 12 },
    };
    return {
      color: ["#ffad3a", "#ffe2b8", "#c98a3a", "#bfe6ff"], backgroundColor: "transparent",
      textStyle: { fontFamily: PX, fontSize: 12, color: "#c99a5a" },
      categoryAxis: axis, valueAxis: axis, logAxis: axis, timeAxis: axis,
      tooltip: {
        backgroundColor: "rgba(14,15,20,.82)", borderWidth: 0, padding: [10, 14], textStyle: { color: "#ffe2b8", fontFamily: PX, fontSize: 12 },
        extraCssText: "border-radius:16px;backdrop-filter:blur(8px) saturate(1.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 18px 40px rgba(0,0,0,.5)",
      },
      graph: { label: { color: "#ffe2b8", fontFamily: PX } },
    };
  }
  const axis = {
    axisLine: { lineStyle: { color: "rgba(15,28,46,.35)" } }, axisTick: { show: false },
    axisLabel: { color: "#5b6573", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(15,28,46,.07)" } }, nameTextStyle: { color: "#5b6573" },
  };
  return {
    color: ["#0f1c2e", "#5b6573", "#97a1ae", "#0e7c86"], backgroundColor: "transparent",
    textStyle: { fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, color: "#5b6573" },
    categoryAxis: axis, valueAxis: axis, logAxis: axis, timeAxis: axis,
    tooltip: {
      backgroundColor: "rgba(255,255,255,.88)", borderWidth: 0, padding: [10, 14], textStyle: { color: "#0f1c2e" },
      extraCssText: "border-radius:16px;backdrop-filter:blur(8px);box-shadow:0 0 0 1px rgba(15,28,46,.08),0 14px 30px rgba(15,28,46,.12)",
    },
  };
}

/** G3 f2: a task label as ECharts rich text — its 14 px silhouette (one rich style per task; rich styles are keyed, not per
 *  node) then the code. Without `sil`, or for 未关联, the plain label. */
export function richTaskLabels(ids: readonly string[], sil: TaskSil | null, code: (id: string) => string) {
  const key = new Map(ids.filter(Boolean).map((t, i) => [t, `g${i}`] as [string, string]));
  const rich: Record<string, object> = { c: { padding: [0, 0, 0, 4] } };
  if (sil) for (const [t, k] of key) rich[k] = { width: 14, height: 14, backgroundColor: { image: glyphDataUrl(sil.of(t), 28) } };
  return { rich: sil ? rich : undefined, text: (t: string) => (sil && t && key.has(t) ? `{${key.get(t)}|}{c|${code(t)}}` : code(t)) };
}
