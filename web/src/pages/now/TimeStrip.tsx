import { useEffect, useMemo, useState } from "react";
import { lit, disc } from "../../chart/canvas";
import { useCanvas } from "../../chart/useCanvas";
import { makeCalendar, type Calendar, type DayCell } from "../../cal/calendar";
import { sunTimes } from "../../cal/sun";
import { t } from "../../i18n/t";
import { bits, type Bitmap } from "../../led/bits";
import { loadPixelFont } from "../../led/fonts";
import { PITCH } from "../../led/lattice";
import type { Lang } from "../../prefs/types";
import { weekdayOfDate } from "../../predict/dates";
import { hmOf, jstDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C, TIER_GLOW } from "../../ui/palette";
import { useWorld } from "../../world/store";
import { countdownText, rankTiers } from "./countdown";
import { useNarrow } from "./narrow";
import { hourTier, useMonthHours, type MonthHours } from "./useMonthHours";

type Tier = 0 | 1 | 2 | 3;
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const tierAt = (n: number) => Math.min(3, Math.max(0, n)) as Tier;
/** The date block's weekday is always the Japanese one (「火」), in every language (prototype `wdJ`). */
const WD_JA = "日月火水木金土";

/** 此刻 title block (spec §2.2; prototype now-c3a.html:260-320, 996-1094): one full-width hairline table — the
 *  countdown rows, the month calendar and the date block share one 30px header row and five body rows (six in a
 *  6-week month, at a lower row height: `.w6`). `now` is the snapshot's ms; the strip reads its JST date per minute. */
export function TimeStrip({ now }: { now: number }) {
  const { prefs, lang } = useV2();
  const today = jstDate(now);
  const cal = useMemo(() => makeCalendar(prefs.cal), [prefs.cal]);
  const rows = useMemo(() => cal.countdowns(today), [cal, today]);
  const grid = useMemo(() => cal.monthGrid(today), [cal, today]);
  const hours = useMonthHours(today);
  const w6 = grid.length > 5;
  return (
    <div className={`tstrip${w6 ? " w6" : ""}`} role="group" aria-label={t(lang, "now.time.label")}>
      <div className="ttl">
        <Countdowns rows={rows} today={today} lang={lang} payday={prefs.cal.payday} />
        <span className="vr" />
        <MonthGrid grid={grid} today={today} cal={cal} hours={hours} lang={lang} />
      </div>
      <span className="vr" />
      <DateBlock now={now} today={today} cal={cal} hours={hours} lang={lang} />
    </div>
  );
}

function Countdowns({ rows, today, lang, payday }: { rows: ReturnType<Calendar["countdowns"]>; today: string; lang: Lang; payday: number }) {
  const tiers = rankTiers(rows.length), narrow = useNarrow();
  return (
    <section className="eph">
      <div className="eph-g">
        <div className="er hd2">
          <span className="cell ttl2"><Led ui fit size={10} tier={2} text={t(lang, narrow ? "now.time.titleShort" : "now.time.title")} /></span>
          <span className="cell"><Led ui fit size={8} tier={3} text={t(lang, "now.time.h.date")} /></span>
          <span className="cell r"><Led ui fit size={8} tier={3} text={t(lang, "now.time.h.in")} /></span>
          <span className="cell r"><Led ui fit size={8} tier={3} text={t(lang, "now.time.h.biz")} /></span>
        </div>
        {rows.map((c, i) => {
          // Flighty rule: the row's rank sets the days column; the labels sit a step or so below it.
          const x = countdownText(c, today, payday, lang), r = tiers[i], lo = tierAt(Math.max(2, r + 1)), mid = tierAt(Math.max(1, r));
          return (
            <div className="er" key={c.kind}>
              <span className="cell c-kind"><Led fit size={8} tier={mid} text={x.kind} /></span>
              <span className="cell c-what"><Led clip size={8} tier={lo} className="fill" text={x.what} /></span>
              <span className="cell c-date"><Led ui fit size={8} tier={mid} text={x.date} /></span>
              <span className="cell r c-in"><Led ui fit size={8} tier={r} text={x.days} /></span>
              <span className="cell r c-biz"><Led ui fit size={8} tier={lo} text={x.biz} /></span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MonthGrid({ grid, today, cal, hours, lang }: { grid: (DayCell | null)[][]; today: string; cal: Calendar; hours: MonthHours | null; lang: Lang }) {
  const world = useWorld(), omote = world === "omote";
  const wd = t(lang, "now.time.wd"), heads = [1, 2, 3, 4, 5, 6, 0].map((i) => wd[i]);
  const thisWeek = cal.ephemeris(today).isoWeek;
  const tierOf = (c: DayCell) => (c.future ? 0 : hourTier(hours?.byDate.get(c.date)));

  // 里: one canvas under the table — each day a lattice patch lit at its hour tier, the digit in LED dots on top.
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => { let live = true; void loadPixelFont(8, "zh").then(() => { if (live) setFontTick((n) => n + 1); }); return () => { live = false; }; }, []);
  const cv = useCanvas((x, w, h, offX, offY) => {
    x.clearRect(0, 0, w, h);
    if (omote) return;
    drawUraMonth(x, grid, tierOf, w, h, offX, offY);
  }, [grid, hours, omote, fontTick]);

  return (
    <div className="calz">
      <div className={`cal-g${omote ? " om" : ""}`} role="grid" aria-label={t(lang, "now.time.cal", { m: Number(today.slice(5, 7)) })}>
        <div className="hd-row" role="row">
          {omote && <span className="ch iso"><Led ui fit size={8} tier={3} text={t(lang, "now.time.iso")} /></span>}
          {heads.map((h, i) => (
            <span key={i} className="ch" role="columnheader"><Led ui fit size={8} tier={i >= 5 ? 3 : 2} text={h} /></span>
          ))}
        </div>
        {grid.map((wk, j) => {
          const iso = cal.ephemeris(wk.find((c): c is DayCell => c !== null)!.date).isoWeek;
          return (
            <div className="wk-row" role="row" key={j}>
              {omote && <span className="iso"><Led ui fit size={8} tier={iso === thisWeek ? 1 : 3} text={`W${iso}`} /></span>}
              {wk.map((c, i) => {
                if (!c) return <span key={i} className="day nil" />;
                const min = hours?.byDate.get(c.date), hol = cal.holidayName(c.date, lang);
                const cls = `day${c.off ? " off" : ""}${c.holiday ? " hol" : ""}${c.today ? " today" : ""}${c.future ? " future" : ""}`;
                const label = `${c.date}${hol ? ` ${hol}` : ""}${!c.future && min ? ` ${(min / 60).toFixed(1)}h` : ""}`;
                return (
                  <span key={i} role="gridcell" className={cls} data-date={c.date} data-h={tierOf(c)} aria-label={label} aria-current={c.today ? "date" : undefined}>
                    <span className="dn" aria-hidden="true">{c.d}</span>
                  </span>
                );
              })}
            </div>
          );
        })}
        <canvas ref={cv} className="cal-cv" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Patch brightness per hour tier 1..4 (prototype `lv`); weekends and 祝日 at 0.6 of it. */
const LV = [0, 0.08, 0.16, 0.27, 0.4];

/** The digit's origin (lattice indices) so that its lit dots, not its 8-row em box, sit centred in the patch
 *  [i0, i1] × [j0, j1]: the 8px digits light rows 0–5 only, and centring the em box put their top row on the patch edge. */
export function glyphOrigin(b: Bitmap, i0: number, i1: number, j0: number, j1: number): { ox: number; oy: number } {
  let r0 = b.h, r1 = -1, q0 = b.w, q1 = -1;
  for (let r = 0; r < b.h; r++) for (let q = 0; q < b.w; q++) {
    if (!b.on[r * b.w + q]) continue;
    r0 = Math.min(r0, r); r1 = Math.max(r1, r); q0 = Math.min(q0, q); q1 = Math.max(q1, q);
  }
  if (r1 < 0) return { ox: i0, oy: j0 };
  return { ox: i0 + Math.floor((i1 - i0 + 1 - (q1 - q0 + 1)) / 2) - q0, oy: j0 + Math.floor((j1 - j0 + 1 - (r1 - r0 + 1)) / 2) - r0 };
}

/** Today's field floor: a dim warm patch even before today has hours; with hours it lights at its tier (review I1). */
const TODAY_FIELD = 0.2;

/** 里 month field on the page-wide PITCH lattice. Every day is a patch of dots that keeps one clear dot from the strip's
 *  hairlines; future days and days without hours show only the unlit board. Today (T10 verdict 5): no ring — a 7-row
 *  patch (at the old 3px lattice; ~1.5× the rows at PITCH 2, the rule kept) had no room for a ring or an underline with
 *  a clear dot to a 6-row digit — but its field in the warm hue at its
 *  hour tier (at least TODAY_FIELD) under a digit at full brightness and full glow, the brightest digit of the month. */
export function drawUraMonth(x: CanvasRenderingContext2D, grid: (DayCell | null)[][], tierOf: (c: DayCell) => number,
  w: number, h: number, offX: number, offY: number, bitsFn: (text: string, size: 8, glyph: "zh") => Bitmap = bits): void {
  const CW = w / 7, CH = h / grid.length, P = PITCH, H = P / 2, R = P * 0.4;
  // lattice indices whose dot centre (off + k·P + P/2) lies inside [a, b]
  const span = (a: number, b: number, off: number): [number, number] => [Math.ceil((a - off - H) / P), Math.floor((b - off - H) / P)];
  grid.forEach((wk, j) => wk.forEach((c, i) => {
    if (!c) return;
    const [i0, i1] = span(i * CW + 2, (i + 1) * CW - 2, offX), [j0, j1] = span(j * CH + 2.6, (j + 1) * CH - 2.6, offY);
    const tier = tierOf(c);
    for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
      const px = offX + ii * P + H, py = offY + jj * P + H;
      if (c.today) { x.globalAlpha = Math.max(TODAY_FIELD, LV[tier] ?? 0); lit(x, px, py, R, C.WARM, 0.2); x.globalAlpha = 1; continue; }
      if (c.future || !tier) { disc(x, px, py, P * 0.3, "rgba(255,236,214,.05)"); continue; }
      x.globalAlpha = LV[tier] * (c.off ? 0.6 : 1);
      lit(x, px, py, R, C.AMBER, 0.2);
      x.globalAlpha = 1;
    }
    // the digit, centred in its patch; on today's field its dots replace the field's
    const b = bitsFn(String(c.d), 8, "zh");
    if (!b.w) return;
    const { ox, oy } = glyphOrigin(b, i0, i1, j0, j1);
    x.globalAlpha = c.today ? 1 : c.future ? 0.18 : c.off ? 0.36 : tier ? 0.95 : 0.6;
    for (let r = 0; r < b.h; r++) for (let q = 0; q < b.w; q++) {
      if (b.on[r * b.w + q]) lit(x, offX + (ox + q) * P + H, offY + (oy + r) * P + H, R, C.WARM, c.today ? TIER_GLOW[0] : 0.6);
    }
    x.globalAlpha = 1;
  }));
}

function DateBlock({ now, today, cal, hours, lang }: { now: number; today: string; cal: Calendar; hours: MonthHours | null; lang: Lang }) {
  const eph = cal.ephemeris(today), biz = cal.bizOfMonth(today), sun = sunTimes(today), narrow = useNarrow();
  const md = `${today.slice(5, 7)}/${today.slice(8, 10)}`;
  const rec = hours
    ? t(lang, "now.time.rec", { a: hours.recorded, b: hours.pastDays })
    : t(lang, "now.time.rec", { a: "-", b: Number(today.slice(8, 10)) });
  return (
    <section className="tbz">
      <div className="tb">
        <div className="c c-bas"><Led ui fit size={8} tier={3} text={t(lang, "now.time.basis", { t: `${md} ${hmOf(now)}` })} /></div>
        <div className="c c-date dom"><Led ui fit size={narrow ? 10 : 12} tier={0} text={[{ t: `${today} ` }, { t: WD_JA[weekdayOfDate(today) % 7], glyph: "ja" }]} /></div>
        <div className="c c-wk"><Led ui fit size={8} tier={2} text={`W${eph.isoWeek} · FY${eph.fy} Q${eph.fq}`} /></div>
        <div className="c c-biz">
          <Led ui fit size={8} tier={2} text={biz.index ? t(lang, "now.time.biz", { a: biz.index, b: biz.total, c: biz.left }) : t(lang, "now.time.off", { c: biz.left })} />
        </div>
        <div className="c c-war"><Led fit size={8} tier={2} text={[{ t: eph.wareki, glyph: "ja" }]} /></div>
        <div className="c c-rec"><Led ui fit size={8} tier={3} text={rec} /></div>
        <div className="c c-sun"><Led ui fit size={8} tier={3} text={t(lang, "now.scene.sunset", { t: hm(Math.round(sun.set)) })} /></div>
        <div className="c c-rise"><Led ui fit size={8} tier={3} text={t(lang, "now.time.sunrise", { t: hm(Math.round(sun.rise)) })} /></div>
        <div className="c c-foot"><Led ui clip size={8} tier={3} className="fill" text={t(lang, "now.time.foot", { m: Number(today.slice(5, 7)) })} /></div>
      </div>
    </section>
  );
}
