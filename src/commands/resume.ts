import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadRecipe } from '../recipe.js';
import { orchestrate } from '../orchestrator.js';
import { SquadTUI } from '../tui.js';
import { writeJsonResult } from '../json-mode.js';

type Opts = { cwd: string; echo?: boolean; tui?: boolean };

/**
 * Resume a partial run. Loads the run's recipe + task, then re-runs only
 * agents that didn't succeed (i.e. skipped or failed in the original).
 */
export async function runResume(runRef: string, opts: Opts): Promise<void> {
  const runsDir = join(opts.cwd, '.squad', 'runs');
  if (!existsSync(runsDir)) {
    if (writeJsonResult({ error: 'no runs', cwd: opts.cwd })) return;
    console.error(chalk.red(`no .squad/runs/ in ${opts.cwd}`));
    process.exitCode = 1;
    return;
  }
  const all = await readdir(runsDir);
  let target: string | undefined;
  if (runRef === 'last') {
    const sorted = await Promise.all(all.map(async id => ({ id, mtime: (await stat(join(runsDir, id))).mtimeMs })));
    sorted.sort((a, b) => b.mtime - a.mtime);
    target = sorted[0]?.id;
  } else {
    target = all.find(d => d === runRef || d.startsWith(runRef));
  }
  if (!target) {
    if (writeJsonResult({ error: 'not_found', query: runRef })) return;
    console.error(chalk.red(`no run matches "${runRef}"`));
    process.exitCode = 1;
    return;
  }

  const dir = join(runsDir, target);
  const taskPath = join(dir, 'task.txt');
  const summaryPath = join(dir, 'summary.json');
  if (!existsSync(taskPath)) {
    console.error(chalk.red(`run ${target} has no task.txt — cannot resume`));
    process.exitCode = 1;
    return;
  }
  const taskText = await readFile(taskPath, 'utf8');
  const recipeMatch = taskText.match(/^recipe:\s*(\S+)/m);
  const taskMatch = taskText.match(/^task:\s*(.+)$/m);
  if (!recipeMatch || !taskMatch) {
    console.error(chalk.red(`run ${target} has malformed task.txt`));
    process.exitCode = 1;
    return;
  }
  const recipeName = recipeMatch[1]!;
  const task = taskMatch[1]!;

  // Determine which agents to re-run: those without a successful artifact
  const recipe = await loadRecipe(recipeName);
  const successful = new Set<string>();
  if (existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
      for (const r of summary.results ?? []) {
        if (r.exit_code === 0 || r.exitCode === 0) successful.add(r.agent);
      }
    } catch {}
  }
  const toRun = recipe.agents.filter(a => !successful.has(a.name));
  if (toRun.length === 0) {
    if (writeJsonResult({ message: 'nothing to resume', run: target })) return;
    console.log(chalk.green(`run ${target} is already complete — nothing to resume`));
    return;
  }

  console.log(chalk.bold(`resuming ${target}`), chalk.dim(`→ ${toRun.length} of ${recipe.agents.length} agents`));
  console.log(chalk.dim(`  recipe: ${recipeName}`));
  console.log(chalk.dim(`  task:   ${task}`));
  console.log(chalk.dim(`  skipping: ${[...successful].join(', ') || '(none)'}\n`));

  // Build a synthetic recipe with only the un-finished agents (preserving deps)
  const remainingRecipe = {
    ...recipe,
    agents: toRun,
  };

  const tuiEnabled = (opts.tui ?? true) && process.stdout.isTTY && process.env.SQUAD_JSON !== '1';
  const tui = tuiEnabled ? new SquadTUI(remainingRecipe.agents) : null;
  const result = await orchestrate({
    recipe: remainingRecipe,
    task,
    cwd: opts.cwd,
    runDir: dir, // continue in same run dir
    echo: opts.echo,
    onStdoutLine: line => tui?.log(line),
    onStatusChange: e => {
      tui?.set(e.agent, {
        status: e.status,
        artifactPath: e.result?.artifactPath,
        durationMs: e.result?.durationMs,
      });
    },
  });
  tui?.finalize();

  if (writeJsonResult({ resumed: target, results: result.results, failed: result.failed })) return;
  console.log('');
  if (result.failed.length === 0) {
    console.log(chalk.green(`✓ resumed and completed in ${(result.durationMs / 1000).toFixed(1)}s`));
  } else {
    console.log(chalk.red(`✗ ${result.failed.length} agents still failing`));
  }
}
