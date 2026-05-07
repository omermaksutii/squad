import { unlink, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { writeJsonResult } from '../json-mode.js';

export async function runUninstall(): Promise<void> {
  const claudeDir = process.env.SQUAD_CLAUDE_DIR ?? join(homedir(), '.claude');
  const skillDir = join(claudeDir, 'skills', 'squad');
  const skillFile = join(skillDir, 'SKILL.md');

  if (writeJsonResult({ removed: existsSync(skillFile), path: skillFile })) return;

  if (!existsSync(skillFile)) {
    console.log(chalk.dim('squad skill is not installed'));
    return;
  }
  await unlink(skillFile);
  try { await rmdir(skillDir); } catch {}
  console.log(chalk.green('removed'), chalk.cyan(skillFile));
  console.log(chalk.dim('restart Claude Code to drop the skill from the active session'));
}
