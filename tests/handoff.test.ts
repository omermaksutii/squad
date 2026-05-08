import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orchestrate } from '../src/orchestrator.js';
import { loadRecipe } from '../src/recipe.js';
import { buildDependentsMap, buildHandoff, formatHandoff } from '../src/handoff.js';

describe('handoff (v1.1)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'squad-handoff-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('emits a handoff per producer→dependent edge in the DAG', async () => {
    const recipe = await loadRecipe('feature');
    const events: { from: string; to: string[] }[] = [];
    const result = await orchestrate({
      recipe,
      task: 'add OAuth2 login',
      cwd: dir,
      runDir: join(dir, '.run'),
      echo: true,
      onHandoff: e => events.push({ from: e.from, to: e.to }),
    });
    expect(result.failed).toHaveLength(0);
    // Every agent except the terminal one (reviewer) should have emitted a handoff
    const terminalAgents = recipe.agents
      .filter(a => !recipe.agents.some(other => other.dependsOn?.includes(a.name)))
      .map(a => a.name);
    const producers = recipe.agents.map(a => a.name).filter(n => !terminalAgents.includes(n));
    for (const p of producers) {
      expect(events.find(e => e.from === p)).toBeTruthy();
    }
    // Terminal agent (reviewer) has no dependents, so no event for it
    for (const t of terminalAgents) {
      expect(events.find(e => e.from === t)).toBeFalsy();
    }
  });

  it('handoff event includes the artifact file with non-zero size', async () => {
    const recipe = await loadRecipe('bugfix');
    const events: import('../src/handoff.js').HandoffEvent[] = [];
    await orchestrate({
      recipe,
      task: 'login 500s',
      cwd: dir,
      runDir: join(dir, '.run'),
      echo: true,
      onHandoff: e => events.push(e),
    });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.files.length).toBe(1);
      expect(e.files[0]!.bytes).toBeGreaterThan(0);
      expect(e.files[0]!.path).toContain(`${e.from}.md`);
    }
  });

  it('OrchestrationResult.handoffs accumulates all events', async () => {
    const recipe = await loadRecipe('feature');
    const result = await orchestrate({
      recipe,
      task: 'x',
      cwd: dir,
      runDir: join(dir, '.run'),
      echo: true,
    });
    expect(result.handoffs).toBeDefined();
    expect(Array.isArray(result.handoffs)).toBe(true);
    // feature recipe: researcher → architect → coder → tester → reviewer
    // 4 producers (each except reviewer), 4 handoff events
    expect(result.handoffs.length).toBe(4);
  });

  it('buildDependentsMap inverts dependsOn edges', async () => {
    const recipe = await loadRecipe('feature');
    const dep = buildDependentsMap(recipe);
    // researcher → [architect]
    expect(dep.get('researcher')).toEqual(['architect']);
  });

  it('buildHandoff returns null when no dependents', async () => {
    const ev = await buildHandoff('terminal', [], '/nonexistent/path.md');
    expect(ev).toBeNull();
  });

  it('buildHandoff emits empty files[] when artifact missing', async () => {
    const ev = await buildHandoff('a', ['b'], '/nonexistent/path.md');
    expect(ev).not.toBeNull();
    expect(ev!.files).toEqual([]);
  });

  it('buildHandoff includes file size when artifact exists', async () => {
    const file = join(dir, 'art.md');
    writeFileSync(file, 'hello world');
    const ev = await buildHandoff('a', ['b'], file);
    expect(ev!.files).toEqual([{ path: file, bytes: 11 }]);
  });

  it('formatHandoff prints A → B: filename (size)', () => {
    const s = formatHandoff({
      from: 'planner',
      to: ['coder'],
      files: [{ path: '/runs/x/artifacts/planner.md', bytes: 1234 }],
    });
    expect(s).toBe('planner → coder: planner.md (1.2KB)');
  });

  it('formatHandoff handles empty files[]', () => {
    const s = formatHandoff({ from: 'planner', to: ['coder'], files: [] });
    expect(s).toBe('planner → coder: (no artifacts)');
  });
});
