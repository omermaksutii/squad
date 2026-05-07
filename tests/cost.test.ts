import { describe, it, expect } from 'vitest';
import { estimateCost } from '../src/cost.js';

describe('estimateCost', () => {
  it('sums per-agent budgets', () => {
    const c = estimateCost(
      [
        { name: 'a', description: '', prompt: '', maxBudgetUsd: 0.5 },
        { name: 'b', description: '', prompt: '', maxBudgetUsd: 1.0 },
        { name: 'c', description: '', prompt: '', maxBudgetUsd: 0.25 },
      ],
      [
        { agent: 'a', exitCode: 0, stdout: '', stderr: '', artifactPath: '/x', durationMs: 1000 },
        { agent: 'b', exitCode: 0, stdout: '', stderr: '', artifactPath: '/x', durationMs: 2000 },
        { agent: 'c', exitCode: 0, stdout: '', stderr: '', artifactPath: '/x', durationMs: 500 },
      ],
    );
    expect(c.totalMaxUsd).toBe(1.75);
    expect(c.totalDurationMs).toBe(3500);
    expect(c.perAgent).toHaveLength(3);
  });

  it('defaults missing budgets to 0.5', () => {
    const c = estimateCost(
      [{ name: 'a', description: '', prompt: '' }],
      [],
    );
    expect(c.perAgent[0]?.maxBudgetUsd).toBe(0.5);
  });
});
