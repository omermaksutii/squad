import chalk from 'chalk';
import { writeJsonResult } from '../json-mode.js';
import { fetchIndex, searchIndex } from '../registry.js';

export async function runSearch(query: string): Promise<void> {
  const { index, source, warning } = await fetchIndex();
  const hits = searchIndex(query, index);

  if (writeJsonResult({
    query,
    source,
    warning: warning ?? null,
    hits: hits.map(h => ({
      name: h.entry.name,
      description: h.entry.description,
      author: h.entry.author,
      url: h.entry.url,
      tags: h.entry.tags ?? [],
      version: h.entry.version,
      score: h.score,
    })),
  })) return;

  if (warning) console.error(chalk.yellow(`warn: ${warning}`));

  if (hits.length === 0) {
    console.log(chalk.dim(`no recipes match "${query}"`));
    if (index.recipes.length === 0) {
      console.log(chalk.dim('  registry is empty — submit one at github.com/omermaksutii/squad-recipes'));
    }
    return;
  }

  const nameW = Math.max(8, ...hits.map(h => h.entry.name.length));
  for (const h of hits) {
    const name = h.entry.name.padEnd(nameW);
    const desc = h.entry.description || chalk.dim('(no description)');
    const author = h.entry.author ? chalk.dim(`  ${h.entry.author}`) : '';
    console.log(`  ${chalk.cyan(name)}  ${desc}${author}`);
  }
  console.log('');
  console.log(chalk.dim(`  ${hits.length} match${hits.length === 1 ? '' : 'es'} · install with \`squad add <name>\``));
}
