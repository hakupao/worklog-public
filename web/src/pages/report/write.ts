import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { api, ApiError, ValidationError } from "../../api/client";
import { findReportCell, keys, rollbackReportCell, updateReportCell } from "../../api/queries";
import type { DigestOut, DigestPatchOut, GridCell, ReportPreview, SheetKey } from "../../api/types";
import { toast } from "../../components/Toast";
import { autoText } from "./ReportCell";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { reportWriteError } from "../timeline/SessionDrawer";

/** One cell of one week's report. The week travels with the target (not with the hook): a write queued
 *  by a drawer that closes because the week changed still goes to the week it was typed in. */
export interface CellRef {
  week: string; sheet: SheetKey; row_key: string; column: string;
  /** The days sheet's day (preflight R1): the row to read, update and roll back when a row_key is on two days. */
  date?: string;
}

/** What a queued save turned into when its turn came. */
export type CellWrite = "put" | "delete" | "none";

const cached = (qc: QueryClient, c: CellRef): GridCell | undefined =>
  findReportCell(qc.getQueryData<ReportPreview>(keys.report(c.week, "weekly")), c);
const shown = (cell: GridCell) => (cell.value === null ? "" : String(cell.value));

/** The old usePutOverride, throwing and with the week in the target: the cell becomes the draft at once (the first
 *  edit keeps the computed value under `auto`), a failure puts back just this cell, and that week's report is always
 *  re-read — even when no view shows it any more (a drawer that saved on a week switch: `refetchType: "all"`, as an
 *  inactive query is otherwise only marked stale), and awaited, so the next queued write reads the server's answer
 *  from the cache. */
export async function putCell(qc: QueryClient, c: CellRef, value: string): Promise<void> {
  const queryKey = keys.report(c.week, "weekly");
  await qc.cancelQueries({ queryKey });
  const preview = qc.getQueryData<ReportPreview>(queryKey);
  const previousCell = findReportCell(preview, c);
  if (preview) qc.setQueryData(queryKey, updateReportCell(preview, c, (x) => ({ ...x, value, overridden: true, auto: x.auto ?? x.value })));
  try {
    await api.putOverride(c.week, "weekly", { sheet: c.sheet, row_key: c.row_key, column: c.column, value });
  } catch (err) {
    rollbackReportCell(qc, { queryKey, previousCell }, c);
    throw err;
  } finally {
    await qc.invalidateQueries({ queryKey, refetchType: "all" });
  }
}

/** The old useDeleteOverride, throwing: back to the computed value at once; a 404 (already gone) is a success; the
 *  week's report is re-read as after a put. */
export async function deleteCell(qc: QueryClient, c: CellRef): Promise<void> {
  const queryKey = keys.report(c.week, "weekly");
  await qc.cancelQueries({ queryKey });
  const preview = qc.getQueryData<ReportPreview>(queryKey);
  const previousCell = findReportCell(preview, c);
  if (preview) qc.setQueryData(queryKey, updateReportCell(preview, c, (x) => ({ ...x, value: x.auto ?? x.value, overridden: false, auto: undefined })));
  try {
    await api.deleteOverride(c.week, "weekly", { sheet: c.sheet, row_key: c.row_key, column: c.column });
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      rollbackReportCell(qc, { queryKey, previousCell }, c);
      throw err;
    }
  } finally {
    await qc.invalidateQueries({ queryKey, refetchType: "all" });
  }
}

/** A digest line of `week` (`day` = a date or "week") written as the server answered it, into every cached preview
 *  of that week (the digests are per week, the cache per week + template — the v1 page still caches its own), then that week is re-read. A regenerate
 *  also answers `auto` (R12), and of a line that does not exist yet only that (the server writes it in the
 *  background, or the next local generation does): the screen keeps what it shows until the re-read. */
export async function patchDigest(qc: QueryClient, week: string, day: string, body: { text: string } | { oneliner: string } | { regenerate: true }): Promise<DigestPatchOut> {
  const queryKey = ["report", week];
  await qc.cancelQueries({ queryKey });
  try {
    const r = await api.patchDigest(week, day, body);
    if (r && typeof r.text === "string") {
      const { auto: _, ...d } = r as DigestOut & { auto?: boolean };   // the cache keeps the line only
      qc.setQueriesData<ReportPreview>({ queryKey }, (p) => (p?.digests
        ? { ...p, digests: day === "week" ? { ...p.digests, week: d } : { ...p.digests, days: { ...p.digests.days, [day]: d } } }
        : p));
    }
    return r;
  } finally {
    // active only: setQueriesData above already patched every cached template, the inactive ones included
    await qc.invalidateQueries({ queryKey });
  }
}

/** A failed write's toast: a 400 the server refused says why (preflight R7, its reason after the interface
 *  language's 保存失败); a conflict or anything else keeps the timeline's texts. */
function writeError(lang: Lang, err: unknown): void {
  if (err instanceof ValidationError) toast.error(t(lang, "rp.e.refused", { m: err.issues[0]?.message ?? err.message }));
  else reportWriteError(lang, err);
}

export interface WriteOpts {
  /** Throw the failure to the caller instead of reporting it (an InlineEdit keeps the draft and says why itself). */
  rethrow?: boolean;
}

export interface ReportWrite {
  /** Any write, after the ones queued before it have been answered and re-read. */
  queue: <R>(fn: () => Promise<R>, o?: WriteOpts) => Promise<R | undefined>;
  /** Save a draft with the old ReportCell rule, decided when its turn comes, on the cell as the cache has it then:
   *  the computed value → restore it if the cell is edited, else nothing; the value it already has → nothing;
   *  anything else → put. A cell the cache does not have (the row is gone) is not written. */
  save: (c: CellRef, draft: string, o?: WriteOpts) => Promise<CellWrite | undefined>;
  /** Back to the computed value, when the cell is still edited at its turn. */
  restore: (c: CellRef, o?: WriteOpts) => Promise<CellWrite | undefined>;
  /** A digest line's edit (`{ text }`) or regenerate, in the same queue (patchDigest). */
  digest: (week: string, day: string, body: { text: string } | { oneliner: string } | { regenerate: true }, o?: WriteOpts) => Promise<DigestPatchOut | undefined>;
}

/** The 週報 page's writes, one after another (the 计划 page's queue, preflight R1): a write's turn comes after the
 *  one before has been answered AND re-read, and it builds its payload from the cache then — never from what the
 *  page showed at the click (sub-project 5's lesson: two quick saves of one cell, the second typing the computed
 *  value back, must restore what the first put). Failures are reported in the interface language. Call it once per
 *  page and hand it down, so a drawer that saves on close still has the queue after it unmounts. */
export function useReportWrite(): ReportWrite {
  const qc = useQueryClient();
  const { lang } = useV2();
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const queue = useCallback(<R,>(fn: () => Promise<R>, o: WriteOpts = {}) => {
    const job = tail.current.then(fn).then(
      (r) => r as R | undefined,
      (err) => { if (o.rethrow) throw err; writeError(lang, err); return undefined; },
    );
    tail.current = job.catch(() => undefined);
    return job;
  }, [lang]);
  const save = useCallback((c: CellRef, draft: string, o?: WriteOpts) => queue(async (): Promise<CellWrite> => {
    const cell = cached(qc, c);
    if (!cell) return "none";
    if (draft === autoText(cell)) {
      if (!cell.overridden) return "none";
      await deleteCell(qc, c);
      return "delete";
    }
    if (cell.overridden && draft === shown(cell)) return "none";
    await putCell(qc, c, draft);
    return "put";
  }, o), [qc, queue]);
  const restore = useCallback((c: CellRef, o?: WriteOpts) => queue(async (): Promise<CellWrite> => {
    if (!cached(qc, c)?.overridden) return "none";
    await deleteCell(qc, c);
    return "delete";
  }, o), [qc, queue]);
  const digest = useCallback((week: string, day: string, body: { text: string } | { oneliner: string } | { regenerate: true }, o?: WriteOpts) =>
    queue(() => patchDigest(qc, week, day, body), o), [qc, queue]);
  return useMemo(() => ({ queue, save, restore, digest }), [queue, save, restore, digest]);
}
