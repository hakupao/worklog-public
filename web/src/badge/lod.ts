export type Level = "S" | "M" | "L";
/** Spec §2.3: pick the detail level from the displayed CSS height, so a badge is never a shrunk picture. */
export const levelFor = (cssHeight: number): Level => (cssHeight <= 24 ? "S" : cssHeight <= 48 ? "M" : "L");
