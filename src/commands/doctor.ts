import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { writeJsonResult } from '../json-mode.js';
import { BUILTIN_RECIPE_NAMES, loadRecipe } from '../recipe.js';

type Check = { name: string; ok: boolean; warn?: boolean; detail: string };

export async function runDoctor(): Promise<void> {
  const checks: Check[] = [];

  // claude on PATH?
  const claudeWhich = spawnSyncSafe('which', ['claude']);
  const claudeOk = (claudeWhich.status ?? 1) === 0;
  const claudePath = claudeWhich.stdout?.toString().trim();
  checks.push({ name: 'claude on PATH', ok: claudeOk, detail: claudeOk ? claudePath : 'install Claude Code first' });

  if (claudeOk) {
    const v = spawnSyncSafe('claude', ['--version']);
    const ver = v.stdout?.toString().trim().split('\n')[0] ?? 'unknown';
    checks.push({ name: 'claude --version', ok: (v.status ?? 1) === 0, detail: ver });
  }

  // recipes resolvable?
  let recipesOk = true;
  let recipeCount = 0;
  try {
    for (const name of BUILTIN_RECIPE_NAMES) {
      await loadRecipe(name);
      recipeCount++;
    }
  } catch (err) {
    recipesOk = false;
    checks.push({ name: 'built-in recipes', ok: false, detail: (err as Error).message });
  }
  if (recipesOk) {
    checks.push({ name: 'built-in recipes', ok: true, detail: `${recipeCount} loadable` });
  }

  // squad skill installed in ~/.claude?
  const skill = join(homedir(), '.claude', 'skills', 'squad', 'SKILL.md');
  const skillOk = existsSync(skill);
  checks.push({
    name: 'squad skill',
    ok: skillOk,
    warn: !skillOk,
    detail: skillOk ? skill : 'optional — run `squad install` to enable /squad in Claude Code',
  });

  // user recipes dir
  const userRecipes = join(homedir(), '.squad', 'recipes');
  const userRecipesExists = existsSync(userRecipes);
  checks.push({
    name: 'user recipes dir',
    ok: true,
    detail: userRecipesExists ? userRecipes : '(none — run `squad new <name>` to scaffold)',
  });

  // docker (only fail if user opted into sandbox checks)
  const checkDocker = process.argv.includes('--sandbox') || process.env.SQUAD_DOCTOR_SANDBOX === '1';
  const dockerVer = spawnSyncSafe('docker', ['--version']);
  const dockerOk = (dockerVer.status ?? 1) === 0;
  if (checkDocker || dockerOk) {
    checks.push({
      name: 'docker',
      ok: dockerOk,
      warn: !dockerOk && !checkDocker,
      detail: dockerOk
        ? dockerVer.stdout?.toString().trim()
        : 'optional — required only for `squad run --sandbox`',
    });
  }
  if (dockerOk) {
    const info = spawnSyncSafe('docker', ['info']);
    const daemonOk = (info.status ?? 1) === 0;
    checks.push({
      name: 'docker daemon',
      ok: daemonOk,
      warn: !daemonOk && !checkDocker,
      detail: daemonOk ? 'reachable' : 'start Docker Desktop / dockerd to use --sandbox',
    });
  }

  if (writeJsonResult({ checks })) return;

  let allOk = true;
  let warnings = 0;
  for (const c of checks) {
    let tag: string;
    if (c.ok) {
      tag = chalk.green('OK ');
    } else if (c.warn) {
      tag = chalk.yellow('WARN');
      warnings++;
    } else {
      tag = chalk.red('FAIL');
      allOk = false;
    }
    console.log(`${tag} ${pad(c.name, 22)} ${chalk.dim(c.detail)}`);
  }
  console.log('');
  if (allOk && warnings === 0) console.log(chalk.green('healthy'));
  else if (allOk) console.log(chalk.yellow(`healthy with ${warnings} warning${warnings === 1 ? '' : 's'}`));
  else {
    console.log(chalk.red('issues detected'));
    process.exitCode = 1;
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function spawnSyncSafe(cmd: string, args: string[]): SpawnSyncReturns<Buffer> {
  try {
    return spawnSync(cmd, args, { encoding: 'buffer' });
  } catch {
    return { status: 1, stdout: Buffer.from(''), stderr: Buffer.from(''), signal: null, pid: 0, output: [] } as unknown as SpawnSyncReturns<Buffer>;
  }
}
