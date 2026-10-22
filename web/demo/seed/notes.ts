// 补记: meetings, calls and hand-offs typed by hand, most linked to a 案件, a few not. Three were typed roughly and
// polished (raw kept in the base, the polished text in every language).
import type { Lang, Tri } from "./types";

export interface NoteDef { id: string; ts: string; task: string | null; minutes: number | null; src: Lang; tri: Tri; raw?: string }

const N = (date: string, hm: string, task: string | null, minutes: number | null, src: Lang, ja: string, zh: string, en: string, raw?: string): NoteDef => ({
  id: `N${date.replaceAll("-", "")}-${hm.replace(":", "")}00`, ts: `${date}T${hm}:00`, task, minutes, src, tri: { ja, zh, en }, raw,
});

export const NOTES: NoteDef[] = [
  N("2026-08-24", "10:30", "T20260824-01", 30, "ja", "高橋リーダーとキックオフ。12 画面の優先順を確認した", "与高桥组长开了启动会，确认了 12 个画面的优先顺序", "Kick-off with Takahashi; agreed the priority order of the 12 screens"),
  N("2026-08-26", "16:00", "T20260826-01", 45, "zh", "Alex Wang さんと結合テストの範囲を打ち合わせた", "与 Alex Wang 讨论了集成测试的范围", "Discussed the integration test scope with Alex Wang"),
  N("2026-08-28", "17:30", "T20260822-01", 15, "ja", "開発環境の手順書をチームに共有した", "向团队共享了开发环境手册", "Shared the dev environment guide with the team"),
  N("2026-09-01", "11:00", "T20260901-01", 30, "ja", "佐藤さんから照合バッチの現状をヒアリングした", "听佐藤先生介绍了对账批处理的现状", "Sato-san walked me through the current reconciliation batch"),
  N("2026-09-03", "14:00", "T20260903-01", 40, "ja", "鈴木さんの部署から帳票 40 種のサンプルを受け取った", "从铃木先生的部门拿到了 40 种报表样本", "Received samples of the 40 reports from Suzuki-san's department"),
  N("2026-09-04", "18:10", null, 60, "ja", "社内勉強会（テスト自動化）に参加した", "参加了公司内部学习会（测试自动化）", "Attended the internal study session on test automation", "勉強会 テスト自動化 参加"),
  N("2026-09-08", "10:00", "T20260907-01", 30, "en", "Mia Chen さんと定義書の書式を相談した", "与 Mia Chen 商量了定义书的格式", "Talked through the dictionary format with Mia Chen"),
  N("2026-09-09", "15:30", "T20260909-01", 20, "ja", "田中先生から検証の目的と評価基準の説明を受けた", "田中老师说明了验证的目的和评估标准", "Tanaka-sensei explained the goal and the scoring criteria"),
  N("2026-09-11", "17:00", "T20260826-01", 30, "zh", "相手先の認証設定の誤りを Alex Wang さんに連絡した", "把对方认证配置有误的情况告诉了 Alex Wang", "Told Alex Wang about the partner's authentication setting error"),
  N("2026-09-14", "13:30", "T20260914-01", 45, "en", "Kevin Liu さんと現在の権限モデルを確認した", "与 Kevin Liu 确认了现有的权限模型", "Went over the current permission model with Kevin Liu"),
  N("2026-09-16", "09:40", "T20260916-01", 20, "ja", "Sam Lee さんから障害の連絡。影響範囲の確認から始めた", "Sam Lee 通知了故障，从确认影响范围开始处理", "Sam Lee reported the incident; started by checking the impact"),
  N("2026-09-17", "16:30", "T20260916-01", 30, "ja", "障害報告の説明会で経緯と再発防止策を説明した", "在故障报告说明会上讲解了经过和防止再发的措施", "Presented the incident timeline and the prevention measures"),
  N("2026-09-18", "17:45", "T20260826-01", 15, "ja", "結合テストの結果報告書を提出した", "提交了集成测试结果报告", "Submitted the integration test report"),
  N("2026-09-24", "10:00", "T20260924-01", 60, "ja", "ORION-B の移行方針を高橋リーダー・佐藤さんと打ち合わせた", "与高桥组长和佐藤先生讨论了 ORION-B 的迁移方针", "Discussed the ORION-B migration approach with Takahashi and Sato-san"),
  N("2026-09-25", "15:00", "T20260901-01", 30, "ja", "性能改善の結果を佐藤さんに報告し、完了の了承をもらった", "向佐藤先生汇报了性能优化结果，并获得完成确认", "Reported the tuning results to Sato-san and got sign-off"),
  N("2026-09-29", "11:30", "T20260907-01", 10, "zh", "業務部門の回答待ちのため data-wiki は保留にした", "因为在等业务部门回复，data-wiki 暂时搁置", "Put data-wiki on hold while the business side answers"),
  N("2026-09-29", "14:00", "T20260929-01", 45, "en", "KPI ダッシュボードの要件を Mia さん・Kevin さんと打ち合わせた", "与 Mia 和 Kevin 讨论了 KPI 仪表盘的需求", "Requirements meeting for the KPI dashboard with Mia and Kevin"),
  N("2026-09-30", "17:00", "T20260824-01", 30, "ja", "ORION-A 全画面の確認会", "ORION-A 全部画面的确认会", "Review meeting for all ORION-A screens", "orion-a 確認会 全画面"),
  N("2026-10-01", "10:30", "T20261001-01", 30, "zh", "Alex Wang さんと v2 仕様書の改訂方針を確認した", "与 Alex Wang 确认了 v2 规格书的修订方针", "Agreed the v2 spec revision approach with Alex Wang"),
  N("2026-10-02", "16:00", "T20260909-01", 40, "ja", "検証結果を田中先生に報告した", "向田中老师汇报了验证结果", "Reported the evaluation results to Tanaka-sensei"),
  N("2026-10-02", "18:00", null, 15, "zh", "勤怠と経費を入力した", "录入了考勤和报销", "Entered the timesheet and expenses"),
  N("2026-10-06", "11:00", "T20261006-01", 30, "ja", "佐藤さんと監査ログの要件を確認した", "与佐藤先生确认了审计日志的需求", "Went over the audit log requirements with Sato-san"),
  N("2026-10-07", "13:20", "T20260924-01", 20, "ja", "顧客マスタの移行は佐藤さんの承認待ち", "客户主数据的迁移在等佐藤先生批准", "The customer master migration is waiting for Sato-san's approval"),
  N("2026-10-09", "15:00", "T20260914-01", 30, "en", "ATLAS 設計書の引き継ぎ会を行った", "举行了 ATLAS 设计书的交接会", "Held the hand-over meeting for the ATLAS design"),
  N("2026-10-09", "17:30", null, 20, "ja", "PC の OS 更新とバックアップ", "电脑系统更新和备份", "OS update and backup on the PC"),
  N("2026-10-13", "10:00", "T20261013-01", 30, "ja", "Sam Lee さんと多言語化する通知 26 種を確認した", "与 Sam Lee 确认了要多语言化的 26 种通知", "Confirmed the 26 notices to translate with Sam Lee", "sam さんと 多言語化 26種 確認"),
  N("2026-10-14", "16:40", "T20261008-01", 10, "zh", "情報システム部の回答待ちのため保留にした", "在等信息系统部回复，暂时搁置", "On hold while the IT department replies"),
  N("2026-10-14", "17:20", "T20260929-01", 25, "en", "Kevin Liu さんに画面の試作を見せた", "给 Kevin Liu 看了画面原型", "Showed the screen prototype to Kevin Liu"),
  N("2026-10-15", "11:30", "T20260924-01", 15, "ja", "佐藤さんから顧客マスタ移行の承認をもらった", "得到了佐藤先生对客户主数据迁移的批准", "Sato-san approved the customer master migration"),
  N("2026-10-15", "13:00", null, 30, "ja", "チーム定例", "团队例会", "Team weekly meeting"),
];
