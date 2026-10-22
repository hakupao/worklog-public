import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../api/client";
import type { PolishEntity, PolishMeta } from "../api/types";
import { toast } from "../components/Toast";
import { t } from "../i18n/t";
import { useV2 } from "./context";

/** After 还原 / 恢复润色 the server redoes the field in the background (one model call, seconds): refetch at each of these delays (ms after the click). The timers deliberately outlive the component: the QueryClient is app-wide. */
export const POLISH_REFETCH_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000];
export const overridePolishId = (week: string, sheet: string, row_key: string, column: string) =>
  [week, "weekly", sheet, row_key, column].join("\u001f");
export const digestPolishId = (week: string, day: string) => `${week}\u001f${day}`;

/** 「润」 after a polished field (input polish §8): opens the raw text with 还原; a restored field shows 「原」 with
 *  恢复润色. Nothing without meta. A sibling of the field's editor, never inside its button. */
export function PolishMark({ meta, entity, entityId, field }: {
  meta: PolishMeta | undefined; entity: PolishEntity; entityId: string; field: string;
}) {
  const { lang } = useV2();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timers = useRef<number[]>([]);
  if (!meta) return null;
  const flip = async () => {
    setBusy(true);
    try {
      await api.pinPolish(entity, entityId, field, !meta.pinned);
      setOpen(false);
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = POLISH_REFETCH_SCHEDULE_MS.map((ms) => window.setTimeout(() => { void qc.invalidateQueries(); }, ms));
    } catch {
      toast.error(t(lang, "pm.failed"));
    } finally { setBusy(false); }
  };
  const label = t(lang, meta.pinned ? "pm.raw" : "pm.polished");
  return (
    <span className="pm">
      <button type="button" className={`pm-k${meta.pinned ? " raw" : ""}`} aria-label={label} aria-expanded={open}
        title={label} onClick={() => setOpen((o) => !o)}>{meta.pinned ? "原" : "润"}</button>
      {open && (
        <span className="pm-pop" role="group" aria-label={label}>
          {!meta.pinned && <span className="pm-raw">{t(lang, "pm.rawText", { t: meta.raw })}</span>}
          <button type="button" className="key dim" disabled={busy} onClick={() => void flip()}>
            {t(lang, meta.pinned ? "pm.repolish" : "pm.restore")}
          </button>
        </span>
      )}
    </span>
  );
}
