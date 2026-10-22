import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { chartXml, type ChartStyle } from "../src/report/range/charts/chart-xml";
import { injectCharts } from "../src/report/range/charts/inject";

const ST: ChartStyle = { font: "Yu Gothic", text: "333333", axis: "BFBFBF", grid: null, bg: null, titleSize: 11, labelSize: 9 };
const chart = (sheet: string) => chartXml({ kind: "bar", title: "t", grouping: "stacked", numFmt: "0.0", style: ST, bars: [{
  name: "a", nameCell: { sheet, col: 2, row: 1 }, cat: { sheet, col: 1, from: 2, to: 3 }, val: { sheet, col: 2, from: 2, to: 3 },
  cats: ["W1", "W2"], vals: [1, 2], color: "111111" }] });

async function book(names: string[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const n of names) {
    const ws = wb.addWorksheet(n);
    ws.getCell("A1").value = "x";
    ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
}
const text = (z: JSZip, p: string) => z.file(p)!.async("string");

describe("injectCharts", () => {
  it("adds parts, content types and rels Excel needs, and the drawing after pageSetup", async () => {
    const out = await injectCharts(await book(["概要", "データ"]), [{ sheet: "概要", charts: [
      { xml: chart("データ"), anchor: { from: { col: 0, row: 7 }, to: { col: 7, row: 25 } } },
      { xml: chart("データ"), anchor: { from: { col: 7, row: 7 }, to: { col: 14, row: 25 } } },
    ] }]);
    const z = await JSZip.loadAsync(out);
    expect(z.file("xl/charts/chart1.xml")).not.toBeNull();
    expect(z.file("xl/charts/chart2.xml")).not.toBeNull();
    const ct = await text(z, "[Content_Types].xml");
    expect(ct).toContain('<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>');
    expect(ct).toContain('<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>');
    const dRels = await text(z, "xl/drawings/_rels/drawing1.xml.rels");
    expect(dRels).toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"');
    expect(dRels).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"');
    const sRels = await text(z, "xl/worksheets/_rels/sheet1.xml.rels");
    expect(sRels).toMatch(/Id="(rId\d+)" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/drawing" Target="\.\.\/drawings\/drawing1\.xml"/);
    const rid = /Id="(rId\d+)"[^>]*relationships\/drawing"/.exec(sRels)![1];
    const sheet = await text(z, "xl/worksheets/sheet1.xml");
    const i = sheet.indexOf(`<drawing r:id="${rid}"/>`);
    expect(i).toBeGreaterThan(sheet.indexOf("<pageSetup"));
    expect(i).toBeLessThan(sheet.indexOf("</worksheet>"));
    expect(await text(z, "xl/worksheets/sheet2.xml")).not.toContain("<drawing");
    expect(z.file("xl/worksheets/_rels/sheet2.xml.rels")).toBeNull();
  });

  it("compresses the package once: a STORE input comes out DEFLATEd", async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet("a").getCell("A1").value = "x".repeat(5000);
    const stored = new Uint8Array((await wb.xlsx.writeBuffer({ zip: { compression: "STORE" } } as never)) as unknown as Uint8Array);
    const out = await injectCharts(stored, [{ sheet: "a", charts: [{ xml: chart("a"), anchor: { from: { col: 0, row: 2 }, to: { col: 5, row: 12 } } }] }]);
    expect(out.byteLength).toBeLessThan(stored.byteLength / 2);
  });

  it("finds the sheet by its name, quotes and ampersands included", async () => {
    const out = await injectCharts(await book(["a", "R&D 'x' 週"]), [{ sheet: "R&D 'x' 週", charts: [{ xml: chart("a"), anchor: { from: { col: 0, row: 0 }, to: { col: 5, row: 10 } } }] }]);
    const z = await JSZip.loadAsync(out);
    expect(await text(z, "xl/worksheets/sheet2.xml")).toContain("<drawing r:id=");
    expect(await text(z, "xl/worksheets/sheet1.xml")).not.toContain("<drawing");
  });

  it("puts <drawing> among the worksheet's own children, not inside a nested element that has an <extLst>", async () => {
    const z0 = await JSZip.loadAsync(await book(["a"]));
    const s0 = await text(z0, "xl/worksheets/sheet1.xml");
    const cf = '<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>1</formula><extLst><ext uri="{X}"/></extLst></cfRule></conditionalFormatting>';
    z0.file("xl/worksheets/sheet1.xml", s0.replace("</sheetData>", `</sheetData>${cf}`));
    const out = await injectCharts(await z0.generateAsync({ type: "uint8array" }), [{ sheet: "a", charts: [{ xml: chart("a"), anchor: { from: { col: 0, row: 0 }, to: { col: 5, row: 10 } } }] }]);
    const sheet = await text(await JSZip.loadAsync(out), "xl/worksheets/sheet1.xml");
    const i = sheet.indexOf("<drawing r:id=");
    expect(i).toBeGreaterThan(sheet.indexOf("</conditionalFormatting>"));
    expect(i).toBeGreaterThan(sheet.indexOf("<pageSetup"));
    expect(sheet.indexOf("</worksheet>")).toBeGreaterThan(i);
  });

  it("writes file entries only (no directory entries, which Excel never writes)", async () => {
    const out = await injectCharts(await book(["a"]), [{ sheet: "a", charts: [{ xml: chart("a"), anchor: { from: { col: 0, row: 0 }, to: { col: 5, row: 10 } } }] }]);
    const names = Object.keys((await JSZip.loadAsync(out)).files);
    expect(names).toContain("xl/charts/chart1.xml");
    expect(names.filter((n) => n.endsWith("/"))).toEqual([]);
  });

  it("refuses an unknown sheet", async () => {
    await expect(injectCharts(await book(["a"]), [{ sheet: "b", charts: [{ xml: chart("a"), anchor: { from: { col: 0, row: 0 }, to: { col: 1, row: 1 } } }] }]))
      .rejects.toThrow(/no sheet named b/);
  });

  it("keeps the workbook's cells readable (exceljs reads it back)", async () => {
    const out = await injectCharts(await book(["概要"]), [{ sheet: "概要", charts: [{ xml: chart("概要"), anchor: { from: { col: 0, row: 2 }, to: { col: 5, row: 12 } } }] }]);
    const wb = await new ExcelJS.Workbook().xlsx.load(out.slice().buffer as ArrayBuffer);
    expect(wb.getWorksheet("概要")!.getCell("A1").value).toBe("x");
  });
});
