/** A 2D context that records every drawing call with the fill and alpha in force at that moment. A gradient is
 *  recorded at its creation and at each addColorStop; as a fill it reads "gradient". */
export type Call = { op: string; args: unknown[]; fill: string; alpha: number; stroke?: string; lw?: number };
export function rec(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { fillStyle: "#000000", strokeStyle: "#000000", globalAlpha: 1, font: "", textAlign: "start", textBaseline: "alphabetic", lineWidth: 1 };
  const push = (op: string, args: unknown[]) => { calls.push(op === "stroke" ? { op, args, fill: String(ctx.fillStyle), alpha: Number(ctx.globalAlpha), stroke: String(ctx.strokeStyle), lw: Number(ctx.lineWidth) } : { op, args, fill: String(ctx.fillStyle), alpha: Number(ctx.globalAlpha) }); };
  for (const op of [
    "beginPath", "arc", "fill", "fillRect", "drawImage", "clearRect", "save", "restore", "fillText", "setTransform", "stroke", "moveTo", "lineTo", "strokeRect",
    "closePath", "quadraticCurveTo", "bezierCurveTo", "translate", "scale", "clip", "rotate", "ellipse", "setLineDash",
  ]) {
    ctx[op] = (...args: unknown[]) => push(op, args);
  }
  for (const op of ["createLinearGradient", "createRadialGradient"]) {
    ctx[op] = (...args: unknown[]) => {
      push(op, args);
      return { addColorStop: (...a: unknown[]) => push("addColorStop", a), toString: () => "gradient" };
    };
  }
  ctx.measureText = (s: string) => ({ width: s.length * 6 });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
