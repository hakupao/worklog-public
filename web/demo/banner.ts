// The demo strip (PLAN D7): one quiet line saying the data is fictional and edits vanish on reload, in the UI's
// language (it follows <html lang>), plus a link to the repository.
import { demoLang, type DemoLang } from "./lang";

export const REPO_URL = "https://github.com/hakupao/worklog-public";

const TEXT: Record<DemoLang, string> = {
  zh: "演示站 · 数据均为虚构 · 修改只保存在本页、刷新即重置",
  ja: "デモ · データはすべて架空 · 変更はこのページだけに保存され、再読み込みで元に戻ります",
  en: "Demo · all data is fictional · changes live in this tab and reset on reload",
};

const CSS = `
/* desktop: a tab hanging from the top edge, centred (the page headers keep that span empty); under the drawers and their
   scrim (z 24+), over the page */
#demo-banner{position:fixed;z-index:22;left:50%;top:0;transform:translateX(-50%);max-width:calc(100vw - 32px);
  display:flex;align-items:center;gap:10px;height:22px;padding:0 12px;border-radius:0 0 10px 10px;
  font:11.5px/22px "Noto Sans SC","BIZ UDPGothic","Hiragino Sans",system-ui,sans-serif;letter-spacing:.02em;white-space:nowrap;
  color:rgba(240,236,228,.66);background:rgba(10,11,14,.78);border:1px solid rgba(255,255,255,.08);border-top:0;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
#demo-banner .t{overflow:hidden;text-overflow:ellipsis;min-width:0}
#demo-banner a{color:#ffad3a;text-decoration:none;flex:none}
#demo-banner a:hover{text-decoration:underline}
#demo-banner a:focus-visible{outline:2px solid #ffc06a;outline-offset:2px;border-radius:4px}
html.v2[data-world=omote] #demo-banner{color:rgba(20,22,26,.66);background:rgba(250,248,244,.82);border-color:rgba(0,0,0,.08)}
html.v2[data-world=omote] #demo-banner a{color:#0e7c86}
/* phone shell: in the flow above the app (the sticky top bar holds controls edge to edge), wrapping instead of
   truncating; it scrolls away with the page */
html.m #demo-banner{position:static;transform:none;max-width:none;height:auto;justify-content:center;flex-wrap:wrap;gap:2px 10px;
  padding:calc(4px + env(safe-area-inset-top,0px)) 16px 4px;border:0;border-bottom:.5px solid var(--sep);border-radius:0;
  white-space:normal;text-align:center;line-height:1.4;font-size:12px;color:var(--mute);background:var(--bar)}
html.m #demo-banner a{color:var(--tint)}`;

export function mountBanner(): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const bar = document.createElement("div");
  bar.id = "demo-banner";
  bar.setAttribute("role", "note");
  const text = document.createElement("span");
  text.className = "t";
  const link = document.createElement("a");
  link.href = REPO_URL;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "GitHub";
  bar.appendChild(text);
  bar.appendChild(link);
  document.body.insertBefore(bar, document.getElementById("root"));
  const render = () => {
    const lang = demoLang();
    text.textContent = TEXT[lang];
    bar.lang = lang === "zh" ? "zh-CN" : lang;
    bar.title = TEXT[lang];
  };
  render();
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
}
