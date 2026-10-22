#!/usr/bin/env node
// Seeds the LOCAL wrangler dev worker (D1) with a small, deterministic dataset for manual UI
// testing: two tasks and six sessions spanning three JST days across two working directories,
// plus one progress note. Never point this at anything but a local server.
//
// Usage: node scripts/seed-local.mjs [baseUrl] [token]
//   baseUrl defaults to http://127.0.0.1:8787, token defaults to $WORKLOG_DEV_TOKEN || "dev-token".

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8787";
const token = process.argv[3] ?? process.env.WORKLOG_DEV_TOKEN ?? "dev-token";

const host = new URL(baseUrl).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  console.error(`refusing to seed non-local host: ${host}`);
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return data;
}

/** JST wall-clock "YYYY-MM-DD HH:MM:SS+09:00" -> UTC ISO instant. */
const jstToUtcIso = (date, time) => new Date(`${date}T${time}+09:00`).toISOString();

/** ISO-8601 week label (Asia/Tokyo calendar) for a "YYYY-MM-DD" JST date string. */
function isoWeekLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Anchor to last week's Monday (JST) so the whole dataset sits safely in the past.
const now = new Date(Date.now() + 9 * 3_600_000); // JST wall clock, as a UTC-labelled Date
const jstToday = now.toISOString().slice(0, 10);
const todayDow = (now.getUTCDay() + 6) % 7; // Mon=0..Sun=6
const mondayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (todayDow + 7) * 86_400_000;
const day = (offset) => new Date(mondayMs + offset * 86_400_000).toISOString().slice(0, 10);
const [day1, day2, day3] = [day(0), day(1), day(2)]; // last week's Mon/Tue/Wed
const week = isoWeekLabel(day1);

console.log(`seeding week ${week} (days ${day1}, ${day2}, ${day3}; today is ${jstToday} JST)`);

const cwdA = "/Volumes/Data/Projects/demo-a";
const cwdB = "/Volumes/Data/Projects/demo-b";

const taskA = `T${day1.replaceAll("-", "")}-01`;
const taskB = `T${day1.replaceAll("-", "")}-02`;

await call("PUT", `/api/tasks/${taskA}`, {
  requester: "田中", project: "demo-a", title: "帳票修正", status: "open",
  received_at: day1, done_at: null, thinking: "原因調査中", deliverables: [],
  hours_manual: null, machine: "seed", ts: `${day1}T09:00:00`,
});
await call("PUT", `/api/tasks/${taskB}`, {
  requester: "鈴木", project: "demo-b", title: "API 動作確認", status: "open",
  received_at: day1, done_at: null, thinking: "", deliverables: [],
  hours_manual: null, machine: "seed", ts: `${day1}T09:00:00`,
});

const session = (id, date, startTime, endTime, opts) => ({
  id, machine: "seed", agent: opts.agent ?? "claude-code", session_id: `sess-${id}`,
  cwd: opts.cwd, started_at: jstToUtcIso(date, startTime), ended_at: jstToUtcIso(date, endTime),
  active_minutes: opts.minutes, turns: opts.turns ?? 10,
  summary: opts.summary, summary_source: opts.summarySource ?? "llm",
  task_id: opts.taskId ?? null, link_method: opts.linkMethod ?? "none", ts: `${date}T${startTime}`,
});

const sessions = [
  session("S-seed-01", day1, "10:00:00", "10:45:00", {
    cwd: cwdA, taskId: taskA, linkMethod: "auto-dir", minutes: 45,
    summary: "帳票のフォーマット崩れを調査した",
  }),
  session("S-seed-02", day1, "14:00:00", "14:20:00", {
    cwd: cwdB, taskId: taskB, agent: "codex", linkMethod: "auto-dir", minutes: 20,
    summary: "API のレスポンス形式を確認した",
  }),
  // Boundary case: 00:30 JST must land on day2, not day1 (started_at drives day grouping).
  session("S-seed-03", day2, "00:30:00", "00:50:00", {
    cwd: cwdA, taskId: taskA, linkMethod: "auto-dir", minutes: 20,
    summary: "深夜に追加のデバッグを行った",
  }),
  session("S-seed-04", day2, "11:00:00", "11:30:00", {
    cwd: cwdB, taskId: null, linkMethod: "none", minutes: 30, // unassigned
    summary: "未分類の調査セッション",
  }),
  session("S-seed-05", day3, "09:00:00", "09:15:00", {
    cwd: cwdA, taskId: taskA, linkMethod: "auto-dir", minutes: 15,
    summarySource: "fallback", summary: "claude-code session in demo-a", // fallback: no LLM summary
  }),
  session("S-seed-06", day3, "16:00:00", "16:40:00", {
    cwd: cwdB, taskId: taskB, agent: "codex", linkMethod: "auto-time", minutes: 40,
    summary: "結合テストを実施した",
  }),
];

const ingestResult = await call("POST", "/api/ingest/sessions", { machine: "seed", sessions });
console.log("ingest:", ingestResult);

const note = await call("POST", "/api/notes", {
  text: "田中さんに進捗を報告した", task_id: taskA, minutes: 10, date: day2,
});
console.log("note:", note);

console.log(`\ndone. verify with:\n  curl -s ${baseUrl}/api/weeks/${week}/timeline -H "Authorization: Bearer ${token}"`);
console.log(`seeded week: ${week}`);
