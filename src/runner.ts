import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir, appendFile } from 'node:fs/promises';
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
  tokens?: { input: number; output: number };
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
  /** Streaming callback for live text deltas (token-level when stream-json is active). */
  onTextDelta?: (agent: string, delta: string) => void;
  /** Force "echo" mode for tests — does not spawn claude, just writes a stub artifact. */
  echo?: boolean;
};

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(TEMPLATE_RE, (_m, key) => {
    if (key in vars) return vars[key]!;
    return `{{${key}}}`;
  });
}

/**
 * Parse a single stream-json event line. Returns metadata extracted from it.
 * Claude Code's stream-json format emits one JSON object per line with `type` field.
 */
type StreamEvent =
  | { type: 'system'; subtype?: string }
  | { type: 'assistant'; message?: { content?: Array<{ type: string; text?: string }> } }
  | { type: 'user'; message?: { content?: Array<{ type: string; text?: string }> } }
  | { type: 'result'; subtype?: string; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number }; result?: string; duration_ms?: number; is_error?: boolean }
  | { type: string };

function parseEventLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
}

/** Extract text content from an assistant event. */
function extractAssistantText(ev: StreamEvent): string {
  if (ev.type !== 'assistant') return '';
  const msg = (ev as { message?: { content?: Array<{ type: string; text?: string }> } }).message;
  const parts = msg?.content ?? [];
  let out = '';
  for (const p of parts) {
    if (p.type === 'text' && typeof p.text === 'string') out += p.text;
  }
  return out;
}

export async function runAgent(spec: AgentSpec, opts: RunOptions): Promise<RunResult> {
  const start = Date.now();
  const artifactPath = join(opts.runDir, 'artifacts', `${spec.name}.md`);
  await mkdir(join(opts.runDir, 'artifacts'), { recursive: true });

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
    const out = `# ${spec.name} (echo)\n\nrendered prompt:\n\n${prompt}\n`;
    await writeFile(artifactPath, out);
    opts.onStdoutLine?.(`[${spec.name}] (echo) wrote ${artifactPath}`);
    return { agent: spec.name, exitCode: 0, stdout: out, stderr: '', artifactPath, durationMs: Date.now() - start };
  }

  const args: string[] = [
    '-p',
    prompt,
    '--model',
    spec.model ?? 'sonnet',
    '--max-budget-usd',
    String(spec.maxBudgetUsd ?? 0.5),
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
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
    let costUsd: number | undefined;
    let tokens: { input: number; output: number } | undefined;
    let lineBuf = '';
    let lastDeltaSent = '';

    if (spec.timeoutSec) {
      timeoutHandle = setTimeout(() => child.kill('SIGTERM'), spec.timeoutSec * 1000);
    }

    const handleEvent = (ev: StreamEvent | null) => {
      if (!ev) return;
      if (ev.type === 'assistant') {
        const text = extractAssistantText(ev);
        if (text && text !== lastDeltaSent) {
          // Stream-json may emit cumulative or delta — handle both by comparing
          const delta = text.startsWith(lastDeltaSent) ? text.slice(lastDeltaSent.length) : text;
          if (delta) {
            lastDeltaSent = text;
            opts.onTextDelta?.(spec.name, delta);
            // Per-line forwarding to onStdoutLine for the TUI
            const lines = delta.split('\n');
            for (const l of lines) {
              if (l) opts.onStdoutLine?.(`[${spec.name}] ${l}`);
            }
          }
        }
      } else if (ev.type === 'result') {
        const r = ev as { total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } };
        if (typeof r.total_cost_usd === 'number') costUsd = r.total_cost_usd;
        if (r.usage) {
          tokens = {
            input: r.usage.input_tokens ?? 0,
            output: r.usage.output_tokens ?? 0,
          };
        }
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      lineBuf += s;
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() ?? '';
      for (const ln of lines) handleEvent(parseEventLine(ln));
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', err => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });

    child.on('close', async code => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (lineBuf.trim()) handleEvent(parseEventLine(lineBuf));
      if (!existsSync(artifactPath)) {
        await writeFile(artifactPath, lastDeltaSent || stdout || '(no output)');
      }
      resolve({
        agent: spec.name,
        exitCode: code ?? -1,
        stdout,
        stderr,
        artifactPath,
        durationMs: Date.now() - start,
        costUsd,
        tokens,
      });
    });
  });
}

export async function appendAuditLog(runDir: string, entry: Record<string, unknown>): Promise<void> {
  const file = join(runDir, '..', '..', 'audit.log');
  try { await mkdir(join(runDir, '..', '..'), { recursive: true }); } catch {}
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await appendFile(file, line, 'utf8');
}
