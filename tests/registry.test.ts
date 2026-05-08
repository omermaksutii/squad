import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fetchIndex,
  searchIndex,
  addFromRegistry,
  cachePath,
  userRecipesDir,
  type RegistryIndex,
} from '../src/registry.js';

const SAMPLE_INDEX: RegistryIndex = {
  version: 1,
  recipes: [
    {
      name: 'auth-flow',
      description: 'Build login + RLS for Supabase apps',
      author: '@alice',
      url: 'https://example.com/recipes/auth-flow.json',
      tags: ['supabase', 'auth', 'rls'],
      version: '1.0.0',
    },
    {
      name: 'jwt-rotate',
      description: 'Rotate JWT secrets safely',
      author: '@bob',
      url: 'https://example.com/recipes/jwt-rotate.json',
      tags: ['auth', 'security'],
    },
    {
      name: 'oauth-google',
      description: 'Google OAuth integration',
      author: '@carol',
      url: 'https://example.com/recipes/oauth-google.json',
      tags: ['oauth', 'google'],
    },
  ],
};

const SAMPLE_RECIPE = JSON.stringify({
  name: 'auth-flow',
  description: 'Build login + RLS',
  agents: [
    { name: 'planner', prompt: 'plan the work' },
    { name: 'coder', prompt: 'do the work', dependsOn: ['planner'] },
  ],
});

function makeFetcher(handlers: Record<string, { status?: number; body?: string; etag?: string | null }>) {
  return async (url: string, _headers: Record<string, string>) => {
    const h = handlers[url];
    if (!h) throw new Error(`no mock for ${url}`);
    return { status: h.status ?? 200, body: h.body ?? '', etag: h.etag ?? null };
  };
}

describe('registry (v1.2)', () => {
  let dir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'squad-reg-'));
    originalHome = process.env.HOME;
    process.env.HOME = dir;
    process.env.SQUAD_REGISTRY_INDEX = 'https://example.com/index.json';
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.SQUAD_REGISTRY_INDEX;
  });

  it('fetchIndex pulls fresh on cold cache and writes to ~/.squad/.registry-cache.json', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify(SAMPLE_INDEX), etag: '"abc"' },
    });
    const result = await fetchIndex({ fetcher });
    expect(result.source).toBe('fresh');
    expect(result.index.recipes.length).toBe(3);
    expect(existsSync(cachePath())).toBe(true);
    const cache = JSON.parse(readFileSync(cachePath(), 'utf8'));
    expect(cache.etag).toBe('"abc"');
  });

  it('fetchIndex serves cache when warm and skips network', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify(SAMPLE_INDEX) },
    });
    await fetchIndex({ fetcher });
    let calls = 0;
    const counting = async (...args: Parameters<typeof fetcher>) => {
      calls++;
      return fetcher(...args);
    };
    const result = await fetchIndex({ fetcher: counting });
    expect(result.source).toBe('cached');
    expect(calls).toBe(0);
  });

  it('fetchIndex falls back to stale cache when network fails', async () => {
    const ok = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify(SAMPLE_INDEX) },
    });
    await fetchIndex({ fetcher: ok });
    // Force expiry
    const cache = JSON.parse(readFileSync(cachePath(), 'utf8'));
    cache.lastFetched = 0;
    writeFileSync(cachePath(), JSON.stringify(cache));

    const failing = async () => { throw new Error('ECONNREFUSED'); };
    const result = await fetchIndex({ fetcher: failing });
    expect(result.source).toBe('cached-stale-offline');
    expect(result.warning).toMatch(/ECONNREFUSED/);
    expect(result.index.recipes.length).toBe(3);
  });

  it('fetchIndex throws when network fails AND no cache exists', async () => {
    const failing = async () => { throw new Error('DNS'); };
    await expect(fetchIndex({ fetcher: failing })).rejects.toThrow(/registry unreachable.*no cache/);
  });

  it('searchIndex ranks name matches above description above tag', () => {
    const hits = searchIndex('auth', SAMPLE_INDEX);
    // All three contain "auth" as a substring somewhere; ranking distinguishes them.
    // oauth-google: name + desc + tag (17), auth-flow: name + tag (12), jwt-rotate: tag only (2)
    expect(hits.map(h => h.entry.name)).toEqual(['oauth-google', 'auth-flow', 'jwt-rotate']);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThan(hits[2]!.score);
  });

  it('searchIndex ranks an exact name token highest', () => {
    const hits = searchIndex('rotate', SAMPLE_INDEX);
    expect(hits.length).toBe(1);
    expect(hits[0]!.entry.name).toBe('jwt-rotate');
  });

  it('searchIndex with empty query returns all', () => {
    const hits = searchIndex('', SAMPLE_INDEX);
    expect(hits.length).toBe(3);
  });

  it('searchIndex is case-insensitive', () => {
    const hits = searchIndex('SUPABASE', SAMPLE_INDEX);
    expect(hits.length).toBe(1);
    expect(hits[0]!.entry.name).toBe('auth-flow');
  });

  it('addFromRegistry downloads recipe and saves to ~/.squad/recipes/', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify(SAMPLE_INDEX) },
      'https://example.com/recipes/auth-flow.json': { body: SAMPLE_RECIPE },
    });
    const result = await addFromRegistry('auth-flow', { fetcher });
    expect(result.destination).toContain('auth-flow.json');
    expect(existsSync(result.destination)).toBe(true);
    expect(readFileSync(result.destination, 'utf8')).toBe(SAMPLE_RECIPE);
  });

  it('addFromRegistry refuses to shadow a built-in without --force', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': {
        body: JSON.stringify({
          version: 1,
          recipes: [{ name: 'feature', description: 'x', author: '@a', url: 'https://example.com/r.json' }],
        }),
      },
    });
    await expect(addFromRegistry('feature', { fetcher })).rejects.toThrow(/built-in/);
  });

  it('addFromRegistry refuses to overwrite existing local recipe without --force', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify(SAMPLE_INDEX) },
      'https://example.com/recipes/auth-flow.json': { body: SAMPLE_RECIPE },
    });
    await mkdir(userRecipesDir(), { recursive: true });
    writeFileSync(join(userRecipesDir(), 'auth-flow.json'), '{"existing": true}');
    await expect(addFromRegistry('auth-flow', { fetcher })).rejects.toThrow(/already installed/);
  });

  it('addFromRegistry --force overwrites existing local recipe', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify(SAMPLE_INDEX) },
      'https://example.com/recipes/auth-flow.json': { body: SAMPLE_RECIPE },
    });
    await mkdir(userRecipesDir(), { recursive: true });
    writeFileSync(join(userRecipesDir(), 'auth-flow.json'), '{"existing": true}');
    const result = await addFromRegistry('auth-flow', { fetcher, force: true });
    expect(readFileSync(result.destination, 'utf8')).toBe(SAMPLE_RECIPE);
  });

  it('addFromRegistry rejects unknown recipe name', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify(SAMPLE_INDEX) },
    });
    await expect(addFromRegistry('does-not-exist', { fetcher })).rejects.toThrow(/not found in registry/);
  });

  it('addFromRegistry validates the recipe body before saving', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify(SAMPLE_INDEX) },
      'https://example.com/recipes/auth-flow.json': { body: '{"not a": "recipe"}' },
    });
    await expect(addFromRegistry('auth-flow', { fetcher })).rejects.toThrow(/missing/);
    expect(existsSync(join(userRecipesDir(), 'auth-flow.json'))).toBe(false);
  });

  it('parseIndex rejects unsupported version', async () => {
    const fetcher = makeFetcher({
      'https://example.com/index.json': { body: JSON.stringify({ version: 99, recipes: [] }) },
    });
    await expect(fetchIndex({ fetcher })).rejects.toThrow(/unsupported version/);
  });
});
