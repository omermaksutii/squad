import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

export type AgentSpec = {
  name: string;
  description: string;
  prompt: string;
  dependsOn?: string[];
  model?: 'haiku' | 'sonnet' | 'opus';
  maxBudgetUsd?: number;
  allowedTools?: string[];
  timeoutSec?: number;
};

export type Recipe = {
  name: string;
  description: string;
  headline: string;
  agents: AgentSpec[];
};

const HERE = dirname(fileURLToPath(import.meta.url));

function builtinDir(): string {
  const candidates = [
    join(HERE, 'recipes'),
    join(HERE, '..', 'src', 'recipes'),
    join(HERE, '..', '..', 'src', 'recipes'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'feature.json'))) return c;
  }
  return candidates[1]!;
}

const BUILTIN_DIR = builtinDir();

export const BUILTIN_RECIPE_NAMES = [
  'feature',
  'bugfix',
  'refactor',
  'security-review',
  'debug',
  'postmortem',
  'release',
  'onboard',
];

export async function loadRecipe(nameOrPath: string, _seen: Set<string> = new Set()): Promise<Recipe> {
  // URL fetch
  if (/^https?:\/\//.test(nameOrPath)) {
    const json = await fetchUrl(nameOrPath);
    return await resolveExtends(parseRecipe(json, nameOrPath), _seen);
  }
  if (BUILTIN_RECIPE_NAMES.includes(nameOrPath)) {
    const path = join(BUILTIN_DIR, `${nameOrPath}.json`);
    return await resolveExtends(parseRecipe(await readFile(path, 'utf8'), path), _seen);
  }
  const homeRecipe = join(process.env.HOME ?? '', '.squad', 'recipes', `${nameOrPath}.json`);
  if (existsSync(homeRecipe)) {
    return await resolveExtends(parseRecipe(await readFile(homeRecipe, 'utf8'), homeRecipe), _seen);
  }
  if (existsSync(nameOrPath)) {
    return await resolveExtends(parseRecipe(await readFile(nameOrPath, 'utf8'), nameOrPath), _seen);
  }
  throw new Error(
    `recipe "${nameOrPath}" not found. Built-ins: ${BUILTIN_RECIPE_NAMES.join(', ')}.\n` +
      `Or pass a path/URL to your own JSON file.`,
  );
}

async function fetchUrl(url: string): Promise<string> {
  const get = url.startsWith('https') ? httpsGet : httpGet;
  return await new Promise<string>((resolve, reject) => {
    get(url, res => {
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`fetch ${url}: HTTP ${res.statusCode}`));
        return;
      }
      let buf = '';
      res.on('data', chunk => { buf += chunk.toString(); });
      res.on('end', () => resolve(buf));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function resolveExtends(recipe: Recipe & { extends?: string }, seen: Set<string>): Promise<Recipe> {
  if (!recipe.extends) return recipe;
  if (seen.has(recipe.name)) {
    throw new Error(`recipe inheritance cycle through ${recipe.name}`);
  }
  seen.add(recipe.name);
  const parent = await loadRecipe(recipe.extends, seen);
  const overrideMap = new Map(recipe.agents.map(a => [a.name, a]));
  const mergedAgents: AgentSpec[] = parent.agents.map(p => overrideMap.get(p.name) ?? p);
  for (const a of recipe.agents) {
    if (!parent.agents.find(p => p.name === a.name)) mergedAgents.push(a);
  }
  return {
    name: recipe.name,
    description: recipe.description || parent.description,
    headline: recipe.headline || parent.headline,
    agents: mergedAgents,
  };
}

export function parseRecipe(json: string, source: string): Recipe & { extends?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`recipe ${source}: invalid JSON: ${(err as Error).message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`recipe ${source}: must be a JSON object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name) throw new Error(`recipe ${source}: missing "name"`);
  const isExtending = typeof r.extends === 'string' && r.extends;
  if (!isExtending && typeof r.description !== 'string') {
    throw new Error(`recipe ${source}: missing "description"`);
  }
  if (!Array.isArray(r.agents)) r.agents = [];
  if (!isExtending && (r.agents as unknown[]).length === 0) {
    throw new Error(`recipe ${source}: must have at least one agent`);
  }

  const agents: AgentSpec[] = (r.agents as unknown[]).map((a, i) => {
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

  // Only validate dep graph in non-extending recipes (extending recipes may
  // omit deps that are inherited from the parent)
  if (!isExtending) {
    const names = new Set(agents.map(a => a.name));
    for (const a of agents) {
      for (const d of a.dependsOn ?? []) {
        if (!names.has(d)) throw new Error(`recipe ${source}: agent ${a.name} depends on unknown "${d}"`);
      }
    }
  }

  const out: Recipe & { extends?: string } = {
    name: r.name,
    description: typeof r.description === 'string' ? r.description : '',
    headline: typeof r.headline === 'string' ? r.headline : (typeof r.description === 'string' ? r.description : ''),
    agents,
  };
  if (typeof r.extends === 'string') out.extends = r.extends;
  return out;
}

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
