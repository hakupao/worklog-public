import type { ReactNode } from "react";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { dayTitle, stepDay } from "../format";

export function DayNav({ date, today, min, max, onGo, sub }: {
  date: string; today: string; min?: string; max?: string; onGo: (dir: 1 | -1) => void; sub: ReactNode;
}) {
  const { lang } = useV2();
  return (
    <div className="m-daynav">
      <button type="button" className="m-arr" aria-label={t(lang, "m.day.prev")} disabled={stepDay(date, -1, min, max) === null} onClick={() => onGo(-1)}>‹</button>
      <div className="m-day"><b>{dayTitle(date, today, lang)}</b><span>{sub}</span></div>
      <button type="button" className="m-arr" aria-label={t(lang, "m.day.next")} disabled={stepDay(date, 1, min, max) === null} onClick={() => onGo(1)}>›</button>
    </div>
  );
}
