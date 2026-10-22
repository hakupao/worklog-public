import type { CSSProperties } from "react";
import { t } from "../../i18n/t";
import type { Running, Snapshot } from "../../predict/snapshot";
import { hmOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { machineLabel } from "../../ui/machine";
import { Led } from "../../ui/Led";
import { C, lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { elapsed, taskCode } from "./format";

export const MAX_RUN_ROWS = 3;

/** 运行中: sessions running as of their machine's last collection (spec §7.4). */
export function RunRows({ snap }: { snap: Snapshot }) {
  const { lang } = useV2();
  const n = snap.running.length;
  return (
    <>
      <div className="sec"><span className={`lamp${n ? " live" : ""}`} /><Led ui size={12} tier={2} fit color={C.GREEN} text={t(lang, "now.run.title", { n })} /></div>
      {n === 0
        ? <div className="row run empty"><span className="nm"><Led ui tier={3} clip className="fill" text={t(lang, "now.run.none")} /></span></div>
        : snap.running.slice(0, MAX_RUN_ROWS).map((r) => <RunRow key={r.session.id} r={r} snap={snap} />)}
    </>
  );
}

function RunRow({ r, snap }: { r: Running; snap: Snapshot }) {
  const { lang } = useV2();
  const x = r.session, task = x.taskId ? snap.tasks[x.taskId] : undefined, k = x.taskId ?? undefined, lc = lineColor(x.taskId);
  return (
    <div className="row run" data-task={k} style={{ "--lc": lc } as CSSProperties}>
      <Led tier={1} fit text={hmOf(r.since)} />
      {x.taskId ? <TaskBadge id={x.taskId} height={BADGE_H.row} /> : <Led tier={1} fit text={[{ t: taskCode(null), kind: "dim" }]} />}
      <span className="nm">
        {task
          ? <Led size={12} tier={1} clip className="fill" task={k} text={task.title} />
          : <Led ui size={12} tier={1} clip className="fill" text={t(lang, "now.run.unlinked")} />}
      </span>
      <Led tier={2} fit className="mach" text={machineLabel(x.machine)} />
      <span className="end"><Led size={8} scale={2} tier={0} align="right" color={C.GREEN} className="fill" text={elapsed(r.until - r.since)} /></span>
    </div>
  );
}
