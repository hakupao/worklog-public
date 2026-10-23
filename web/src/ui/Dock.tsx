import { useEffect, useRef, useState, type RefObject } from "react";
import type { StrKey } from "../i18n/strings";
import { t } from "../i18n/t";
import { setMobileOptOut } from "../m/route";
import { withoutOverride } from "../prefs/overrides";
import { LANGS, type Lang } from "../prefs/types";
import { replaceHash, v2Href, type V2Page } from "../route";
import { leave, toggleWorld } from "../world/transitions";
import { useV2 } from "./context";

const NAV: V2Page[] = ["now", "timeline", "tasks", "plan", "report", "stats", "usage"];

/** A ?world= / ?lang= override is a one-off view and never reaches prefs: when the user picks a
 *  value on the dock, the override leaves the hash first, then the setting is written. */
export function dropHashOverride(key: "world" | "lang"): void {
  const cur = window.location.hash, next = withoutOverride(cur, key);
  if (next !== cur) replaceHash(next);
}

/** How close to the bottom edge the pointer must come to raise an auto-hidden dock, and how long it stays up after
 *  the pointer and keyboard focus have left it. */
export const DOCK_EDGE_PX = 40;
export const DOCK_HIDE_MS = 1000;

/** prefs.dock "auto": whether the dock is up. Up while the pointer is in the bottom strip or on the dock, or keyboard
 *  focus is inside it (a mouse click also focuses a link, so only :focus-visible counts); down DOCK_HIDE_MS after all
 *  of these end. Touch screens keep it up in CSS (no hover to reach it with). */
function useDockUp(auto: boolean, nav: RefObject<HTMLElement | null>): boolean {
  const [up, setUp] = useState(!auto);
  useEffect(() => {
    setUp(!auto);
    const el = nav.current;
    if (!auto || !el) return;
    let timer = 0, near = false, focus = false;
    const sync = () => {
      window.clearTimeout(timer);
      if (near || focus) setUp(true);
      else timer = window.setTimeout(() => setUp(false), DOCK_HIDE_MS);
    };
    const move = (e: PointerEvent) => {
      const n = e.clientY >= window.innerHeight - DOCK_EDGE_PX || el.contains(e.target as Node);
      if (n !== near) { near = n; sync(); }
    };
    const out = (e: PointerEvent) => { if (!e.relatedTarget && near) { near = false; sync(); } };   // left the window
    const fin = (e: FocusEvent) => {
      let kb = true;
      try { kb = (e.target as Element).matches(":focus-visible"); } catch { /* no :focus-visible: treat as keyboard */ }
      if (kb !== focus) { focus = kb; sync(); }
    };
    const fout = (e: FocusEvent) => { if (focus && !el.contains(e.relatedTarget as Node | null)) { focus = false; sync(); } };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", out);
    el.addEventListener("focusin", fin);
    el.addEventListener("focusout", fout);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", out);
      el.removeEventListener("focusin", fin);
      el.removeEventListener("focusout", fout);
    };
  }, [auto, nav]);
  return up;
}

export function Dock({ page, onNote }: { page: V2Page; onNote: () => void }) {
  const { lang, setLang, prefs } = useV2();
  const nav = useRef<HTMLElement>(null);
  const auto = prefs.dock === "auto", up = useDockUp(auto, nav);
  const go = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    // Same page: no hashchange would follow, so a fade-out would leave the page dark. Do nothing.
    if (window.location.hash.split("?")[0] === href) return;
    leave(() => { window.location.hash = href; });
  };
  const link = (p: V2Page, key: StrKey) => (
    <a key={p} className={`dk${p === page ? " on" : ""}`} href={v2Href(p)} aria-current={p === page ? "page" : undefined}
      onClick={(e) => go(e, v2Href(p))}>{t(lang, key)}</a>
  );
  return (
    <>
    <nav ref={nav} className={`dock lg2${up ? "" : " away"}`} id="dock" data-edge="12" aria-label={t(lang, "nav.pages")}>
      <span className="brand"><i />{t(lang, "nav.brand")}</span>
      {NAV.map((p) => link(p, `nav.${p}` as StrKey))}
      <span className="sep" />
      <div className="seg" role="group" aria-label={t(lang, "nav.langGroup")}>
        {LANGS.map((l: Lang) => (
          <button key={l} type="button" className={`dk${l === lang ? " on" : ""}`} aria-pressed={l === lang}
            onClick={(e) => { dropHashOverride("lang"); setLang(l, e.currentTarget); }}>{t(lang, `lang.${l}` as StrKey)}</button>
        ))}
      </div>
      <span className="sep" />
      <button id="wBtn" type="button" className="dk wbtn" title="W" aria-label={t(lang, "world.toggle")}
        onClick={(e) => { dropHashOverride("world"); void toggleWorld(e.currentTarget); }}><i /><span>{t(lang, "world.label")}</span></button>
      {link("settings", "nav.settings")}
      <span className="sep" />
      <button type="button" className="dk amber" onClick={onNote}>{t(lang, "nav.note")}</button>
    </nav>
    {auto && <span className="dock-hint" aria-hidden="true" />}
    {/* outside the dock: the dock is transformed (a containing block for fixed children) and clipped on a phone */}
    <a className="dk mob" href="#/m/now" onClick={() => setMobileOptOut(false)}>{t(lang, "m.mobile")}</a>
    </>
  );
}
