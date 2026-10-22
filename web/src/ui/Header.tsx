import { useEffect, useState } from "react";
import { useMachines } from "../api/queries";
import { fmtClock, fmtDate } from "../i18n/format";
import type { StrKey } from "../i18n/strings";
import { t } from "../i18n/t";
import { jstDate } from "../predict/time";
import { useV2 } from "./context";
import { Led } from "./Led";
import { machineLabel, seenText } from "./machine";
import { C } from "./palette";

export function Header({ titleKey }: { titleKey: StrKey }) {
  const { lang } = useV2();
  const machines = useMachines().data ?? [];
  // One 1-second tick feeds both the clock and the date, so the date rolls over at Tokyo midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return (
    <header className="v2-hd">
      <Led text={t(lang, titleKey)} ui size={12} tier={2} color={C.WARM} fit />
      <span className="v2-date"><Led text={fmtDate(now, lang)} ui tier={2} fit /></span>
      <span className="grow" />
      {machines.map((m) => {
        const seen = Date.parse(m.last_seen_at);
        return (
          <span className="mach" key={m.name}>
            <span className="lamp" />
            <Led ui tier={1} color={C.WARM} fit text={Number.isFinite(seen)
              ? t(lang, "machines.synced", { name: machineLabel(m.name), t: seenText(seen, jstDate(now.getTime())) })
              : t(lang, "machines.never", { name: machineLabel(m.name) })} />
          </span>
        );
      })}
      <span className="vr" />
      {/* The clock never animates (spec §6.3): a Led whose every change is a plain redraw. */}
      <Led text={fmtClock(now)} size={8} scale={2} tier={0} fit still className="v2-clock" />
    </header>
  );
}
