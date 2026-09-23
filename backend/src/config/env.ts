/**
 * Minimal .env loader (no dependency). Loads ./.env then ../.env; never
 * overrides variables that are already set in the process environment.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
  if (!existsSync(p)) continue;
  const parsed = parseEnv(readFileSync(p, 'utf8')) as Record<string, string>;
  for (const [k, v] of Object.entries(parsed)) if (process.env[k] === undefined) process.env[k] = v;
}
