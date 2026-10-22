import { useEffect, useRef } from "react";
import { enter, swap } from "../../ink/fx";
import { motion } from "../../led/motion";
import type { InkFx, Trigger } from "../../prefs/types";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";

const LANG_SAMPLES = ['<span lang="zh-CN">运行中 · 下一步</span>', '<span lang="ja">運行中・次</span>', '<span lang="en">RUNNING · NEXT</span>'];

export function InkPreview({ trigger, fx }: { trigger: Trigger; fx: InkFx }) {
  const { lang } = useV2();
  const box = useRef<HTMLButtonElement>(null), a = useRef<HTMLSpanElement>(null), b = useRef<HTMLSpanElement>(null), i = useRef(0);
  const data = () => [t(lang, "settings.preview.data"), t(lang, "settings.preview.data2")];
  const play = () => {
    const r = box.current!.getBoundingClientRect();
    motion.origin = { x: r.left + 10, y: r.top + r.height / 2 };
    if (trigger === "load") enter([a.current!, b.current!], fx, box.current!);
    else if (trigger === "lang") { i.current = (i.current + 1) % LANG_SAMPLES.length; swap(a.current!, LANG_SAMPLES[i.current], "lang", fx); }
    else { i.current = (i.current + 1) % 2; swap(a.current!, data()[i.current], "data", fx); }
  };
  useEffect(() => {
    if (trigger === "load") { a.current!.innerHTML = '<span lang="ja">作業記録・週報システム開発</span>'; b.current!.textContent = t(lang, "settings.preview.load"); }
    else if (trigger === "lang") swap(a.current!, LANG_SAMPLES[0], "lang", "none");
    else swap(a.current!, data()[0], "data", "none");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { play(); }, [fx]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button type="button" ref={box} className="pvo" onClick={play} aria-label={t(lang, "settings.replay")}>
      <span ref={a} className="ink s12 t1" />{trigger === "load" && <span ref={b} className="ink s10 t2" />}
      <span className="pv-hint" aria-hidden="true">▶ {t(lang, "settings.replay")}</span>
    </button>
  );
}
