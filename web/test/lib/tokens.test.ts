import { describe, expect, it } from "vitest";
import type { ModelTokens, Session, SessionTokens } from "../../src/api/types";
import { compactCount, usd } from "../../src/lib/format";
import { sumTokens, tokenLine, tokenTotal } from "../../src/lib/tokens";

const row = (over: Partial<ModelTokens> = {}): ModelTokens => ({
  input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, reasoning: 0, ...over,
});
const tokens = (over: Partial<SessionTokens> = {}): SessionTokens => ({
  by_model: {}, subagent: {}, cost_usd: 0, cost_partial: false, ...over,
});
const session = (t: SessionTokens | null) => ({ tokens: t }) as Session;

describe("compactCount", () => {
  it("keeps three significant figures at most, with a K/M/B suffix", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(950)).toBe("950");
    expect(compactCount(1234)).toBe("1.2K");
    expect(compactCount(34_567)).toBe("35K");
    expect(compactCount(1_234_567)).toBe("1.2M");
    expect(compactCount(123_456_789)).toBe("123M");
    expect(compactCount(2_500_000_000)).toBe("2.5B");
    expect(compactCount(999_960)).toBe("1M");
    expect(compactCount(Number.NaN)).toBe("0");
  });
});

describe("usd", () => {
  it("is to the cent, and never shows a real cost as $0.00", () => {
    expect(usd(3.4)).toBe("$3.40");
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.001)).toBe("<$0.01");
  });
});

describe("sumTokens / tokenLine", () => {
  it("totals every billed field but reasoning, which is inside output", () => {
    expect(tokenTotal({ a: row({ input: 1, output: 2, cache_read: 3, cache_write_5m: 4, cache_write_1h: 5, reasoning: 100 }) }))
      .toBe(15);
  });

  it("one priced session with subagent usage", () => {
    const t = tokens({
      by_model: { "claude-opus-5-5": row({ cache_read: 1_000_000 }), "claude-sonnet-5": row({ cache_read: 200_000 }) },
      subagent: { "claude-sonnet-5": row({ cache_read: 200_000 }) },
      cost_usd: 3.4,
    });
    expect(tokenLine(sumTokens([session(t)]))).toBe("1.2M tok · ≈$3.40 · 子 agent 17%");
  });

  it("sums across sessions, marks partial, and counts sessions never collected", () => {
    const sum = sumTokens([
      session(tokens({ by_model: { a: row({ input: 1000 }) }, cost_usd: 1 })),
      session(tokens({ by_model: { a: row({ input: 500 }), "gpt-6-sol": row({ input: 500 }) }, cost_usd: 0.5, cost_partial: true })),
      session(null),
    ]);
    expect(sum).toMatchObject({ tokens: 2000, cost: 1.5, partial: true, notCollected: 1, collected: 2 });
    expect(tokenLine(sum)).toBe("2K tok · ≈$1.50（部分未定价）");
  });

  it("an unpriced session makes the sum partial even next to priced ones, and alone has no cost", () => {
    const codex = session(tokens({ by_model: { "gpt-6-sol": row({ input: 10 }) }, cost_usd: null, cost_partial: true }));
    expect(tokenLine(sumTokens([codex]))).toBe("10 tok · 费用未定价");
    const both = sumTokens([codex, session(tokens({ by_model: { a: row({ input: 10 }) }, cost_usd: 2 }))]);
    expect(both.cost).toBe(2);
    expect(both.partial).toBe(true);
  });
});
