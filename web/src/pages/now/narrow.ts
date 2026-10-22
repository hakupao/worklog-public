import { useSyncExternalStore } from "react";

/** The narrow layout (≤1400px, prototype now-c3a.html:312): the title block's date drops to size 10 and the scene keys
 *  to one glyph. Same breakpoint as the ≤1400px block in v2.css. */
const NARROW = "(max-width:1400px)";
const narrowMq = () => (typeof window.matchMedia === "function" ? window.matchMedia(NARROW) : null);
const subscribeNarrow = (cb: () => void) => { const mq = narrowMq(); mq?.addEventListener("change", cb); return () => mq?.removeEventListener("change", cb); };
export const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => narrowMq()?.matches ?? false, () => false);
