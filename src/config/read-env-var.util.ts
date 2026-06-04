import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Read `KEY=value` from `.env` without dotenv (empty process.env keys break dotenv parse). */
function readFromDotenvFile(name: string, cwd: string): string {
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) return '';

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\s*=\\s*(.*)$`, 'mi');
  for (let line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (
      (line.startsWith('"') && line.endsWith('"')) ||
      (line.startsWith("'") && line.endsWith("'"))
    ) {
      line = line.slice(1, -1).trim();
    }
    const match = line.match(re);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  return '';
}

/**
 * Read a variable from `.env`, preferring the file when `process.env` is unset or blank.
 * Nest's ConfigModule does not override existing (including empty) process.env keys.
 */
export function readEnvVarPreferDotenvFile(name: string, cwd = process.cwd()): string {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  return readFromDotenvFile(name, cwd);
}
