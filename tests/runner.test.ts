import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderPrompt, runAgent } from '../src/runner.js';

describe('renderPrompt', () => {
  it('substitutes simple vars', () => {
    expect(renderPrompt('hello {{name}}', { name: 'world' })).toBe('hello world');
  });
  it('handles surrounding whitespace in delimiters', () => {
    expect(renderPrompt('{{ name }}', { name: 'x' })).toBe('x');
  });
  it('leaves unknown placeholders intact', () => {
    expect(renderPrompt('{{a}} {{b}}', { a: '1' })).toBe('1 {{b}}');
  });
  it('substitutes the same key multiple times', () => {
    expect(renderPrompt('{{x}} {{x}}', { x: 'foo' })).toBe('foo foo');
  });
});

describe('runAgent (echo mode)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'squad-run-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a stub artifact and returns success', async () => {
    const result = await runAgent(
      { name: 'a', description: 'd', prompt: 'do {{task}}' },
      { runDir: dir, cwd: dir, vars: { task: 'thing' }, echo: true },
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(result.artifactPath)).toBe(true);
    const content = readFileSync(result.artifactPath, 'utf8');
    expect(content).toContain('do thing');
  });

  it('exposes dependency artifacts to the prompt', async () => {
    await runAgent(
      { name: 'first', description: '', prompt: 'first agent says {{task}}' },
      { runDir: dir, cwd: dir, vars: { task: 'hello' }, echo: true },
    );
    const result = await runAgent(
      {
        name: 'second',
        description: '',
        prompt: 'first said: {{first}}',
        dependsOn: ['first'],
      },
      { runDir: dir, cwd: dir, vars: { task: 'hello' }, echo: true },
    );
    const content = readFileSync(result.artifactPath, 'utf8');
    expect(content).toContain('first said:');
    expect(content).toContain('first agent says hello');
  });
});
