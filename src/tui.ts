import chalk from 'chalk';
import { stdout } from 'node:process';
import type { AgentStatus } from './orchestrator.js';
import { formatHandoff, type HandoffEvent } from './handoff.js';

export type AgentRow = {
  name: string;
  description: string;
  status: AgentStatus;
  startedAt?: number;
  endedAt?: number;
  artifactPath?: string;
  durationMs?: number;
};

const TWO_PANE_MIN_COLS = 100;

export class SquadTUI {
  private rows = new Map<string, AgentRow>();
  private firstRender = true;
  private lastTotalLines = 0;
  private logLines: string[] = [];
  private handoffLines: string[] = [];
  private maxLogLines = 6;
  private maxHandoffLines = 10;

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

  handoff(ev: HandoffEvent): void {
    this.handoffLines.push(formatHandoff(ev));
    while (this.handoffLines.length > this.maxHandoffLines) this.handoffLines.shift();
    this.render();
  }

  render(): void {
    if (!stdout.isTTY) return;
    if (!this.firstRender && this.lastTotalLines > 0) {
      stdout.write(`\x1b[${this.lastTotalLines}A`);
    } else {
      this.firstRender = false;
    }

    const cols = stdout.columns ?? 80;
    const lines = cols >= TWO_PANE_MIN_COLS ? this.renderTwoPane(cols) : this.renderSinglePane();
    for (const ln of lines) stdout.write(`\x1b[2K${ln}\n`);
    this.lastTotalLines = lines.length;
  }

  finalize(): void {
    if (!stdout.isTTY) {
      stdout.write('\nfinal status:\n');
      for (const r of this.rows.values()) stdout.write(`  ${this.row(r)}\n`);
      if (this.handoffLines.length > 0) {
        stdout.write('\nhandoffs:\n');
        for (const h of this.handoffLines) stdout.write(`  ${h}\n`);
      }
    }
  }

  private renderSinglePane(): string[] {
    const out: string[] = [];
    out.push(chalk.bold.cyan('🟢 squad'));
    out.push(chalk.dim('  agent          status      duration   artifact'));
    out.push(chalk.dim('  ─────          ──────      ────────   ────────'));
    for (const r of this.rows.values()) out.push(`  ${this.row(r)}`);
    if (this.handoffLines.length > 0) {
      out.push(chalk.dim('  handoffs:'));
      for (let i = 0; i < this.maxHandoffLines; i++) {
        const line = this.handoffLines[i] ?? '';
        out.push(`    ${chalk.dim(truncate(line, 110))}`);
      }
    }
    out.push(chalk.dim('  recent activity:'));
    for (let i = 0; i < this.maxLogLines; i++) {
      const line = this.logLines[i] ?? '';
      out.push(`    ${chalk.dim(truncate(line, 110))}`);
    }
    return out;
  }

  private renderTwoPane(cols: number): string[] {
    const gap = 2;
    const leftWidth = Math.min(56, Math.floor((cols - gap) * 0.55));
    const rightWidth = cols - leftWidth - gap - 2;

    const left: string[] = [];
    left.push(chalk.dim(`  agent          status      duration`));
    left.push(chalk.dim(`  ─────          ──────      ────────`));
    for (const r of this.rows.values()) left.push(`  ${this.rowCompact(r)}`);

    const right: string[] = [];
    right.push(chalk.dim(`  handoffs`));
    right.push(chalk.dim(`  ────────`));
    if (this.handoffLines.length === 0) {
      right.push(chalk.dim(`  (none yet)`));
    } else {
      for (const line of this.handoffLines) right.push(`  ${chalk.dim(truncate(line, rightWidth - 2))}`);
    }

    const out: string[] = [];
    out.push(chalk.bold.cyan('🟢 squad'));
    const rows = Math.max(left.length, right.length);
    for (let i = 0; i < rows; i++) {
      const l = padVisible(left[i] ?? '', leftWidth);
      const r = right[i] ?? '';
      out.push(`${l}${' '.repeat(gap)}${r}`);
    }
    out.push(chalk.dim('  recent activity:'));
    for (let i = 0; i < this.maxLogLines; i++) {
      const line = this.logLines[i] ?? '';
      out.push(`    ${chalk.dim(truncate(line, cols - 6))}`);
    }
    return out;
  }

  private row(r: AgentRow): string {
    const name = pad(r.name, 14);
    const status = pad(this.statusLabel(r.status), 11);
    const dur = pad(this.duration(r), 10);
    const artifact = r.artifactPath ? chalk.dim(r.artifactPath) : '';
    return `${chalk.cyan(name)} ${status} ${chalk.dim(dur)} ${artifact}`;
  }

  private rowCompact(r: AgentRow): string {
    const name = pad(r.name, 14);
    const status = pad(this.statusLabel(r.status), 11);
    const dur = pad(this.duration(r), 10);
    return `${chalk.cyan(name)} ${status} ${chalk.dim(dur)}`;
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

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLength(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

function padVisible(s: string, n: number): string {
  const v = visibleLength(s);
  if (v >= n) return s;
  return s + ' '.repeat(n - v);
}
