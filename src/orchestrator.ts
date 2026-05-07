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
  /** Max concurrent agents per dependency layer. 0/undefined = unlimited. */
  parallel?: number;
  /** Retry an agent up to this many times on non-zero exit. Default 0 (no retry). */
  retry?: number;
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

  const retry = Math.max(0, opts.retry ?? 0);
  const parallel = opts.parallel && opts.parallel > 0 ? opts.parallel : Infinity;

  for (const layer of layers) {
    // Run agents in this layer with bounded concurrency + per-agent retry.
    const settled = await runWithConcurrency(layer, parallel, async spec => {
      opts.onStatusChange?.({ agent: spec.name, status: 'running' });
      let lastErr: unknown;
      let lastResult: RunResult | undefined;
      for (let attempt = 0; attempt <= retry; attempt++) {
        try {
          const r = await runAgent(spec, {
            runDir,
            cwd: opts.cwd,
            vars: { task: opts.task },
            echo: opts.echo,
            onStdoutLine: opts.onStdoutLine,
          });
          lastResult = r;
          if (r.exitCode === 0) return r;
          lastErr = new Error(`exit ${r.exitCode}`);
        } catch (err) {
          lastErr = err;
          if (attempt === retry) throw err;
        }
        if (attempt < retry) {
          opts.onStdoutLine?.(`[${spec.name}] retrying (${attempt + 1}/${retry})…`);
        }
      }
      // All attempts exhausted; return the last failed result if any
      if (lastResult) return lastResult;
      throw lastErr;
    });

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

/** Run `tasks` through `worker` with up to `limit` concurrent in-flight at a time. */
async function runWithConcurrency<T, R>(
  tasks: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(tasks.length);
  let next = 0;
  const active: Promise<void>[] = [];
  const launch = (): Promise<void> => {
    const idx = next++;
    if (idx >= tasks.length) return Promise.resolve();
    return worker(tasks[idx]!)
      .then(value => { results[idx] = { status: 'fulfilled', value }; })
      .catch(reason => { results[idx] = { status: 'rejected', reason }; })
      .then(() => launch());
  };
  for (let i = 0; i < Math.min(limit, tasks.length); i++) active.push(launch());
  await Promise.all(active);
  return results;
}
