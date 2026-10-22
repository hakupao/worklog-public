import type { ModelTokens, Session } from "../api/types";
import { compactCount, usd } from "./format";

/** Every token a set of models used: uncached input, output, cache reads and cache writes. */
export function tokenTotal(byModel: Record<string, ModelTokens>): number {
  return Object.values(byModel).reduce(
    (n, r) => n + r.input + r.output + r.cache_read + r.cache_write_5m + r.cache_write_1h,
    0,
  );
}

export interface TokenSum {
  tokens: number;
  subagentTokens: number;
  /** Sum of the priced sessions' costs; null when none of them has a price at all. */
  cost: number | null;
  /** Some usage has no price, so `cost` understates the API-equivalent cost. */
  partial: boolean;
  /** Sessions whose tokens were never collected (tokens === null). */
  notCollected: number;
  collected: number;
}

export function sumTokens(sessions: Session[]): TokenSum {
  const sum: TokenSum = { tokens: 0, subagentTokens: 0, cost: null, partial: false, notCollected: 0, collected: 0 };
  for (const { tokens } of sessions) {
    if (!tokens) {
      sum.notCollected += 1;
      continue;
    }
    sum.collected += 1;
    const total = tokenTotal(tokens.by_model);
    sum.tokens += total;
    sum.subagentTokens += tokenTotal(tokens.subagent);
    if (tokens.cost_usd !== null) sum.cost = (sum.cost ?? 0) + tokens.cost_usd;
    if (tokens.cost_partial || (tokens.cost_usd === null && total > 0)) sum.partial = true;
  }
  return sum;
}

/** "1.2M tok · ≈$3.40", then "（部分未定价）" when some usage has no price and "· 子 agent 37%"
 *  when subagents used any of it. Only meaningful when `sum.collected > 0`. */
export function tokenLine(sum: TokenSum): string {
  const cost = sum.cost === null ? "费用未定价" : `≈${usd(sum.cost)}${sum.partial ? "（部分未定价）" : ""}`;
  const share = sum.subagentTokens > 0 && sum.tokens > 0 ? ` · 子 agent ${Math.round((sum.subagentTokens / sum.tokens) * 100)}%` : "";
  return `${compactCount(sum.tokens)} tok · ${cost}${share}`;
}
