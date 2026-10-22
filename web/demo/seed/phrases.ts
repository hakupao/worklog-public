// Trilingual sentence templates. `{o}` is a TaskDef object (a module, screen or document), `{n}` a small count.
import type { Lang, Tri } from "./types";

const t = (ja: string, zh: string, en: string): Tri => ({ ja, zh, en });

/** Fill `{o}` / `{n}` in every language. */
export function fill(tpl: Tri, o: Tri, n = 0): Tri {
  const f = (s: string, l: Lang) => s.replaceAll("{o}", o[l]).replaceAll("{n}", String(n));
  return { ja: f(tpl.ja, "ja"), zh: f(tpl.zh, "zh"), en: f(tpl.en, "en") };
}

/** Two sentences as one summary, in each language's punctuation. */
export const join2 = (a: Tri, b: Tri): Tri => ({
  ja: `${a.ja}。${b.ja}`, zh: `${a.zh}；${b.zh}`, en: `${a.en}. ${b.en.charAt(0).toUpperCase()}${b.en.slice(1)}`,
});

/** What a coding-agent session did, as its summary says it. */
export const ACTIONS: Tri[] = [
  t("{o}の実装を進め、単体テストを追加した", "推进了{o}的实现，并补充了单元测试", "Implemented part of {o} and added unit tests"),
  t("{o}の仕様を読み直し、未確定事項を一覧にまとめた", "重新梳理了{o}的规格，整理出待确认事项清单", "Re-read the spec for {o} and listed the open questions"),
  t("{o}で失敗していたテストの原因を特定して修正した", "定位并修复了{o}中失败的测试", "Found and fixed the cause of the failing tests in {o}"),
  t("{o}のレビュー指摘 {n} 件に対応した", "处理了{o}的 {n} 条评审意见", "Addressed {n} review comments on {o}"),
  t("{o}のデータ対応表を更新し、変換ルールを追記した", "更新了{o}的数据映射表，补充了转换规则", "Updated the data mapping for {o} and added conversion rules"),
  t("{o}の処理時間を計測し、遅い箇所を洗い出した", "测量了{o}的处理时间，找出了慢的地方", "Profiled {o} and pinned down the slow spots"),
  t("{o}を整理し、重複していた処理を共通化した", "重构了{o}，把重复的处理抽成公共函数", "Refactored {o} and pulled the duplicated logic into one place"),
  t("{o}の設計メモを書き、代替案を 2 つ比較した", "写了{o}的设计笔记，比较了两个备选方案", "Wrote a design note on {o} comparing two alternatives"),
  t("{o}の結合テストを実行し、不具合 {n} 件を起票した", "执行了{o}的集成测试，登记了 {n} 个缺陷", "Ran the integration tests for {o} and filed {n} defects"),
  t("{o}のエラー処理を見直し、ログ出力を整理した", "检查了{o}的错误处理，并整理了日志输出", "Reworked error handling in {o} and tidied the logging"),
  t("{o}の手順書を書き、確認を依頼した", "编写了{o}的操作手册并请对方确认", "Drafted the runbook for {o} and asked for a review"),
  t("{o}の型定義を整理し、レスポンス形式をそろえた", "整理了{o}的类型定义，统一了响应格式", "Cleaned up the types in {o} and aligned the response shape"),
  t("{o}の不具合を再現し、修正方針を決めた", "复现了{o}的缺陷，并确定了修复方案", "Reproduced the bug in {o} and settled on a fix"),
  t("{o}のテストデータを作り直し、境界値のケースを {n} 件追加した", "重新生成了{o}的测试数据，增加了 {n} 个边界值用例", "Regenerated test data for {o} and added {n} boundary cases"),
  t("{o}の差分を確認し、プルリクエストを作成した", "确认了{o}的改动并创建了 PR", "Checked the diff for {o} and opened a pull request"),
  t("{o}について Codex に別案を書かせ、良い方を取り込んだ", "让 Codex 为{o}写了另一种实现，并采纳了更好的那个", "Had Codex draft an alternative for {o} and merged the better one"),
  t("{o}を書き直し、v1 からの変更点を注記した", "改写了{o}，并注明了与 v1 相比的变化", "Rewrote {o} and marked the changes from v1"),
  t("{o}の表記ゆれをそろえ、用語集と照合した", "统一了{o}中的用词，并与术语表核对", "Made the wording in {o} consistent and checked it against the glossary"),
];
/** The ACTIONS entry that names Codex: never the summary of a Codex session itself. */
export const ASK_CODEX = 15;

/** 具体要求 of a day plan item. */
export const DETAILS: Tri[] = [
  t("{o}を終わらせ、テストまで通す", "完成{o}并让测试通过", "Finish {o} and get the tests passing"),
  t("agent と最低 2 往復して{o}の方針を固める", "和 agent 至少来回两轮，确定{o}的方案", "At least two rounds with the agent to settle the approach for {o}"),
  t("{o}のレビュー依頼まで出す", "把{o}提交评审", "Get {o} out for review"),
  t("午前中に{o}、午後は確認待ちの返事を見る", "上午做{o}，下午看等待确认的回复", "Morning: {o}; afternoon: check the pending replies"),
];

/** A day plan item made on the spot for a task: its short name and today's object. */
export const dayItem = (short: Tri, o: Tri): Tri => ({
  ja: `${short.ja}：${o.ja}を進める`, zh: `${short.zh}：推进${o.zh}`, en: `${cap(short.en)}: move ${o.en} forward`,
});

/** The AI judge's reason line. */
export const judgeNote = (status: "done" | "partial" | "none", n: number, minutes: number, hasTasks: boolean): Tri => {
  if (!hasTasks) return t("案件が紐付いていないため、作業記録からは判断できない", "未关联案件，无法从工作记录判断", "No 案件 is linked, so the work log cannot show it");
  if (status === "none") return t("この日は紐付いた案件のセッションがなかった", "当天没有关联案件的会话", "No session on the linked 案件 that day");
  const base = t(`関連するセッション ${n} 件（計 ${minutes} 分）の内容から判断した`, `根据 ${n} 个相关会话（共 ${minutes} 分钟）的内容判断`,
    `Judged from ${n} related session${n === 1 ? "" : "s"} (${minutes} min in total)`);
  return status === "done" ? base
    : { ja: `${base.ja}。具体要求の一部が残っている`, zh: `${base.zh}。具体要求还有一部分没完成`, en: `${base.en}; part of the goal is still open` };
};

/** Digest connectors. */
export const OTHER: Tri = t("その他", "其他", "Other");
export const continued = (o: Tri): Tri => t(`引き続き${o.ja}に取り組んだ`, `继续推进${o.zh}`, `Continued work on ${o.en}`);
export const smallWork = (names: Tri[]): Tri => ({
  ja: `${names.map((x) => x.ja).join("、")}の細かな作業`, zh: `${names.map((x) => x.zh).join("、")}的零碎工作`,
  en: `small tasks on ${names.map((x) => x.en).join(", ")}`,
});
export const UNASSIGNED: Tri = t("調査・雑務", "调查·杂务", "research and chores");

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
