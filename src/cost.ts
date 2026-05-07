import type { AgentSpec } from './recipe.js';
import type { RunResult } from './runner.js';

/** A coarse cost estimate based on recipe budgets. Real per-call cost requires
 * parsing claude's --output-format json output; that lands in v1.1. */
export type CostEstimate = {
  perAgent: { name: string; maxBudgetUsd: number; durationMs: number; spent?: number }[];
  totalMaxUsd: number;
  totalDurationMs: number;
};

export function estimateCost(specs: AgentSpec[], results: RunResult[]): CostEstimate {
  const byName = new Map(results.map(r => [r.agent, r]));
  const perAgent = specs.map(s => {
    const r = byName.get(s.name);
    return {
      name: s.name,
      maxBudgetUsd: s.maxBudgetUsd ?? 0.5,
      durationMs: r?.durationMs ?? 0,
      spent: r?.costUsd,
    };
  });
  return {
    perAgent,
    totalMaxUsd: perAgent.reduce((acc, a) => acc + a.maxBudgetUsd, 0),
    totalDurationMs: perAgent.reduce((acc, a) => acc + a.durationMs, 0),
  };
}
