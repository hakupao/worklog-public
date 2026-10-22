// The page's side of the demo (PLAN D2): every same-origin request under /api/ goes to the in-page app instead of the
// network, and links into /api/ (the xlsx downloads are plain <a href>) become blob downloads. The UI calls /api/…
// absolutely, so the check holds under any base path. Everything else uses the real fetch.
import { toAppRequest, type DemoApp } from "./app";
import { showPrintPreview } from "./print-preview";

export interface ApiLogEntry { method: string; path: string; status: number; ms: number; lang?: string | null; body?: string }
declare global { interface Window { __demoApi?: ApiLogEntry[] } }

const isApi = (url: URL) => url.origin === location.origin && url.pathname.startsWith("/api/");
/** GET /api/reports/:week/pdf: the demo's PDF route answers the print-ready HTML (app.ts). */
const PDF_PATH = /^\/api\/reports\/[^/]+\/pdf$/;

/** The newest "PDF" the UI asked for, waiting for the UI's own save (an <a download> click on a blob URL). */
let pendingPdf: { name: string; html: string } | null = null;

async function callApp(app: DemoApp, req: Request): Promise<Response> {
  const url = new URL(req.url), t0 = performance.now();
  const res = await app.fetch(await toAppRequest(req));
  const entry: ApiLogEntry = { method: req.method, path: url.pathname + url.search, status: res.status, ms: Math.round(performance.now() - t0), lang: req.headers.get("X-Lang") };
  if (!res.ok) entry.body = (await res.clone().text()).slice(0, 300);
  (window.__demoApi ??= []).push(entry);
  if (req.method === "GET" && PDF_PATH.test(url.pathname) && res.ok) {
    const html = await res.clone().text();
    pendingPdf = { name: `${url.pathname.split("/")[3]}-${url.searchParams.get("lang") ?? "ja"}.pdf`, html };
  }
  return res;
}

/** filename="…" or filename*=UTF-8''… from Content-Disposition. */
function fileName(res: Response, fallback: string): string {
  const cd = res.headers.get("Content-Disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
  return /filename="([^"]+)"/i.exec(cd)?.[1] ?? fallback;
}

function save(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

async function download(app: DemoApp, url: URL): Promise<void> {
  const res = await callApp(app, new Request(url));
  if (!res.ok) { console.warn("[demo] download failed", url.pathname, res.status, await res.text()); return; }
  save(await res.blob(), fileName(res, url.pathname.split("/").pop() || "download"));
}

export function installFetch(app: DemoApp): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // A Request is built only for /api: anything else (the wasm, fonts, a body that may be a one-shot stream) goes
    // to the real fetch with its arguments untouched.
    const url = input instanceof Request ? new URL(input.url) : new URL(input, location.href);
    return isApi(url) ? callApp(app, new Request(input, init)) : realFetch(input, init);
  };

  const anchor = (e: MouseEvent): HTMLAnchorElement | null => {
    if (e.defaultPrevented || !(e.target instanceof Element)) return null;
    const a = e.target.closest("a[href]");
    return a instanceof HTMLAnchorElement ? a : null;
  };
  // Every way of following an /api link saves the file: plain, ⌘/Ctrl/Shift/Alt-click (click) and the middle button
  // (auxclick) alike. A new tab or window would ask Pages for /api/… and get its 404.
  document.addEventListener("auxclick", (e) => {
    const a = e.button === 1 ? anchor(e) : null;
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (isApi(url)) { e.preventDefault(); void download(app, url); }
  });
  document.addEventListener("click", (e) => {
    const a = anchor(e);
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (isApi(url)) {
      e.preventDefault();
      void download(app, url);
    } else if (url.protocol === "blob:" && pendingPdf && a.download === pendingPdf.name) {
      // The UI saving the "PDF" it fetched: show the print-ready page instead of saving HTML as .pdf.
      e.preventDefault();
      showPrintPreview(pendingPdf.html);
      pendingPdf = null;
    }
  });
}
