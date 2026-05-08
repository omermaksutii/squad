import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Recipe } from './recipe.js';

export type HandoffEvent = {
  from: string;
  to: string[];
  files: { path: string; bytes: number }[];
};

export function buildDependentsMap(recipe: Recipe): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of recipe.agents) {
    for (const dep of a.dependsOn ?? []) {
      const list = out.get(dep) ?? [];
      list.push(a.name);
      out.set(dep, list);
    }
  }
  return out;
}

export async function buildHandoff(
  from: string,
  to: string[],
  artifactPath: string,
): Promise<HandoffEvent | null> {
  if (to.length === 0) return null;
  const files: { path: string; bytes: number }[] = [];
  if (existsSync(artifactPath)) {
    try {
      const s = await stat(artifactPath);
      files.push({ path: artifactPath, bytes: s.size });
    } catch {
      // best-effort — if stat fails we still emit with empty files
    }
  }
  return { from, to, files };
}

export function formatHandoff(e: HandoffEvent): string {
  const targets = e.to.join(', ');
  if (e.files.length === 0) return `${e.from} → ${targets}: (no artifacts)`;
  const f = e.files[0]!;
  const name = f.path.split('/').pop() ?? f.path;
  return `${e.from} → ${targets}: ${name} (${formatBytes(f.bytes)})`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
