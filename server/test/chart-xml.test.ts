import { describe, expect, it } from "vitest";
import { chartXml, drawingXml, type ChartStyle, type LineSeries } from "../src/report/range/charts/chart-xml";

const ST: ChartStyle = { font: "Yu Gothic", text: "333333", axis: "BFBFBF", grid: "EDEDED", bg: null, titleSize: 11, labelSize: 9 };
const ser = (name: string, col: number, color: string, vals: number[], sheet = "データ"): LineSeries => ({
  name, nameCell: { sheet, col, row: 1 }, cat: { sheet, col: 1, from: 2, to: 1 + vals.length },
  val: { sheet, col, from: 2, to: 1 + vals.length }, cats: vals.map((_, i) => `2026-W${40 + i}`), vals, color,
});

/** Balanced tags (no parser in workerd): every open tag is closed in order. */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (self) continue;
    if (close) { if (stack.pop() !== name) return false; } else stack.push(name);
  }
  return stack.length === 0;
}
/** Each tag's first occurrence comes after the previous one's. */
const inOrder = (xml: string, tags: string[]) => {
  const at = tags.map((t) => xml.indexOf(t));
  expect(at.every((i) => i >= 0), `missing one of ${tags.join(" ")}`).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
};
const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"))].map((m) => m[0]);

describe("chartXml — bar", () => {
  const stacked = chartXml({ kind: "bar", title: "週別", grouping: "stacked", numFmt: "0.0", style: ST,
    bars: [ser("田中", 3, "2F6FB0", [1, 2, 3]), ser("その他", 4, "B5B5B5", [0.5, 0, 1])] });

  it("is a stacked column chart: grouping, overlap 100, one ser per series with idx / order 0..n-1", () => {
    expect(stacked).toContain('<c:barDir val="col"/><c:grouping val="stacked"/>');
    expect(stacked).toContain('<c:overlap val="100"/>');
    expect(blocks(stacked, "c:ser")).toHaveLength(2);
    expect(stacked).toMatch(/<c:ser><c:idx val="0"\/><c:order val="0"\/>[\s\S]*<c:ser><c:idx val="1"\/><c:order val="1"\/>/);
  });

  it("references the data sheet with quoted absolute ranges and carries the cached values", () => {
    expect(stacked).toContain("<c:f>'データ'!$C$1</c:f>");
    expect(stacked).toContain("<c:f>'データ'!$A$2:$A$4</c:f>");
    expect(stacked).toContain("<c:f>'データ'!$C$2:$C$4</c:f>");
    expect(stacked).toContain('<c:numCache><c:formatCode>0.0</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt>');
    expect(stacked).toContain('<c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>2026-W40</c:v></c:pt>');
  });

  it("pairs its category and value axes", () => {
    const [cat] = blocks(stacked, "c:catAx"), [val] = blocks(stacked, "c:valAx");
    expect(cat).toContain('<c:axId val="1001"/>'); expect(cat).toContain('<c:crossAx val="1002"/>');
    expect(val).toContain('<c:axId val="1002"/>'); expect(val).toContain('<c:crossAx val="1001"/>');
  });

  it("keeps CT_ChartSpace / CT_PlotArea / CT_BarSer element order", () => {
    inOrder(stacked, ["<c:date1904", "<c:lang", "<c:roundedCorners", "<c:chart>", "<c:title>", "<c:autoTitleDeleted",
      "<c:plotArea>", "<c:layout/>", "<c:barChart>", "<c:catAx>", "<c:valAx>", "</c:plotArea>", "<c:legend>", "<c:plotVisOnly", "<c:dispBlanksAs", "</c:chart><c:spPr>"]);
    const [s] = blocks(stacked, "c:ser");
    inOrder(s, ["<c:idx", "<c:order", "<c:tx>", "<c:spPr>", "<c:invertIfNegative", "<c:cat>", "<c:val>"]);
    const [bar] = blocks(stacked, "c:barChart");
    inOrder(bar, ["<c:barDir", "<c:grouping", "<c:varyColors", "<c:ser>", "<c:gapWidth", "<c:overlap", "<c:axId"]);
  });

  it("adds a line on a secondary axis: its own deleted category axis, a value axis on the right crossing at max", () => {
    const combo = chartXml({ kind: "bar", title: "案件", grouping: "clustered", numFmt: "0", lineNumFmt: "0", style: ST,
      bars: [ser("新規", 5, "8A8A8A", [1, 0]), ser("完了", 6, "2F6FB0", [0, 2])], lines: [ser("累計完了", 7, "C0504D", [0, 2])] });
    expect(combo).toContain('<c:grouping val="clustered"/>');
    const [line] = blocks(combo, "c:lineChart");
    expect(line).toContain('<c:axId val="1003"/><c:axId val="1004"/>');
    expect(line).toContain('<c:idx val="2"/><c:order val="2"/>');      // idx unique across the chart
    const cats = blocks(combo, "c:catAx"), vals = blocks(combo, "c:valAx");
    expect(cats).toHaveLength(2); expect(vals).toHaveLength(2);
    expect(cats[1]).toContain('<c:axId val="1003"/>'); expect(cats[1]).toContain('<c:delete val="1"/>'); expect(cats[1]).toContain('<c:crossAx val="1004"/>');
    expect(vals[1]).toContain('<c:axPos val="r"/>'); expect(vals[1]).toContain('<c:crosses val="max"/>'); expect(vals[1]).toContain('<c:crossAx val="1003"/>');
    inOrder(combo, ["<c:barChart>", "<c:lineChart>", "<c:catAx>", "<c:valAx>"]);
    const [ls] = blocks(line, "c:ser");
    inOrder(ls, ["<c:idx", "<c:order", "<c:tx>", "<c:spPr>", "<c:marker>", "<c:cat>", "<c:val>", "<c:smooth"]);
  });

  it("rejects a missing, NaN or infinite value instead of writing it into the cache", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      expect(() => chartXml({ kind: "bar", title: "x", grouping: "stacked", numFmt: "0.0", style: ST, bars: [ser("a", 2, "111111", [1, bad])] }))
        .toThrow(/not a finite number/);
    }
  });

  it("rejects a bar chart with no series (Excel repairs an empty plot)", () => {
    expect(() => chartXml({ kind: "bar", title: "x", grouping: "stacked", numFmt: "0.0", style: ST, bars: [] })).toThrow(/no series/);
  });
});

describe("chartXml — doughnut", () => {
  const s = { ...ser("時間", 2, "000000", [5, 3, 1]), cats: ["田中", "鈴木", "その他"] };
  const d = chartXml({ kind: "doughnut", title: "配分", series: s, colors: ["2F6FB0", "7FA7D4", "B5B5B5"], style: ST });
  it("one ser, one dPt per point, a hole, percent labels, no axes", () => {
    expect(blocks(d, "c:ser")).toHaveLength(1);
    expect(blocks(d, "c:dPt")).toHaveLength(3);
    expect(d).toContain('<c:varyColors val="1"/>');
    expect(d).toMatch(/<c:holeSize val="\d+"\/>/);
    expect(d).toContain('<c:showPercent val="1"/>');
    expect(d).not.toContain("<c:catAx>");
    const [ds] = blocks(d, "c:ser");
    inOrder(ds, ["<c:idx", "<c:order", "<c:tx>", "<c:dPt>", "<c:dLbls>", "<c:cat>", "<c:val>"]);
  });
});

describe("escaping and well-formedness", () => {
  it("doubles a quote in a sheet name and escapes XML specials in names and text", () => {
    const x = chartXml({ kind: "bar", title: "R&D <週>", grouping: "stacked", numFmt: "0.0", style: ST, bars: [ser("A&B", 2, "111111", [1], "A'B&C")] });
    expect(x).toContain("<c:f>'A''B&amp;C'!$B$2:$B$2</c:f>");
    expect(x).toContain("<c:v>A&amp;B</c:v>");
    expect(x).toContain("<a:t>R&amp;D &lt;週&gt;</a:t>");
  });

  it("every generated part is well-formed", () => {
    const parts = [
      chartXml({ kind: "bar", title: "t", grouping: "stacked", numFmt: "0.0", style: { ...ST, grid: null, bg: "14171C" }, bars: [ser("a", 2, "111111", [1, 2])] }),
      chartXml({ kind: "bar", title: "t", grouping: "clustered", numFmt: "0", style: ST, bars: [ser("a", 2, "111111", [1])], lines: [ser("b", 3, "222222", [1])] }),
      chartXml({ kind: "doughnut", title: "t", series: ser("a", 2, "111111", [1]), colors: ["111111"], style: ST }),
      drawingXml([{ from: { col: 0, row: 7 }, to: { col: 7, row: 25 } }, { from: { col: 7, row: 7 }, to: { col: 14, row: 25 } }]),
    ];
    for (const p of parts) expect(wellFormed(p)).toBe(true);
  });

  it("drawingXml: one twoCellAnchor per chart, rId1..n in order, 0-based cell anchors", () => {
    const x = drawingXml([{ from: { col: 0, row: 7 }, to: { col: 7, row: 25 } }, { from: { col: 7, row: 7 }, to: { col: 14, row: 25 } }]);
    expect(x.match(/<xdr:twoCellAnchor /g)).toHaveLength(2);
    expect(x).toMatch(/r:id="rId1"[\s\S]*r:id="rId2"/);
    expect(x).toContain("<xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>");
  });
});

describe("chartXml — floating bars (an invisible series under a visible one)", () => {
  const float = chartXml({ kind: "bar", title: "開始・終了", grouping: "stacked", numFmt: "[h]:mm", valMin: 5 / 24, style: ST,
    bars: [{ ...ser("開始", 2, "000000", [0.4, 0]), color: null }, ser("稼働幅", 3, "2F6FB0", [0.3, 0])] });

  it("a null-colour series has no fill and no line; the visible one keeps its colour", () => {
    const [start, width] = blocks(float, "c:ser");
    expect(start).toContain("<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>");
    expect(start).not.toContain("<a:srgbClr");
    expect(width).toContain('<c:spPr><a:solidFill><a:srgbClr val="2F6FB0"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>');
  });

  it("the invisible series has no legend entry; the value axis starts at valMin and shows clock time", () => {
    expect(float).toContain('<c:legend><c:legendPos val="b"/><c:legendEntry><c:idx val="0"/><c:delete val="1"/></c:legendEntry><c:overlay val="0"/>');
    expect(float).toContain(`<c:scaling><c:orientation val="minMax"/><c:min val="${5 / 24}"/></c:scaling>`);
    expect(float).toContain('<c:numFmt formatCode="[h]:mm" sourceLinked="0"/>');
    expect(float).toContain("<c:formatCode>[h]:mm</c:formatCode>");
    expect(wellFormed(float)).toBe(true);
  });

  it("charts without a null series or valMin carry neither (existing charts unchanged)", () => {
    const plain = chartXml({ kind: "bar", title: "t", grouping: "stacked", numFmt: "0.0", style: ST, bars: [ser("a", 2, "111111", [1])] });
    expect(plain).not.toContain("<c:legendEntry>");
    expect(plain).not.toContain("<c:min ");
    expect(plain).toContain('<c:legend><c:legendPos val="b"/><c:overlay val="0"/>');
  });
});

describe("chartXml — value axis scale (valMax, valMajor)", () => {
  it("max before min inside c:scaling, majorUnit right after crossBetween on the primary value axis", () => {
    const x = chartXml({ kind: "bar", title: "t", grouping: "stacked", numFmt: "[h]:mm", valMin: 5 / 24, valMax: 27 / 24, valMajor: 3 / 24, style: ST,
      bars: [{ ...ser("a", 2, "000000", [0.4]), color: null }, ser("b", 3, "2F6FB0", [0.2])] });
    expect(x).toContain(`<c:scaling><c:orientation val="minMax"/><c:max val="${27 / 24}"/><c:min val="${5 / 24}"/></c:scaling>`);
    expect(x).toContain(`<c:crossBetween val="between"/><c:majorUnit val="${3 / 24}"/></c:valAx>`);
    expect(wellFormed(x)).toBe(true);
  });

  it("existing charts are byte-identical to the 8919af7 chart-xml (sha-256 of its output)", async () => {
    const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const specs = [
      chartXml({ kind: "bar", title: "週別", grouping: "stacked", numFmt: "0.0", style: ST, bars: [ser("田中", 3, "2F6FB0", [1, 2, 3]), ser("その他", 4, "B5B5B5", [0.5, 0, 1])] }),
      chartXml({ kind: "bar", title: "件数", grouping: "clustered", numFmt: "0", lineNumFmt: "0", style: ST, bars: [ser("新規", 2, "111111", [1, 2])], lines: [ser("累計", 3, "222222", [1, 3])] }),
      chartXml({ kind: "doughnut", title: "構成", series: ser("h", 2, "111111", [1, 2]), colors: ["111111", "222222"], style: ST }),
    ];
    expect(await Promise.all(specs.map(sha))).toEqual([
      "2c869b25d3bb821ce0928a716abf39e9a9374d20baa5222d40d7e2ff170ebce9",
      "afa4cf31e1e4b3a409fa71fd5bdd2ef6f1f015d4522d2085bf66e6c6a05154c5",
      "f7d6b24b6f457802609e0829cc613336a75b1aeb7e64caeaeb27d0f19720cd46",
    ]);
  });

  it("a line series must have a colour", () => {
    expect(() => chartXml({ kind: "bar", title: "t", grouping: "clustered", numFmt: "0", style: ST, bars: [ser("a", 2, "111111", [1])],
      lines: [{ ...ser("b", 3, "222222", [1]), color: null } as never] })).toThrow(/colour/);
  });
});
