import { describe, it, expect } from 'vitest';
import { loadRecipe, parseRecipe, planExecution, BUILTIN_RECIPE_NAMES } from '../src/recipe.js';

describe('recipe loading', () => {
  it('loads each built-in recipe', async () => {
    for (const name of BUILTIN_RECIPE_NAMES) {
      const r = await loadRecipe(name);
      expect(r.name).toBe(name);
      expect(r.agents.length).toBeGreaterThan(0);
    }
  });

  it('throws for unknown recipe', async () => {
    await expect(loadRecipe('nope-does-not-exist')).rejects.toThrow();
  });

  it('parses inline recipe JSON', () => {
    const r = parseRecipe(JSON.stringify({
      name: 't', description: 'd',
      agents: [{ name: 'a', prompt: 'p' }],
    }), 'inline');
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0]!.name).toBe('a');
    expect(r.agents[0]!.model).toBe('sonnet');
  });

  it('rejects unknown dependsOn', () => {
    expect(() => parseRecipe(JSON.stringify({
      name: 't', description: 'd',
      agents: [
        { name: 'a', prompt: 'p', dependsOn: ['ghost'] },
      ],
    }), 'inline')).toThrow(/unknown/);
  });

  it('rejects empty agent list', () => {
    expect(() => parseRecipe(JSON.stringify({
      name: 't', description: 'd', agents: [],
    }), 'inline')).toThrow(/at least one/);
  });
});

describe('planExecution', () => {
  it('topologically sorts a linear chain', async () => {
    const r = await loadRecipe('feature');
    const layers = planExecution(r);
    expect(layers).toHaveLength(5); // 5 sequential agents
    expect(layers[0]?.[0]?.name).toBe('researcher');
    expect(layers[4]?.[0]?.name).toBe('reviewer');
  });

  it('detects cycles', () => {
    const r = parseRecipe(JSON.stringify({
      name: 't', description: 'd',
      agents: [
        { name: 'a', prompt: 'p', dependsOn: ['b'] },
        { name: 'b', prompt: 'p', dependsOn: ['a'] },
      ],
    }), 'inline');
    expect(() => planExecution(r)).toThrow(/cycle/);
  });

  it('puts independent agents in same layer (parallel)', () => {
    const r = parseRecipe(JSON.stringify({
      name: 't', description: 'd',
      agents: [
        { name: 'a', prompt: 'p' },
        { name: 'b', prompt: 'p' },
        { name: 'c', prompt: 'p', dependsOn: ['a', 'b'] },
      ],
    }), 'inline');
    const layers = planExecution(r);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toHaveLength(2);
    expect(layers[1]).toHaveLength(1);
  });
});
