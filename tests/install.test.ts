import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInstall } from '../src/commands/install.js';
import { runUninstall } from '../src/commands/uninstall.js';
import { runDoctor } from '../src/commands/doctor.js';

describe('install / uninstall', () => {
  let claudeDir: string;
  let captured: string;
  let origLog: typeof console.log;
  let origErr: typeof console.error;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'squad-install-'));
    claudeDir = join(root, '.claude');
    process.env.SQUAD_CLAUDE_DIR = claudeDir;
    captured = '';
    origLog = console.log;
    origErr = console.error;
    console.log = (...a: unknown[]) => { captured += a.join(' ') + '\n'; };
    console.error = (...a: unknown[]) => { captured += a.join(' ') + '\n'; };
  });
  afterEach(() => {
    console.log = origLog;
    console.error = origErr;
    delete process.env.SQUAD_CLAUDE_DIR;
    rmSync(claudeDir, { recursive: true, force: true });
  });

  it('install copies SKILL.md', async () => {
    await runInstall({});
    const dest = join(claudeDir, 'skills', 'squad', 'SKILL.md');
    expect(existsSync(dest)).toBe(true);
    expect(captured).toMatch(/installed/);
  });

  it('install --dry-run does not write', async () => {
    await runInstall({ dryRun: true });
    const dest = join(claudeDir, 'skills', 'squad', 'SKILL.md');
    expect(existsSync(dest)).toBe(false);
    expect(captured).toMatch(/would install/);
  });

  it('install respects --force overwrite', async () => {
    const dest = join(claudeDir, 'skills', 'squad', 'SKILL.md');
    mkdirSync(join(claudeDir, 'skills', 'squad'), { recursive: true });
    writeFileSync(dest, 'old content');
    captured = '';
    await runInstall({ force: true });
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(dest, 'utf8');
    expect(content).not.toBe('old content');
    expect(content).toMatch(/^---/); // frontmatter from real SKILL.md
  });

  it('install without --force refuses to overwrite', async () => {
    const dest = join(claudeDir, 'skills', 'squad', 'SKILL.md');
    mkdirSync(join(claudeDir, 'skills', 'squad'), { recursive: true });
    writeFileSync(dest, 'preserved');
    captured = '';
    await runInstall({});
    const fs = await import('node:fs/promises');
    expect(await fs.readFile(dest, 'utf8')).toBe('preserved');
    expect(captured).toMatch(/already installed/);
  });

  it('uninstall removes SKILL.md', async () => {
    await runInstall({});
    captured = '';
    await runUninstall();
    const dest = join(claudeDir, 'skills', 'squad', 'SKILL.md');
    expect(existsSync(dest)).toBe(false);
    expect(captured).toMatch(/removed/);
  });

  it('uninstall is a no-op when nothing installed', async () => {
    await runUninstall();
    expect(captured).toMatch(/not installed/);
  });

  it('doctor reports skill OK when installed', async () => {
    await runInstall({});
    captured = '';
    await runDoctor();
    expect(captured).toMatch(/squad skill/);
    expect(captured).toMatch(/OK/);
  });
});
