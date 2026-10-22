import type { ReactNode } from "react";
import { isModuleHidden } from "../world/modules";
import { useWorld } from "../world/store";
import { useV2 } from "./context";

/** A configurable 表 module: not rendered at all in 表 when the user hid it (spec §5.2). */
export function Mod({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const { prefs } = useV2(), world = useWorld();
  if (isModuleHidden(id, prefs.omote.hide, world)) return null;
  return <div data-mod={id} className={className}>{children}</div>;
}
