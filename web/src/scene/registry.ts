import * as pkg from "ascii.rest/pieces";
import * as vendor from "./vendor";
import type { Frame } from "ascii.rest";

/** The plate reaches the sampler and drawers through this lazy chunk only (D11). */
export { sampleFrame } from "./sample";
export { drawScene } from "./draw";

export type Period = "dawn" | "day" | "dusk" | "night";
export type SceneDef = {
  id: string; fig: number; period: Period; cap: { zh: string; ja: string; en: string };
  meta: { cols: number; rows: number; fps: number; palette?: string[]; still?: number }; make: () => Frame;
};

/** The period each scene depicts; the board clock against sunrise/sunset picks the window. */
export const PERIOD: Record<string, Period> = {
  alpineDawn: "dawn", tajDawn: "dawn", mistyForest: "dawn", jalMahal: "dawn", saltFlat: "dawn",
  deepReef: "day", earthrise: "day", jungleFalls: "day", kiteFestival: "day", blackPrism: "day", planetScale: "day", saturnRise: "day",
  kyotoDusk: "dusk", oceanSunset: "dusk", stormPlains: "dusk", varanasiGhats: "dusk", cloudSea: "dusk", lakePichola: "dusk",
  nightHighway: "dusk", greenStorm: "dusk", prismCity: "dusk",
  auroraFjord: "night", desertNight: "night", lanternLake: "night", marineDrive: "night", nightCoast: "night", tokyoRain: "night",
  amerFort: "night", commandCity: "night", edgeOrbit: "night", gangaurGhat: "night", snowTrain: "night", volcanoNight: "night", lavaWall: "night",
};

/** Figure captions for the 表 plate. */
export const CAP: Record<string, SceneDef["cap"]> = {
  alpineDawn: { zh: "阿尔卑斯 · 黎明", ja: "アルプス・夜明け", en: "Alpine dawn" },
  tajDawn: { zh: "泰姬陵 · 晨", ja: "タージ・マハル・朝", en: "Taj at dawn" },
  mistyForest: { zh: "雾林 · 晨", ja: "霧の森・朝", en: "Misty forest" },
  deepReef: { zh: "深礁", ja: "深い礁", en: "Deep reef" },
  earthrise: { zh: "地出", ja: "地球の出", en: "Earthrise" },
  kyotoDusk: { zh: "京都 · 黄昏", ja: "京都・黄昏", en: "Kyoto dusk" },
  oceanSunset: { zh: "海 · 日落", ja: "海・日没", en: "Ocean sunset" },
  stormPlains: { zh: "雷雨平原", ja: "雷雨の平原", en: "Storm plains" },
  varanasiGhats: { zh: "瓦拉纳西 · 暮", ja: "ヴァラナシ・夕", en: "Varanasi ghats" },
  auroraFjord: { zh: "峡湾 · 极光", ja: "フィヨルド・オーロラ", en: "Aurora fjord" },
  desertNight: { zh: "沙漠 · 夜", ja: "砂漠・夜", en: "Desert night" },
  lanternLake: { zh: "灯湖", ja: "灯籠の湖", en: "Lantern lake" },
  marineDrive: { zh: "孟买 · 海滨夜", ja: "ムンバイ・海岸夜", en: "Marine Drive" },
  nightCoast: { zh: "夜岸 · 灯塔", ja: "夜の岸・灯台", en: "Night coast" },
  tokyoRain: { zh: "东京 · 雨", ja: "東京・雨", en: "Tokyo rain" },
  amerFort: { zh: "琥珀堡 · 夜", ja: "アンベール城・夜", en: "Amer Fort" },
  blackPrism: { zh: "黑棱镜", ja: "黒いプリズム", en: "Black prism" },
  cloudSea: { zh: "云海 · 日落", ja: "雲海・日没", en: "Cloud sea" },
  commandCity: { zh: "指令之城", ja: "コマンドの街", en: "Command city" },
  edgeOrbit: { zh: "轨道 · 夜地球", ja: "軌道・夜の地球", en: "Edge orbit" },
  gangaurGhat: { zh: "乌代浦尔 · 夜", ja: "ウダイプール・夜", en: "Gangaur Ghat" },
  greenStorm: { zh: "海上雷暴", ja: "海の雷雨", en: "Green storm" },
  jalMahal: { zh: "水宫 · 日出", ja: "ジャル・マハル・日の出", en: "Jal Mahal" },
  jungleFalls: { zh: "雨林瀑布", ja: "密林の滝", en: "Jungle falls" },
  kiteFestival: { zh: "斋浦尔 · 风筝节", ja: "ジャイプール・凧祭り", en: "Kite festival" },
  lakePichola: { zh: "皮丘拉湖 · 日落", ja: "ピチョーラー湖・日没", en: "Lake Pichola" },
  lavaWall: { zh: "熔岩灯墙", ja: "ラバランプの壁", en: "Lava wall" },
  nightHighway: { zh: "公路 · 黄昏", ja: "ハイウェイ・夕暮れ", en: "Night highway" },
  planetScale: { zh: "暗行星", ja: "暗い惑星", en: "Planet scale" },
  prismCity: { zh: "蓝调之城", ja: "ブルーアワーの街", en: "Prism city" },
  saltFlat: { zh: "盐湖 · 日出", ja: "塩湖・日の出", en: "Salt flat" },
  saturnRise: { zh: "土星升起", ja: "土星の出", en: "Saturn rise" },
  snowTrain: { zh: "雪夜列车", ja: "雪夜の列車", en: "Snow train" },
  volcanoNight: { zh: "火山 · 夜", ja: "火山・夜", en: "Volcano night" },
};

type Piece = { meta: SceneDef["meta"] & { category: string }; default: () => Frame };
let list: SceneDef[] | null = null;

/** The package's scenes that are tagged: an id missing from PERIOD or CAP (a package bump) stays out of rotation until
 *  both tables are filled (D8); the registry test fails meanwhile. */
export function scenes(): SceneDef[] {
  return (list ??= Object.entries({ ...pkg, ...vendor } as unknown as Record<string, Piece>)
    .filter(([id, p]) => p?.meta?.category === "scenes" && id in PERIOD && id in CAP)
    .map(([id, p], i) => ({ id, fig: i + 1, period: PERIOD[id], cap: CAP[id], meta: p.meta, make: p.default })));
}

export const forPeriod = (p: Period): SceneDef[] => scenes().filter((s) => s.period === p);
