import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSpec } from './recipe.js';

export type RunResult = {
  agent: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  artifactPath: string;
  durationMs: number;
  costUsd?: number;
};

export type RunOptions = {
  /** Per-run dir (e.g. .squad/runs/<timestamp>) holding all artifacts. */
  runDir: string;
  /** Working directory the agent runs in. */
  cwd: string;
  /** Variables exposed in the prompt template. */
  vars: Record<string, string>;
  /** Path to a "claude" binary; defaults to the one on PATH. */
  claudeBin?: string;
  /** Stream stdout to this writable (used by the TUI). */
  onStdoutLine?: (line: string) => void;
  /** Force "echo" mode for tests — does not spawn claude, just writes a stub artifact. */
  echo?: boolean;
};

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(TEMPLATE_RE, (_m, key) => {
    if (key in vars) return vars[key]!;
    return `{{${key}}}`; // leave unknown placeholders as-is
  });
}

export async function runAgent(spec: AgentSpec, opts: RunOptions): Promise<RunResult> {
  const start = Date.now();
  const artifactPath = join(opts.runDir, 'artifacts', `${spec.name}.md`);
  await mkdir(join(opts.runDir, 'artifacts'), { recursive: true });

  // Resolve dependency artifacts so they can be referenced in the prompt
  const expandedVars: Record<string, string> = { ...opts.vars };
  for (const dep of spec.dependsOn ?? []) {
    const depFile = join(opts.runDir, 'artifacts', `${dep}.md`);
    if (existsSync(depFile)) {
      const content = await readFile(depFile, 'utf8');
      expandedVars[dep] = content;
      expandedVars[`${dep}_path`] = depFile;
    }
  }
  expandedVars.artifactDir = join(opts.runDir, 'artifacts');
  expandedVars.cwd = opts.cwd;
  expandedVars.agent = spec.name;
  expandedVars.outputPath = artifactPath;

  const prompt = renderPrompt(spec.prompt, expandedVars);

  if (opts.echo) {
    // Stub for tests: write a deterministic artifact and return immediately.
    const out = `# ${spec.name} (echo)\n\nrendered prompt:\n\n${prompt}\n`;
    await writeFile(artifactPath, out);
    opts.onStdoutLine?.(`[${spec.name}] (echo) wrote ${artifactPath}`);
    return {
      agent: spec.name,
      exitCode: 0,
      stdout: out,
      stderr: '',
      artifactPath,
      durationMs: Date.now() - start,
    };
  }

  const args: string[] = [
    '-p',
    prompt,
    '--model',
    spec.model ?? 'sonnet',
    '--max-budget-usd',
    String(spec.maxBudgetUsd ?? 0.5),
    '--output-format',
    'text',
  ];
  if (spec.allowedTools && spec.allowedTools.length > 0) {
    args.push('--allowedTools', spec.allowedTools.join(','));
  }
  args.push(
    '--append-system-prompt',
    `You are the "${spec.name}" agent in a Squad pipeline. Your role: ${spec.description}\n\nWrite your final output to: ${artifactPath}\nBe concise. Do not narrate. Just do the work and write the artifact.`,
  );

  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(opts.claudeBin ?? 'claude', args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timeoutHandle: NodeJS.Timeout | null = null;
    if (spec.timeoutSec) {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
      }, spec.timeoutSec * 1000);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      for (const line of s.split('\n')) {
        if (line) opts.onStdoutLine?.(`[${spec.name}] ${line}`);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', err => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });

    child.on('close', async code => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      // Persist stdout as the artifact if the agent didn't write its own file
      if (!existsSync(artifactPath)) {
        await writeFile(artifactPath, stdout || '(no output)');
      }
      resolve({
        agent: spec.name,
        exitCode: code ?? -1,
        stdout,
        stderr,
        artifactPath,
        durationMs: Date.now() - start,
      });
    });
  });
}
