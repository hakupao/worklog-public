// server/src/report/pdf/html.ts
// The one-page A4 週報 (design 2026-10-08 §4.1, prototype docs/design/prototypes/2026-10-08/pdf-weekly.html, layout
// "②+③"). A whole HTML document: Browser Run (pdf/browser.ts) and scripts/pdf-check.mjs both load it, run its
// window.__fit() and print it, so the fitting is the same code in both places.
import { LABELS, countText, dayText, issuedText, periodText, weekText } from "../labels";
import { hoursText, type PdfData, type PdfTask } from "./data";

export const FIT_STEPS = ["fit1", "fit2", "fit3", "trim", "clamp"] as const;
export const GROW_STEPS = ["grow1", "grow2", "grow3"] as const;
const SPREAD_MAX_PX = 22; // extra padding per row side; a very light week must not float its rows apart
const MAX_ROWS = 7, TRIM_ROWS = 5;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A thin space between CJK and Latin / digits (data text only). */
export function spaceMixed(s: string): string {
  return s.replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])(?=[A-Za-z0-9])|([A-Za-z0-9])(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])/gu, "$1$2\u2009");
}
const dt = (s: string) => esc(spaceMixed(s));
const pct = (m: number, max: number) => (max > 0 ? Math.round((m / max) * 1000) / 10 : 0);

const FONTS = {
  ja: "family=Shippori+Mincho:wght@400;600&family=Noto+Serif+JP:wght@400;500&family=Noto+Sans+JP:wght@300;400;500&family=Noto+Serif+SC:wght@400&family=Noto+Sans+SC:wght@300;400",
  zh: "family=Noto+Serif+SC:wght@400;600&family=Noto+Sans+SC:wght@300;400;500&family=Noto+Serif+JP:wght@400&family=Noto+Sans+JP:wght@300;400",
} as const;
const STACK = {
  ja: { title: '"Shippori Mincho","Noto Serif SC",serif', body: '"Noto Serif JP","Noto Serif SC",serif', sans: '"Noto Sans JP","Noto Sans SC",sans-serif' },
  zh: { title: '"Noto Serif SC","Noto Serif JP",serif', body: '"Noto Serif SC","Noto Serif JP",serif', sans: '"Noto Sans SC","Noto Sans JP",sans-serif' },
} as const;

const css = (f: { title: string; body: string; sans: string }) => `
@page{size:A4;margin:0}
html,body{margin:0;background:#fff}
.sheet{width:210mm;height:297mm;background:#fff;color:#1d1d1f;position:relative;overflow:hidden;box-sizing:border-box;
  padding:18mm 19mm 13mm;font-family:${f.body};--ink:#1a2238;--line:#c9ccd6;--bg:#f3f4f7;--lab:15mm;--s:1}
.sheet *{box-sizing:border-box}
.fit1{--s:.94}.fit2{--s:.88}.fit3{--s:.82}
.grow1{--s:1.08}.grow2{--s:1.16}.grow3{--s:1.24}
.hd{display:flex;justify-content:space-between;align-items:flex-end}
.ttl{font:600 calc(var(--s)*26px)/1 ${f.title};letter-spacing:.32em;color:var(--ink)}
.sub{text-align:right;font:400 11px/1.7 ${f.sans};color:#555;letter-spacing:.06em}
.info{display:grid;grid-template-columns:var(--lab) 1fr var(--lab) auto;border-top:1px solid var(--ink);border-bottom:.5px solid var(--ink);margin:8mm 0 0}
.info dt{font:500 10.5px ${f.sans};color:var(--ink);background:var(--bg);letter-spacing:.1em;padding:8px 0;text-align:center;border-right:.5px solid var(--line)}
.info dd{margin:0;font:400 11.5px ${f.sans};padding:8px 16px;white-space:normal;border-right:.5px solid var(--line)}
.info dd:last-child{border-right:0}
.sec{display:grid;grid-template-columns:var(--lab) 1fr;border-bottom:.5px solid var(--ink)}
.sec.last{border-bottom:1px solid var(--ink)}
.k{font:500 11px/1.5 ${f.sans};color:var(--ink);background:var(--bg);letter-spacing:.3em;writing-mode:vertical-rl;text-orientation:upright;display:flex;align-items:center;justify-content:center;border-right:.5px solid var(--line);padding:10px 0}
.k.h{writing-mode:horizontal-tb;letter-spacing:.04em;font-size:9.5px}
.v{padding:calc(var(--s)*12px) 0 calc(var(--s)*12px) 16px;min-width:0}
.lead{font:400 calc(var(--s)*14.5px)/1.9 ${f.title};margin:0;padding:var(--pad,0px) 0}
.spread .lead{padding:calc(var(--pad)*.5) 0}
.day{display:grid;grid-template-columns:62px 1fr 72px 58px;gap:10px;padding:calc(var(--s)*3.5px + var(--pad,0px)) 0;font-size:calc(var(--s)*12px);line-height:1.6;border-bottom:.5px dotted var(--line)}
.day:last-child{border-bottom:0}
.ln{display:block}
.day .d{font:500 10.5px/1.75 ${f.sans};color:var(--ink)}
.day .mb{height:4px;background:#eceef3;align-self:center}.day .mb i{display:block;height:100%;background:var(--ink)}
.day.off .mb i{background:#aab1c2}
.h{text-align:right;font:400 11px/1.75 ${f.sans};color:#555}
.h .sm{display:block;font-size:8.5px;line-height:1.3;color:#8a8f99;white-space:nowrap}
.tk{display:grid;grid-template-columns:minmax(0,1fr) 100px 128px 38px;gap:10px;align-items:start;padding:calc(var(--s)*3.5px + var(--pad,0px)) 0;font-size:calc(var(--s)*12px)}
.tk>span:first-child{white-space:normal;overflow-wrap:anywhere}
.tk .r{font:300 10px ${f.sans};color:#888;white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.tk .h{line-height:1.4}
.bar{align-self:center;height:4px;background:#eceef3}.bar i{display:block;height:100%;background:var(--ink)}
.tk.rest span:first-child{color:#888}.tk.rest .bar i{background:#b9bfcc}
.r5{display:none}
.clamp .lead:nth-of-type(n+7){display:none}
.clamp .day>span:nth-child(2) .ln:nth-child(n+2){display:none}
.clamp .lead,.clamp .ln{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
.clamp .lead{-webkit-line-clamp:3}.clamp .ln{-webkit-line-clamp:2}
.trim .tk[data-rank="6"],.trim .tk[data-rank="7"],.trim .r7{display:none}.trim .r5{display:grid}
.tot{display:flex;justify-content:flex-end;align-items:baseline;gap:20px;font:400 11px ${f.sans};color:#555;padding-top:8px;border-top:.5px solid var(--line);margin-top:6px}
.tot b{font:600 15px ${f.title};color:var(--ink);margin-left:4px}
.tot b.cum{font-weight:400;color:#555}
.foot{position:absolute;left:19mm;right:19mm;bottom:9mm;display:flex;justify-content:space-between;font:300 9px ${f.sans};color:#aaa}
.en .ttl{letter-spacing:.06em;font-size:calc(var(--s)*24px)}
.en .lead{font-size:calc(var(--s)*13.5px);line-height:1.75}
.en .day{font-size:calc(var(--s)*11px);line-height:1.5}
.en .info dt{letter-spacing:.02em;font-size:9.5px}`;

// Runs in the page: grow the type while the content fills under 85% of the sheet and still fits, else (when it
// overflows) add the fit steps in order until it fits; report what it took and which web fonts actually loaded
// (pdf/browser.ts logs a missing one). Growing and shrinking are exclusive: a sheet that overflows at once never grows.
const FIT_JS = `window.__fit=function(){var s=document.querySelector(".sheet"),c=document.querySelector(".cnt");
var cs=getComputedStyle(s),avail=s.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
var over=function(){return s.scrollHeight>s.clientHeight+1||c.getBoundingClientRect().height>avail+1};
var used=[],grow=${JSON.stringify(GROW_STEPS)},shrink=${JSON.stringify(FIT_STEPS)};
if(!over()){for(var g=0;g<grow.length;g++){if(c.getBoundingClientRect().height>=avail*0.85)break;
s.classList.add(grow[g]);if(over()){s.classList.remove(grow[g]);break;}used.push(grow[g]);}}
var h=function(){return c.getBoundingClientRect().height};
if(!over()&&h()<avail*0.85){var rows=0,all=document.querySelectorAll(".day,.tk,.lead");
for(var r=0;r<all.length;r++){if(all[r].getClientRects().length)rows++;}
var pad=Math.min(${SPREAD_MAX_PX},(avail*0.93-h())/(2*rows));
for(var t=0;t<8&&pad>0.5;t++){s.style.setProperty("--pad",pad+"px");s.classList.add("spread");
if(!over())break;pad/=2;s.classList.remove("spread");s.style.removeProperty("--pad");}
if(s.classList.contains("spread"))used.push("spread");}
for(var i=0;i<shrink.length&&over();i++){s.classList.add(shrink[i]);used.push(shrink[i]);}
var fonts=[];document.fonts.forEach(function(f){if(f.status==="loaded"&&fonts.indexOf(f.family)<0)fonts.push(f.family)});
return {over:over(),steps:used,fonts:fonts,fill:h()/avail};};`;

// Composed sheets only (a separate script, so an un-composed sheet's HTML is unchanged byte for byte): after the fit,
// a summary line that is not displayed (the clamp step hides the 7th on) or is cut by the 3-line clamp is overflow too
// — the composer's text must be read whole. hiddenLines = how many.
const COMPOSED_FIT_JS = `(function(base){window.__fit=function(){var r=base(),ls=document.querySelectorAll(".lead"),n=0;
for(var i=0;i<ls.length;i++){var l=ls[i];if(!l.getClientRects().length||l.scrollHeight>l.clientHeight+1)n++;}
if(n){r.over=true;r.hiddenLines=n;}return r;};})(window.__fit);`;

/** The その他 rows. A composed row (folded 案件 + overflow) can outweigh the largest 案件: its bar stops at 100%. An
 *  un-composed one keeps its old width (its HTML stays byte-identical). */
function restRow(cls: string, overflow: PdfTask[], composed: PdfTask | undefined, max: number, label: [string, string]): string {
  const n = overflow.length + (composed?.rest ?? 0);
  if (n === 0) return "";
  const m = overflow.reduce((a, t) => a + t.minutes, 0) + (composed?.minutes ?? 0);
  return `<div class="tk rest ${cls}"><span>${esc(countText(label, n))}</span><span class="r"></span>`
    + `<span class="bar"><i style="width:${composed ? Math.min(100, pct(m, max)) : pct(m, max)}%"></i></span><span class="h">${hoursText(m)}</span></div>`;
}

/** The 累計 under a day's wall-clock hours (user 10/9: both 工作时间 and 累计耗时), only when parallel sessions make
 *  it differ at 0.1 h. */
const cumText = (label: string, wall: number, sum: number | undefined) =>
  sum !== undefined && hoursText(sum) !== hoursText(wall) ? `<span class="sm">${esc(label)} ${hoursText(sum)}</span>` : "";

export function renderReportHtml(d: PdfData): string {
  const L = LABELS[d.lang], P = L.pdf;
  const f = STACK[d.lang === "zh" ? "zh" : "ja"], fonts = FONTS[d.lang === "zh" ? "zh" : "ja"];
  const k = (text: string) => `<div class="k${P.vertical ? "" : " h"}">${esc(text)}</div>`;
  const dayMax = Math.max(0, ...d.days.map((x) => x.minutes));
  const days = d.days.map((x) => {
    const wd = new Date(`${x.date}T00:00:00Z`).getUTCDay();
    return `<div class="day${wd === 0 || wd === 6 ? " off" : ""}"><span class="d">${esc(dayText(d.lang, x.date))}</span>`
      + `<span>${x.text.length ? x.text.map((l) => `<span class="ln">${dt(l)}</span>`).join("") : "—"}</span><span class="mb"><i style="width:${pct(x.minutes, dayMax)}%"></i></span>`
      + `<span class="h">${hoursText(x.minutes)}${cumText(P.cumulative, x.minutes, x.sum)}</span></div>`;
  }).join("\n");
  // a composed week carries its その他 as a last row (rest = 案件 folded in); overflow rows join that same row
  const composed = d.tasks.find((t) => t.rest !== undefined);
  const rows = d.tasks.filter((t) => t.rest === undefined);
  const taskMax = Math.max(0, ...d.tasks.map((t) => t.minutes));
  const shown = rows.slice(0, MAX_ROWS).map((t, i) =>
    `<div class="tk" data-rank="${i + 1}"><span>${dt(t.title)}</span><span class="r">${dt(t.requester)}</span>`
    + `<span class="bar"><i style="width:${pct(t.minutes, taskMax)}%"></i></span><span class="h">${hoursText(t.minutes)}</span></div>`).join("\n");
  const worked = d.days.filter((x) => hoursText(x.minutes) !== "0h").length;
  const htmlLang = d.lang === "zh" ? "zh-Hans" : d.lang;
  return `<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8">
<title>${esc(P.title)} ${esc(d.week)}</title>
<link href="https://fonts.googleapis.com/css2?${fonts}&display=block" rel="stylesheet">
<style>${css(f)}</style>
<script>${FIT_JS}</script>${d.composed ? `\n<script>${COMPOSED_FIT_JS}</script>` : ""}
</head>
<body>
<div class="sheet${d.lang === "en" ? " en" : ""}">
<div class="cnt">
  <div class="hd"><div class="ttl">${esc(P.title)}</div><div class="sub">${esc(weekText(d.lang, d.week))}<br>${esc(issuedText(d.lang, d.issued))}</div></div>
  <dl class="info"><dt>${esc(P.period)}</dt><dd>${esc(periodText(d.lang, d.days[0].date, d.days[6].date))}</dd><dt>${esc(P.name)}</dt><dd>${dt(d.name)}</dd></dl>
  <div class="sec">${k(P.summary)}<div class="v">${(d.summary.length ? d.summary : ["—"]).map((l) => `<p class="lead">${dt(l)}</p>`).join("\n")}</div></div>
  <div class="sec">${k(P.daily)}<div class="v">
${days}
  </div></div>
  <div class="sec last">${k(P.projects)}<div class="v">
${shown}
${restRow("r7", rows.slice(MAX_ROWS), composed, taskMax, P.others)}
${rows.length > TRIM_ROWS || composed ? restRow("r5", rows.slice(TRIM_ROWS), composed, taskMax, P.others) : ""}
    <div class="tot"><span>${esc(countText(P.taskCount, d.taskCount))}</span><span>${esc(countText(P.daysWorked, worked))}</span><span>${esc(P.work)}<b>${hoursText(d.totalMinutes)}</b></span>${d.sumMinutes !== undefined && hoursText(d.sumMinutes) !== hoursText(d.totalMinutes) ? `<span>${esc(P.cumulative)}<b class="cum">${hoursText(d.sumMinutes)}</b></span>` : ""}</div>
  </div></div>
</div>
  <div class="foot"><span>worklog</span><span>1 / 1</span></div>
</div>
</body>
</html>`;
}
