import type { Glyph } from "../prefs/types";
import { bits, type Bitmap } from "./bits";
import type { PixelSize } from "./fonts";

export interface Seg { t: string; color?: string; glyph?: Glyph }
/** A composed line: one colour (or null) per pixel, plus which character each column belongs to. */
export interface Composed { w: number; h: number; col: (string | null)[]; kc: Int16Array; nk: number }
export type BitsFn = (text: string, size: PixelSize, glyph: Glyph) => Bitmap;

export const EMPTY_COMPOSED = (size: number): Composed => ({ w: 0, h: size, col: [], kc: new Int16Array(0), nk: 0 });

export function compose(segs: Seg[], size: PixelSize, glyph: Glyph, color: string, bitsFn: BitsFn = bits): Composed {
  const parts = segs.map((s) => ({ b: bitsFn(s.t, size, s.glyph ?? glyph), color: s.color ?? color }));
  const w = parts.reduce((a, p) => a + p.b.w, 0), h = size;
  const col: (string | null)[] = new Array(w * h).fill(null);
  let x0 = 0;
  for (const p of parts) {
    for (let y = 0; y < h; y++) for (let x = 0; x < p.b.w; x++) if (p.b.on[y * p.b.w + x]) col[y * w + x0 + x] = p.color;
    x0 += p.b.w;
  }
  // Column → character index, so per-character effects (flap) can stagger by character.
  const kc = new Int16Array(w);
  let x = 0, k = 0;
  for (const s of segs) for (const ch of Array.from(s.t)) {
    const cw = bitsFn(ch, size, s.glyph ?? glyph).w;
    for (let i = 0; i < cw && x < w; i++) kc[x++] = k;
    k++;
  }
  return { w, h, col, kc, nk: k };
}

export function segsWidth(segs: Seg[], size: PixelSize, glyph: Glyph, bitsFn: BitsFn = bits): number {
  return segs.reduce((n, s) => n + bitsFn(s.t, size, s.glyph ?? glyph).w, 0);
}

/** Trim from the end until the line plus "…" fits `avail` columns. */
export function clipSegs(segs: Seg[], avail: number, widthOf: (s: Seg[]) => number, ellipsisColor: string): Seg[] {
  if (widthOf(segs) <= avail) return segs;
  const out = segs.map((s) => ({ ...s }));
  const ell = (): Seg => ({ t: "…", color: ellipsisColor, glyph: out[out.length - 1]?.glyph });
  while (out.length && widthOf([...out, ell()]) > avail) {
    const last = out[out.length - 1], ch = Array.from(last.t);
    ch.pop();
    last.t = ch.join("").trimEnd();
    if (!last.t) out.pop();
  }
  return [...out, ell()];
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/** Lines of at most `avail` columns (S2c §1.3): CJK breaks between any two characters, a Latin word stays whole unless
 *  it is wider than a line (then it is cut by characters), "\n" always breaks, a line never starts or ends with a
 *  space. Segment props (colour, glyph) carry over to every piece of the segment. */
export function wrapSegs<T extends { t: string; glyph?: Glyph }>(segs: T[], avail: number, widthOf: (s: T[]) => number): T[][] {
  type Tok = { seg: T; t: string; nl?: boolean };
  const toks: Tok[] = [];
  for (const seg of segs) {
    for (const part of seg.t.split(/(\n)/)) {
      if (part === "\n") { toks.push({ seg, t: "", nl: true }); continue; }
      for (const m of part.matchAll(/[A-Za-z0-9_\-./:@#%+]+\s*|\s+|./gsu)) {
        if (CJK.test(m[0]) && m[0].length > 1) for (const ch of Array.from(m[0])) toks.push({ seg, t: ch });
        else toks.push({ seg, t: m[0] });
      }
    }
  }
  // pieces of one source segment on one line merge back into one segment
  type Piece = { src: T; t: string };
  const lines: Piece[][] = [[]];
  const cur = () => lines[lines.length - 1];
  const asSegs = (l: Piece[]) => l.map((p) => ({ ...p.src, t: p.t }));
  const push = (src: T, t: string) => {
    const line = cur(), last = line[line.length - 1];
    if (last && last.src === src) last.t += t; else line.push({ src, t });
  };
  // a token's trailing space never counts against the line it would end
  const fits = (src: T, t: string) => widthOf([...asSegs(cur()), { ...src, t: t.trimEnd() }]) <= avail;
  for (const tok of toks) {
    if (tok.nl) { lines.push([]); continue; }
    const t = cur().length === 0 ? tok.t.trimStart() : tok.t;
    if (!t) continue;
    if (fits(tok.seg, t)) { push(tok.seg, t); continue; }
    if (cur().length) lines.push([]);
    const word = t.trimStart();
    if (!word) continue;
    if (fits(tok.seg, word)) { push(tok.seg, word); continue; }
    for (const ch of Array.from(word)) {
      if (cur().length && !fits(tok.seg, ch)) lines.push([]);
      if (cur().length === 0 && /\s/.test(ch)) continue;
      push(tok.seg, ch);
    }
  }
  return lines.map((l) => {
    const out = asSegs(l);
    if (out.length) out[out.length - 1].t = out[out.length - 1].t.trimEnd();
    return out.length ? out : [{ ...(segs[0] ?? ({} as T)), t: "" }];
  });
}
