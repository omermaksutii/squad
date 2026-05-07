import { describe, it, expect } from 'vitest';
import { renderMermaid } from '../src/mermaid.js';
import { parseRecipe } from '../src/recipe.js';

describe('renderMermaid', () => {
  it('emits flowchart TD with all agents', () => {
    const r = parseRecipe(JSON.stringify({
      name: 't', description: 'd',
      agents: [
        { name: 'a', description: 'first', prompt: 'p' },
        { name: 'b', description: 'second', prompt: 'p', dependsOn: ['a'] },
      ],
    }), 'test');
    const out = renderMermaid(r);
    expect(out).toContain('```mermaid');
    expect(out).toContain('flowchart TD');
    expect(out).toContain('a["a<br/>');
    expect(out).toContain('a --> b');
    expect(out.endsWith('```')).toBe(true);
  });

  it('handles agents with no dependencies', () => {
    const r = parseRecipe(JSON.stringify({
      name: 't', description: 'd',
      agents: [
        { name: 'a', description: 'first', prompt: 'p' },
        { name: 'b', description: 'second', prompt: 'p' },
      ],
    }), 'test');
    const out = renderMermaid(r);
    expect(out).toContain('a[');
    expect(out).toContain('b[');
    // No edges
    expect(out).not.toContain('-->');
  });
});
