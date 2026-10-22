// The views' own text (tooltips, key figures, screen-reader summaries) in all three languages, kept in the lazy
// views chunk so V2App does not carry it (controller decision after Task 4). The views' names and the lines on
// what they reveal (`sv.<id>.name/desc`) and the frame's words stay in i18n/strings.ts.
import type { Lang } from "../../../prefs/types";

export const VSTRINGS = {
  "wall": { zh: "墙钟 {v}", ja: "実時間 {v}", en: "Wall clock {v}" },
  "hours24.meta": { zh: "最忙 {h}", ja: "ピーク {h}", en: "Peak {h}" },
  "hours24.tip": { zh: "{a}–{b}", ja: "{a}–{b}", en: "{a}–{b}" },
  "hours24.sum": { zh: "最忙的小时 {h}，墙钟 {v}；全区间合计 {t}", ja: "一番忙しい時間 {h}、実時間 {v}；期間合計 {t}", en: "Busiest hour {h}, {v} wall clock; {t} over the range" },
  "weekday.meta": { zh: "最忙 周{d}", ja: "ピーク {d}曜", en: "Peak {d}" },
  "weekday.perDay": { zh: "{v} / 天", ja: "{v} / 日", en: "{v} / day" },
  "weekday.days": { zh: "{n} 天的平均", ja: "{n} 日の平均", en: "average of {n} days" },
  "weekday.sum": { zh: "每天平均墙钟：{list}", ja: "1 日平均の実時間：{list}", en: "Average wall clock per day: {list}" },
  "wd.name": { zh: "周{d}", ja: "{d}曜", en: "{d}" },
  // a day under the pointer (作息瀑布, 日历热力)
  "tip.wall": { zh: "墙钟 {u} · 累计 {s} · ×{c}", ja: "実時間 {u} · 累計 {s} · ×{c}", en: "wall {u} · summed {s} · ×{c}" },
  "tip.sess": { zh: "{n} 个会话", ja: "{n} セッション", en: "{n} sessions" },
  "tip.at": { zh: "{t} 并行 ×{c}", ja: "{t} 並行 ×{c}", en: "at {t} ×{c}" },
  "tip.idle": { zh: "{t} 没有会话", ja: "{t} セッションなし", en: "at {t} none open" },
  // 洞察头条: each cell = a label, a big figure, two lines
  "hl.meta": { zh: "{n} 个会话", ja: "{n} セッション", en: "{n} sessions" },
  "hl.cell": { zh: "{l} {v}（{a}；{b}）", ja: "{l} {v}（{a}；{b}）", en: "{l} {v} ({a}; {b})" },
  "hl.wall": { zh: "墙钟时长", ja: "実時間", en: "WALL CLOCK" },
  "hl.wall.a": { zh: "会话累计 {s}", ja: "累計 {s}", en: "summed {s}" },
  "hl.wall.b": { zh: "并行多出 {p}", ja: "並行で +{p}", en: "parallel +{p}" },
  "hl.peak": { zh: "最高并行", ja: "最大並行", en: "PEAK PARALLEL" },
  "hl.peak.b": { zh: "同时开着 {n} 个", ja: "{n} 本が同時", en: "{n} open at once" },
  "hl.dense": { zh: "最满的一天", ja: "最も密な日", en: "FULLEST DAY" },
  "hl.dense.a": { zh: "{d} 会话累计", ja: "{d} の累計", en: "{d} summed" },
  "hl.dense.b": { zh: "墙钟只有 {u}", ja: "実時間は {u}", en: "in {u} wall" },
  "hl.long": { zh: "最长单会话", ja: "最長セッション", en: "LONGEST SESSION" },
  "hl.long.a": { zh: "{d} 开始", ja: "{d} 開始", en: "at {d}" },
  "hl.start": { zh: "开工中位", ja: "開始の中央値", en: "MEDIAN START" },
  "hl.start.b": { zh: "满 1 小时的天", ja: "1 時間以上の日", en: "days of 1h+" },
  "hl.end": { zh: "收工中位", ja: "終了の中央値", en: "MEDIAN FINISH" },
  "hl.end.b": { zh: "5:00 前算前一天", ja: "5:00 前は前日", en: "days start 5:00" },
  "hl.med.a": { zh: "{n} 天的中位", ja: "{n} 日の中央値", en: "{n}-day median" },
  "hl.med.none": { zh: "没有满 1 小时的天", ja: "1 時間以上の日がない", en: "no day with 1h or more" },
  "hl.wd": { zh: "最忙的星期", ja: "最も忙しい曜日", en: "BUSIEST WEEKDAY" },
  "hl.wd.a": { zh: "日均墙钟 {h}", ja: "平均 {h}/日", en: "avg {h}/day" },
  "hl.wd.b": { zh: "最闲 {q} {l}", ja: "最少 {q} {l}", en: "least {q} {l}" },
  "hl.cost": { zh: "最贵会话", ja: "最高額セッション", en: "COSTLIEST SESSION" },
  "hl.cost.a": { zh: "{d} {k} tok", ja: "{d} {k} tok", en: "{d} {k} tok" },
  "hl.cost.none": { zh: "没有定价的会话", ja: "価格付きのセッションなし", en: "no priced session" },
  "hl.tok": { zh: "Token", ja: "Token", en: "TOKENS" },
  "hl.tok.a": { zh: "缓存读取 {c}", ja: "再利用 {c}", en: "cached {c}" },
  "hl.tok.b": { zh: "输出只占 {o}", ja: "出力は {o}", en: "output {o}" },
  "hl.tok.none": { zh: "没有 token 记录", ja: "token の記録なし", en: "no tokens recorded" },
  "hl.days": { zh: "活跃天数", ja: "稼働日数", en: "ACTIVE DAYS" },
  "hl.days.a": { zh: "最长连续 {n} 天", ja: "最長連続 {n} 日", en: "streak {n} d" },
  // 作息瀑布
  "wf.meta": { zh: "开工 {s} · 收工 {e}", ja: "開始 {s} · 終了 {e}", en: "start {s} · finish {e}" },
  "wf.sum": { zh: "{n} 天；墙钟 {u}，会话累计 {m}；中位开工 {s}、收工 {e}", ja: "{n} 日；実時間 {u}、累計 {m}；開始の中央値 {s}、終了 {e}", en: "{n} days; {u} wall clock, {m} summed; median start {s}, finish {e}" },
  // 日历热力
  "cal.meta": { zh: "活跃 {a}/{n} 天", ja: "稼働 {a}/{n} 日", en: "active {a}/{n} days" },
  "cal.sum": { zh: "{w} 周；活跃 {a}/{n} 天，最长连续 {s} 天；最长的一天 {d}，墙钟 {h}", ja: "{w} 週；稼働 {a}/{n} 日、最長連続 {s} 日；最長の日 {d}、実時間 {h}", en: "{w} weeks; active {a}/{n} days, longest streak {s}; longest day {d}, {h} wall clock" },
  "cal.cut": { zh: "；被区间截断的周 {w}", ja: "；期間で切れた週 {w}", en: "; weeks cut by the range: {w}" },
  // one day opened (并行编队, 大圆表盘): the day keys and a session's tip
  "day.pick": { zh: "选择日期", ja: "日付を選ぶ", en: "Pick a day" },
  "day.prev": { zh: "前一个有会话的日子", ja: "前の稼働日", en: "Previous day with sessions" },
  "day.next": { zh: "后一个有会话的日子", ja: "次の稼働日", en: "Next day with sessions" },
  "day.peak": { zh: "峰值日", ja: "ピーク日", en: "Peak day" },
  "day.today": { zh: "今天", ja: "今日", en: "Today" },
  "sess.main": { zh: "{a}–{b} · 当日 {m} · {n} 轮", ja: "{a}–{b} · 当日 {m} · {n} ターン", en: "{a}–{b} · {m} that day · {n} turns" },
  "sess.tok": { zh: "{k} token", ja: "{k} token", en: "{k} tokens" },
  // 并行编队
  "river.meta": { zh: "×{c} {d}", ja: "×{c} {d}", en: "×{c} {d}" },
  "river.day": { zh: "{k} 个会话 · 最高 ×{c} {t}", ja: "{k} セッション · 最大 ×{c} {t}", en: "{k} sessions · peak ×{c} {t}" },
  "river.ge": { zh: "×{k} 以上 {h}", ja: "×{k} 以上 {h}", en: "×{k}+ {h}" },
  "river.sum": { zh: "{n} 天的并行度；最高 ×{c}（{d} {t}）。展开 {o}：{k} 个会话，墙钟 {u}，累计 {s}", ja: "{n} 日の並行度；最大 ×{c}（{d} {t}）。展開中 {o}：{k} セッション、実時間 {u}、累計 {s}", en: "Concurrency over {n} days; peak ×{c} ({d} {t}). Opened {o}: {k} sessions, {u} wall clock, {s} summed" },
  // 大圆表盘
  "dial.meta": { zh: "此刻 {t}", ja: "現在 {t}", en: "Now {t}" },
  "dial.fig": { zh: "累计 {s} · 最高 ×{c}", ja: "累計 {s} · 最大 ×{c}", en: "summed {s} · peak ×{c}" },
  "dial.lanes": { zh: "{k} 个会话 · {l} 道", ja: "{k} セッション · {l} 列", en: "{k} sessions · {l} lanes" },
  "dial.sum": { zh: "{d}：墙钟 {u}，累计 {s}，最高并行 ×{c}；{k} 个会话排成 {l} 道", ja: "{d}：実時間 {u}、累計 {s}、最大並行 ×{c}；{k} セッションを {l} 列に", en: "{d}: {u} wall clock, {s} summed, peak ×{c}; {k} sessions in {l} lanes" },
  // a whole session under the pointer (会话星图)
  "sess.whole": { zh: "{d} {a}–{b} · 区间内 {m} · {n} 轮", ja: "{d} {a}–{b} · 期間内 {m} · {n} ターン", en: "{d} {a}–{b} · {m} in range · {n} turns" },
  // 案件时间流
  "stream.meta": { zh: "最多 {k}", ja: "最多 {k}", en: "Most {k}" },
  "stream.sum": { zh: "{w} 周，{n} 项（含未关联）；最多 {k}，墙钟 {h}", ja: "{w} 週、{n} 件（未紐付けを含む）；最多 {k}、実時間 {h}", en: "{w} weeks, {n} tasks (unlinked included); most {k}, {h} wall clock" },
  "stream.week": { zh: "{w} · {a}–{b}", ja: "{w} · {a}–{b}", en: "{w} · {a}–{b}" },
  "stream.cut": { zh: "（区间截断）", ja: "（期間で切れた週）", en: " (cut by the range)" },
  "stream.tot": { zh: "区间合计 {h}", ja: "期間合計 {h}", en: "{h} over the range" },
  // 会话星图
  "stars.meta": { zh: "{n} 个会话 · 最多 {k} token", ja: "{n} セッション · 最大 {k} token", en: "{n} sessions · max {k} tokens" },
  "stars.sum": { zh: "{n} 个会话；最长 {l}（{d}）；token 最多 {k}", ja: "{n} セッション；最長 {l}（{d}）；token 最大 {k}", en: "{n} sessions; longest {l} ({d}); most tokens {k}" },
  "stars.sum.cost": { zh: "；最贵 {c}（{d}）", ja: "；最高額 {c}（{d}）", en: "; costliest {c} ({d})" },
  // 节律指纹
  "fp.meta": { zh: "最常 {w} {h}", ja: "最多 {w} {h}", en: "Peak {w} {h}" },
  "fp.tip": { zh: "{w} {a}–{b}", ja: "{w} {a}–{b}", en: "{w} {a}–{b}" },
  "fp.avg": { zh: "平均 {m} 分钟 / 天", ja: "平均 {m} 分 / 日", en: "avg {m} min / day" },
  "fp.tot": { zh: "合计 {h}（{n} 天）", ja: "合計 {h}（{n} 日）", en: "{h} in total ({n} days)" },
  "fp.wd": { zh: "星期均值", ja: "曜日平均", en: "Weekday average" },
  "fp.hours": { zh: "各小时合计 0 → 23", ja: "時間別合計 0 → 23", en: "Hour totals 0 → 23" },
  "fp.sum": { zh: "最常工作的时段 {w} {h}（平均每天 {m} 分钟）；最忙的小时 {bh}，合计 {v}；最忙的星期 {bw}，平均 {a} / 天", ja: "一番多い時間帯 {w} {h}（1 日平均 {m} 分）；一番忙しい時間 {bh}、合計 {v}；一番忙しい曜日 {bw}、平均 {a} / 日", en: "Most worked {w} {h} ({m} min a day on average); busiest hour {bh}, {v} in total; busiest weekday {bw}, {a} a day" },
  // 地形 · 立体 / 等高线: the key figure is the true peak; the heights are smoothed and every place that reads them says so
  "terr.meta": { zh: "实际最高 ×{c} {d}", ja: "実際の最大 ×{c} {d}", en: "True peak ×{c} {d}" },
  "terr.note": { zh: "高度经过平滑（15 分钟格 + 模糊），读数低于实际：地形最高 ≈{z}，实际最高并行 ×{c}（{d} {t}）", ja: "高さは平滑化済み（15 分枠 + ぼかし）で実際より低く読める：地形の最高 ≈{z}、実際の最大並行 ×{c}（{d} {t}）", en: "Heights are smoothed (15-minute bins + blur) and read lower than they were: the land tops out at ≈{z}, the true peak is ×{c} ({d} {t})" },
  "terr.sum": { zh: "{n} 天 × 24 小时的并行度地形；平滑后的山峰 {list}。", ja: "{n} 日 × 24 時間の並行度の地形；平滑化後の山 {list}。", en: "Concurrency over {n} days × 24 hours as land; smoothed summits {list}. " },
  "cont.sum": { zh: "同一地形的等高线；平滑后的山峰 {list}。", ja: "同じ地形の等高線；平滑化後の山 {list}。", en: "The same land as contours; smoothed summits {list}. " },
  "terr.tip": { zh: "{t} 并行 ≈{z}（平滑）", ja: "{t} 並行 ≈{z}（平滑）", en: "at {t} parallel ≈{z} (smoothed)" },
  "terr.keys": { zh: "地形视角：拖动，或 ← → 横移、↑ ↓ 调高度", ja: "地形の視点：ドラッグ、または ← → で横、↑ ↓ で高さ", en: "Terrain view: drag, or ← → to shear and ↑ ↓ for height" },
  // 算力构成 (shown only where amounts may show)
  "cmp.meta": { zh: "{c} · {r}/h", ja: "{c} · {r}/h", en: "{c} · {r}/h" },
  "cmp.unit": { zh: "1 点 = {u} token：从下往上 缓存读取 · 缓存写入 · 输入 · 输出；列顶 = 当周费用，列底 = 每墙钟小时费用。会话整笔计入它在区间里开始的那一周", ja: "1 点 = {u} token：下から キャッシュ読み · キャッシュ書き · 入力 · 出力；列の上 = その週の費用、下 = 実時間 1 時間あたりの費用。セッションは期間内で始まった週にまとめて計上", en: "1 dot = {u} tokens, bottom up: cache read · cache write · input · output; above = the week's cost, below = cost per wall-clock hour. A session counts whole to the week it starts in within the range" },
  "cmp.tip": { zh: "{k} token · {c} · {r}/h（墙钟 {h}）", ja: "{k} token · {c} · {r}/h（実時間 {h}）", en: "{k} tokens · {c} · {r}/h ({h} wall clock)" },
  "cmp.kinds": { zh: "缓存读取 {cr} · 缓存写入 {cw} · 输入 {i} · 输出 {o}", ja: "キャッシュ読み {cr} · キャッシュ書き {cw} · 入力 {i} · 出力 {o}", en: "cache read {cr} · cache write {cw} · input {i} · output {o}" },
  "cmp.mach": { zh: "机器", ja: "マシン", en: "Machine" },
  "cmp.agent": { zh: "Agent", ja: "エージェント", en: "Agent" },
  "cmp.wall": { zh: "墙钟", ja: "実時間", en: "wall clock" },
  "cmp.cost": { zh: "费用", ja: "費用", en: "cost" },
  "cmp.fam": { zh: "按模型家族（token）", ja: "モデル系列別（token）", en: "By model family (tokens)" },
  "cmp.sub": { zh: "子 agent 占 token {p}", ja: "サブエージェントが token の {p}", en: "Subagents: {p} of tokens" },
  "cmp.partial": { zh: "* 含未定价的会话，费用只算已知部分", ja: "* 価格のないセッションを含む；費用は分かる分だけ", en: "* some sessions are unpriced; cost counts the known part" },
  "cmp.sum": { zh: "{w} 周，token {k}（1 点 = {u}）；费用 {c}，每墙钟小时 {r}；最贵的一周 {bw}：{bc}", ja: "{w} 週、token {k}（1 点 = {u}）；費用 {c}、実時間 1 時間あたり {r}；最も高い週 {bw}：{bc}", en: "{w} weeks, {k} tokens (1 dot = {u}); cost {c}, {r} per wall-clock hour; costliest week {bw}: {bc}" },
  "cmp.share": { zh: "{k} 墙钟 {w} · 费用 {c}", ja: "{k} 実時間 {w} · 費用 {c}", en: "{k} wall clock {w} · cost {c}" },
  // 产出密度
  "den.meta": { zh: "最快 {k} {m}/h", ja: "最速 {k} {m}/h", en: "Fastest {k} {m}/h" },
  "den.cap": { zh: "一点 = 一个会话（≥5 分钟），x = 每墙钟小时的轮次（对数；被区间截断的会话按落在区间内的比例折算轮次），竖线 = 中位；右侧 轮次/h · 文件/h 的中位", ja: "1 点 = 1 セッション（5 分以上）、x = 実時間 1 時間あたりのターン数（対数；区間で切れたセッションは区間内の割合でターン数を按分）、縦線 = 中央値；右 ターン/h · ファイル/h の中央値", en: "a dot = a session (≥ 5 min), x = turns per wall-clock hour (log; a session the range cuts counts its turns in the share inside the range), tick = median; right: median turns/h · files/h" },
  "den.tip": { zh: "中位 {m} 轮/h · {f} 文件/h", ja: "中央値 {m} ターン/h · {f} ファイル/h", en: "median {m} turns/h · {f} files/h" },
  "den.tip.s": { zh: "{n} 个会话 · 墙钟 {h} · {t} 轮 · {f} 个文件", ja: "{n} セッション · 実時間 {h} · {t} ターン · {f} ファイル", en: "{n} sessions · {h} wall clock · {t} turns · {f} files" },
  "den.sum": { zh: "{n} 个案件；最快 {k}（中位 {m} 轮/h），最慢 {s}（{l} 轮/h）", ja: "{n} 件；最速 {k}（中央値 {m} ターン/h）、最遅 {s}（{l} ターン/h）", en: "{n} tasks; fastest {k} (median {m} turns/h), slowest {s} ({l} turns/h)" },
  // 计划兑现
  "pl.meta": { zh: "条目 {n} · AI 完成 {a}/{j} · 手动完成 {m} · 一致 {g}/{b}", ja: "項目 {n} · AI 完了 {a}/{j} · 手動完了 {m} · 一致 {g}/{b}", en: "items {n} · AI done {a}/{j} · marked done {m} · agree {g}/{b}" },
  "pl.legend": { zh: "每格：每个条目一对灯，左 AI、右手动（满 = 完成 · 半 = 部分 · 暗 = 未完成 · 灭 = 未判）· 条 = 当天该案件的墙钟（同时开着的平分）", ja: "各マス：項目ごとに灯 2 つ、左 AI・右 手動（満 = 完了 · 半 = 一部 · 暗 = 未完了 · 消 = 未判定）· 棒 = その日その案件の実時間（同時分は等分）", en: "each cell: two lamps per item, left AI, right you (full = done · half = partial · dim = not done · off = not judged) · bar = that task's wall clock that day (overlaps split evenly)" },
  "pl.legend1": { zh: "每格：每个条目一盏灯，手动判过的看手动，否则看 AI（满 = 完成 · 半 = 部分 · 暗 = 未完成 · 灭 = 未判；悬停看两者）· 条 = 当天该案件的墙钟（同时开着的平分）", ja: "各マス：項目ごとに灯 1 つ、手動判定があれば手動、なければ AI（満 = 完了 · 半 = 一部 · 暗 = 未完了 · 消 = 未判定；ホバーで両方）· 棒 = その日その案件の実時間（同時分は等分）", en: "each cell: one lamp per item, yours if you judged it, else the AI's (full = done · half = partial · dim = not done · off = not judged; hover for both) · bar = that task's wall clock that day (overlaps split evenly)" },
  "pl.nolink": { zh: "没有条目关联案件", ja: "案件に紐づいた項目がありません", en: "No item is linked to a task" },
  "pl.last": { zh: "只显示最近 {n} 天", ja: "直近 {n} 日のみ表示", en: "showing the last {n} days only" },
  "pl.st.done": { zh: "完成", ja: "完了", en: "done" },
  "pl.st.partial": { zh: "部分", ja: "一部", en: "partial" },
  "pl.st.none": { zh: "未完成", ja: "未完了", en: "not done" },
  "pl.st.null": { zh: "未判", ja: "未判定", en: "not judged" },
  "pl.item": { zh: "AI {a} · 手动 {m}", ja: "AI {a} · 手動 {m}", en: "AI {a} · you {m}" },
  "pl.items": { zh: "（条目各案件合计 {h}）", ja: "（項目の案件合計 {h}）", en: " (the item's tasks: {h})" },
  "pl.day": { zh: "{d} · 当天墙钟 {h}", ja: "{d} · その日の実時間 {h}", en: "{d} · {h} wall clock that day" },
  "pl.none": { zh: "这天没有该案件的条目", ja: "この日この案件の項目なし", en: "no item for this task that day" },
  "pl.sum": { zh: "{d} 天的今日安排，{n} 个条目，{r} 个案件；AI 判完成 {a}/{j}，手动完成 {m}，两者都判的 {b} 条中一致 {g} 条", ja: "{d} 日分の今日の予定、{n} 項目、{r} 件；AI 完了 {a}/{j}、手動完了 {m}、両方判定済み {b} 項目のうち一致 {g}", en: "Day plans on {d} days, {n} items over {r} tasks; AI done {a}/{j}, marked done {m}, {g} of {b} judged by both agree" },
  // 依頼元旭日
  "sun.meta": { zh: "最大 {r} {p}", ja: "最大 {r} {p}", en: "Top {r} {p}" },
  "sun.noreq": { zh: "未填依頼元", ja: "依頼元なし", en: "no requester" },
  "sun.legend": { zh: "内圈 依頼元 → 中圈 案件 → 外圈 机器（琥珀 Mac · 蓝 Win11）；弧长 = 墙钟，多依頼元与同时开着的部分平分", ja: "内側 依頼元 → 中 案件 → 外側 マシン（琥珀 Mac · 青 Win11）；弧の長さ = 実時間、複数依頼元と同時分は等分", en: "inner requester → middle task → outer machine (amber Mac · blue Win11); arc = wall clock, several requesters and overlaps split evenly" },
  "sun.tip": { zh: "墙钟 {h} · {p}", ja: "実時間 {h} · {p}", en: "{h} wall clock · {p}" },
  "sun.sum": { zh: "墙钟 {t}：{list}", ja: "実時間 {t}：{list}", en: "{t} wall clock: {list}" },
  "sun.item": { zh: "{r} {h}（{p}）", ja: "{r} {h}（{p}）", en: "{r} {h} ({p})" },
  // 流向
  "sankey.meta": { zh: "{a} {p}", ja: "{a} {p}", en: "{a} {p}" },
  "sankey.sum": { zh: "墙钟 {t}：机器 {m}；agent {a}；案件 {k}", ja: "実時間 {t}：マシン {m}；agent {a}；案件 {k}", en: "{t} wall clock: machines {m}; agents {a}; tasks {k}" },
  "flow.item": { zh: "{n} {h}", ja: "{n} {h}", en: "{n} {h}" },
  // 并行关系网
  "graph.meta": { zh: "最常并行 {a} + {b}", ja: "最も並行 {a} + {b}", en: "Most parallel {a} + {b}" },
  "graph.none": { zh: "没有同时开着的案件", ja: "同時に開いた案件なし", en: "No tasks open together" },
  "graph.sum": { zh: "{n} 个案件，{e} 对同时开过：{list}", ja: "{n} 案件、同時に開いたペア {e}：{list}", en: "{n} tasks, {e} pairs open together: {list}" },
  "graph.pair": { zh: "{a} + {b} {h}", ja: "{a} + {b} {h}", en: "{a} + {b} {h}" },
  // 会话平行坐标
  "par.meta": { zh: "{n} 个会话", ja: "{n} セッション", en: "{n} sessions" },
  "par.sum": { zh: "{n} 个会话，每条线一个会话，{k} 个轴：{axes}；在轴上拖动可筛选", ja: "{n} セッション、1 本の線が 1 セッション、軸 {k} 本：{axes}；軸をドラッグで絞り込み", en: "{n} sessions, one line each, on {k} axes: {axes}; drag along an axis to filter" },
  "par.start": { zh: "开始", ja: "開始", en: "Start" },
  "par.min": { zh: "时长", ja: "長さ", en: "Length" },
  "par.turns": { zh: "轮数", ja: "ターン", en: "Turns" },
  "par.files": { zh: "文件", ja: "ファイル", en: "Files" },
  "par.tok": { zh: "token", ja: "token", en: "Tokens" },
  "par.cost": { zh: "费用", ja: "費用", en: "Cost" },
  "par.turns.v": { zh: "{n} 轮", ja: "{n} ターン", en: "{n} turns" },
  "par.files.v": { zh: "{n} 个文件", ja: "{n} ファイル", en: "{n} files" },
} as const satisfies Record<string, Record<Lang, string>>;

export type VStrKey = keyof typeof VSTRINGS;

export function tv(lang: Lang, key: VStrKey, params: Record<string, string | number> = {}): string {
  let s: string = VSTRINGS[key][lang] || VSTRINGS[key].zh;
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
