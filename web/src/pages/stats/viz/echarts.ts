// The only module that imports ECharts (U19, brief assumption 8). EChart loads it with import(), so vite cuts it
// (with zrender) into its own chunk: the main bundle, V2App and the views chunk never carry it. The five chart
// types the 统计 page uses are registered here once, with the components they need (and LabelLayout, for the
// sankey's hideOverlap).
import { BarChart, GraphChart, ParallelChart, PictorialBarChart, SankeyChart } from "echarts/charts";
import { GridComponent, ParallelComponent, PolarComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";

use([SankeyChart, GraphChart, ParallelChart, PictorialBarChart, BarChart,
  PolarComponent, GridComponent, TooltipComponent, ParallelComponent, LabelLayout, CanvasRenderer]);

export { init };
export type { EChartsType } from "echarts/core";
