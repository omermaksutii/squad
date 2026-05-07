import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Recipe, planExecution } from './recipe.js';
import { runAgent, type RunOptions, type RunResult } from './runner.js';

export type OrchestrateOptions = {
  recipe: Recipe;
  task: string;
  cwd: string;
  /** Where to write run artifacts. Default `<cwd>/.squad/runs/<timestamp>`. */
  runDir?: string;
  /** Echo mode: do not spawn claude, just write deterministic stubs. */
  echo?: boolean;
  /** Streaming line callback (pass to TUI). */
  onStdoutLine?: (line: string) => void;
  /** Status callback fired when an agent transitions state. */
  onStatusChange?: (event: StatusEvent) => void;
};

export type AgentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type StatusEvent = {
  agent: string;
  status: AgentStatus;
  result?: RunResult;
  error?: Error;
};

export type OrchestrationResult = {
  recipe: string;
  runDir: string;
  durationMs: number;
  results: RunResult[];
  failed: { agent: string; error: string }[];
};

export async function orchestrate(opts: OrchestrateOptions): Promise<OrchestrationResult> {
  const start = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = opts.runDir ?? join(opts.cwd, '.squad', 'runs', stamp);
  await mkdir(join(runDir, 'artifacts'), { recursive: true });
  await writeFile(
    join(runDir, 'task.txt'),
    `recipe: ${opts.recipe.name}\ncwd: ${opts.cwd}\ntask: ${opts.task}\n`,
  );

  const layers = planExecution(opts.recipe);
  const results: RunResult[] = [];
  const failed: { agent: string; error: string }[] = [];

  for (const a of opts.recipe.agents) {
    opts.onStatusChange?.({ agent: a.name, status: 'pending' });
  }

  for (const layer of layers) {
    // Run all agents in this dependency layer in parallel.
    const settled = await Promise.allSettled(
      layer.map(spec => {
        opts.onStatusChange?.({ agent: spec.name, status: 'running' });
        const runOpts: RunOptions = {
          runDir,
          cwd: opts.cwd,
          vars: { task: opts.task },
          echo: opts.echo,
          onStdoutLine: opts.onStdoutLine,
        };
        return runAgent(spec, runOpts);
      }),
    );

    for (let i = 0; i < settled.length; i++) {
      const spec = layer[i]!;
      const s = settled[i]!;
      if (s.status === 'fulfilled') {
        const r = s.value;
        results.push(r);
        if (r.exitCode === 0) {
          opts.onStatusChange?.({ agent: spec.name, status: 'done', result: r });
        } else {
          failed.push({ agent: spec.name, error: `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}` });
          opts.onStatusChange?.({ agent: spec.name, status: 'failed', result: r });
        }
      } else {
        failed.push({ agent: spec.name, error: (s.reason as Error).message });
        opts.onStatusChange?.({
          agent: spec.name,
          status: 'failed',
          error: s.reason as Error,
        });
      }
    }

    // If any agent in this layer failed, mark downstream agents as skipped.
    if (failed.length > 0) {
      for (const remainingLayer of layers.slice(layers.indexOf(layer) + 1)) {
        for (const spec of remainingLayer) {
          opts.onStatusChange?.({ agent: spec.name, status: 'skipped' });
        }
      }
      break;
    }
  }

  const summary: OrchestrationResult = {
    recipe: opts.recipe.name,
    runDir,
    durationMs: Date.now() - start,
    results,
    failed,
  };
  await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}
