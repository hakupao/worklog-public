// DrawingML chart parts for the range xlsx (spec 2026-10-13 §6): column (stacked / clustered), a line on a secondary
// axis, a doughnut. Knows nothing of the report: input = cell ranges + series + style. Only the conservative element
// subset Excel itself writes, in schema order (CT_ChartSpace, CT_PlotArea, CT_BarSer …), with cached values, so
// Windows and Mac Excel open it without a repair prompt.

export type Ref = { sheet: string; col: number; from: number; to: number };        // 1-based column, inclusive rows
export type CellRef = { sheet: string; col: number; row: number };
/** `color` null = an invisible bar (no fill, no line, no legend entry): the floating base of a stacked range bar. */
export interface Series { name: string; nameCell: CellRef; cat: Ref; val: Ref; cats: string[]; vals: number[]; color: string | null }
/** Colours are "RRGGBB". `grid` null = no gridlines; `bg` null = transparent chart area. */
/** A line is always drawn: it needs a colour. */
export type LineSeries = Series & { color: string };
export interface ChartStyle { font: string; text: string; axis: string; grid: string | null; bg: string | null; titleSize: number; labelSize: number }
export type ChartSpec =
  | { kind: "bar"; title: string; grouping: "stacked" | "clustered"; bars: Series[]; lines?: LineSeries[]; numFmt: string; lineNumFmt?: string;
      valMin?: number; valMax?: number; valMajor?: number; style: ChartStyle }   // val*: the primary value axis' scale (default: Excel's)
  | { kind: "doughnut"; title: string; series: Series; colors: string[]; style: ChartStyle };
/** 0-based column / row of the top-left and bottom-right cells. */
export interface Anchor { from: { col: number; row: number }; to: { col: number; row: number } }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (n: number) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const sheetRef = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;
const rangeF = (r: Ref) => esc(`${sheetRef(r.sheet)}!$${colName(r.col)}$${r.from}:$${colName(r.col)}$${r.to}`);
const cellF = (c: CellRef) => esc(`${sheetRef(c.sheet)}!$${colName(c.col)}$${c.row}`);

const solid = (rgb: string) => `<a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill>`;
const NO_LINE = "<a:ln><a:noFill/></a:ln>";
const runPr = (st: ChartStyle, size: number, bold: boolean, tag: "a:defRPr" | "a:rPr") =>
  `<${tag}${tag === "a:rPr" ? ' lang="ja-JP"' : ""} sz="${Math.round(size * 100)}" b="${bold ? 1 : 0}">${solid(st.text)}<a:latin typeface="${esc(st.font)}"/><a:ea typeface="${esc(st.font)}"/></${tag}>`;
const txPr = (st: ChartStyle, size: number) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${runPr(st, size, false, "a:defRPr")}</a:pPr><a:endParaRPr lang="ja-JP"/></a:p></c:txPr>`;
const title = (text: string, st: ChartStyle) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${runPr(st, st.titleSize, true, "a:defRPr")}</a:pPr><a:r>${runPr(st, st.titleSize, true, "a:rPr")}<a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;

const strCache = (xs: string[]) => `<c:strCache><c:ptCount val="${xs.length}"/>${xs.map((x, i) => `<c:pt idx="${i}"><c:v>${esc(x)}</c:v></c:pt>`).join("")}</c:strCache>`;
const finite = (x: number) => { if (!Number.isFinite(x)) throw new Error(`chart value is not a finite number: ${x}`); return x; };
const numCache = (xs: number[], fmt: string) => `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${xs.length}"/>${xs.map((x, i) => `<c:pt idx="${i}"><c:v>${finite(x)}</c:v></c:pt>`).join("")}</c:numCache>`;
const tx = (s: Series) => `<c:tx><c:strRef><c:f>${cellF(s.nameCell)}</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
const catVal = (s: Series, fmt: string) =>
  `<c:cat><c:strRef><c:f>${rangeF(s.cat)}</c:f>${strCache(s.cats)}</c:strRef></c:cat><c:val><c:numRef><c:f>${rangeF(s.val)}</c:f>${numCache(s.vals, fmt)}</c:numRef></c:val>`;

const barSer = (s: Series, i: number, fmt: string) =>
  `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(s)}<c:spPr>${s.color === null ? "<a:noFill/>" : solid(s.color)}${NO_LINE}</c:spPr><c:invertIfNegative val="0"/>${catVal(s, fmt)}</c:ser>`;
const lineSer = (s: LineSeries, i: number, fmt: string) => {
  if (s.color === null) throw new Error(`line series without a colour: ${s.name}`);   // the type says so; a cast must not slip through
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(s)}<c:spPr><a:ln w="28575" cap="rnd">${solid(s.color)}<a:round/></a:ln></c:spPr>` +
  `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${solid(s.color)}${NO_LINE}</c:spPr></c:marker>${catVal(s, fmt)}<c:smooth val="0"/></c:ser>`;
};

const catAx = (id: number, cross: number, del: boolean, st: ChartStyle) =>
  `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${del ? 1 : 0}"/><c:axPos val="b"/>` +
  `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
  `<c:spPr><a:ln w="9525">${solid(st.axis)}</a:ln></c:spPr>${txPr(st, st.labelSize)}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/>` +
  `<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
const valAx = (id: number, cross: number, pos: "l" | "r", fmt: string, grid: string | null, crosses: "autoZero" | "max", st: ChartStyle, scale: { min?: number; max?: number; major?: number } = {}) =>
  `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>` +
  (scale.max === undefined ? "" : `<c:max val="${finite(scale.max)}"/>`) + (scale.min === undefined ? "" : `<c:min val="${finite(scale.min)}"/>`) + `</c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>` +
  (grid ? `<c:majorGridlines><c:spPr><a:ln w="6350">${solid(grid)}</a:ln></c:spPr></c:majorGridlines>` : "") +
  `<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
  `<c:spPr>${NO_LINE}</c:spPr>${txPr(st, st.labelSize)}<c:crossAx val="${cross}"/><c:crosses val="${crosses}"/><c:crossBetween val="between"/>` +
  (scale.major === undefined ? "" : `<c:majorUnit val="${finite(scale.major)}"/>`) + `</c:valAx>`;

function plot(spec: ChartSpec): string {
  const st = spec.style;
  if (spec.kind === "doughnut") {
    const s = spec.series;
    const dPt = s.vals.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${solid(spec.colors[i % spec.colors.length])}<a:ln w="12700">${solid(st.bg ?? "FFFFFF")}</a:ln></c:spPr></c:dPt>`).join("");
    const dLbls = `<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/>${NO_LINE}</c:spPr>${txPr(st, st.labelSize)}` +
      `<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>`;
    return `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(s)}${dPt}${dLbls}${catVal(s, "0.0")}</c:ser><c:firstSliceAng val="0"/><c:holeSize val="60"/></c:doughnutChart>`;
  }
  if (spec.bars.length === 0) throw new Error("bar chart with no series");
  const stacked = spec.grouping === "stacked";
  const bars = `<c:barChart><c:barDir val="col"/><c:grouping val="${spec.grouping}"/><c:varyColors val="0"/>${spec.bars.map((s, i) => barSer(s, i, spec.numFmt)).join("")}` +
    `<c:gapWidth val="60"/><c:overlap val="${stacked ? 100 : -10}"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>`;
  const lines = spec.lines ?? [], lf = spec.lineNumFmt ?? spec.numFmt;
  const line = lines.length
    ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${lines.map((s, i) => lineSer(s, spec.bars.length + i, lf)).join("")}<c:marker val="1"/><c:axId val="1003"/><c:axId val="1004"/></c:lineChart>`
    : "";
  const axes = catAx(1001, 1002, false, st) + valAx(1002, 1001, "l", spec.numFmt, st.grid, "autoZero", st, { min: spec.valMin, max: spec.valMax, major: spec.valMajor }) +
    (lines.length ? catAx(1003, 1004, true, st) + valAx(1004, 1003, "r", lf, null, "max", st) : "");
  return bars + line + axes;
}

/** Legend entries of the invisible bars, deleted (an empty swatch would read as a series). */
const hidden = (spec: ChartSpec) => (spec.kind === "bar"
  ? spec.bars.map((s, i) => (s.color === null ? `<c:legendEntry><c:idx val="${i}"/><c:delete val="1"/></c:legendEntry>` : "")).join("") : "");

export function chartXml(spec: ChartSpec): string {
  const st = spec.style;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:date1904 val="0"/><c:lang val="ja-JP"/><c:roundedCorners val="0"/>` +
    `<c:chart>${title(spec.title, st)}<c:plotArea><c:layout/>${plot(spec)}<c:spPr><a:noFill/>${NO_LINE}</c:spPr></c:plotArea>` +
    `<c:legend><c:legendPos val="b"/>${hidden(spec)}<c:overlay val="0"/>${txPr(st, st.labelSize)}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr>${st.bg ? solid(st.bg) : "<a:noFill/>"}${NO_LINE}</c:spPr>${txPr(st, st.labelSize)}</c:chartSpace>`;
}

export function drawingXml(anchors: Anchor[]): string {
  const at = (tag: string, p: { col: number; row: number }) =>
    `<xdr:${tag}><xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    anchors.map((a, i) => `<xdr:twoCellAnchor editAs="oneCell">${at("from", a.from)}${at("to", a.to)}` +
      `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
      `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/>` +
      `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join("") +
    `</xdr:wsDr>`;
}
