import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRuns, runLogs } from '../src/commands/runs.js';

describe('runs / logs', () => {
  let cwd: string;
  let captured: string;
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'squad-runs-'));
    captured = '';
    origLog = console.log;
    origErr = console.error;
    console.log = (...args: unknown[]) => { captured += args.join(' ') + '\n'; };
    console.error = (...args: unknown[]) => { captured += args.join(' ') + '\n'; };
  });
  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('runs lists nothing when no .squad/runs', async () => {
    await runRuns({ cwd, limit: 10 });
    expect(captured).toMatch(/no runs/i);
  });

  it('runs lists past runs in newest-first order', async () => {
    const runsDir = join(cwd, '.squad', 'runs');
    mkdirSync(join(runsDir, 'older'), { recursive: true });
    writeFileSync(join(runsDir, 'older', 'summary.json'), JSON.stringify({ recipe: 'feature', durationMs: 1000, results: [], failed: [] }));
    // Force a small mtime gap
    await new Promise(r => setTimeout(r, 10));
    mkdirSync(join(runsDir, 'newer'), { recursive: true });
    writeFileSync(join(runsDir, 'newer', 'summary.json'), JSON.stringify({ recipe: 'bugfix', durationMs: 500, results: [{ agent: 'a' }], failed: [] }));

    await runRuns({ cwd, limit: 10 });
    const newerIdx = captured.indexOf('newer');
    const olderIdx = captured.indexOf('older');
    expect(newerIdx).toBeGreaterThanOrEqual(0);
    expect(olderIdx).toBeGreaterThan(newerIdx); // newer comes first
  });

  it('logs reports not_found for unknown run', async () => {
    const runsDir = join(cwd, '.squad', 'runs');
    mkdirSync(runsDir, { recursive: true });
    await runLogs({ cwd, runId: 'does-not-exist' });
    expect(captured).toMatch(/no run matches/i);
    process.exitCode = 0; // reset
  });

  it('logs prints artifact contents', async () => {
    const runDir = join(cwd, '.squad', 'runs', 'abc');
    mkdirSync(join(runDir, 'artifacts'), { recursive: true });
    writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ recipe: 'feature', durationMs: 1000, results: [{ agent: 'researcher' }], failed: [] }));
    writeFileSync(join(runDir, 'artifacts', 'researcher.md'), '# research output\nthings I learned');

    await runLogs({ cwd, runId: 'abc' });
    expect(captured).toContain('researcher.md');
    expect(captured).toContain('things I learned');
  });

  it('logs accepts "last" alias', async () => {
    const runsDir = join(cwd, '.squad', 'runs');
    mkdirSync(join(runsDir, 'r1', 'artifacts'), { recursive: true });
    writeFileSync(join(runsDir, 'r1', 'artifacts', 'a.md'), 'old');
    await new Promise(r => setTimeout(r, 10));
    mkdirSync(join(runsDir, 'r2', 'artifacts'), { recursive: true });
    writeFileSync(join(runsDir, 'r2', 'artifacts', 'a.md'), 'newer');

    await runLogs({ cwd, runId: 'last' });
    expect(captured).toContain('newer');
    expect(captured).not.toContain('old');
  });
});
