// scripts/fake-claude.mjs — stands in for `claude -p` when testing digests-local.mjs (pass --claude "node scripts/fake-claude.mjs"):
// reads stdin, answers a fixed JSON reply in the requested shape(s). Never used for real data.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
process.stdin.resume();
process.stdin.on("end", () => {
  // one reply satisfies every check: day / PDF-only (lines), week (lines + oneliner) and oneliner-only
  // FAKE_CLAUDE_NO_ONELINER=1: the reply has no oneliner (a week reply whose text is fine but whose oneliner is missing)
  // FAKE_CLAUDE_CALLS=<file>: each call appends one "." (the test counts calls); FAKE_CLAUDE_LONG=n: the first n calls answer
  // a ja oneliner over 40 code points
  const calls = process.env.FAKE_CLAUDE_CALLS, n = calls && existsSync(calls) ? readFileSync(calls, "utf8").length : 0;
  if (calls) appendFileSync(calls, ".");
  const ja = n < Number(process.env.FAKE_CLAUDE_LONG ?? 0) ? "長".repeat(41) : "替身の一言";
  const one = { lines: ["■ テスト案件：替身の出力"], pdf_lines: ["替身の出力"], oneliner: process.env.FAKE_CLAUDE_NO_ONELINER ? undefined : ja };
  process.stdout.write(JSON.stringify({ ...one, zh: { lines: ["■ 测试案件：替身输出"], pdf_lines: ["替身输出"], oneliner: "替身的一句话" },
    en: { lines: ["■ Test task: stand-in output"], pdf_lines: ["Stand-in output"], oneliner: "Stand-in one-liner" } }));
});
