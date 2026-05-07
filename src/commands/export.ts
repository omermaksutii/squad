import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { BUILTIN_RECIPE_NAMES } from '../recipe.js';
import { writeJsonResult } from '../json-mode.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function builtinPath(name: string): string {
  const candidates = [
    join(HERE, '..', 'recipes', `${name}.json`),
    join(HERE, '..', '..', 'src', 'recipes', `${name}.json`),
    join(HERE, 'recipes', `${name}.json`),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

type Opts = { to?: string; rename?: string };

export async function runExport(name: string, opts: Opts): Promise<void> {
  if (!BUILTIN_RECIPE_NAMES.includes(name)) {
    if (writeJsonResult({ error: 'unknown_recipe', query: name, builtins: BUILTIN_RECIPE_NAMES })) return;
    console.error(chalk.red(`unknown built-in: "${name}"`));
    console.error(chalk.dim(`available: ${BUILTIN_RECIPE_NAMES.join(', ')}`));
    process.exitCode = 1;
    return;
  }
  const src = builtinPath(name);
  const targetName = opts.rename ?? name;
  const dest = opts.to ?? join(process.env.HOME ?? homedir(), '.squad', 'recipes', `${targetName}.json`);
  if (existsSync(dest)) {
    if (writeJsonResult({ error: 'already_exists', target: dest })) return;
    console.error(chalk.yellow(`already exists: ${dest}`));
    console.error(chalk.dim('pass --rename <new-name> or --to <path>'));
    process.exitCode = 1;
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  if (writeJsonResult({ exported: name, source: src, target: dest, rename: opts.rename })) return;
  console.log(chalk.green('exported'), chalk.cyan(name), chalk.dim('→'), chalk.cyan(dest));
  console.log(chalk.dim(`edit it, then run with \`squad run ${targetName} "task"\``));
}
