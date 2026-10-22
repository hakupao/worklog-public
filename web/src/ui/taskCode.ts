/** Assumption 13: until sub-project 4 names task codes, the MMDD-NN of the task id.
 *  A leaf module (no imports) so the phone shell can reach it without pulling in led|ink. */
export function taskCode(id: string | null): string {
  if (!id) return "--";
  const m = /^T\d{4}(\d{4})-(\d+)$/.exec(id);
  return m ? `${m[1]}-${m[2]}` : id.slice(-7);
}
