// web/src/m/pages/PlanSheet.tsx
import { useState } from "react";
import type { DayPlanItem, DayPlanItemPatch, DayStatus } from "../../api/types";
import { toast } from "../../components/Toast";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { reportWriteError } from "../../pages/writeError";
import { useV2 } from "../../ui/context";
import { Seg } from "../ui/Seg";
import { Sheet } from "../ui/Sheet";
import { PlanGoneError, type PlanActions } from "./planActions";

const OPTS: ["auto" | DayStatus, StrKey][] = [["auto", "m.plan.st.auto"], ["done", "m.plan.st.done"], ["partial", "m.plan.st.partial"], ["none", "m.plan.st.none"]];

/** Edit one day-plan item: text, goal, manual status, delete (two taps). Only changed fields are sent, so an
 *  unchanged text is not re-polished. A failed save keeps the sheet and the draft open. */
export function PlanSheet({ item, act, onClose }: { item: DayPlanItem; act: PlanActions; onClose: () => void }) {
  const { lang } = useV2();
  const [text, setText] = useState(item.text);
  const [detail, setDetail] = useState(item.detail);
  const [ms, setMs] = useState<DayStatus | null>(item.manual_status);
  // A refetch (another device's edit, or the refresh after a 409) moves every field the user has not touched to the
  // server's value, so a save sends only what was really changed here and never reverts an edit made elsewhere.
  const [base, setBase] = useState(item);
  // B8: compare what save() compares (trimmed), so a trailing space alone is not an edit
  if (item.updated_at !== base.updated_at) {
    setBase(item);
    if (text.trim() === base.text) setText(item.text);
    if (detail.trim() === base.detail.trim()) setDetail(item.detail);
    if (ms === base.manual_status) setMs(item.manual_status);
  }
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const v = text.trim();
    if (!v) { toast.error(t(lang, "m.plan.textRequired")); return; }
    const patch: DayPlanItemPatch = {};
    if (v !== item.text) patch.text = v;
    if (detail.trim() !== item.detail.trim()) patch.detail = detail.trim();
    if (ms !== item.manual_status) patch.manual_status = ms;
    if (Object.keys(patch).length === 0) { onClose(); return; }
    setBusy(true);
    try { await act.save(item.id, patch); toast.info(t(lang, "m.plan.saved")); onClose(); }
    catch (err) { if (err instanceof PlanGoneError) toast.error(t(lang, "m.plan.gone")); else reportWriteError(lang, err); }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try { await act.remove(item.id); toast.info(t(lang, "m.plan.deleted")); onClose(); }
    catch (err) { reportWriteError(lang, err); setArmed(false); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={t(lang, "m.plan.edit")} onClose={onClose}>
      <div className="m-field"><label htmlFor="m-pt">{t(lang, "m.plan.text")}</label>
        <input id="m-pt" className="m-input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} /></div>
      <div className="m-field"><label htmlFor="m-pd">{t(lang, "m.plan.detail")}</label>
        <textarea id="m-pd" className="m-input" value={detail} maxLength={1000} onChange={(e) => setDetail(e.target.value)} /></div>
      <div className="m-field"><span className="m-lab">{t(lang, "m.plan.status")}</span>
        <Seg label={t(lang, "m.plan.status")} value={ms ?? "auto"} options={OPTS.map(([v, k]) => [v, t(lang, k)])}
          onChange={(v) => setMs(v === "auto" ? null : v)} />
        {item.ai_status && <p className="m-note">{t(lang, "m.plan.ai", { s: t(lang, `m.plan.st.${item.ai_status}` as StrKey) })}{item.ai_note ? ` · ${item.ai_note}` : ""}</p>}
      </div>
      <div className="m-actions">
        <button type="button" className="m-btn danger" disabled={busy} onClick={() => void del()}>[{t(lang, armed ? "m.plan.deleteConfirm" : "m.plan.delete")}]</button>
        <button type="button" className="m-btn pri" disabled={busy} onClick={() => void save()}>[{t(lang, "m.plan.save")}]</button>
      </div>
    </Sheet>
  );
}
