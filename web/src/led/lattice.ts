/** The page-wide lattice step in CSS px: every 里 dot (text, charts, the unlit field in v2.css) sits on it (user 10/21: 3 → 2). */
export const PITCH = 2;
/** The old 3px lattice, kept as 表's drawing unit and as the canvas sizes both worlds share (user 10/22: 表 unchanged,
 *  heights unchanged — a 里 view with a fixed dot count leaves room until the layout round). Never a 里 dot step. */
export const OMOTE_UNIT = 3;

/** Where a canvas's dots sit. With snap, every dot lies on the one page-wide lattice of `pitch`-sized
 *  cells counted from the document origin, so neighbouring boards line up dot for dot. */
export function lattice(rect: { left: number; top: number; width: number; height: number }, scroll: { x: number; y: number }, pitch: number, snap: boolean) {
  const m = (v: number) => ((v % pitch) + pitch) % pitch;
  const offX = snap ? m(-(rect.left + scroll.x)) : 0, offY = snap ? m(-(rect.top + scroll.y)) : 0;
  const nx = Math.max(0, Math.floor((rect.width - offX) / pitch)), ny = Math.max(0, Math.floor((rect.height - offY) / pitch));
  return { offX, offY, nx, ny };
}
