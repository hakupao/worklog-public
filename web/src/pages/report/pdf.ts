// ↓ PDF (design 2026-10-08 §4.4). Unlike the xlsx link this is a fetch: rendering takes seconds (the button says
// 生成中…) and Browser Run can be busy (503 + Retry-After), which a plain link would download as a broken file.
// An expired Access session answers with a redirect: then the same URL is opened as a page, which goes through
// the login and ends in the download.
import type { Lang } from "../../prefs/types";

type Deps = { fetch: typeof fetch; save: (blob: Blob, name: string) => void; navigate: (url: string) => void };

const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
const DEFAULT: Deps = { fetch: (...a) => fetch(...a), save: saveBlob, navigate: (u) => window.location.assign(u) };

export async function downloadPdf(week: string, lang: Lang, deps: Deps = DEFAULT): Promise<{ ok: true } | { ok: false; busy: number | null }> {
  const url = `/api/reports/${week}/pdf?lang=${lang}`;
  let res: Response;
  try { res = await deps.fetch(url, { credentials: "same-origin", redirect: "manual" }); }
  catch { return { ok: false, busy: null }; }
  if (res.type === "opaqueredirect" || res.status === 401 || (res.status >= 300 && res.status < 400)) {
    deps.navigate(url);
    return { ok: true };
  }
  if (res.ok && (res.headers.get("Content-Type") ?? "").startsWith("application/pdf")) {
    deps.save(await res.blob(), `${week}-${lang}.pdf`);
    return { ok: true };
  }
  if (res.status === 503) {
    const s = Number(res.headers.get("Retry-After"));
    if (Number.isFinite(s) && s > 0) return { ok: false, busy: s };
  }
  return { ok: false, busy: null };
}
