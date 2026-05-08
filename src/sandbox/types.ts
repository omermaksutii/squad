export type SpawnSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export interface SandboxAdapter {
  /** Adapter identity, surfaced to TUI + JSON output. */
  readonly name: 'docker' | 'e2b';

  /** Verify backend is usable (binary present, daemon reachable, image pullable…). Throws on failure. */
  preflight(): Promise<void>;

  /** Wrap a host-side `claude` invocation into the sandbox-equivalent spawn. */
  buildSpawn(claudeArgs: string[], hostCwd: string): SpawnSpec;

  /** Translate a host-absolute path into the path visible inside the sandbox.
   * Used when the prompt embeds artifact paths the in-sandbox claude must read/write. */
  translatePath(hostPath: string): string;
}

export type SandboxNetwork = 'bridge' | 'none';
