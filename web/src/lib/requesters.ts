/** A 案件's 依頼元 are stored as ONE string joined by "、" — same rule as the server's
 *  server/src/requesters.ts (split also accepts "," / "，"; blanks and repeats dropped). */
export const REQUESTER_SEPARATOR = "、";

export function splitRequesters(requester: string): string[] {
  const parts = requester.split(/[、,，]/).map((p) => p.trim()).filter(Boolean);
  return [...new Set(parts)];
}

export function joinRequesters(names: string[]): string {
  return names.join(REQUESTER_SEPARATOR);
}
