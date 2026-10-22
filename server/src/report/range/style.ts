// Style constants of the range workbook (spec §5). The G1 pick (素白报告风, 10/13). Colours are "RRGGBB".
import type { ChartStyle } from "./charts/chart-xml";

export interface RangeStyle {
  key: "plain";
  font: string;
  ink: string; muted: string; accent: string; rule: string;
  overviewPaper: string; overviewInk: string; overviewMuted: string;   // the 概要 sheet
  headerFill: string; headerInk: string;
  titleSize: number; kpiSize: number; kpiLabelSize: number; bodySize: number;
  series: string[];          // 6 依頼元, then その他, then 未割当
  newBar: string; doneBar: string; line: string; costBar: string;
  chart: ChartStyle;
}

const FONT = "Yu Gothic";

export const STYLE: RangeStyle = {  // 素白报告风 (G1 pick, 10/13): white, dark grey text, one accent
  key: "plain", font: FONT, ink: "333333", muted: "8A8A8A", accent: "2F6FB0", rule: "D9D9D9",
  overviewPaper: "FFFFFF", overviewInk: "333333", overviewMuted: "8A8A8A", headerFill: "F2F2F2", headerInk: "333333",
  titleSize: 16, kpiSize: 24, kpiLabelSize: 9, bodySize: 10,
  series: ["2F6FB0", "6E9BCF", "A7C3E3", "4C9A8A", "93C2B6", "C9A15A", "BFBFBF", "E3E3E3"],
  newBar: "A7C3E3", doneBar: "2F6FB0", line: "C0504D", costBar: "2F6FB0",
  chart: { font: FONT, text: "595959", axis: "BFBFBF", grid: "EDEDED", bg: null, titleSize: 11, labelSize: 9 },
};
