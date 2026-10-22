// server/src/report/pdf/fonts.ts
// Google Fonts answers a current browser with variable fonts, which Chromium prints as Type 3 (soft in some PDF
// viewers); an old browser gets static instances, printed as CID TrueType (verified 2026-10-08). So the Worker asks
// once, with an old UA and only this page's characters, and inlines that CSS; the font files themselves are still
// fetched by the page. "…" is always asked for: the line clamp draws it, it is not in the text. Any failure keeps the <link> (variable fonts, still a valid PDF). One fetch + string ops only
// (Workers Free: 10 ms CPU).
const OLD_UA = "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.100 Safari/534.30";
const LINK = /<link href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)" rel="stylesheet">/;
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export async function staticFonts(html: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const m = LINK.exec(html);
  if (!m) return html;
  try {
    const body = html.slice(Math.max(0, html.indexOf("<body")))
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, "");
    const chars = [...new Set(Array.from(`${unesc(body)}…`.replace(/[\r\n\t]+/g, "")))].join("");   // U+0020 / U+2009 are drawn: keep (R13)
    const url = `${unesc(m[1])}&text=${encodeURIComponent(chars)}`;
    const r = await fetchFn(url, { headers: { "User-Agent": OLD_UA } });
    if (!r.ok) { console.error("[pdf] static fonts", r.status); return html; }
    const css = await r.text();
    return html.replace(m[0], () => `<style>${css}</style>`);
  } catch (e) {
    console.error("[pdf] static fonts", e);
    return html;
  }
}
