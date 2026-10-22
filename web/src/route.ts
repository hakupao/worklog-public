export type V2Page = "now" | "timeline" | "tasks" | "plan" | "report" | "stats" | "usage" | "settings";
export const V2_PAGES: V2Page[] = ["now", "timeline", "tasks", "plan", "report", "stats", "usage", "settings"];
export const v2Href = (page: V2Page) => `#/v2/${page}`;

export const isV2Hash = (hash: string) => /^#\/v2(\/|\?|$)/.test(hash);

export function parseV2Route(hash: string): { page: V2Page; param: string | null } {
  const path = hash.replace(/^#\/v2\/?/, "").split("?")[0];
  const [head, param] = path.split("/");
  const page = (V2_PAGES as string[]).includes(head) ? (head as V2Page) : "now";
  let p: string | null = null;
  // a hand-typed or truncated address ("%E0") must fall back like any other bad param, not throw in render
  if (page === head && param) { try { p = decodeURIComponent(param); } catch { p = null; } }
  return { page, param: p };
}

/** Where an address of the removed old UI lands (bookmarks exist): its v2 page with the same path param and query
 *  (`?status=` on tasks, `?sheet=` on report read the same keys). The old 首页 #/dashboard is 统计, #/unlinked is the
 *  timeline's 未关联 filter (UNLINKED_HREF, not imported: it would pull the predict rules into the main chunk), the
 *  report's template segment is dropped (one template now), anything else is the home. */
export function legacyHref(hash: string): string {
  const [path, query] = splitHash(hash.replace(/^#\/?/, ""));
  const [head, param] = path.split("/");
  if (head === "unlinked") return "#/v2/timeline?unlinked=1";
  if (head === "dashboard") return v2Href("stats");
  if (!["timeline", "tasks", "report", "plan", "usage"].includes(head)) return v2Href("now");
  return `${v2Href(head as V2Page)}${param ? `/${param}` : ""}${query ? `?${query}` : ""}`;
}

/** The hash split at its first "?": the route path and the query string after it. */
export const splitHash = (hash: string): [string, string] => {
  const i = hash.indexOf("?");
  return i < 0 ? [hash, ""] : [hash.slice(0, i), hash.slice(i + 1)];
};
export const readQuery = (hash: string) => new URLSearchParams(splitHash(hash)[1]);
/** The hash with some query keys set (string) or removed (null); `path` replaces the route path. Other keys stay. */
export function withQuery(hash: string, patch: Record<string, string | null>, path?: string): string {
  const [p, query] = splitHash(hash), q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(patch)) if (v === null) q.delete(k); else q.set(k, v);
  const s = q.toString();
  return s ? `${path ?? p}?${s}` : path ?? p;
}
/** replaceState adds no history entry and fires no hashchange, so announce it for useSyncExternalStore. */
export function replaceHash(h: string): void {
  window.history.replaceState(null, "", h || window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
