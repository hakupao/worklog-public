import { parseV2Route, readQuery } from "../route";

export type MPage = "now" | "tl" | "tasks" | "plan" | "stats";
export const M_PAGES: MPage[] = ["now", "tl", "tasks", "plan", "stats"];
export type StatsRange = "today" | "week" | "month";
export interface MRoute { page: MPage; param: string | null; unlinked: boolean; range: StatsRange }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isMobileHash = (hash: string) => /^#\/m(\/|\?|$)/.test(hash);

/** A real calendar day "YYYY-MM-DD" (2026-02-30 is not). */
export function isDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const decode = (s: string): string | null => { try { return decodeURIComponent(s); } catch { return null; } };

/** `#/m/<page>[/<param>][?query]`. Anything unknown or malformed falls back (now / no param / week); never throws. */
export function parseMRoute(hash: string): MRoute {
  const [path, query = ""] = hash.replace(/^#\/m\/?/, "").split("?");
  const [head, raw] = path.split("/");
  const page = (M_PAGES as string[]).includes(head) ? (head as MPage) : "now";
  let param = page === head && raw ? decode(raw) : null;
  if ((page === "tl" || page === "plan") && param !== null && !isDate(param)) param = null;
  if (page === "now" || page === "stats" || param === "") param = null;
  const q = new URLSearchParams(query), r = q.get("range");
  return { page, param, unlinked: page === "tl" && q.get("un") === "1", range: r === "today" || r === "month" ? r : "week" };
}

export function mHref(page: MPage, param?: string | null, query?: Record<string, string>): string {
  const p = param ? `/${encodeURIComponent(param)}` : "";
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : "";
  return `#/m/${page}${p}${qs}`;
}

const FROM_V2: Record<string, MPage> = { now: "now", timeline: "tl", tasks: "tasks", plan: "plan", stats: "stats" };
const TO_V2: Record<MPage, string> = { now: "now", tl: "timeline", tasks: "tasks", plan: "plan", stats: "stats" };

/** The phone page for a desktop address (v2 or the old UI). */
export function mobileTarget(hash: string): string {
  if (/^#\/v2(\/|\?|$)/.test(hash)) {
    const { page, param } = parseV2Route(hash);
    const m = FROM_V2[page] ?? "now";
    const keep = m === "tasks" ? param : (m === "plan" || m === "tl") && param && isDate(param) ? param : null;
    const un = m === "tl" && readQuery(hash).get("unlinked") === "1";
    return mHref(m, keep, un ? { un: "1" } : undefined);
  }
  const [head, raw] = hash.replace(/^#\/?/, "").split("?")[0].split("/");
  const param = raw ? decode(raw) : null;
  if (head === "tasks") return mHref("tasks", param);
  if (head === "plan") return mHref("plan", param && isDate(param) ? param : null);
  if (head === "unlinked") return mHref("tl", null, { un: "1" });
  if (head === "timeline") return mHref("tl");
  return mHref("now");
}

export const desktopHref = (page: MPage) => `#/v2/${TO_V2[page]}`;

export const NARROW = "(max-width: 700px)";
export const isNarrow = () => typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;

const OPT_KEY = "wl-mobile";
/** The choice made on this page load; it wins over storage, so blocked storage cannot cause a redirect loop. */
let chosen: boolean | null = null;
export function mobileOptedOut(): boolean {
  if (chosen !== null) return chosen;
  try { return localStorage.getItem(OPT_KEY) === "off"; } catch { return false; }
}
export function setMobileOptOut(off: boolean): void {
  chosen = off;
  try { if (off) localStorage.setItem(OPT_KEY, "off"); else localStorage.removeItem(OPT_KEY); } catch { /* storage blocked: `chosen` keeps it for this page */ }
}
export function __resetMobileOptOutForTests(): void { chosen = null; }

export const shouldRedirect = (hash: string, narrow: boolean, optedOut: boolean) => narrow && !optedOut && !isMobileHash(hash);
