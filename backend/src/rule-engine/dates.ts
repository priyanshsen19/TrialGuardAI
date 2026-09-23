/**
 * Deterministic calendar arithmetic. All dates are treated as UTC calendar
 * days; no LLM is ever asked to compute a duration.
 */
export type Precision = 'day' | 'month' | 'year' | 'unknown';

const DAY_MS = 86_400_000;

export function parseIsoDay(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid ISO day: ${s}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new Error(`Invalid calendar date: ${s}`);
  }
  return t;
}

/** Whole calendar days from `from` to `to` (positive when `from` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDay(to) - parseIsoDay(from)) / DAY_MS);
}

export function formatDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Earliest/latest possible calendar day for a date of a given precision:
 * "2026-08" → [2026-08-01, 2026-08-31]; "2026" → [2026-01-01, 2026-12-31].
 */
export function dateBounds(value: string | null | undefined, precision: Precision): [string, string] | null {
  if (!value || precision === 'unknown') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return [value, value];
  const ym = /^(\d{4})-(\d{2})$/.exec(value);
  if (ym) {
    const y = Number(ym[1]);
    const mo = Number(ym[2]);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return [`${ym[1]}-${ym[2]}-01`, `${ym[1]}-${ym[2]}-${String(last).padStart(2, '0')}`];
  }
  if (/^\d{4}$/.test(value)) return [`${value}-01-01`, `${value}-12-31`];
  return null;
}

/** Age in completed years on a reference date. */
export function ageInYears(dob: string, onDate: string): number {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onDate);
  if (!b || !r) throw new Error('ageInYears requires ISO days');
  parseIsoDay(dob);
  parseIsoDay(onDate);
  let age = Number(r[1]) - Number(b[1]);
  if (Number(r[2]) < Number(b[2]) || (Number(r[2]) === Number(b[2]) && Number(r[3]) < Number(b[3]))) age -= 1;
  return age;
}
