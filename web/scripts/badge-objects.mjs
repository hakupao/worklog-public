// Writes src/badge/objects.gen.ts: the badge object silhouettes, keyed "<source>:<name>", from two MIT libraries
// (see src/badge/NOTICE.md). Run after changing a list: `npm run badge:objects`. Needs only node_modules.
//  - phosphor: @phosphor-icons/core fill SVGs, drawn in the 256 box already — copied as is (all path-only).
//  - fluent: @iconify-json/fluent-emoji-high-contrast (32-unit box). Each body is flattened to ONE path (circle /
//    ellipse / rect and <g transform> become path data), then scaled so its longer side is 224 units and centred in
//    the 256 box (Phosphor's 16-unit margin). Fill rule = the source's fill-rule attribute (evenodd if any part says
//    so); on 2026-10-14 this matched the rasterised check for all 114.
//    FLUENT lists the glyphs that passed the G0 tuning prototype's checks on 2026-10-14: flattened path vs the
//    original rasterised IoU >= 0.95, and ink lost to a radius-3 opening at 128px <= 0.3 (no stroke thinner than
//    ~1.2px at 18px). Those checks need headless Chrome and are NOT re-run here; a name added later must be judged
//    by eye at 18px on a v2 page.
// Fails on a missing icon or anything one filled path cannot hold (stroke, mask, clip-path, gradient, style, ...).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { svgPathBbox } from "svg-path-bbox";
import svgpath from "svgpath";

const require = createRequire(import.meta.url);

export const PHOSPHOR = [
  // animals & characters
  "cat", "dog", "bird", "fish", "butterfly", "rabbit", "horse", "cow", "bug-beetle", "shrimp", "alien", "ghost", "robot",
  // vehicles
  "airplane", "rocket", "car", "bicycle", "boat", "sailboat", "train", "tram", "bus", "motorcycle", "scooter", "tractor", "truck", "van", "jeep",
  // nature & food
  "tree", "tree-palm", "tree-evergreen", "cactus", "flower", "flower-lotus", "flower-tulip", "leaf", "acorn", "carrot", "cherries", "avocado",
  "pepper", "orange", "ice-cream", "pizza", "hamburger", "cake", "cookie", "coffee", "egg", "bread", "popcorn",
  // things
  "anchor", "crown", "key", "guitar", "umbrella", "lighthouse", "campfire", "tent", "balloon", "camera", "headphones", "lightbulb", "hourglass",
  "compass", "planet", "bell", "gift", "trophy", "magnet", "flask", "sneaker", "t-shirt", "dress", "eyeglasses", "scissors", "puzzle-piece",
  "lego", "basketball", "soccer-ball", "dice-five", "diamond", "lamp",
];

// Order = the prototype's cutest-first order (faces, animals, food, vehicles, things).
export const FLUENT = [
  "hamster", "panda", "koala", "frog", "penguin", "owl", "bear", "pig-face", "rabbit-face", "mouse-face", "cat-face", "dog-face", "fox",
  "tiger-face", "lion", "monkey-face", "cow-face", "unicorn", "dragon-face", "snail", "whale", "octopus", "duck", "hatching-chick",
  "front-facing-baby-chick", "hedgehog", "sloth", "crab", "jellyfish", "blowfish", "honeybee", "lady-beetle", "t-rex", "sauropod", "kangaroo",
  "bat", "ghost", "alien-monster", "robot", "teddy-bear", "cupcake", "ice-cream", "doughnut", "bubble-tea", "teapot", "lollipop", "sushi",
  "pineapple", "watermelon", "strawberry", "cherries", "mushroom", "rocket", "flying-saucer", "taxi", "fire-engine", "tent", "castle", "snowman",
  "jack-o-lantern", "pig", "rabbit", "horse-face", "spouting-whale", "dolphin", "baby-chick", "raccoon", "skunk", "flamingo", "turtle",
  "lobster", "shrimp", "tropical-fish", "dragon", "zebra", "llama", "soft-ice-cream", "cookie", "pancakes", "waffle", "bagel", "taco",
  "burrito", "fortune-cookie", "pie", "candy", "popcorn", "avocado", "peach", "lemon", "tomato", "carrot", "eggplant", "hamburger", "pizza",
  "egg", "helicopter", "sailboat", "canoe", "tractor", "motor-scooter", "ambulance", "auto-rickshaw", "kite", "yo-yo", "puzzle-piece",
  "nesting-dolls", "crystal-ball", "magic-wand", "cactus", "sunflower", "tulip", "cat", "dog",
];

const attr = (s, k) => { const m = new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(s); return m ? m[1] : null; };
const num = (v) => (v == null ? 0 : parseFloat(v));
function shapeD(tag, a) {
  if (tag === "path") return attr(a, "d");
  if (tag === "circle") { const cx = num(attr(a, "cx")), cy = num(attr(a, "cy")), r = num(attr(a, "r")); return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`; }
  if (tag === "ellipse") { const cx = num(attr(a, "cx")), cy = num(attr(a, "cy")), rx = num(attr(a, "rx")), ry = num(attr(a, "ry")); return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`; }
  if (tag === "rect") {
    const x = num(attr(a, "x")), y = num(attr(a, "y")), w = num(attr(a, "width")), h = num(attr(a, "height"));
    let rx = attr(a, "rx"), ry = attr(a, "ry");
    rx = rx == null ? (ry == null ? 0 : num(ry)) : num(rx); ry = ry == null ? rx : num(ry);
    rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    if (!rx) return `M${x} ${y}h${w}v${h}h${-w}Z`;
    return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
  }
  return null;
}
/** An iconify body → one absolute path + fill rule, or { err } for anything a single filled path cannot hold. */
function flatten(body) {
  const stack = [{ tf: [], fill: "currentColor", fr: null }];
  let out = "", evenodd = false;
  for (const m of body.matchAll(/<(\/?)([\w:-]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, a, self] = m;
    if (close) { if ((tag === "g" || tag === "svg") && stack.length > 1) stack.pop(); continue; }
    if (["mask", "clipPath", "defs", "use", "linearGradient", "radialGradient", "image", "text", "line", "polyline"].includes(tag)) return { err: tag };
    const top = stack[stack.length - 1];
    if (attr(a, "stroke") && attr(a, "stroke") !== "none") return { err: "stroke" };
    if (/(?:^|\s)stroke-[\w-]+=/.test(a)) return { err: "stroke-attr" };
    if (attr(a, "mask") || attr(a, "clip-path") || attr(a, "style") || attr(a, "opacity") || attr(a, "fill-opacity")) return { err: "attr" };
    const fill = attr(a, "fill") ?? top.fill, fr = attr(a, "fill-rule") ?? top.fr;
    const tf = attr(a, "transform") ? [attr(a, "transform"), ...top.tf] : top.tf;
    if (tag === "g" || tag === "svg") { if (!self) stack.push({ tf, fill, fr }); continue; }
    const d = shapeD(tag, a);
    if (d == null) return { err: "tag:" + tag };
    if (fill === "none") continue;
    if (fill !== "currentColor" && !/^#0{3,6}$/.test(fill) && fill !== "black") return { err: "fill:" + fill };
    let p = svgpath(d);
    for (const t of tf) p = p.transform(t);
    out += p.abs().toString();
    if (fr === "evenodd") evenodd = true;
  }
  return out ? { d: out, evenodd } : { err: "empty" };
}
/** Longer side → 224 units, centred on (128, 128), one decimal. */
function normalise(d) {
  const [x0, y0, x1, y1] = svgPathBbox(d), s = 224 / Math.max(x1 - x0, y1 - y0);
  return svgpath(d).translate(-(x0 + x1) / 2, -(y0 + y1) / 2).scale(s).translate(128, 128).round(1).toString();
}

// Parse culled.ts first, so a bad culled.ts leaves both generated files untouched.
const culledSrc = readFileSync(new URL("../src/badge/culled.ts", import.meta.url), "utf8");
const culledLit = /CULLED:\s*readonly string\[\]\s*=\s*(\[[\s\S]*?\]);/.exec(culledSrc);
if (!culledLit) throw new Error("culled.ts: CULLED array literal not found");
let culledList;
try { culledList = JSON.parse(culledLit[1]); }
catch { throw new Error("culled.ts: CULLED must be a strict JSON array of double-quoted names (no trailing comma)"); }
const out = {};
const phosphorDir = new URL("../node_modules/@phosphor-icons/core/assets/fill/", import.meta.url);
for (const n of PHOSPHOR) {
  const svg = readFileSync(new URL(`${n}-fill.svg`, phosphorDir), "utf8");
  if (/<(rect|circle|ellipse|polygon|polyline|line|g)\b/.test(svg)) throw new Error(`phosphor:${n}: not path-only`);
  const ds = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) throw new Error(`phosphor:${n}: no path`);
  out[`phosphor:${n}`] = { d: ds.join(" ") };
}
const fluent = require("@iconify-json/fluent-emoji-high-contrast/icons.json");
for (const n of FLUENT) {
  const ic = fluent.icons[n] ?? fluent.icons[fluent.aliases?.[n]?.parent];
  if (!ic) throw new Error(`fluent:${n}: missing`);
  const fl = flatten(ic.body);
  if (fl.err) throw new Error(`fluent:${n}: ${fl.err}`);
  out[`fluent:${n}`] = fl.evenodd ? { d: normalise(fl.d), evenodd: true } : { d: normalise(fl.d) };
}
writeFileSync(new URL("../src/badge/objects.gen.ts", import.meta.url),
  "// GENERATED by scripts/badge-objects.mjs from @phosphor-icons/core 2.1.1 and @iconify-json/fluent-emoji-high-contrast\n" +
  "// 1.2.6 (both MIT, see NOTICE.md). Do not edit. Paths are in the 256-unit box; evenodd = fill with the even-odd rule.\n" +
  `export const OBJECTS: Record<string, { d: string; evenodd?: true }> = ${JSON.stringify(out, null, 1)};\n`);
const eo = Object.keys(out).filter((k) => out[k].evenodd);
console.log(`wrote ${Object.keys(out).length} objects (phosphor ${PHOSPHOR.length}, fluent ${FLUENT.length}; evenodd: ${eo.join(" ")})`);
// The server's copy of the listed names (B1 allocation): generated names minus culled.ts. The server cannot import
// objects.gen.ts (239 KB of paths); web/test/badge-server-parity.test.ts fails when this file is stale.
const culled = new Set(culledList);
const names = Object.keys(out).filter((n) => !culled.has(n));
writeFileSync(new URL("../../server/src/badge/names.gen.ts", import.meta.url),
  "// GENERATED by web/scripts/badge-objects.mjs: web/src/badge BADGE_OBJECTS (generated minus CULLED). Do not edit;\n" +
  "// re-run `node web/scripts/badge-objects.mjs` after changing culled.ts.\n" +
  `export const BADGE_OBJECT_NAMES: readonly string[] = ${JSON.stringify(names, null, 1)};\n`);
console.log(`wrote ${names.length} server badge names (${culled.size} culled)`);
