import chalk from 'chalk';
import type { Recipe, AgentSpec } from './recipe.js';
import { planExecution } from './recipe.js';

/**
 * Render a recipe DAG as ASCII art. Linear chains print as arrows;
 * branches print with simple ├ / │ / └ glyphs. Compact, terminal-friendly.
 */
export function renderGraph(recipe: Recipe): string {
  const layers = planExecution(recipe);
  const lines: string[] = [];
  lines.push(chalk.bold.cyan(`${recipe.name}`));
  lines.push(chalk.dim(recipe.description));
  lines.push('');

  // Build child map: who depends on whom?
  const children = new Map<string, string[]>();
  for (const a of recipe.agents) children.set(a.name, []);
  for (const a of recipe.agents) {
    for (const d of a.dependsOn ?? []) children.get(d)?.push(a.name);
  }

  // Find roots (no dependencies) — typically just one or two
  const roots = recipe.agents.filter(a => !a.dependsOn || a.dependsOn.length === 0);
  const renderedSet = new Set<string>();

  for (const root of roots) {
    renderTree(root, lines, '', true, recipe, children, renderedSet);
  }

  // If any agents weren't reachable from roots (shouldn't happen with a valid DAG), list them
  for (const a of recipe.agents) {
    if (!renderedSet.has(a.name)) {
      lines.push(chalk.dim('(unreachable)'));
      renderTree(a, lines, '', true, recipe, children, renderedSet);
    }
  }

  lines.push('');
  lines.push(chalk.dim(`${recipe.agents.length} agents · ${layers.length} layer${layers.length === 1 ? '' : 's'} · max parallelism ${Math.max(...layers.map(l => l.length))}`));
  return lines.join('\n');
}

function renderTree(
  agent: AgentSpec,
  out: string[],
  prefix: string,
  isLast: boolean,
  recipe: Recipe,
  children: Map<string, string[]>,
  rendered: Set<string>,
): void {
  if (rendered.has(agent.name)) {
    out.push(`${prefix}${isLast ? '└─ ' : '├─ '}${chalk.dim(agent.name)} ${chalk.dim('(see above)')}`);
    return;
  }
  rendered.add(agent.name);
  const connector = prefix === '' ? '' : (isLast ? '└─ ' : '├─ ');
  const modelTag = chalk.dim(`(${agent.model ?? 'sonnet'})`);
  out.push(`${prefix}${connector}${chalk.cyan(agent.name)} ${modelTag}`);
  if (agent.description) {
    const indent = prefix + (isLast ? '   ' : '│  ');
    out.push(`${indent}${chalk.dim(agent.description)}`);
  }
  const kids = (children.get(agent.name) ?? [])
    .map(name => recipe.agents.find(a => a.name === name)!)
    .filter(Boolean);
  const childPrefix = prefix + (isLast ? '   ' : '│  ');
  kids.forEach((c, i) => renderTree(c, out, childPrefix, i === kids.length - 1, recipe, children, rendered));
}
