import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { writeJsonResult } from '../json-mode.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function skillSrc(): string {
  const candidates = [
    join(HERE, '..', '..', 'assets', 'skill', 'SKILL.md'),
    join(HERE, '..', 'assets', 'skill', 'SKILL.md'),
    join(HERE, 'assets', 'skill', 'SKILL.md'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('cannot locate bundled SKILL.md (tried 3 candidate paths)');
}

export async function runInstall(opts: { dryRun?: boolean; force?: boolean } = {}): Promise<void> {
  const claudeDir = process.env.SQUAD_CLAUDE_DIR ?? join(homedir(), '.claude');
  const dest = join(claudeDir, 'skills', 'squad', 'SKILL.md');
  const src = skillSrc();

  if (writeJsonResult({ source: src, target: dest, dry_run: !!opts.dryRun, exists: existsSync(dest) })) return;

  if (opts.dryRun) {
    console.log(chalk.dim('would install'), chalk.cyan(src));
    console.log(chalk.dim('       to    '), chalk.cyan(dest));
    return;
  }

  if (existsSync(dest) && !opts.force) {
    console.log(chalk.yellow('already installed:'), dest);
    console.log(chalk.dim('pass --force to overwrite'));
    return;
  }

  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(chalk.green('installed'), chalk.cyan(dest));
  console.log(chalk.dim('restart Claude Code, then try `/squad`'));
}
