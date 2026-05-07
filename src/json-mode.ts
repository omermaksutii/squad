export function jsonMode(): boolean {
  return process.env.SQUAD_JSON === '1';
}

export function writeJsonResult(payload: unknown): boolean {
  if (!jsonMode()) return false;
  process.stdout.write(JSON.stringify(payload) + '\n');
  return true;
}
