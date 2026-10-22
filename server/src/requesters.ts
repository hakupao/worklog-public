/**
 * A 案件 can have several 依頼元, stored in the one `tasks.requester` TEXT column joined by "、"
 * (no schema change: the CLI, sync and PUT keep writing a plain string). Splitting also accepts
 * "," / "，" so a hand-typed "A, B" reads the same as "A、B". Blank parts and repeats are dropped,
 * first-appearance order kept. The web client has a copy of this rule (web/src/lib/requesters.ts).
 */
export function splitRequesters(requester: string): string[] {
  const parts = requester.split(/[、,，]/).map((p) => p.trim()).filter(Boolean);
  return [...new Set(parts)];
}
