import { daysBetween } from "../predict/dates";

export type Sun = { rise: number; set: number };
export type Period = "dawn" | "day" | "dusk" | "night";

const LAT = 35.68, LNG = 139.76, RAD = Math.PI / 180;

/** Sunrise and sunset in Tokyo, minutes after JST midnight (approximate NOAA formula, good to about a minute). */
export function sunTimes(date: string): Sun {
  const n = daysBetween(`${Number(date.slice(0, 4)) - 1}-12-31`, date);   // day of the year, Jan 1 = 1
  const g = (2 * Math.PI / 365) * (n - 1 + 0.5);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * RAD) / (Math.cos(LAT * RAD) * Math.cos(decl)) - Math.tan(LAT * RAD) * Math.tan(decl)) / RAD;
  return { rise: 720 - 4 * (LNG + ha) - eq + 540, set: 720 - 4 * (LNG - ha) - eq + 540 };
}

export function periodOf(nowMin: number, sun: Sun): Period {
  return nowMin < sun.rise - 30 ? "night" : nowMin < sun.rise + 90 ? "dawn" : nowMin < sun.set - 60 ? "day" : nowMin < sun.set + 40 ? "dusk" : "night";
}
