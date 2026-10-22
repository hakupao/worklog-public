import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const W = "2026-W40";
const dayItem = { day: "2026-09-28", input: "d", hash: "hd", text: null, edited: false, fresh: false, pdf_missing: false, oneliner: null, oneliner_missing: false };
const inputs = (week) => ({ week: W, system: { day: "DAY", week: "WEEK", oneliner: "ONE" }, schema: {}, limits: { day: { pdf: 120 }, week: { pdf: 700 } }, names: [],
  items: [dayItem, { day: "", input: "w", hash: "hw", text: "本文", fresh: false, oneliner: null, oneliner_missing: true, ...week }] });

/** A stub API: GET digest-inputs answers `body`; every PUT is recorded and answered `status(url)` (default 200). */
async function stub(body, status = () => 200) {
  const puts = [];
  const srv = createServer((req, res) => {
    let raw = ""; req.on("data", (d) => (raw += d)); req.on("end", () => {
      if (req.method === "PUT") puts.push({ url: req.url, body: JSON.parse(raw) });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "PUT") res.statusCode = status(req.url);
      res.end(JSON.stringify(req.method === "GET" ? body : res.statusCode === 200 ? { ok: true } : { error: "stale" }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { puts, base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}
const localEnv = (env, base, ...extra) => run("node", ["scripts/digests-local.mjs", "--base", base, "--from", W, "--to", W, "--claude", "node scripts/fake-claude.mjs", ...extra],
  { env: { ...process.env, WORKLOG_TOKEN: "t", ...env } });
const local = (base, ...extra) => localEnv({}, base, ...extra);

test("digests-local wiring: a regenerated week PUTs its oneliner from the same reply, and no oneliner_only call", async () => {
  const s = await stub(inputs({ edited: false, pdf_missing: false }));
  try { await local(s.base); } finally { s.close(); }
  const week = s.puts.filter((p) => p.url === `/api/reports/${W}/digests/week/generated`);
  assert.equal(week.length, 1);
  assert.equal(week[0].body.oneliner, "替身の一言");
  assert.equal(week[0].body.zh.oneliner, "替身的一句话");
  assert.ok(!("oneliner_only" in week[0].body));
});

test("digests-local wiring: a hand-edited week gets the PDF-only pass (old shape) and one oneliner_only call", async () => {
  const s = await stub(inputs({ edited: true, pdf_missing: true }));
  try { await local(s.base); } finally { s.close(); }
  const week = s.puts.filter((p) => p.url === `/api/reports/${W}/digests/week/generated`).map((p) => p.body);
  assert.deepEqual(week.map((b) => Object.keys(b).sort()), [
    ["en", "model", "pdf_only", "pdf_text", "source_text", "zh"],
    ["en", "model", "oneliner", "oneliner_only", "source_text", "zh"],
  ]);
  assert.equal(week[1].source_text, "本文");
});

test("--oneliners needs --save or --load", async () => {
  const s = await stub(inputs({ edited: true }));
  try { await assert.rejects(local(s.base, "--oneliners")); } finally { s.close(); }
});

test("digests-local wiring: a week reply with good text and no oneliner still writes the text, without a oneliner (refilled later)", async () => {
  const s = await stub(inputs({ edited: false, pdf_missing: false }));
  try { await localEnv({ FAKE_CLAUDE_NO_ONELINER: "1" }, s.base); } finally { s.close(); }
  const week = s.puts.filter((p) => p.url === `/api/reports/${W}/digests/week/generated`).map((p) => p.body);
  assert.equal(week.length, 1);   // the text PUT only: no oneliner_only call against the text it just replaced
  assert.equal(week[0].text, "■ テスト案件：替身の出力");
  assert.ok(!("oneliner" in week[0]) && !("oneliner" in week[0].zh) && !("oneliner" in week[0].en));
});

test("--oneliners --save: an over-long oneliner gets one more try (the shorter reply is saved); still long → the first is kept, no failure", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wl-one-")), file = path.join(dir, "one.json");
  const s = await stub(inputs({ edited: true }));
  try {
    const calls = path.join(dir, "calls1");
    await localEnv({ FAKE_CLAUDE_CALLS: calls, FAKE_CLAUDE_LONG: "1" }, s.base, "--oneliners", "--save", file);
    assert.equal(readFileSync(calls, "utf8").length, 2);
    assert.equal(JSON.parse(readFileSync(file, "utf8"))[0].oneliner, "替身の一言");

    const calls2 = path.join(dir, "calls2");
    const out = await localEnv({ FAKE_CLAUDE_CALLS: calls2, FAKE_CLAUDE_LONG: "9" }, s.base, "--oneliners", "--save", file);
    assert.equal(readFileSync(calls2, "utf8").length, 2);
    assert.equal(JSON.parse(readFileSync(file, "utf8"))[0].oneliner, "長".repeat(41));
    assert.match(out.stdout, /saved 1 /);
    assert.match(out.stderr, /oneliner over 40 字 \/ 25 words after a retry/);
    assert.equal(s.puts.length, 0);
  } finally { s.close(); }
});

test("--oneliners --save writes the file and no PUT; --load PUTs its entries (409 → skipped), counts and refuses an all-outside file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wl-one-")), file = path.join(dir, "one.json");
  const s = await stub(inputs({ edited: true }), (url) => (url.startsWith("/api/reports/2026-W39/") ? 409 : 200));
  try {
    await local(s.base, "--oneliners", "--save", file);
    assert.equal(s.puts.length, 0);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(saved, [{ week: W, source_text: "本文", oneliner: "替身の一言", zh: "替身的一句话", en: "Stand-in one-liner" }]);

    writeFileSync(file, JSON.stringify([...saved, { ...saved[0], week: "2026-W39" }, { ...saved[0], week: "2026-W30" }]));
    const out = await run("node", ["scripts/digests-local.mjs", "--base", s.base, "--from", "2026-W39", "--to", W, "--oneliners", "--load", file],
      { env: { ...process.env, WORKLOG_TOKEN: "t" } });
    assert.deepEqual(s.puts.map((p) => p.url), [`/api/reports/${W}/digests/week/generated`, "/api/reports/2026-W39/digests/week/generated"]);
    assert.deepEqual(s.puts[0].body, { oneliner_only: true, source_text: "本文", oneliner: "替身の一言", model: "opus-local",
      zh: { oneliner: "替身的一句话" }, en: { oneliner: "Stand-in one-liner" } });
    assert.match(out.stdout, /"filled":1,"skipped":1,"failed":0,"outside":1/);
    assert.match(out.stderr, /1 of 3 entries outside 2026-W39\.\.2026-W40: ignored/);

    writeFileSync(file, JSON.stringify([{ ...saved[0], week: "2026-W30" }]));
    await assert.rejects(local(s.base, "--oneliners", "--load", file));
    assert.equal(s.puts.length, 2);
  } finally { s.close(); }
});
