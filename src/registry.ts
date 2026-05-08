import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { parseRecipe, BUILTIN_RECIPE_NAMES } from './recipe.js';

function squadHome(): string {
  return join(process.env.HOME || homedir(), '.squad');
}

export const DEFAULT_INDEX_URL =
  'https://raw.githubusercontent.com/omermaksutii/squad-recipes/main/index.json';

export type RegistryEntry = {
  name: string;
  description: string;
  author: string;
  url: string;
  tags?: string[];
  version?: string;
};

export type RegistryIndex = {
  version: 1;
  recipes: RegistryEntry[];
};

export type CacheRecord = {
  etag: string | null;
  lastFetched: number;
  index: RegistryIndex;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function indexUrl(): string {
  return process.env.SQUAD_REGISTRY_INDEX || DEFAULT_INDEX_URL;
}

export function cachePath(): string {
  return join(squadHome(), '.registry-cache.json');
}

export function userRecipesDir(): string {
  return join(squadHome(), 'recipes');
}

type FetchResult = { status: number; body: string; etag: string | null };

async function httpFetch(url: string, headers: Record<string, string> = {}): Promise<FetchResult> {
  const u = new URL(url);
  const req = u.protocol === 'http:' ? httpRequest : httpsRequest;
  return await new Promise<FetchResult>((resolve, reject) => {
    const r = req(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers,
      },
      res => {
        let buf = '';
        res.on('data', c => { buf += c.toString(); });
        res.on('end', () => {
          const etagHeader = res.headers.etag;
          const etag = typeof etagHeader === 'string' ? etagHeader : null;
          resolve({ status: res.statusCode ?? 0, body: buf, etag });
        });
        res.on('error', reject);
      },
    );
    r.on('error', reject);
    r.end();
  });
}

async function readCache(): Promise<CacheRecord | null> {
  const p = cachePath();
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw) as CacheRecord;
  } catch {
    return null;
  }
}

async function writeCache(rec: CacheRecord): Promise<void> {
  const p = cachePath();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(rec, null, 2));
}

function parseIndex(body: string, source: string): RegistryIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (err) {
    throw new Error(`registry ${source}: invalid JSON: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error(`registry ${source}: must be an object`);
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new Error(`registry ${source}: unsupported version ${String(r.version)} (expected 1)`);
  if (!Array.isArray(r.recipes)) throw new Error(`registry ${source}: missing recipes[]`);
  const recipes: RegistryEntry[] = r.recipes.map((e, i) => {
    if (!e || typeof e !== 'object') throw new Error(`registry ${source}: recipes[${i}] not an object`);
    const o = e as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name) throw new Error(`registry ${source}: recipes[${i}].name missing`);
    if (typeof o.url !== 'string' || !o.url) throw new Error(`registry ${source}: recipes[${i}].url missing`);
    return {
      name: o.name,
      description: typeof o.description === 'string' ? o.description : '',
      author: typeof o.author === 'string' ? o.author : '',
      url: o.url,
      tags: Array.isArray(o.tags) ? (o.tags as string[]) : [],
      version: typeof o.version === 'string' ? o.version : undefined,
    };
  });
  return { version: 1, recipes };
}

export type FetchIndexOptions = {
  /** Force a fresh fetch even if cache is warm. */
  force?: boolean;
  /** Override the in-process http fetcher (used for tests). */
  fetcher?: (url: string, headers: Record<string, string>) => Promise<FetchResult>;
};

export type FetchIndexResult = {
  index: RegistryIndex;
  source: 'fresh' | 'cached' | 'cached-stale-offline';
  warning?: string;
};

export async function fetchIndex(opts: FetchIndexOptions = {}): Promise<FetchIndexResult> {
  const fetcher = opts.fetcher ?? httpFetch;
  const cached = await readCache();
  const url = indexUrl();
  const fresh = cached && !opts.force && Date.now() - cached.lastFetched < CACHE_TTL_MS;
  if (fresh && cached) return { index: cached.index, source: 'cached' };

  const headers: Record<string, string> = {};
  if (cached?.etag) headers['if-none-match'] = cached.etag;

  try {
    const res = await fetcher(url, headers);
    if (res.status === 304 && cached) {
      const updated: CacheRecord = { ...cached, lastFetched: Date.now() };
      await writeCache(updated);
      return { index: cached.index, source: 'cached' };
    }
    if (res.status >= 200 && res.status < 300) {
      const index = parseIndex(res.body, url);
      const rec: CacheRecord = { etag: res.etag, lastFetched: Date.now(), index };
      await writeCache(rec);
      return { index, source: 'fresh' };
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (cached) {
      return {
        index: cached.index,
        source: 'cached-stale-offline',
        warning: `registry unreachable (${(err as Error).message}); using cached index from ${new Date(cached.lastFetched).toISOString()}`,
      };
    }
    throw new Error(
      `registry unreachable (${(err as Error).message}); no cache available. ` +
        `Try again or set $SQUAD_REGISTRY_INDEX.`,
    );
  }
}

export type SearchHit = { entry: RegistryEntry; score: number };

export function searchIndex(query: string, index: RegistryIndex): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.recipes.map(entry => ({ entry, score: 1 }));
  const hits: SearchHit[] = [];
  for (const entry of index.recipes) {
    let score = 0;
    if (entry.name.toLowerCase().includes(q)) score += 10;
    if (entry.description.toLowerCase().includes(q)) score += 5;
    for (const t of entry.tags ?? []) {
      if (t.toLowerCase().includes(q)) {
        score += 2;
        break;
      }
    }
    if (score > 0) hits.push({ entry, score });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return hits;
}

export type AddOptions = {
  /** Allow overwriting an existing user recipe with the same filename. */
  force?: boolean;
  /** Test seam for the http fetcher. */
  fetcher?: (url: string, headers: Record<string, string>) => Promise<FetchResult>;
};

export type AddResult = {
  name: string;
  source: string;
  destination: string;
  collidedWithBuiltin: boolean;
};

export async function addFromRegistry(name: string, opts: AddOptions = {}): Promise<AddResult> {
  if (BUILTIN_RECIPE_NAMES.includes(name) && !opts.force) {
    throw new Error(
      `recipe "${name}" collides with a built-in. Pass --force to override locally, ` +
        `or pick a different name on the registry side.`,
    );
  }
  const { index } = await fetchIndex({ fetcher: opts.fetcher });
  const entry = index.recipes.find(e => e.name === name);
  if (!entry) {
    throw new Error(
      `recipe "${name}" not found in registry. Try \`squad search\` or check the spelling.`,
    );
  }
  const fetcher = opts.fetcher ?? httpFetch;
  const res = await fetcher(entry.url, {});
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`failed to fetch recipe body (${entry.url}): HTTP ${res.status}`);
  }
  // Validate it's a real recipe before saving — surfaces bad uploads early.
  parseRecipe(res.body, entry.url);

  const dest = join(userRecipesDir(), `${name}.json`);
  if (existsSync(dest) && !opts.force) {
    throw new Error(`already installed: ${dest}. Pass --force to overwrite.`);
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, res.body);
  return {
    name,
    source: entry.url,
    destination: dest,
    collidedWithBuiltin: BUILTIN_RECIPE_NAMES.includes(name),
  };
}

/** Cache age helper (used by doctor + search command). */
export async function cacheAgeMs(): Promise<number | null> {
  const p = cachePath();
  if (!existsSync(p)) return null;
  try {
    const s = await stat(p);
    return Date.now() - s.mtimeMs;
  } catch {
    return null;
  }
}
