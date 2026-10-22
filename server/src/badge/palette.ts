// A 案件's line colour on the server (the range xlsx's 案件 charts): copies of web/src/ui/palette-data.ts LINE_PALETTE,
// web/src/ui/palette.ts hashLineColor and inkOf, pinned by web/test/badge-server-parity.test.ts. Colours "#rrggbb".

/** Task line colours; tasks.badge_color indexes it. */
export const LINE_PALETTE = ["#ffc81e", "#25e0c8", "#9be05a", "#ff6a2e", "#35c8ff", "#6e98ff", "#ff4a5a", "#b48cff", "#c8c8a0", "#ff8fc8", "#7fe0ff", "#d0a070"];

/** The registry-blind colour: a stable hash of the id. */
export function hashLineColor(taskId: string): string {
  let h = 0;
  for (const ch of taskId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LINE_PALETTE[h % LINE_PALETTE.length];
}

/** A line colour deepened for paper: mixed 28% toward the ink #0f1c2e. */
export function inkOf(c: string): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map((i) => Math.round(ch(c, i) + (ch("#0f1c2e", i) - ch(c, i)) * 0.28).toString(16).padStart(2, "0")).join("");
}

/** A 案件's colour for paper: its stored badge colour (0..11), else the hash colour; inked. */
export const paperColor = (taskId: string, badgeColor: number | null | undefined): string =>
  inkOf(badgeColor != null && LINE_PALETTE[badgeColor] ? LINE_PALETTE[badgeColor] : hashLineColor(taskId));
