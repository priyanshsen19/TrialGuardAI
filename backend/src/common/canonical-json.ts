import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialisation (RFC 8785-style: sorted object keys, no
 * whitespace, undefined dropped). Used for every hash in the audit chain so the
 * hash of a record is independent of key order or database round-trips.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : sortDeep(x)));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const val = (v as Record<string, unknown>)[k];
    if (val !== undefined) out[k] = sortDeep(val);
  }
  return out;
}

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export const hashObject = (value: unknown) => sha256Hex(canonicalJson(value));
