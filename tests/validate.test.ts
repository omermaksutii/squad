import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runValidate } from '../src/commands/validate.js';

describe('validate command', () => {
  let dir: string;
  let captured: string;
  let origLog: typeof console.log;
  let origErr: typeof console.error;
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'squad-validate-'));
    captured = '';
    origLog = console.log;
    origErr = console.error;
    console.log = (...a: unknown[]) => { captured += a.join(' ') + '\n'; };
    console.error = (...a: unknown[]) => { captured += a.join(' ') + '\n'; };
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });
  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    process.exitCode = originalExitCode;
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a valid recipe', async () => {
    const file = join(dir, 'good.json');
    writeFileSync(file, JSON.stringify({
      name: 't', description: 'd',
      agents: [{ name: 'a', prompt: 'p' }],
    }));
    await runValidate(file);
    expect(captured).toMatch(/valid/);
  });

  it('rejects missing description', async () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ name: 't', agents: [{ name: 'a', prompt: 'p' }] }));
    await runValidate(file);
    expect(captured).toMatch(/invalid/i);
  });

  it('reports missing file gracefully', async () => {
    await runValidate(join(dir, 'nope.json'));
    expect(captured).toMatch(/cannot read/i);
  });

  it('detects DAG cycles', async () => {
    const file = join(dir, 'cycle.json');
    writeFileSync(file, JSON.stringify({
      name: 't', description: 'd',
      agents: [
        { name: 'a', prompt: 'p', dependsOn: ['b'] },
        { name: 'b', prompt: 'p', dependsOn: ['a'] },
      ],
    }));
    await runValidate(file);
    expect(captured).toMatch(/cycle|invalid/i);
  });
});
