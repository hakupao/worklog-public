import { ConflictError } from "../api/client";
import { toast } from "../components/Toast";
import { t } from "../i18n/t";
import type { Lang } from "../prefs/types";

/** A failed write's toast in the interface language: a 409 says the row was refreshed, anything else that saving failed.
 *  Kept free of UI imports so the plan queue (and the phone UI through it) can use it without the desktop drawers. */
export function reportWriteError(lang: Lang, err: unknown): void {
  toast.error(t(lang, err instanceof ConflictError ? "tl.p.conflict" : "tl.p.saveFailed"));
}
