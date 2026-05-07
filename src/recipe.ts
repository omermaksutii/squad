import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AgentSpec = {
  name: string;
  description: string;
  /** Agent prompt template. Variables: {{task}}, {{cwd}}, {{artifactDir}}, {{<dependency>}}. */
  prompt: string;
  /** Names of agents that must finish before this one starts. */
  dependsOn?: string[];
  /** Model to use: haiku, sonnet, opus. Default sonnet. */
  model?: 'haiku' | 'sonnet' | 'opus';
  /** Max budget in USD per agent. Default 0.50. */
  maxBudgetUsd?: number;
  /** Restrict allowed tools (passed via --allowedTools). */
  allowedTools?: string[];
  /** Wall-clock timeout in seconds. Default 300. */
  timeoutSec?: number;
};

export type Recipe = {
  name: string;
  description: string;
  /** One-line headline shown in `squad list`. */
  headline: string;
  agents: AgentSpec[];
};

const HERE = dirname(fileURLToPath(import.meta.url));

// Recipes ship as src/recipes/*.json (declared in package.json "files").
// At runtime we may be in dist/ — look in both spots.
function builtinDir(): string {
  const candidates = [
    join(HERE, 'recipes'),                  // dist/recipes (if copied during build)
    join(HERE, '..', 'src', 'recipes'),     // dist/../src/recipes (shipped layout)
    join(HERE, '..', '..', 'src', 'recipes'), // some bundlers add another level
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'feature.json'))) return c;
  }
  return candidates[1]!; // sensible default; loadRecipe will surface the ENOENT
}

const BUILTIN_DIR = builtinDir();

export const BUILTIN_RECIPE_NAMES = [
  'feature',
  'bugfix',
  'refactor',
  'security-review',
  'debug',
  'postmortem',
];

export async function loadRecipe(nameOrPath: string): Promise<Recipe> {
  // Try built-in first
  if (BUILTIN_RECIPE_NAMES.includes(nameOrPath)) {
    const path = join(BUILTIN_DIR, `${nameOrPath}.json`);
    return parseRecipe(await readFile(path, 'utf8'), path);
  }
  // Then try user override at ~/.squad/recipes/<name>.json
  const homeRecipe = join(process.env.HOME ?? '', '.squad', 'recipes', `${nameOrPath}.json`);
  if (existsSync(homeRecipe)) {
    return parseRecipe(await readFile(homeRecipe, 'utf8'), homeRecipe);
  }
  // Then assume it's a literal path
  if (existsSync(nameOrPath)) {
    return parseRecipe(await readFile(nameOrPath, 'utf8'), nameOrPath);
  }
  throw new Error(
    `recipe "${nameOrPath}" not found. Built-ins: ${BUILTIN_RECIPE_NAMES.join(', ')}.\n` +
      `Or pass a path to your own JSON file.`,
  );
}

export function parseRecipe(json: string, source: string): Recipe {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`recipe ${source}: invalid JSON: ${(err as Error).message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`recipe ${source}: must be a JSON object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name) throw new Error(`recipe ${source}: missing "name"`);
  if (typeof r.description !== 'string') throw new Error(`recipe ${source}: missing "description"`);
  if (!Array.isArray(r.agents) || r.agents.length === 0)
    throw new Error(`recipe ${source}: must have at least one agent`);

  const agents: AgentSpec[] = r.agents.map((a, i) => {
    if (!isPlainObject(a)) throw new Error(`recipe ${source}: agent[${i}] must be an object`);
    const o = a as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name)
      throw new Error(`recipe ${source}: agent[${i}] missing "name"`);
    if (typeof o.prompt !== 'string' || !o.prompt)
      throw new Error(`recipe ${source}: agent ${o.name}: missing "prompt"`);
    return {
      name: o.name,
      description: typeof o.description === 'string' ? o.description : '',
      prompt: o.prompt,
      dependsOn: Array.isArray(o.dependsOn) ? (o.dependsOn as string[]) : [],
      model: typeof o.model === 'string' ? (o.model as AgentSpec['model']) : 'sonnet',
      maxBudgetUsd: typeof o.maxBudgetUsd === 'number' ? o.maxBudgetUsd : 0.5,
      allowedTools: Array.isArray(o.allowedTools) ? (o.allowedTools as string[]) : undefined,
      timeoutSec: typeof o.timeoutSec === 'number' ? o.timeoutSec : 300,
    };
  });

  // Validate dependency graph
  const names = new Set(agents.map(a => a.name));
  for (const a of agents) {
    for (const d of a.dependsOn ?? []) {
      if (!names.has(d)) throw new Error(`recipe ${source}: agent ${a.name} depends on unknown "${d}"`);
    }
  }

  return {
    name: r.name,
    description: r.description,
    headline: typeof r.headline === 'string' ? r.headline : r.description,
    agents,
  };
}

/** Topological sort. Throws on cycles. Returns a flat list in run order. */
export function planExecution(recipe: Recipe): AgentSpec[][] {
  const remaining = new Set(recipe.agents.map(a => a.name));
  const done = new Set<string>();
  const byName = new Map(recipe.agents.map(a => [a.name, a]));
  const layers: AgentSpec[][] = [];

  while (remaining.size > 0) {
    const ready: AgentSpec[] = [];
    for (const name of remaining) {
      const a = byName.get(name)!;
      const deps = a.dependsOn ?? [];
      if (deps.every(d => done.has(d))) ready.push(a);
    }
    if (ready.length === 0) {
      throw new Error(`recipe ${recipe.name}: cycle detected — ${[...remaining].join(', ')}`);
    }
    for (const a of ready) {
      remaining.delete(a.name);
      done.add(a.name);
    }
    layers.push(ready);
  }
  return layers;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
