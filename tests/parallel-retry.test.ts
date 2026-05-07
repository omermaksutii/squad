import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrate } from '../src/orchestrator.js';
import { parseRecipe } from '../src/recipe.js';

describe('orchestrator --parallel and --retry', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'squad-pr-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('parallel: runs independent agents concurrently in echo mode', async () => {
    const r = parseRecipe(JSON.stringify({
      name: 'fan', description: 'd',
      agents: [
        { name: 'a', prompt: 'p' },
        { name: 'b', prompt: 'p' },
        { name: 'c', prompt: 'p' },
        { name: 'd', prompt: 'p', dependsOn: ['a', 'b', 'c'] },
      ],
    }), 'test');
    const result = await orchestrate({
      recipe: r,
      task: 'x',
      cwd: dir,
      echo: true,
      parallel: 2,
    });
    expect(result.failed).toHaveLength(0);
    expect(result.results).toHaveLength(4);
  });

  it('retry: 0 retries means a single attempt (echo always succeeds)', async () => {
    const r = parseRecipe(JSON.stringify({
      name: 't', description: 'd',
      agents: [{ name: 'a', prompt: 'p' }],
    }), 'test');
    const result = await orchestrate({ recipe: r, task: 'x', cwd: dir, echo: true, retry: 0 });
    expect(result.results).toHaveLength(1);
  });

  it('parallel and retry are independent options that compose', async () => {
    const r = parseRecipe(JSON.stringify({
      name: 't', description: 'd',
      agents: [
        { name: 'a', prompt: 'p' },
        { name: 'b', prompt: 'p' },
      ],
    }), 'test');
    const result = await orchestrate({ recipe: r, task: 'x', cwd: dir, echo: true, parallel: 1, retry: 2 });
    expect(result.results).toHaveLength(2);
  });
});
