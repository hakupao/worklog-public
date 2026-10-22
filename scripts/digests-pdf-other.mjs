// R17: the PDF version must keep the 「■ その他」 line. If lines has one and pdf_lines does not, append it
// (and the zh / en line at the same index, only when that array lines up with lines). Mutates j; returns true if it appended.
const OTHER = "■ その他";
export function keepOtherInPdf(j) {
  const k = j.lines.findIndex((l) => String(l).trim().startsWith(OTHER));
  if (k < 0 || j.pdf_lines.some((l) => String(l).trim().startsWith(OTHER))) return false;
  j.pdf_lines.push(j.lines[k]);
  for (const t of [j.zh, j.en]) if (Array.isArray(t?.lines) && Array.isArray(t.pdf_lines) && t.lines.length === j.lines.length) t.pdf_lines.push(t.lines[k]);
  return true;
}
