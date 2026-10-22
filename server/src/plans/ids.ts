import { jstNow } from "../jst";

/** "P20261002-101530-a3f91c2e": the JST stamp keeps ids readable and roughly ordered; the random tail
 *  makes two writes in the same second distinct without the notes route's retry loop. */
export function newId(prefix: "P" | "D"): string {
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}${jstNow().stamp}-${tail}`;
}
