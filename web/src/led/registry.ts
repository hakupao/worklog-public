import type { Board } from "./board";

/** Every mounted <Led>: its board and its ink twin. The world transitions walk this list (in document
 *  order) and pair the two worlds by slot identity. */
export interface Slot { board: Board; ink: HTMLElement }
const all = new Set<Slot>();
export const registerSlot = (s: Slot) => { all.add(s); };
export const unregisterSlot = (s: Slot) => { all.delete(s); };
export function slots(): Slot[] {
  return [...all].sort((a, b) => (a.board.cv.compareDocumentPosition(b.board.cv) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}
export function __resetRegistryForTests() { all.clear(); }
