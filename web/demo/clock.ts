// The demo's clock (PLAN D3). The demo site and the build that seeds demo.sqlite both run on this shifted clock, so
// "now" in the fictional data and "now" on the page are the same moment: DEMO_NOW at load, then moving at real speed.

/** The fixed moment the demo starts at (a Thursday afternoon, JST). The seed generator imports it too. */
export const DEMO_NOW_ISO = "2026-10-15T15:20:00+09:00";
export const DEMO_NOW = Date.parse(DEMO_NOW_ISO);

let installed = false;

/** Replaces the global Date so `Date.now()`, `new Date()` and `Date()` (no arguments) read
 *  DEMO_NOW + (real now − install time). With arguments, `Date.UTC`, `Date.parse`, the prototype and `instanceof`
 *  stay the real ones (a Proxy over the real constructor, not a subclass). Idempotent. */
export function installClock(start: number = DEMO_NOW): void {
  if (installed) return;
  installed = true;
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  const offset = start - realNow();
  const now = () => realNow() + offset;
  const ShiftedDate: DateConstructor = new Proxy(RealDate, {
    construct(target, args, newTarget): object {
      return Reflect.construct(target, args.length ? args : [now()], newTarget === ShiftedDate ? target : newTarget);
    },
    apply() {
      return new RealDate(now()).toString();
    },
    get(target, key, receiver) {
      if (key === "now") return now;
      return Reflect.get(target, key, receiver === ShiftedDate ? target : receiver);
    },
  });
  RealDate.prototype.constructor = ShiftedDate;   // `d.constructor === Date` stays true
  globalThis.Date = ShiftedDate;
}
