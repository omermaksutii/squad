import type { Recipe } from './recipe.js';

/**
 * Render a recipe as a Mermaid `flowchart TD` graph. Drop into any
 * markdown that supports mermaid (GitHub, GitLab, docs sites).
 */
export function renderMermaid(recipe: Recipe): string {
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart TD');
  for (const a of recipe.agents) {
    const label = `${a.name}<br/><i>${a.description.replace(/\n/g, ' ').slice(0, 60)}</i>`;
    lines.push(`  ${a.name}["${label}"]`);
  }
  lines.push('');
  for (const a of recipe.agents) {
    for (const d of a.dependsOn ?? []) {
      lines.push(`  ${d} --> ${a.name}`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}
