import { useEffect, useRef } from "react";
import { Board } from "../../led/board";
import { loadPixelFont } from "../../led/fonts";
import { motion } from "../../led/motion";
import type { Glyph, LedFx, Trigger } from "../../prefs/types";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";

const SAMPLES: Record<Trigger, { t: string; glyph: Glyph }[]> = {
  load: [],      // filled from t("settings.preview.load") at play time
  lang: [{ t: "运行中 · 下一步", glyph: "zh" }, { t: "運行中・次", glyph: "ja" }, { t: "RUNNING · NEXT", glyph: "zh" }],
  data: [{ t: "作業記録・週報システム開発", glyph: "ja" }, { t: "セッション 51 ターン · 39.29 USD", glyph: "ja" }],
};

export function FxPreview({ trigger, fx }: { trigger: Trigger; fx: LedFx }) {
  const { lang } = useV2();
  const cv = useRef<HTMLCanvasElement>(null), board = useRef<Board | null>(null), i = useRef(0);
  const play = () => {
    const b = board.current; if (!b) return;
    const r = b.cv.getBoundingClientRect();
    motion.origin = { x: r.left + 20, y: r.top + r.height / 2 };
    if (trigger === "load") b.set(t(lang, "settings.preview.load"), { fx, fromBlank: true });
    else { i.current = (i.current + 1) % SAMPLES[trigger].length; const s = SAMPLES[trigger][i.current]; b.set([{ t: s.t, glyph: s.glyph }], { fx }); }
  };
  useEffect(() => {
    const b = new Board(cv.current!, { size: 12, dim: 0.05, glow: 1, marquee: false });
    board.current = b;
    let cancelled = false;
    Promise.all([loadPixelFont(12, "zh"), loadPixelFont(12, "ja")]).then(() => {
      if (cancelled) return;
      if (trigger === "load") play();
      else { const s = SAMPLES[trigger][0]; b.set([{ t: s.t, glyph: s.glyph }], { animate: false }); }
    });
    return () => { cancelled = true; b.dispose(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { play(); }, [fx]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button type="button" className="pv" onClick={play} aria-label={t(lang, "settings.replay")}>
      <canvas ref={cv} aria-hidden="true" /><span className="pv-hint" aria-hidden="true">▶ {t(lang, "settings.replay")}</span>
    </button>
  );
}
