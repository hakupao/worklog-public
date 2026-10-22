const HREF = "https://fonts.googleapis.com/css2?family=Doto:wght@900&display=swap";
/** Doto: dot-matrix numbers in both themes (Latin only; CJK uses the system font). */
export function ensureMobileFonts(): void {
  if (document.querySelector("link[data-m-fonts]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = HREF; l.dataset.mFonts = "";
  document.head.appendChild(l);
}
