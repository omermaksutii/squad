import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExport } from '../src/commands/export.js';

describe('export command', () => {
  let dir: string;
  let captured: string;
  let origLog: typeof console.log;
  let origErr: typeof console.error;
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'squad-export-'));
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

  it('exports a built-in to a custom path', async () => {
    const target = join(dir, 'feature.json');
    await runExport('feature', { to: target });
    expect(existsSync(target)).toBe(true);
    const content = JSON.parse(readFileSync(target, 'utf8'));
    expect(content.name).toBe('feature');
    expect(captured).toMatch(/exported/);
  });

  it('respects --rename', async () => {
    const target = join(dir, 'my-feature.json');
    await runExport('feature', { to: target, rename: 'my-feature' });
    expect(existsSync(target)).toBe(true);
  });

  it('rejects unknown built-ins', async () => {
    await runExport('does-not-exist', { to: join(dir, 'x.json') });
    expect(captured).toMatch(/unknown built-in/i);
  });

  it('refuses to overwrite an existing file', async () => {
    const target = join(dir, 'feature.json');
    await runExport('feature', { to: target });
    captured = '';
    await runExport('feature', { to: target });
    expect(captured).toMatch(/already exists/i);
  });
});
