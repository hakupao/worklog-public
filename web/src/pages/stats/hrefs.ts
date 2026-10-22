import { UNLINKED_HREF } from "../../predict/rules";

/** The server's hint links (server/src/dashboard/hints.ts) still name old-UI addresses for weeks and 案件: the
 *  v2 page for each. `#/unlinked` (what the server sent before it named the v2 filter itself) becomes the
 *  timeline's 未关联 filter, which lists the unlinked sessions of every week (longest first) plus this week's
 *  unlinked notes. Anything else, a v2 address included, is returned unchanged. */
export function toV2Href(href: string): string {
  if (href === "#/unlinked") return UNLINKED_HREF;
  const task = /^#\/tasks\/(.+)$/.exec(href);
  if (task) return `#/v2/tasks/${encodeURIComponent(task[1])}`;   // the server writes the id raw
  const week = /^#\/timeline\/(.+)$/.exec(href);
  if (week) return `#/v2/timeline/${week[1]}`;
  return href;
}
