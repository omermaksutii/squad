import { watch } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadRecipe } from '../recipe.js';
import { orchestrate } from '../orchestrator.js';
import { SquadTUI } from '../tui.js';

type Opts = {
  cwd: string;
  glob?: string;
  debounceMs: number;
  echo: boolean;
};

/**
 * Re-runs a recipe whenever files change in `cwd`. Debounced. Native fs.watch
 * (no deps). Skips changes inside `.squad/`.
 */
export async function runWatch(recipeName: string, task: string, opts: Opts): Promise<void> {
  const recipe = await loadRecipe(recipeName);
  console.log(chalk.bold(`squad watch:${recipe.name}`), chalk.dim(`→ ${recipe.agents.length} agents`));
  console.log(chalk.dim(`  task: ${task}`));
  console.log(chalk.dim(`  watching: ${resolve(opts.cwd)} (excludes .squad/, node_modules/, .git/)`));
  console.log(chalk.dim('  Ctrl-C to stop\n'));

  let running = false;
  let pending = false;
  let timer: NodeJS.Timeout | null = null;

  const trigger = async (reason: string) => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    console.log(chalk.cyan(`\n→ trigger: ${reason}`));
    const tui = new SquadTUI(recipe.agents);
    try {
      const result = await orchestrate({
        recipe,
        task,
        cwd: opts.cwd,
        echo: opts.echo,
        onStdoutLine: line => tui.log(line),
        onStatusChange: e => {
          tui.set(e.agent, {
            status: e.status,
            artifactPath: e.result?.artifactPath,
            durationMs: e.result?.durationMs,
          });
        },
      });
      tui.finalize();
      console.log(chalk.green(`✓ ${result.results.length} agents in ${(result.durationMs / 1000).toFixed(1)}s`));
    } catch (err) {
      console.error(chalk.red('error:'), (err as Error).message);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        setTimeout(() => trigger('queued change'), 50);
      }
    }
  };

  const watcher = watch(opts.cwd, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    const f = String(filename);
    if (f.startsWith('.squad/') || f.includes('node_modules/') || f.startsWith('.git/')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => trigger(f), opts.debounceMs);
  });

  // Initial run
  await trigger('initial');

  process.on('SIGINT', () => {
    watcher.close();
    console.log(chalk.dim('\nstopped'));
    process.exit(0);
  });

  // Keep alive
  await new Promise<void>(() => {});
}
