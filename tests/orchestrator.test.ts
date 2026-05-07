import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrate } from '../src/orchestrator.js';
import { loadRecipe } from '../src/recipe.js';

describe('orchestrator (echo mode)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'squad-orch-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('runs a 5-agent feature pipeline end-to-end with echo', async () => {
    const recipe = await loadRecipe('feature');
    const events: { agent: string; status: string }[] = [];
    const result = await orchestrate({
      recipe,
      task: 'add OAuth2 login',
      cwd: dir,
      runDir: join(dir, '.run'),
      echo: true,
      onStatusChange: e => events.push({ agent: e.agent, status: e.status }),
    });
    expect(result.failed).toHaveLength(0);
    expect(result.results).toHaveLength(5);
    // All artifacts present
    for (const r of result.results) {
      expect(existsSync(r.artifactPath)).toBe(true);
    }
    // researcher ran first, reviewer last
    const order = result.results.map(r => r.agent);
    expect(order[0]).toBe('researcher');
    expect(order[4]).toBe('reviewer');
    // summary written
    const summary = JSON.parse(readFileSync(join(dir, '.run', 'summary.json'), 'utf8'));
    expect(summary.recipe).toBe('feature');
  });

  it('artifacts are referenceable by later agents', async () => {
    const recipe = await loadRecipe('bugfix');
    const result = await orchestrate({
      recipe,
      task: 'login 500s on empty password',
      cwd: dir,
      runDir: join(dir, '.run'),
      echo: true,
    });
    const fixerArtifact = readFileSync(
      result.results.find(r => r.agent === 'fixer')!.artifactPath,
      'utf8',
    );
    // fixer's prompt should have inlined investigator's artifact
    expect(fixerArtifact).toContain('investigator (echo)');
  });
});
