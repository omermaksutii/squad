import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import { parseRecipe, planExecution } from '../recipe.js';
import { writeJsonResult } from '../json-mode.js';

export async function runValidate(filePath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (writeJsonResult({ ok: false, error: (err as Error).message })) return;
    console.error(chalk.red('cannot read file:'), (err as Error).message);
    process.exitCode = 2;
    return;
  }
  let recipe;
  try {
    recipe = parseRecipe(raw, filePath);
  } catch (err) {
    if (writeJsonResult({ ok: false, error: (err as Error).message })) return;
    console.error(chalk.red('invalid recipe:'), (err as Error).message);
    process.exitCode = 1;
    return;
  }
  let layers;
  try {
    layers = planExecution(recipe);
  } catch (err) {
    if (writeJsonResult({ ok: false, error: (err as Error).message })) return;
    console.error(chalk.red('invalid DAG:'), (err as Error).message);
    process.exitCode = 1;
    return;
  }

  const summary = {
    ok: true,
    name: recipe.name,
    description: recipe.description,
    agents: recipe.agents.length,
    layers: layers.length,
    parallelism: Math.max(...layers.map(l => l.length)),
  };
  if (writeJsonResult(summary)) return;

  console.log(chalk.green('✓ recipe valid'), chalk.cyan(recipe.name));
  console.log(`  agents: ${recipe.agents.length}`);
  console.log(`  layers: ${layers.length}`);
  console.log(`  max parallelism: ${summary.parallelism}`);
}
