import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, relative } from 'node:path';
import type { SandboxAdapter, SpawnSpec, SandboxNetwork } from './types.js';

export const DEFAULT_RUNNER_IMAGE = 'ghcr.io/omermaksutii/squad-runner:2';
const CONTAINER_WORKSPACE = '/work';

export type DockerSandboxOptions = {
  /** Host workspace directory mounted at /work inside the container. */
  hostCwd: string;
  /** Image tag. Override via $SQUAD_RUNNER_IMAGE for testing. */
  image?: string;
  /** `bridge` (default, claude API reachable) or `none` (air-gapped). */
  network?: SandboxNetwork;
  /** Memory cap. Default 2g. */
  memory?: string;
  /** CPU cap. Default 2. */
  cpus?: string;
  /** When false, skip uid mapping (used by tests). */
  mapUser?: boolean;
};

export class DockerSandbox implements SandboxAdapter {
  readonly name = 'docker' as const;
  private readonly hostCwd: string;
  private readonly image: string;
  private readonly network: SandboxNetwork;
  private readonly memory: string;
  private readonly cpus: string;
  private readonly mapUser: boolean;

  constructor(opts: DockerSandboxOptions) {
    this.hostCwd = opts.hostCwd;
    this.image = opts.image ?? process.env.SQUAD_RUNNER_IMAGE ?? DEFAULT_RUNNER_IMAGE;
    this.network = opts.network ?? 'bridge';
    this.memory = opts.memory ?? '2g';
    this.cpus = opts.cpus ?? '2';
    this.mapUser = opts.mapUser ?? true;
  }

  async preflight(): Promise<void> {
    const v = spawnSync('docker', ['--version'], { encoding: 'utf8' });
    if ((v.status ?? 1) !== 0) {
      throw new Error('docker is not installed (or not on PATH). Install Docker, or run without --sandbox.');
    }
    const info = spawnSync('docker', ['info'], { encoding: 'utf8' });
    if ((info.status ?? 1) !== 0) {
      throw new Error('docker daemon is not reachable. Start Docker, or run without --sandbox.');
    }
    if (!process.env.ANTHROPIC_API_KEY && !this.hasMountableCredentials()) {
      throw new Error(
        'sandbox needs auth: set $ANTHROPIC_API_KEY, or run `claude login` so ~/.claude can be mounted into the container.',
      );
    }
  }

  buildSpawn(claudeArgs: string[], _hostCwd: string): SpawnSpec {
    const args: string[] = ['run', '--rm', '-i'];
    args.push('-v', `${this.hostCwd}:${CONTAINER_WORKSPACE}`);
    args.push('-w', CONTAINER_WORKSPACE);
    args.push('--network', this.network);
    args.push('--memory', this.memory);
    args.push('--cpus', this.cpus);

    if (process.env.ANTHROPIC_API_KEY) {
      args.push('-e', 'ANTHROPIC_API_KEY');
    } else if (this.hasMountableCredentials()) {
      // Mount user's claude credentials read-only as a fallback for subscription-auth users.
      args.push('-v', `${join(homedir(), '.claude')}:/root/.claude:ro`);
    }

    if (this.mapUser && process.platform === 'linux') {
      const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
      const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
      args.push('--user', `${uid}:${gid}`);
    }

    args.push(this.image);
    args.push('claude', ...claudeArgs);

    // Pass through ANTHROPIC_API_KEY without leaking the rest of the host env.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
    };
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    return { command: 'docker', args, env };
  }

  translatePath(hostPath: string): string {
    if (!isAbsolute(hostPath)) return hostPath;
    const rel = relative(this.hostCwd, hostPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      // Path is outside the mounted workspace — leave as-is and let the caller error.
      return hostPath;
    }
    return join(CONTAINER_WORKSPACE, rel);
  }

  private hasMountableCredentials(): boolean {
    return existsSync(join(homedir(), '.claude', 'credentials.json'));
  }
}
