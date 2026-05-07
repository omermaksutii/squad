import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { writeJsonResult } from '../json-mode.js';

type RunsOpts = { cwd: string; limit: number };

export async function runRuns(opts: RunsOpts): Promise<void> {
  const runsDir = join(opts.cwd, '.squad', 'runs');
  if (!existsSync(runsDir)) {
    if (writeJsonResult({ runs: [] })) return;
    console.log(chalk.dim(`no runs in ${opts.cwd}/.squad/runs/`));
    return;
  }
  const entries = await readdir(runsDir);
  const runs: { id: string; recipe?: string; durationMs?: number; agents?: number; failed?: number; createdAt: number }[] = [];
  for (const id of entries) {
    const dir = join(runsDir, id);
    const summaryPath = join(dir, 'summary.json');
    const taskPath = join(dir, 'task.txt');
    let createdAt = 0;
    try { createdAt = (await stat(dir)).mtimeMs; } catch {}
    let recipe: string | undefined;
    let durationMs: number | undefined;
    let agents: number | undefined;
    let failed: number | undefined;
    if (existsSync(summaryPath)) {
      try {
        const s = JSON.parse(await readFile(summaryPath, 'utf8'));
        recipe = s.recipe;
        durationMs = s.durationMs;
        agents = Array.isArray(s.results) ? s.results.length : undefined;
        failed = Array.isArray(s.failed) ? s.failed.length : undefined;
      } catch {}
    } else if (existsSync(taskPath)) {
      try {
        const t = await readFile(taskPath, 'utf8');
        recipe = t.match(/^recipe:\s*(\S+)/m)?.[1];
      } catch {}
    }
    runs.push({ id, recipe, durationMs, agents, failed, createdAt });
  }
  runs.sort((a, b) => b.createdAt - a.createdAt);
  const limited = runs.slice(0, opts.limit);

  if (writeJsonResult({ runs: limited })) return;

  if (limited.length === 0) {
    console.log(chalk.dim('no runs yet'));
    return;
  }
  console.log(chalk.bold(`Recent runs (showing ${limited.length} of ${runs.length}):`));
  for (const r of limited) {
    const ago = relTime(r.createdAt);
    const recipeStr = r.recipe ? chalk.cyan(r.recipe) : chalk.dim('?');
    const dur = r.durationMs ? chalk.dim(`${(r.durationMs / 1000).toFixed(1)}s`) : '';
    const agents = r.agents != null ? chalk.dim(`${r.agents} agents`) : '';
    const fail = r.failed && r.failed > 0 ? chalk.red(`${r.failed} failed`) : chalk.green('✓');
    console.log(`  ${chalk.dim(r.id.slice(0, 24))}  ${recipeStr}  ${agents}  ${dur}  ${fail}  ${chalk.dim(ago)}`);
  }
}

type LogsOpts = { cwd: string; runId: string };

export async function runLogs(opts: LogsOpts): Promise<void> {
  const runsDir = join(opts.cwd, '.squad', 'runs');
  if (!existsSync(runsDir)) {
    if (writeJsonResult({ error: 'no runs' })) return;
    console.error(chalk.red(`no .squad/runs/ in ${opts.cwd}`));
    process.exitCode = 1;
    return;
  }
  // Match by exact id, prefix, or "last" alias
  let target: string | undefined;
  if (opts.runId === 'last') {
    const all = await readdir(runsDir);
    const sorted = await Promise.all(all.map(async id => ({ id, mtime: (await stat(join(runsDir, id))).mtimeMs })));
    sorted.sort((a, b) => b.mtime - a.mtime);
    target = sorted[0]?.id;
  } else {
    const all = await readdir(runsDir);
    target = all.find(d => d === opts.runId || d.startsWith(opts.runId));
  }
  if (!target) {
    if (writeJsonResult({ error: 'not_found', query: opts.runId })) return;
    console.error(chalk.red(`no run matches "${opts.runId}"`));
    process.exitCode = 1;
    return;
  }
  const dir = join(runsDir, target);
  const summaryPath = join(dir, 'summary.json');
  const artifactsDir = join(dir, 'artifacts');

  if (writeJsonResult({
    id: target,
    summary: existsSync(summaryPath) ? JSON.parse(await readFile(summaryPath, 'utf8')) : null,
    artifact_dir: artifactsDir,
  })) return;

  console.log(chalk.bold('run:'), target);
  if (existsSync(summaryPath)) {
    const s = JSON.parse(await readFile(summaryPath, 'utf8'));
    console.log(chalk.dim('recipe:'), s.recipe);
    console.log(chalk.dim('duration:'), `${(s.durationMs / 1000).toFixed(1)}s`);
    console.log(chalk.dim('agents:'), s.results?.length ?? 0);
    if (s.failed?.length) console.log(chalk.red(`failed: ${s.failed.length}`));
  }
  if (!existsSync(artifactsDir)) return;
  const arts = await readdir(artifactsDir);
  console.log('');
  for (const f of arts) {
    const p = join(artifactsDir, f);
    console.log(chalk.bold.cyan(`── ${f} ──`));
    console.log(await readFile(p, 'utf8'));
    console.log('');
  }
}

function relTime(ts: number): string {
  if (!ts) return '?';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
