// Puts chart parts into exceljs's xlsx (exceljs writes no charts): per sheet one drawing part holding its charts, the
// drawing / chart relationships, the <drawing> element in the sheet and the content-type overrides. String surgery on
// exceljs's own output, whose shape is fixed (test/charts-inject.test.ts).
import JSZip from "jszip";
import { drawingXml, type Anchor } from "./chart-xml";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
// CT_Worksheet children that come after <drawing>: it goes before the first one present at worksheet level (a nested
// <extLst>, e.g. inside a cfRule, does not count), else before </worksheet>.
const AFTER_DRAWING = new Set(["legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst"]);

export interface Placement { sheet: string; charts: Array<{ xml: string; anchor: Anchor }> }

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };
const tags = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map((m) => m[0]);
const maxIndex = (zip: JSZip, re: RegExp) => Object.keys(zip.files).reduce((n, f) => { const m = re.exec(f); return m ? Math.max(n, Number(m[1])) : n; }, 0);
const read = (zip: JSZip, path: string) => zip.file(path)!.async("string");

/** Offset of the <drawing> insertion point: walks the tags keeping depth, so only <worksheet>'s own children match. */
function drawingAt(xml: string): number {
  let depth = 0;
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (close) { if (--depth === 0) return m.index; continue; }   // depth 0 again = </worksheet>
    if (depth === 1 && AFTER_DRAWING.has(name)) return m.index;
    if (!self) depth++;
  }
  throw new Error("no </worksheet> in sheet part");
}

async function sheetPath(zip: JSZip, sheet: string): Promise<string> {
  const tag = tags(await read(zip, "xl/workbook.xml"), "sheet").find((t) => attr(t, "name") === sheet);
  if (!tag) throw new Error(`no sheet named ${sheet}`);
  const rel = tags(await read(zip, "xl/_rels/workbook.xml.rels"), "Relationship").find((t) => attr(t, "Id") === attr(tag, "r:id"));
  const target = rel ? attr(rel, "Target") : null;
  if (!target) throw new Error(`no part for sheet ${sheet}`);
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

export async function injectCharts(xlsx: Uint8Array, placements: Placement[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(xlsx);
  let chartN = maxIndex(zip, /^xl\/charts\/chart(\d+)\.xml$/), drawingN = maxIndex(zip, /^xl\/drawings\/drawing(\d+)\.xml$/);
  const overrides: string[] = [];
  for (const p of placements) {
    if (p.charts.length === 0) continue;
    const path = await sheetPath(zip, p.sheet);
    const xml = await read(zip, path);
    if (xml.includes("<drawing ")) throw new Error(`sheet ${p.sheet} already has a drawing`);
    const d = ++drawingN;
    const chartRels = p.charts.map((c, i) => {
      const k = ++chartN;
      zip.file(`xl/charts/chart${k}.xml`, c.xml);
      overrides.push(`<Override PartName="/xl/charts/chart${k}.xml" ContentType="${CT_CHART}"/>`);
      return `<Relationship Id="rId${i + 1}" Type="${REL}/chart" Target="../charts/chart${k}.xml"/>`;
    });
    zip.file(`xl/drawings/drawing${d}.xml`, drawingXml(p.charts.map((c) => c.anchor)));
    zip.file(`xl/drawings/_rels/drawing${d}.xml.rels`, `${RELS}${chartRels.join("")}</Relationships>`);
    overrides.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="${CT_DRAWING}"/>`);
    const relsPath = path.replace(/^(.*)\/([^/]+)$/, "$1/_rels/$2.rels");
    const old = zip.file(relsPath) ? await read(zip, relsPath) : `${RELS}</Relationships>`;
    const rid = `rId${[...old.matchAll(/\sId="rId(\d+)"/g)].reduce((n, m) => Math.max(n, Number(m[1])), 0) + 1}`;
    zip.file(relsPath, old.replace("</Relationships>", `<Relationship Id="${rid}" Type="${REL}/drawing" Target="../drawings/drawing${d}.xml"/></Relationships>`));
    const at = drawingAt(xml);
    zip.file(path, `${xml.slice(0, at)}<drawing r:id="${rid}"/>${xml.slice(at)}`);
  }
  const ct = await read(zip, "[Content_Types].xml");
  zip.file("[Content_Types].xml", ct.replace("</Types>", `${overrides.join("")}</Types>`));
  // Files only, as Excel writes them: drop the directory entries (exceljs's own and those zip.file() adds).
  for (const [name, f] of Object.entries(zip.files)) if (f.dir) delete zip.files[name];
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
