import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { jsonMode, writeJsonResult } from '../src/json-mode.js';

describe('json-mode', () => {
  let origEnv: string | undefined;
  let origWrite: typeof process.stdout.write;
  let captured: string;

  beforeEach(() => {
    origEnv = process.env.SQUAD_JSON;
    origWrite = process.stdout.write.bind(process.stdout);
    captured = '';
    process.stdout.write = ((data: string) => { captured += data; return true; }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    if (origEnv === undefined) delete process.env.SQUAD_JSON;
    else process.env.SQUAD_JSON = origEnv;
  });

  it('jsonMode reflects env', () => {
    process.env.SQUAD_JSON = '1';
    expect(jsonMode()).toBe(true);
    process.env.SQUAD_JSON = '0';
    expect(jsonMode()).toBe(false);
    delete process.env.SQUAD_JSON;
    expect(jsonMode()).toBe(false);
  });

  it('writeJsonResult emits JSON and returns true when on', () => {
    process.env.SQUAD_JSON = '1';
    expect(writeJsonResult({ ok: 1 })).toBe(true);
    expect(JSON.parse(captured.trim())).toEqual({ ok: 1 });
  });

  it('writeJsonResult is a no-op when off', () => {
    delete process.env.SQUAD_JSON;
    expect(writeJsonResult({ ok: 1 })).toBe(false);
    expect(captured).toBe('');
  });
});
