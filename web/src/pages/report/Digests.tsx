import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ValidationError } from "../../api/client";
import type { DigestOut } from "../../api/types";
import { InlineEdit } from "../../components/InlineEdit";
import { toast } from "../../components/Toast";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { digestPolishId, PolishMark } from "../../ui/PolishMark";
import { Led } from "../../ui/Led";
import { C } from "../../ui/palette";
import { reportWriteError } from "../timeline/SessionDrawer";
import type { ReportWrite } from "./write";

/** After ↻ the server writes the new line in the background (one model call): the preview is re-read once, then. */
export const REGEN_REFETCH_MS = 40_000;

/** A digest save's failure, as EditCell's: the field keeps the draft and says why in the interface language. */
const failed = (lang: Lang) => (err: unknown): never => {
  if (err instanceof ValidationError) throw err;
  reportWriteError(lang, err);
  throw new ValidationError([{ path: "text", message: t(lang, "tl.p.saveFailed") }]);
};

/** A digest line in place: the reused InlineEdit (multiline) while the preview on screen is the address's and the
 *  line exists (a text edit of a missing line is a 404); else just the text. The data text has no `lang` — it is
 *  already in the interface language (S1). */
function Line({ week, day, d, write, empty }: { week: string; day: string; d: DigestOut | null; write: ReportWrite | null; empty: string }) {
  const { lang } = useV2();
  if (!d || !write) return <span className="rp-ed ro">{d?.text || empty}</span>;
  return (
    <>
    <InlineEdit ariaLabel={t(lang, "rp.dg.text")} className="rp-ed" multiline value={d.text}
      display={<>{d.text}{d.edited && day !== "week" && <span className="pen" title={t(lang, "rp.dg.edited")}>✎</span>}</>}
      onSave={async (text) => { await write.digest(week, day, { text }, { rethrow: true }).catch(failed(lang)); }} />
    <PolishMark meta={d.polish?.text} entity="digest" entityId={digestPolishId(week, day === "week" ? "" : day)} field="text" />
    </>
  );
}

/** 本周概要 (S2 Task 6): an LED label (进行中 while the week runs, 已手改 / 待更新 marks) and ↻ over the week's line
 *  as type — the 里 hybrid: label in dots, prose as type. */
export function WeekDigest({ week, d, live, write }: { week: string; d: DigestOut | null; live: boolean; write: ReportWrite | null }) {
  const { lang } = useV2();
  const qc = useQueryClient();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const regen = async () => {
    if (!write) return;
    const r = await write.digest(week, "week", { regenerate: true });
    if (r === undefined) return; // failed: the queue said so
    // DIGESTS_AUTO off (R12): the line is only marked — the next local generation rewrites it, nothing to re-read
    if (r && "auto" in r && r.auto === false) { toast.info(t(lang, "rp.dg.regenMarked")); return; }
    toast.info(t(lang, "rp.dg.regenQueued"));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void qc.invalidateQueries({ queryKey: ["report", week] }); }, REGEN_REFETCH_MS);
  };
  return (
    <div className="rp-dg">
      <div className="hd">
        <Led ui tier={1} fit text={t(lang, "rp.dg.week")} />
        {live && <Led ui tier={2} fit color={C.WARM} text={t(lang, "rp.dg.live")} />}
        {d?.edited && <Led ui tier={3} fit text={t(lang, "rp.dg.edited")} />}
        {d?.stale && <Led ui tier={3} fit text={t(lang, "rp.dg.stale")} />}
        <span className="grow" />
        {write && <button type="button" className="rp-xp" aria-label={t(lang, "rp.dg.regen")} title={t(lang, "rp.dg.regen")} onClick={() => void regen()}>↻</button>}
      </div>
      <div className={`tx${d ? "" : " none"}`}><Line week={week} day="week" d={d} write={write} empty={t(lang, "rp.dg.none")} /></div>
      <div className="one">
        <Led ui tier={2} fit text={t(lang, "rp.dg.oneliner")} />
        {d && write
          ? <><InlineEdit ariaLabel={t(lang, "rp.dg.oneliner")} className="rp-ed" value={d.oneliner ?? ""}
                display={<>{d.oneliner || <span className="none">{t(lang, "rp.dg.onelinerNone")}</span>}{d.oneliner_edited && <span className="pen" title={t(lang, "rp.dg.edited")}>✎</span>}</>}
                onSave={async (v) => {
                  if (Array.from(v.trim()).length > 120) throw new ValidationError([{ path: "oneliner", message: t(lang, "rp.dg.onelinerTooLong") }]);
                  await write.digest(week, "week", { oneliner: v.trim() }, { rethrow: true }).catch(failed(lang));
                }} />
              <PolishMark meta={d.polish?.oneliner} entity="digest" entityId={digestPolishId(week, "")} field="oneliner" /></>
          : <span className="rp-ed ro">{d?.oneliner || <span className="none">{t(lang, "rp.dg.onelinerNone")}</span>}</span>}
      </div>
    </div>
  );
}
