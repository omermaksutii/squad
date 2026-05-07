import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadRecipe } from '../recipe.js';
import { orchestrate } from '../orchestrator.js';
import { SquadTUI } from '../tui.js';

/**
 * Self-contained demo: spins up a tiny fake project in a temp dir, runs the
 * `feature` recipe in --echo mode, prints the artifacts. No claude tokens spent.
 */
export async function runDemo(): Promise<void> {
  console.log(chalk.bold.cyan('🟢 squad demo'));
  console.log(chalk.dim('runs the `feature` recipe in echo mode (no claude calls)\n'));

  const dir = mkdtempSync(join(tmpdir(), 'squad-demo-'));
  // Sketch a tiny fake project so agents have something to "research"
  writeFileSync(join(dir, 'README.md'), '# Imaginary App\n\nA fake project for the squad demo.\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'imaginary-app', version: '0.0.0' }, null, 2));

  const recipe = await loadRecipe('feature');
  const tui = new SquadTUI(recipe.agents);
  console.log(chalk.bold(`squad:${recipe.name}`), chalk.dim(`→ ${recipe.agents.length} agents`));
  console.log(chalk.dim(`  task: add OAuth2 login (demo)`));
  console.log('');

  const result = await orchestrate({
    recipe,
    task: 'add OAuth2 login (demo task — echo mode, no real LLM calls)',
    cwd: dir,
    runDir: join(dir, '.squad', 'run'),
    echo: true,
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

  console.log('');
  console.log(chalk.bold(`done in ${(result.durationMs / 1000).toFixed(2)}s`));
  console.log(chalk.green(`✓ ${result.results.length} agents wrote artifacts to ${result.runDir}/artifacts/`));
  console.log('');
  console.log(chalk.dim('next: `squad run feature "your task here"` (with real claude this time)'));
}
