// The composer's data (spec 2026-10-09 §3): the server's view, local rows changed at once, saves serialized so each
// PUT carries the previous one's updated_at, and a debounced preview of the draft. One instance per week and export
// language (ComposePage keys it), so nothing of another week's rows or token lives on.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, ConflictError, api } from "../../../api/client";
import type { ComposeLangText, ComposeOut, ComposeRowOut } from "../../../api/types";
import type { Lang } from "../../../prefs/types";
import { toItems } from "./list";

export const PREVIEW_MS = 300;
/** A 409 `generating` (another tab, a double click): the view is read again after this long (spec §7). */
export const GENERATING_RETRY_MS = 20_000;
/** While the view says the other two languages are being retranslated (a hand edit saved elsewhere), it is re-read
 *  this often (and every GENERATING_RETRY_MS while it says another request is generating). This page's own text save
 *  needs no polling: its PUT answers once the retranslation is done (textSaving meanwhile). */
export const TRANSLATING_POLL_MS = 3000;

export type GenerateResult = { ok: true } | { ok: false; reason: string; status: number | null };

export function useCompose(week: string, lang: Lang) {
  const qc = useQueryClient(), key = ["compose", week, lang] as const;
  const q = useQuery({
    queryKey: key, queryFn: () => api.compose(week, lang),
    refetchInterval: (query) => (query.state.data?.translating ? TRANSLATING_POLL_MS : query.state.data?.generating ? GENERATING_RETRY_MS : false),
  });
  const [rows, setRows] = useState<ComposeRowOut[]>([]);
  const token = useRef<string | null>(null), chain = useRef<Promise<unknown>>(Promise.resolve());
  // seq: the latest change; pending: saves not answered yet. A reply only reaches the view when it answers the
  // latest change, and the view only replaces the local rows when no save is pending — so an older reply (or a
  // background refetch) never undoes a newer local change.
  const seq = useRef(0), pending = useRef(0);
  const [conflict, setConflict] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    if (q.data && pending.current === 0) { setRows(q.data.items); token.current = q.data.updated_at; }
  }, [q.data]);

  const change = useCallback((next: ComposeRowOut[]) => {
    if (next === rows) return;
    setRows(next); setConflict(false); setSaveFailed(false);
    const items = toItems(next), mine = ++seq.current;
    pending.current++;
    chain.current = chain.current.then(async () => {
      let view: ComposeOut | null = null, clash = false, failed = false;
      try {
        view = await api.putCompose(week, lang, { items, updated_at: token.current });
      } catch (e) {
        if (e instanceof ConflictError && e.current) { view = e.current as ComposeOut; clash = true; }
        else failed = true;
      }
      pending.current--;
      if (view) {
        token.current = view.updated_at;           // the next save carries it, whichever change it answers
        // the other export languages show the same selection: a language switched to mid-save reads it again
        void qc.invalidateQueries({ queryKey: ["compose", week], predicate: (x) => x.queryKey[2] !== lang });
      }
      if (mine !== seq.current) return;
      if (clash) setConflict(true);
      if (failed) setSaveFailed(true);
      if (view) qc.setQueryData(key, view);
    });
  }, [week, lang, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // the draft's PDF: keyed on what the server renders from (the selection and the stored text), not on row identity
  const [preview, setPreview] = useState<string | null>(null);
  const items = JSON.stringify(toItems(rows)), text = JSON.stringify(q.data?.text ?? null);
  useEffect(() => {
    if (!q.data) return;
    let live = true;
    const h = setTimeout(() => {
      api.composePreview(week, lang, JSON.parse(items)).then((html) => { if (live) setPreview(html); }).catch(() => { /* the old preview stays */ });
    }, PREVIEW_MS);
    return () => { live = false; clearTimeout(h); };
  }, [week, lang, items, text, q.data !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const [generating, setGenerating] = useState(false);
  const generate = useCallback(async (): Promise<GenerateResult> => {
    setGenerating(true);
    try {
      await chain.current;                              // the selection being generated for is saved first
      await api.generateCompose(week);
      await qc.invalidateQueries({ queryKey: ["compose", week] });
      return { ok: true };
    } catch (e) {
      const body = e instanceof ApiError && typeof e.body === "object" && e.body ? (e.body as { reason?: string; error?: string }) : null;
      return { ok: false, reason: body?.reason ?? body?.error ?? String(e), status: e instanceof ApiError ? e.status : null };
    } finally { setGenerating(false); }
  }, [week]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Re-read every language's view of the week (after a 409 `generating`). */
  const reload = useCallback(() => qc.invalidateQueries({ queryKey: ["compose", week] }), [qc, week]);

  const [textSaving, setTextSaving] = useState(false);
  const saveText = useCallback(async (t: ComposeLangText) => {
    setTextSaving(true);
    try {
      const v = await api.putComposeText(week, { lang, ...t });
      qc.setQueryData(key, v);
    } finally { setTextSaving(false); }
  }, [week, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return { view: q.data, rows, error: q.error, conflict, saveFailed, change, preview, generate, generating, reload, saveText, textSaving };
}
