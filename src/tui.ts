import chalk from 'chalk';
import { stdout } from 'node:process';
import type { AgentStatus } from './orchestrator.js';

export type AgentRow = {
  name: string;
  description: string;
  status: AgentStatus;
  startedAt?: number;
  endedAt?: number;
  artifactPath?: string;
  durationMs?: number;
};

export class SquadTUI {
  private rows = new Map<string, AgentRow>();
  private firstRender = true;
  private logLines: string[] = [];
  private maxLogLines = 6;

  constructor(agents: { name: string; description: string }[]) {
    for (const a of agents) {
      this.rows.set(a.name, { ...a, status: 'pending' });
    }
  }

  set(name: string, patch: Partial<AgentRow>): void {
    const cur = this.rows.get(name);
    if (!cur) return;
    Object.assign(cur, patch);
    this.render();
  }

  log(line: string): void {
    this.logLines.push(line);
    while (this.logLines.length > this.maxLogLines) this.logLines.shift();
    this.render();
  }

  render(): void {
    if (!stdout.isTTY) {
      // Non-TTY: print state changes line-by-line and bail.
      // (Actual lines are written via log() and other paths.)
      return;
    }
    const totalLines = this.rows.size + 3 + this.logLines.length + 2;
    if (!this.firstRender) {
      stdout.write(`\x1b[${totalLines}A`);
    } else {
      this.firstRender = false;
    }
    stdout.write(chalk.bold.cyan('🟢 squad') + '\n');
    stdout.write(chalk.dim('  agent          status      duration   artifact\n'));
    stdout.write(chalk.dim('  ─────          ──────      ────────   ────────\n'));
    for (const r of this.rows.values()) {
      stdout.write(`\x1b[2K  ${this.row(r)}\n`);
    }
    stdout.write(chalk.dim('  recent activity:\n'));
    for (let i = 0; i < this.maxLogLines; i++) {
      const line = this.logLines[i] ?? '';
      stdout.write(`\x1b[2K    ${chalk.dim(truncate(line, 110))}\n`);
    }
  }

  finalize(): void {
    if (!stdout.isTTY) {
      // For non-TTY, print a final snapshot.
      stdout.write('\nfinal status:\n');
      for (const r of this.rows.values()) stdout.write(`  ${this.row(r)}\n`);
    }
  }

  private row(r: AgentRow): string {
    const name = pad(r.name, 14);
    const status = pad(this.statusLabel(r.status), 11);
    const dur = pad(this.duration(r), 10);
    const artifact = r.artifactPath ? chalk.dim(r.artifactPath) : '';
    return `${chalk.cyan(name)} ${status} ${chalk.dim(dur)} ${artifact}`;
  }

  private statusLabel(s: AgentStatus): string {
    switch (s) {
      case 'pending': return chalk.dim('pending');
      case 'running': return chalk.yellow('running…');
      case 'done':    return chalk.green('✓ done');
      case 'failed':  return chalk.red('✗ failed');
      case 'skipped': return chalk.dim('skipped');
    }
  }

  private duration(r: AgentRow): string {
    if (r.durationMs == null) return '';
    return `${(r.durationMs / 1000).toFixed(1)}s`;
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
