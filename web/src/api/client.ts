import type * as T from "./types";
import type { Prefs } from "../prefs/types";
import { noteTaskBadges } from "../ui/taskBadges";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) { super(`API ${status}`); }
}
/** 409: someone else changed the row. `current` is the row as it is now — refresh from it. */
export class ConflictError<R> extends ApiError {
  constructor(public current: R) { super(409, { error: "conflict", current }); }
}
/** 409 `{error:"linked", …}`: the 案件 still has sessions, notes or plan rows (`plans`) pointing at
 *  it, so the server refused to delete it. Unlike a `conflict` this is not stale data — the counts say what has to
 *  be unlinked first. A plain `ApiError`, never a `ConflictError` (there is no `current` row). */
export type LinkedError = ApiError & { body: { error: "linked"; sessions: number; notes: number; plans?: number } };
export function isLinkedError(err: unknown): err is LinkedError {
  if (!(err instanceof ApiError) || err.status !== 409 || typeof err.body !== "object" || err.body === null) return false;
  const body = err.body as { error?: unknown; sessions?: unknown; notes?: unknown };
  return body.error === "linked" && typeof body.sessions === "number" && typeof body.notes === "number";
}

export class UnauthorizedError extends ApiError { constructor() { super(401, { error: "unauthorized" }); } }
export class ValidationError extends ApiError {
  constructor(public issues: { path: string; message: string }[]) { super(400, { error: "invalid", issues }); }
}

let apiLang: "zh" | "ja" | "en" | null = null;
/** v2 sets its display language here; the server then answers with data text in it (S1). */
export function setApiLang(lang: "zh" | "ja" | "en" | null): void { apiLang = lang; }

async function request<R>(method: string, path: string, body?: unknown): Promise<R> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (apiLang) headers["X-Lang"] = apiLang;
  const res = await fetch(path, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    // An expired Cloudflare Access session answers with a 302 to the login page on ANOTHER origin.
    // Following it would fail CORS and surface as an opaque TypeError, indistinguishable from being
    // offline. With "manual" the browser hands back an opaque redirect we can recognise.
    redirect: "manual",
  });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) throw new UnauthorizedError();
  if (res.status === 204) return undefined as R;
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (res.ok && data !== undefined) return data as R;
  // A 200 that is not JSON is an interstitial/login page, never our API.
  if (res.status === 401 || (res.ok && data === undefined)) throw new UnauthorizedError();
  if (data === undefined) throw new ApiError(res.status, text.slice(0, 200));
  // 409 is no longer only ever "someone else changed the row": deleting a 案件 answers 409
  // `{error:"linked", sessions, notes}` when something still points at it, which carries no
  // `current` and is not fixed by refreshing. Only the `conflict` shape becomes a ConflictError
  // (whose whole contract is `current`); any other 409 falls through to a plain ApiError, so a
  // caller that doesn't recognise it reports a failure instead of reading `current` off undefined.
  if (res.status === 409 && data.error === "conflict") throw new ConflictError(data.current);
  if (res.status === 400 && Array.isArray(data.issues)) throw new ValidationError(data.issues);
  throw new ApiError(res.status, data);
}

const q = (s: string) => encodeURIComponent(s);

/** The cross-week xlsx: a plain link's address (a navigation, never fetch — see ReportPage's xlsx comment). */
export const rangeXlsxHref = (from: string, to: string, lang: "zh" | "ja" | "en") =>
  `/api/reports/range/xlsx?from=${q(from)}&to=${q(to)}&lang=${lang}`;

export const api = {
  pinPolish: (entity: T.PolishEntity, entityId: string, field: string, pinned: boolean) =>
    request<{ pinned: boolean; raw: string }>("POST", "/api/i18n/pin", { entity, entity_id: entityId, field, pinned }),
  prefs: () => request<Prefs>("GET", "/api/prefs"),
  putPrefs: (p: Prefs) => request<Prefs>("PUT", "/api/prefs", p),
  machines: () => request<T.Machine[]>("GET", "/api/machines"),
  machineRuns: () => request<T.MachineRuns[]>("GET", "/api/machines/runs"),
  requesters: () => request<string[]>("GET", "/api/requesters"),
  timeline: (week: string, includeHidden: boolean) =>
    request<T.Timeline>("GET", `/api/weeks/${q(week)}/timeline${includeHidden ? "?include_hidden=1" : ""}`),
  unlinkedSessions: () => request<T.Session[]>("GET", "/api/sessions?unlinked=1"),
  patchSession: (id: string, updatedAt: string, patch: T.SessionPatch) =>
    request<T.Session>("PATCH", `/api/sessions/${q(id)}`, { updated_at: updatedAt, ...patch }),
  tasks: (statuses?: T.TaskStatus[]) =>
    request<T.Task[]>("GET", `/api/tasks${statuses?.length ? `?status=${statuses.join(",")}` : ""}`)
      .then((r) => { if (Array.isArray(r)) noteTaskBadges(r); return r; }),   // a non-array 200 must not fail the query
  task: (id: string) => request<T.TaskDetail>("GET", `/api/tasks/${q(id)}`)
    .then((r) => { if (r?.task && typeof r.task === "object") noteTaskBadges([r.task]); return r; }),
  taskTotals: () => request<T.TaskTotal[]>("GET", "/api/tasks/totals"),
  putDeliverableVerdict: (body: { key: string; kind: T.AutoDeliverable["kind"]; verdict: "in" | "out" }) =>
    request<unknown>("PUT", "/api/deliverable-verdicts", body),
  createTask: (body: T.TaskCreate) => request<T.Task>("POST", "/api/tasks", body)
    .then((r) => { if (typeof r?.id === "string") noteTaskBadges([r]); return r; }),
  patchTask: (id: string, updatedAt: string, patch: T.TaskPatch) =>
    request<T.Task>("PATCH", `/api/tasks/${q(id)}`, { updated_at: updatedAt, ...patch })
      .then((r) => { if (typeof r?.id === "string") noteTaskBadges([r]); return r; }),
  deleteTask: (id: string, updatedAt: string) =>
    request<void>("DELETE", `/api/tasks/${q(id)}?updated_at=${q(updatedAt)}`),
  createNote: (body: T.NoteCreate) => request<T.Note>("POST", "/api/notes", body),
  patchNote: (id: string, updatedAt: string, patch: T.NotePatch) =>
    request<T.Note>("PATCH", `/api/notes/${q(id)}`, { updated_at: updatedAt, ...patch }),
  deleteNote: (id: string, updatedAt: string) =>
    request<void>("DELETE", `/api/notes/${q(id)}?updated_at=${q(updatedAt)}`),
  reportDownloads: (week: string) => request<T.ReportDownload[]>("GET", `/api/report-downloads?week=${q(week)}`),
  compose: (week: string, lang: "zh" | "ja" | "en") => request<T.ComposeOut>("GET", `/api/reports/${q(week)}/pdf/compose?lang=${lang}`),
  putCompose: (week: string, lang: "zh" | "ja" | "en", body: { items: T.ComposeItem[]; updated_at: string | null }) =>
    request<T.ComposeOut>("PUT", `/api/reports/${q(week)}/pdf/compose?lang=${lang}`, body),
  generateCompose: (week: string) => request<T.ComposeOut>("POST", `/api/reports/${q(week)}/pdf/compose/generate`),
  putComposeText: (week: string, body: { lang: "zh" | "ja" | "en" } & T.ComposeLangText) =>
    request<T.ComposeOut>("PUT", `/api/reports/${q(week)}/pdf/compose/text`, body),
  /** The PDF's HTML for a draft selection (an <iframe srcdoc>): text, not JSON, so not through request(). */
  composePreview: async (week: string, lang: "zh" | "ja" | "en", items: T.ComposeItem[]): Promise<string> => {
    const res = await fetch(`/api/reports/${q(week)}/pdf/preview?lang=${lang}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
      credentials: "same-origin", redirect: "manual",
    });
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      const text = await res.text();
      let body: unknown; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
      throw new ApiError(res.status, body);
    }
    return res.text();
  },
  rangeBounds: () => request<T.RangeBounds>("GET", "/api/reports/range/bounds"),
  report: (week: string, template: T.TemplateKey) =>
    request<T.ReportPreview>("GET", `/api/reports/${q(week)}/${q(template)}`),
  /** `day` = a date of the report week, or "week"; null = no line yet (a regenerate the cron has not run). */
  patchDigest: (week: string, day: string, body: { text: string } | { oneliner: string } | { regenerate: true }) =>
    request<T.DigestPatchOut>("PATCH", `/api/reports/${q(week)}/digests/${q(day)}`, body),
  putOverride: (week: string, template: T.TemplateKey, body: { sheet: T.SheetKey; row_key: string; column: string; value: string }) =>
    request<{ ok: true; updated_at: string }>("PUT", `/api/reports/${q(week)}/${q(template)}/cells`, body),
  deleteOverride: (week: string, template: T.TemplateKey, query: { sheet: T.SheetKey; row_key: string; column: string }) =>
    request<{ ok: true }>(
      "DELETE",
      `/api/reports/${q(week)}/${q(template)}/cells?sheet=${q(query.sheet)}&row_key=${q(query.row_key)}&column=${q(query.column)}`,
    ),
  dashboard: (from: string, to: string) =>
    request<T.Dashboard>("GET", `/api/dashboard?from=${q(from)}&to=${q(to)}`),
  statsSessions: (from: string, to: string) =>
    request<T.StatsSessions>("GET", `/api/stats/sessions?from=${q(from)}&to=${q(to)}`),
  reviews: (limit: number) => request<T.Review[]>("GET", `/api/reviews?limit=${limit}`),
  planItems: (closed = false) => request<T.PlanItem[]>("GET", `/api/plan-items${closed ? "?status=closed" : ""}`),
  createPlanItem: (body: { horizon: T.Horizon; text: string; task_ids?: string[]; until_date?: string | null }) =>
    request<T.PlanItem>("POST", "/api/plan-items", body),
  patchPlanItem: (id: string, updatedAt: string, patch: T.PlanItemPatch) =>
    request<T.PlanItem>("PATCH", `/api/plan-items/${q(id)}`, { updated_at: updatedAt, ...patch }),
  /** null = the day has not been started (the server's JSON 404 `no plan`). */
  dayPlan: async (date: string) => {
    try {
      return await request<T.DayPlan>("GET", `/api/day-plans/${q(date)}`);
    } catch (err) {
      // Only "no plan" means not started; any other 404 (a missing route, a proxy page) is a failure.
      if (err instanceof ApiError && err.status === 404 && (err.body as { error?: unknown } | null)?.error === "no plan") return null;
      throw err;
    }
  },
  startDayPlan: (date: string) => request<T.DayPlan>("POST", `/api/day-plans/${q(date)}/start`),
  addDayPlanItem: (date: string, body: { text?: string; detail?: string; task_ids?: string[]; plan_item_id?: string }) =>
    request<T.DayPlanItem>("POST", `/api/day-plans/${q(date)}/items`, body),
  patchDayPlanItem: (id: string, updatedAt: string, patch: T.DayPlanItemPatch) =>
    request<T.DayPlanItem>("PATCH", `/api/day-plan-items/${q(id)}`, { updated_at: updatedAt, ...patch }),
  deleteDayPlanItem: (id: string, updatedAt: string) =>
    request<void>("DELETE", `/api/day-plan-items/${q(id)}?updated_at=${q(updatedAt)}`),
};
