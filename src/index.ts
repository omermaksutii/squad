import { Command } from 'commander';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { BUILTIN_RECIPE_NAMES, loadRecipe, planExecution } from './recipe.js';
import { orchestrate } from './orchestrator.js';
import { SquadTUI } from './tui.js';
import { writeJsonResult } from './json-mode.js';
import { runDoctor } from './commands/doctor.js';
import { runInstall } from './commands/install.js';
import { runDemo } from './commands/demo.js';
import { runValidate } from './commands/validate.js';
import { runRuns, runLogs } from './commands/runs.js';
import { runUninstall } from './commands/uninstall.js';
import { runExport } from './commands/export.js';
import { renderGraph } from './graph.js';
import { estimateCost } from './cost.js';

export const VERSION = '1.0.0';

const HERE = dirname(fileURLToPath(import.meta.url));

// --json pre-parse: works in any argv position
if (process.argv.includes('--json')) {
  process.env.SQUAD_JSON = '1';
  process.argv = process.argv.filter(a => a !== '--json');
}

const program = new Command();
program
  .name('squad')
  .description('Opinionated subagent pipelines for Claude Code')
  .version(VERSION);

program
  .command('list')
  .description('List built-in recipes')
  .action(async () => {
    const recipes = await Promise.all(BUILTIN_RECIPE_NAMES.map(n => loadRecipe(n)));
    if (writeJsonResult(recipes.map(r => ({ name: r.name, headline: r.headline, agents: r.agents.map(a => a.name) })))) return;
    console.log(chalk.bold('Built-in recipes:'));
    for (const r of recipes) {
      console.log('');
      console.log(`  ${chalk.cyan(r.name)} ${chalk.dim('—')} ${r.headline}`);
      console.log(`    ${chalk.dim('agents:')} ${r.agents.map(a => a.name).join(' → ')}`);
    }
  });

program
  .command('show <recipe>')
  .description('Print the recipe DAG and prompts')
  .option('--graph', 'Render the DAG as ASCII tree art', false)
  .action(async (name: string, opts: { graph: boolean }) => {
    const r = await loadRecipe(name);
    const layers = planExecution(r);
    if (writeJsonResult({
      name: r.name,
      description: r.description,
      layers: layers.map(l => l.map(a => ({ name: a.name, model: a.model, dependsOn: a.dependsOn ?? [], description: a.description }))),
    })) return;
    if (opts.graph) {
      console.log(renderGraph(r));
      return;
    }
    console.log(chalk.bold.cyan(r.name));
    console.log(r.description);
    console.log('');
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
  .option('--parallel <n>', 'Max concurrent agents per layer (default unlimited)', '0')
  .option('--retry <n>', 'Retry each agent up to N times on failure', '0')
  .action(async (
    name: string,
    taskParts: string[],
    opts: { cwd: string; echo: boolean; taskFile?: string; tui: boolean; parallel: string; retry: string },
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
    const tuiEnabled = opts.tui && process.stdout.isTTY && process.env.SQUAD_JSON !== '1';
    const tui = tuiEnabled ? new SquadTUI(recipe.agents) : null;

    if (!tui && process.env.SQUAD_JSON !== '1') {
      console.log(chalk.bold(`squad:${recipe.name}`), chalk.dim(`→ ${recipe.agents.length} agents`));
      console.log(chalk.dim(`  task: ${task}`));
      console.log('');
    }

    const result = await orchestrate({
      recipe,
      task,
      cwd: opts.cwd,
      echo: opts.echo,
      parallel: Number(opts.parallel),
      retry: Number(opts.retry),
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

    const cost = estimateCost(recipe.agents, result.results);

    if (writeJsonResult({
      recipe: result.recipe,
      run_dir: result.runDir,
      duration_ms: result.durationMs,
      cost,
      results: result.results.map(r => ({
        agent: r.agent,
        exit_code: r.exitCode,
        artifact_path: r.artifactPath,
        duration_ms: r.durationMs,
      })),
      failed: result.failed,
    })) return;

    console.log('');
    console.log(chalk.bold(`done in ${(result.durationMs / 1000).toFixed(1)}s`));
    console.log(chalk.dim(`run dir: ${result.runDir}`));
    if (!opts.echo) {
      console.log(chalk.dim(`max budget: $${cost.totalMaxUsd.toFixed(2)} across ${cost.perAgent.length} agents`));
    }
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
  .command('new [recipe]')
  .alias('init')
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
    const tmpl = await readFile(skillCandidate('recipes/feature.json'), 'utf8');
    await writeFile(target, tmpl);
    console.log(chalk.green('created'), target);
    console.log(chalk.dim('edit it, then run with `squad run <name> "task"`'));
  });

program
  .command('install')
  .description('Install the /squad skill into Claude Code (~/.claude/skills/squad/)')
  .option('--dry-run', 'Show what would be written without writing', false)
  .option('-f, --force', 'Overwrite existing skill', false)
  .action(async (opts: { dryRun: boolean; force: boolean }) => { await runInstall(opts); });

program
  .command('doctor')
  .description('Diagnose your Squad installation')
  .action(async () => { await runDoctor(); });

program
  .command('demo')
  .description('Run a self-contained echo-mode demo (no claude needed, no tokens spent)')
  .action(async () => { await runDemo(); });

program
  .command('validate <file>')
  .description('Lint a custom recipe JSON file')
  .action(async (file: string) => { await runValidate(file); });

program
  .command('runs')
  .description('List recent runs in the current project')
  .option('--cwd <path>', 'Working directory to scan', process.cwd())
  .option('-l, --limit <n>', 'Max runs to list', '10')
  .action(async (opts: { cwd: string; limit: string }) => {
    await runRuns({ cwd: opts.cwd, limit: Number(opts.limit) });
  });

program
  .command('logs <run>')
  .description('Print artifacts from a past run (id prefix or "last")')
  .option('--cwd <path>', 'Working directory to scan', process.cwd())
  .action(async (run: string, opts: { cwd: string }) => {
    await runLogs({ cwd: opts.cwd, runId: run });
  });

program
  .command('uninstall')
  .description('Remove the /squad skill from Claude Code')
  .action(async () => { await runUninstall(); });

program
  .command('export <recipe>')
  .description('Export a built-in recipe to ~/.squad/recipes/ for editing')
  .option('--rename <name>', 'Save under a different name')
  .option('--to <path>', 'Custom destination path')
  .action(async (name: string, opts: { rename?: string; to?: string }) => { await runExport(name, opts); });

program.parseAsync(process.argv).catch(err => {
  console.error('squad:', err.message);
  process.exit(1);
});

function skillCandidate(rel: string): string {
  const candidates = [
    join(HERE, rel),
    join(HERE, '..', 'src', rel),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[1]!;
}
