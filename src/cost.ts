import type { AgentSpec } from './recipe.js';
import type { RunResult } from './runner.js';

export type CostEstimate = {
  perAgent: {
    name: string;
    maxBudgetUsd: number;
    durationMs: number;
    spent?: number;
    inputTokens?: number;
    outputTokens?: number;
  }[];
  totalMaxUsd: number;
  totalSpentUsd: number;
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** True when at least one agent reported real cost via stream-json. */
  hasRealCost: boolean;
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
      inputTokens: r?.tokens?.input,
      outputTokens: r?.tokens?.output,
    };
  });
  const totalSpentUsd = perAgent.reduce((acc, a) => acc + (a.spent ?? 0), 0);
  return {
    perAgent,
    totalMaxUsd: perAgent.reduce((acc, a) => acc + a.maxBudgetUsd, 0),
    totalSpentUsd,
    totalDurationMs: perAgent.reduce((acc, a) => acc + a.durationMs, 0),
    totalInputTokens: perAgent.reduce((acc, a) => acc + (a.inputTokens ?? 0), 0),
    totalOutputTokens: perAgent.reduce((acc, a) => acc + (a.outputTokens ?? 0), 0),
    hasRealCost: perAgent.some(a => typeof a.spent === 'number'),
  };
}
