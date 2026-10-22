const HREFS = [
  "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;600&family=BIZ+UDPGothic:wght@400;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+JP:wght@400;500;600&family=Geist:wght@400;500;600&display=swap",
  "https://rsms.me/inter/inter.css",
];
/** The DOM typefaces v2 uses (drawers, 表 ink, settings). Only v2 loads them; the old UI is unaffected. */
export function ensureWebFonts(): void {
  if (document.querySelector("link[data-v2-fonts]")) return;
  for (const href of HREFS) {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.dataset.v2Fonts = "";
    document.head.appendChild(l);
  }
}
