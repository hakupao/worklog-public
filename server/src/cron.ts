// The Worker's cron entry point (wrangler.jsonc triggers): 2,32 past the hour refreshes the 週報 AI digests of this
// and last report week, every other trigger (*/5) runs the S1 translation sweep.
import type { Env } from "./env";
import { runSweep } from "./i18n/sweep";
import { refreshDigests } from "./report/digests";
import { reportWeekOf } from "./report/week";

export const DIGEST_CRON = "2,32 * * * *";

export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  if (controller.cron === DIGEST_CRON) {
    const now = Date.now(), weeks = [reportWeekOf(now), reportWeekOf(now - 7 * 86_400_000)];
    ctx.waitUntil((async () => {
      for (const w of weeks) {       // one week's failure (e.g. D1) must not skip the other
        try { console.log("[digest]", w, JSON.stringify(await refreshDigests(env, w))); }
        catch (e) { console.error("[digest] failed", w, e); }
      }
    })());
    return;
  }
  ctx.waitUntil(runSweep(env, { cleanup: new Date().getUTCMinutes() < 5 })
    .then((r) => console.log("[i18n] sweep", JSON.stringify(r)), (e) => console.error("[i18n] sweep failed", e)));
}
