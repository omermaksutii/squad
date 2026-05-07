import { describe, it, expect } from 'vitest';
import { renderGraph } from '../src/graph.js';
import { parseRecipe } from '../src/recipe.js';

describe('renderGraph', () => {
  it('renders a linear chain', () => {
    const r = parseRecipe(JSON.stringify({
      name: 'lin', description: 'd',
      agents: [
        { name: 'a', prompt: 'p' },
        { name: 'b', prompt: 'p', dependsOn: ['a'] },
        { name: 'c', prompt: 'p', dependsOn: ['b'] },
      ],
    }), 'test');
    const out = renderGraph(r);
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).toMatch(/3 agents/);
  });

  it('renders branches with tree glyphs', () => {
    const r = parseRecipe(JSON.stringify({
      name: 'tree', description: 'd',
      agents: [
        { name: 'root', prompt: 'p' },
        { name: 'left', prompt: 'p', dependsOn: ['root'] },
        { name: 'right', prompt: 'p', dependsOn: ['root'] },
      ],
    }), 'test');
    const out = renderGraph(r);
    expect(out).toContain('├');
    expect(out).toContain('└');
    expect(out).toContain('left');
    expect(out).toContain('right');
  });

  it('marks repeated visits as (see above)', () => {
    const r = parseRecipe(JSON.stringify({
      name: 'dia', description: 'd',
      agents: [
        { name: 'top', prompt: 'p' },
        { name: 'l', prompt: 'p', dependsOn: ['top'] },
        { name: 'r', prompt: 'p', dependsOn: ['top'] },
        { name: 'bot', prompt: 'p', dependsOn: ['l', 'r'] },
      ],
    }), 'test');
    const out = renderGraph(r);
    // bot should appear twice (under l and under r); second is "(see above)"
    expect(out).toMatch(/see above/);
  });
});
