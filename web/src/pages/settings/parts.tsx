import type { MouseEvent, ReactNode } from "react";

/** One settings row: name + description, the controls, and an optional live preview. A wide row has no
 *  preview column, so its controls get the room. */
export function Item({ name, desc, children, aside, wide = false }: { name: string; desc: string; children: ReactNode; aside?: ReactNode; wide?: boolean }) {
  return (
    <div className={`it${wide ? " wide" : ""}`}>
      <div className="nmx"><b>{name}</b><span>{desc}</span></div>
      <div className="opts">{children}</div>
      {!wide && <div>{aside}</div>}
    </div>
  );
}
export function Opt({ on, onClick, children }: { on: boolean; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return <button type="button" className="opt" aria-pressed={on} onClick={onClick}>{children}</button>;
}
