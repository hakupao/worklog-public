#!/usr/bin/env node
// Seeds the LOCAL wrangler dev worker with badge-density data for B3 prototypes and Win11 perf runs:
// 64 案件 (48 open, 8 hold, 8 done) and ~320 sessions over the 6 weeks that end last Sunday (JST), ~10 % unlinked,
// claude-code + codex. Deterministic (fixed PRNG seed, fixed ids). Idempotent within one JST week only: task ids embed the
// receive date and session ids embed dates, so a rerun in a later week adds 64 new tasks and relinks overlapping sessions.
// Before re-running in a later week, reset the local D1 (delete server/.wrangler/state, then re-apply local migrations).
// The worker must run in local mode (`wrangler dev`, never `--remote`): the host check below cannot catch
// `wrangler dev --remote`, which serves a local URL but writes to the remote D1.
// Usage: node scripts/seed-badges.mjs [baseUrl] [token]   (defaults: http://127.0.0.1:8787, $WORKLOG_DEV_TOKEN || dev-token)
const baseUrl = process.argv[2] ?? "http://127.0.0.1:8787";
const token = process.argv[3] ?? process.env.WORKLOG_DEV_TOKEN ?? "dev-token";
const host = new URL(baseUrl).hostname;
if (host !== "127.0.0.1" && host !== "localhost") { console.error(`refusing to seed non-local host: ${host}`); process.exit(1); }

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

let s = 0x9e3779b9;                                  // mulberry32, fixed seed
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n) => String(n).padStart(2, "0");
const jstToUtcIso = (date, time) => new Date(`${date}T${time}+09:00`).toISOString();

const now = new Date(Date.now() + 9 * 3_600_000);
const dow = (now.getUTCDay() + 6) % 7;
const lastSunday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (dow + 1) * 86_400_000;
const first = lastSunday - 41 * 86_400_000;          // Monday six weeks earlier
const dayStr = (i) => new Date(first + i * 86_400_000).toISOString().slice(0, 10);

const REQ = ["田中", "鈴木", "佐藤", "高橋", "伊藤", "渡辺"];
const PROJ = ["demo-a", "demo-b", "demo-c", "demo-d", "demo-e", "demo-f", "demo-g", "demo-h"];
const WORDS = ["帳票修正", "API 確認", "集計バッチ", "画面改修", "性能調査", "移行準備", "障害対応", "設計レビュー"];

const tasks = [];
for (let i = 0; i < 64; i++) {
  const recv = dayStr(Math.floor((i / 64) * 35));
  const id = `T${recv.replaceAll("-", "")}-${pad(i % 100)}`;
  const status = i < 48 ? "open" : i < 56 ? "hold" : "done";
  tasks.push({ id, recv, proj: PROJ[i % PROJ.length] });
  await call("PUT", `/api/tasks/${id}`, {
    requester: REQ[i % REQ.length], project: PROJ[i % PROJ.length], title: `${WORDS[i % WORDS.length]} ${i + 1}`,
    status, received_at: recv, done_at: status === "done" ? dayStr(41) : null, thinking: "",
    deliverables: status === "open" ? [] : [`docs/${PROJ[i % PROJ.length]}/report-${i + 1}.md`, ...(i % 2 ? [`out/${i + 1}.xlsx`] : [])],
    hours_manual: null, machine: "seed", ts: `${recv}T09:00:00`,
  });
}

const sessions = [];
for (let d = 0; d < 42; d++) {
  if (d % 7 >= 5 && rnd() < 0.7) continue;           // most weekends empty
  const date = dayStr(d), live = tasks.filter((t) => t.recv <= date);
  let minute = 9 * 60 + Math.floor(rnd() * 60);
  for (let k = 0; k < 8 + Math.floor(rnd() * 6) && minute < 22 * 60; k++) {
    const len = 10 + Math.floor(rnd() * 80), t = rnd() < 0.1 || !live.length ? null : pick(live.slice(-24));
    const a = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:00`, b = `${pad(Math.floor((minute + len) / 60))}:${pad((minute + len) % 60)}:00`;
    const id = `S-b3-${date}-${pad(k)}`;
    sessions.push({
      id, machine: "seed", agent: rnd() < 0.25 ? "codex" : "claude-code", session_id: `sess-${id}`,
      cwd: `/Volumes/Data/Projects/${t ? t.proj : "misc"}`, started_at: jstToUtcIso(date, a), ended_at: jstToUtcIso(date, b),
      active_minutes: len, turns: 5 + Math.floor(rnd() * 30), summary: t ? `${t.id} の作業` : "未分類の調査",
      summary_source: "llm", task_id: t ? t.id : null, link_method: t ? "auto-dir" : "none", ts: `${date}T${a}`,
    });
    minute += len + 5 + Math.floor(rnd() * 40);
  }
}
for (let i = 0; i < sessions.length; i += 100) await call("POST", "/api/ingest/sessions", { machine: "seed", sessions: sessions.slice(i, i + 100) });
console.log(`seeded ${tasks.length} tasks, ${sessions.length} sessions, ${dayStr(0)} .. ${dayStr(41)}`);

// Day plans on the seeded workdays: 3–4 items per day, each linked to 1–2 of the tasks worked that day, statuses
// spread done / partial / none so the 计划 view (stats) has all three. Newest day first: `start` copies the not-done items
// of the latest EARLIER plan into the new day, so going backwards nothing is copied. Idempotence: `start` answers 409
// for a day that already exists → skip it.
let items = 0;
for (let d = 41; d >= 0; d--) {
  const date = dayStr(d), worked = [...new Set(sessions.filter((x) => x.ts.startsWith(date) && x.task_id).map((x) => x.task_id))];
  if (!worked.length) continue;
  try { await call("POST", `/api/day-plans/${date}/start`, {}); }
  catch (e) { if (String(e.message).includes("-> 409")) continue; throw e; }
  const n = 3 + Math.floor(rnd() * 2);
  for (let k = 0; k < n; k++) {
    const ids = [worked[k % worked.length], ...(rnd() < 0.3 && worked.length > 1 ? [worked[(k + 1) % worked.length]] : [])];
    const it = await call("POST", `/api/day-plans/${date}/items`, { text: `${WORDS[(d + k) % WORDS.length]} の続き`, task_ids: [...new Set(ids)] });
    const st = ["done", "done", "partial", "none"][Math.floor(rnd() * 4)];
    await call("PATCH", `/api/day-plan-items/${it.id}`, { updated_at: it.updated_at, manual_status: st });
    items++;
  }
}
console.log(`seeded ${items} day-plan items`);
