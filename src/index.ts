import { Command } from 'commander';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { BUILTIN_RECIPE_NAMES, loadRecipe, planExecution } from './recipe.js';
import { orchestrate } from './orchestrator.js';
import { SquadTUI } from './tui.js';

export const VERSION = '0.1.0';

const HERE = dirname(fileURLToPath(import.meta.url));

const program = new Command();
program
  .name('squad')
  .description('Opinionated subagent pipelines for Claude Code')
  .version(VERSION);

program
  .command('list')
  .description('List built-in recipes')
  .action(async () => {
    console.log(chalk.bold('Built-in recipes:'));
    for (const name of BUILTIN_RECIPE_NAMES) {
      const r = await loadRecipe(name);
      console.log('');
      console.log(`  ${chalk.cyan(r.name)} ${chalk.dim('—')} ${r.headline}`);
      console.log(`    ${chalk.dim('agents:')} ${r.agents.map(a => a.name).join(' → ')}`);
    }
  });

program
  .command('show <recipe>')
  .description('Print the recipe DAG and prompts')
  .action(async (name: string) => {
    const r = await loadRecipe(name);
    console.log(chalk.bold.cyan(r.name));
    console.log(r.description);
    console.log('');
    const layers = planExecution(r);
    layers.forEach((layer, i) => {
      console.log(chalk.dim(`Layer ${i + 1}:`));
      for (const a of layer) {
        const deps = a.dependsOn?.length ? chalk.dim(` ← ${a.dependsOn.join(', ')}`) : '';
        console.log(`  ${chalk.cyan(a.name)} ${chalk.dim(`(${a.model})`)}${deps}`);
        console.log(`    ${a.description}`);
      }
    });
  });

program
  .command('run <recipe> [task...]')
  .description('Execute a recipe end-to-end')
  .option('--cwd <path>', 'Working directory for agents', process.cwd())
  .option('--echo', 'Do not call claude — echo prompts (for testing)', false)
  .option('--task-file <path>', 'Read the task description from a file instead of args')
  .option('--no-tui', 'Disable the live TUI; print plain logs')
  .action(async (
    name: string,
    taskParts: string[],
    opts: { cwd: string; echo: boolean; taskFile?: string; tui: boolean },
  ) => {
    let task = taskParts.join(' ').trim();
    if (opts.taskFile) {
      task = (await readFile(opts.taskFile, 'utf8')).trim();
    }
    if (!task) {
      console.error(chalk.red('error: task is required (positional args or --task-file)'));
      process.exitCode = 2;
      return;
    }

    const recipe = await loadRecipe(name);
    const tui = opts.tui ? new SquadTUI(recipe.agents) : null;

    console.log(chalk.bold(`squad:${recipe.name}`), chalk.dim(`→ ${recipe.agents.length} agents`));
    console.log(chalk.dim(`  task: ${task}`));
    console.log('');

    const result = await orchestrate({
      recipe,
      task,
      cwd: opts.cwd,
      echo: opts.echo,
      onStdoutLine: (line: string) => tui?.log(line),
      onStatusChange: e => {
        tui?.set(e.agent, {
          status: e.status,
          artifactPath: e.result?.artifactPath,
          durationMs: e.result?.durationMs,
        });
      },
    });

    tui?.finalize();

    console.log('');
    console.log(chalk.bold(`done in ${(result.durationMs / 1000).toFixed(1)}s`));
    console.log(chalk.dim(`run dir: ${result.runDir}`));
    if (result.failed.length) {
      console.log(chalk.red(`  ${result.failed.length} failures:`));
      for (const f of result.failed) console.log(chalk.red(`    ${f.agent}: ${f.error}`));
      process.exitCode = 1;
    } else {
      console.log(chalk.green(`  ✓ all ${result.results.length} agents succeeded`));
      console.log(chalk.dim('  artifacts:'));
      for (const r of result.results) console.log(chalk.dim(`    ${r.artifactPath}`));
    }
  });

program
  .command('init [recipe]')
  .description('Scaffold a custom recipe at ~/.squad/recipes/<name>.json')
  .action(async (recipe?: string) => {
    const home = process.env.HOME ?? '';
    const dir = join(home, '.squad', 'recipes');
    await mkdir(dir, { recursive: true });
    const target = join(dir, `${recipe ?? 'custom'}.json`);
    if (existsSync(target)) {
      console.error(chalk.yellow(`already exists: ${target}`));
      process.exitCode = 1;
      return;
    }
    const tmpl = await readFile(join(HERE, 'recipes', 'feature.json'), 'utf8');
    await writeFile(target, tmpl);
    console.log(chalk.green('created'), target);
    console.log(chalk.dim('edit it, then run with `squad run <name> "task"`'));
  });

program.parseAsync(process.argv).catch(err => {
  console.error('squad:', err.message);
  process.exit(1);
});
