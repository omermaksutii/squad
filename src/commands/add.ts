import chalk from 'chalk';
import { writeJsonResult } from '../json-mode.js';
import { addFromRegistry } from '../registry.js';

export async function runAdd(name: string, opts: { force?: boolean } = {}): Promise<void> {
  try {
    const result = await addFromRegistry(name, { force: opts.force });
    if (writeJsonResult({
      installed: result.name,
      source: result.source,
      destination: result.destination,
      collided_with_builtin: result.collidedWithBuiltin,
    })) return;
    console.log(chalk.green('✓ added'), chalk.cyan(result.name));
    console.log(chalk.dim(`  from: ${result.source}`));
    console.log(chalk.dim(`  to:   ${result.destination}`));
    if (result.collidedWithBuiltin) {
      console.log(chalk.yellow(`  note: shadows built-in "${result.name}" — pass the path explicitly to use the built-in`));
    }
    console.log(chalk.dim(`\n  run it: squad run ${result.name} "<task>"`));
  } catch (err) {
    if (writeJsonResult({ error: (err as Error).message })) {
      process.exitCode = 1;
      return;
    }
    console.error(chalk.red('error:'), (err as Error).message);
    process.exitCode = 1;
  }
}
