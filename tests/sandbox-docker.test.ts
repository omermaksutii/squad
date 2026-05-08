import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DockerSandbox, DEFAULT_RUNNER_IMAGE } from '../src/sandbox/docker.js';

describe('DockerSandbox (unit, no docker required)', () => {
  let dir: string;
  let savedKey: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'squad-sandbox-'));
    savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it('buildSpawn produces a docker run command with workspace mount + bridge network', () => {
    const sb = new DockerSandbox({ hostCwd: dir, mapUser: false });
    const spec = sb.buildSpawn(['-p', 'hello'], dir);
    expect(spec.command).toBe('docker');
    expect(spec.args).toContain('run');
    expect(spec.args).toContain('--rm');
    expect(spec.args).toContain('-v');
    expect(spec.args).toContain(`${dir}:/work`);
    expect(spec.args).toContain('--network');
    expect(spec.args.indexOf('--network')).toBeGreaterThanOrEqual(0);
    const netIdx = spec.args.indexOf('--network');
    expect(spec.args[netIdx + 1]).toBe('bridge');
    expect(spec.args).toContain(DEFAULT_RUNNER_IMAGE);
    // claude args must be present after the image
    const imgIdx = spec.args.indexOf(DEFAULT_RUNNER_IMAGE);
    expect(spec.args[imgIdx + 1]).toBe('claude');
    expect(spec.args[imgIdx + 2]).toBe('-p');
    expect(spec.args[imgIdx + 3]).toBe('hello');
  });

  it('respects --sandbox-network=none', () => {
    const sb = new DockerSandbox({ hostCwd: dir, mapUser: false, network: 'none' });
    const spec = sb.buildSpawn([], dir);
    const netIdx = spec.args.indexOf('--network');
    expect(spec.args[netIdx + 1]).toBe('none');
  });

  it('respects $SQUAD_RUNNER_IMAGE override', () => {
    process.env.SQUAD_RUNNER_IMAGE = 'localhost/test:dev';
    try {
      const sb = new DockerSandbox({ hostCwd: dir, mapUser: false });
      const spec = sb.buildSpawn([], dir);
      expect(spec.args).toContain('localhost/test:dev');
    } finally {
      delete process.env.SQUAD_RUNNER_IMAGE;
    }
  });

  it('passes ANTHROPIC_API_KEY into the container env when set', () => {
    const sb = new DockerSandbox({ hostCwd: dir, mapUser: false });
    const spec = sb.buildSpawn([], dir);
    // -e ANTHROPIC_API_KEY (no value, value comes from env on spec.env)
    const eIdx = spec.args.indexOf('-e');
    expect(eIdx).toBeGreaterThanOrEqual(0);
    expect(spec.args[eIdx + 1]).toBe('ANTHROPIC_API_KEY');
    expect(spec.env.ANTHROPIC_API_KEY).toBe('sk-test');
  });

  it('does NOT leak arbitrary host env vars into the container env', () => {
    process.env.MY_SECRET = 'shhh';
    try {
      const sb = new DockerSandbox({ hostCwd: dir, mapUser: false });
      const spec = sb.buildSpawn([], dir);
      expect(spec.env.MY_SECRET).toBeUndefined();
    } finally {
      delete process.env.MY_SECRET;
    }
  });

  it('translatePath maps host workspace path to container /work path', () => {
    const sb = new DockerSandbox({ hostCwd: dir, mapUser: false });
    expect(sb.translatePath(join(dir, '.squad', 'runs', '123', 'a.md')))
      .toBe('/work/.squad/runs/123/a.md');
  });

  it('translatePath leaves paths outside workspace alone', () => {
    const sb = new DockerSandbox({ hostCwd: dir, mapUser: false });
    expect(sb.translatePath('/etc/passwd')).toBe('/etc/passwd');
  });

  it('translatePath returns relative paths unchanged', () => {
    const sb = new DockerSandbox({ hostCwd: dir, mapUser: false });
    expect(sb.translatePath('./relative/path.md')).toBe('./relative/path.md');
  });

  it('preflight throws when no auth available', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const sb = new DockerSandbox({ hostCwd: dir, mapUser: false });
    // We can't easily mock docker --version here; the auth check fires first
    // ONLY if docker isn't installed will this fail with "docker is not installed".
    // Either way, preflight should throw.
    await expect(sb.preflight()).rejects.toThrow();
  });
});

const RUN_LIVE = process.env.RUN_DOCKER_TESTS === '1';

describe.skipIf(!RUN_LIVE)('DockerSandbox (live, requires Docker + RUN_DOCKER_TESTS=1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'squad-sandbox-live-'));
    mkdirSync(join(dir, '.squad', 'runs', 'test'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('preflight succeeds when docker + auth are present', async () => {
    const sb = new DockerSandbox({ hostCwd: dir });
    await expect(sb.preflight()).resolves.toBeUndefined();
  });
});
