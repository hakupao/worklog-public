// The demo's PDF (PLAN D6): there is no Browser Run in a tab, so 下载 PDF shows the very page the Worker would print —
// the same renderReportHtml output, fitted to one A4 sheet by its own __fit() — in an overlay with 打印 (the browser's
// print dialog, which can save a PDF) and 新标签页打开. An overlay, not window.open: the UI saves its blob after
// awaiting the fetch, by when a popup can already be blocked; these buttons are direct clicks.
import { demoLang, type DemoLang } from "./lang";

const TEXT: Record<DemoLang, { title: string; note: string; print: string; open: string; close: string }> = {
  zh: { title: "PDF 预览", note: "演示站不生成 PDF，这里是同一份可打印的版面", print: "打印", open: "在新标签页打开", close: "关闭" },
  ja: { title: "PDF プレビュー", note: "デモでは PDF を生成しません。同じ印刷用レイアウトです", print: "印刷", open: "新しいタブで開く", close: "閉じる" },
  en: { title: "PDF preview", note: "The demo does not render PDFs; this is the same print-ready page", print: "Print", open: "Open in a new tab", close: "Close" },
};

const A4 = { w: 794, h: 1123 };   // CSS px at 96 dpi
const FIT = `<script>addEventListener("load",function(){document.fonts.ready.then(function(){try{window.__fit&&window.__fit()}catch(e){}})})</script>`;

const CSS = `
.demo-pv{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px 16px;
  background:rgba(4,5,6,.86);color:#f3f1ec;font:13px/1.4 "Noto Sans SC","BIZ UDPGothic",system-ui,sans-serif}
.demo-pv-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;max-width:100%}
.demo-pv-bar b{font-weight:600;margin-right:4px}
.demo-pv-bar span{color:rgba(240,236,228,.62);margin-right:8px}
.demo-pv-bar button{font:inherit;color:inherit;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:999px;
  padding:5px 14px;cursor:pointer}
.demo-pv-bar button:hover{background:rgba(255,255,255,.12)}
.demo-pv-bar button:focus-visible{outline:2px solid #ffc06a;outline-offset:2px}
.demo-pv-sheet{flex:1;min-height:0;width:100%;display:flex;justify-content:center;overflow:hidden}
.demo-pv-sheet iframe{width:${A4.w}px;height:${A4.h}px;border:0;background:#fff;transform-origin:top center;box-shadow:0 8px 40px rgba(0,0,0,.5)}`;

export function showPrintPreview(html: string): void {
  const t = TEXT[demoLang()];
  const page = html.includes("</body>") ? html.replace("</body>", `${FIT}</body>`) : html + FIT;
  const href = URL.createObjectURL(new Blob([page], { type: "text/html;charset=utf-8" }));

  const root = document.createElement("div");
  root.className = "demo-pv";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", t.title);
  root.innerHTML = `<style>${CSS}</style><div class="demo-pv-bar"><b></b><span></span>
    <button type="button" data-a="print"></button><button type="button" data-a="open"></button><button type="button" data-a="close"></button></div>
    <div class="demo-pv-sheet"><iframe title="PDF"></iframe></div>`;
  root.querySelector("b")!.textContent = t.title;
  root.querySelector("span")!.textContent = t.note;
  for (const k of ["print", "open", "close"] as const) root.querySelector(`[data-a=${k}]`)!.textContent = t[k];
  const frame = root.querySelector("iframe")!;
  frame.src = href;

  const sheet = root.querySelector<HTMLElement>(".demo-pv-sheet")!;
  const fit = () => {
    const s = Math.min(1, sheet.clientWidth / A4.w, sheet.clientHeight / A4.h);
    frame.style.transform = `scale(${s})`;
  };
  const close = () => {
    root.remove();
    removeEventListener("resize", fit);
    removeEventListener("keydown", onKey, true);
    setTimeout(() => URL.revokeObjectURL(href), 60_000);   // a tab opened from here may still be loading it
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  root.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("button")?.dataset.a;
    if (a === "print") frame.contentWindow?.print();
    else if (a === "open") window.open(href, "_blank", "noopener");
    else if (a === "close" || e.target === root) close();
  });
  addEventListener("resize", fit);
  addEventListener("keydown", onKey, true);
  document.body.appendChild(root);
  fit();
  root.querySelector<HTMLButtonElement>("[data-a=close]")!.focus();
}
