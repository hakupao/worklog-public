/** True when the user asked for less motion — and when matchMedia is missing (jsdom), so tests see final states. */
export const reducedMotion = () => typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
