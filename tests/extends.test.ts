import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecipe, parseRecipe } from '../src/recipe.js';

describe('recipe extends', () => {
  let homeDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'squad-extends-'));
    origHome = process.env.HOME;
    process.env.HOME = homeDir;
  });
  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('parses extends without requiring description+agents', () => {
    const r = parseRecipe(JSON.stringify({ name: 'child', extends: 'feature' }), 'inline');
    expect(r.extends).toBe('feature');
  });

  it('child inherits parent agents and overrides by name', async () => {
    const recipesDir = join(homeDir, '.squad', 'recipes');
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(join(recipesDir, 'my-feature.json'), JSON.stringify({
      name: 'my-feature',
      extends: 'feature',
      agents: [
        { name: 'reviewer', prompt: 'CUSTOM REVIEWER PROMPT for {{task}}', model: 'haiku' },
      ],
    }));
    const r = await loadRecipe('my-feature');
    // All 5 agents from parent should be present
    expect(r.agents.map(a => a.name).sort()).toEqual(['architect', 'coder', 'researcher', 'reviewer', 'tester']);
    // reviewer should be overridden
    const reviewer = r.agents.find(a => a.name === 'reviewer')!;
    expect(reviewer.prompt).toContain('CUSTOM REVIEWER');
    expect(reviewer.model).toBe('haiku');
    // researcher should be unchanged from parent
    const researcher = r.agents.find(a => a.name === 'researcher')!;
    expect(researcher.prompt).toContain('Explore the codebase');
  });

  it('detects inheritance cycles', async () => {
    const recipesDir = join(homeDir, '.squad', 'recipes');
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(join(recipesDir, 'a.json'), JSON.stringify({ name: 'a', extends: 'b', agents: [] }));
    writeFileSync(join(recipesDir, 'b.json'), JSON.stringify({ name: 'b', extends: 'a', agents: [] }));
    await expect(loadRecipe('a')).rejects.toThrow(/cycle/i);
  });
});
