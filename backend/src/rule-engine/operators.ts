/**
 * Primitive, pure comparison operators of the deterministic rule engine.
 *
 * Every operator returns `true`, `false`, or `null` (= cannot be evaluated —
 * the caller turns this into UNKNOWN and routes to human review). Nothing is
 * ever guessed.
 *
 * Temporal semantics (Δ = whole days from the event date to the reference date):
 *   WITHIN_DAYS N      ⇔ 0 ≤ Δ < N   (event inside the look-back window)
 *   NOT_WITHIN_DAYS N  ⇔ Δ ≥ N       (e.g. a washout of at least N days)
 * Events after the reference date (Δ < 0) cannot be evaluated → null.
 */
import type { Operator } from '@trialguard/agents';
import { daysBetween } from './dates';

export type Scalar = number | string | boolean;

export interface TemporalExpectation {
  days: number;
  referenceDate: string;
}

const EPS = 1e-9;

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function eq(a: unknown, b: unknown): boolean | null {
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < EPS;
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  return null;
}

export function applyOperator(op: Operator, actual: unknown, expected: unknown): boolean | null {
  switch (op) {
    case '=':
      return actual === null || actual === undefined ? null : eq(actual, expected);
    case '!=': {
      const r = actual === null || actual === undefined ? null : eq(actual, expected);
      return r === null ? null : !r;
    }
    case '>':
    case '>=':
    case '<':
    case '<=': {
      const a = num(actual);
      const e = num(expected);
      if (a === null || e === null) return null;
      if (op === '>') return a > e + EPS;
      if (op === '>=') return a >= e - EPS;
      if (op === '<') return a < e - EPS;
      return a <= e + EPS;
    }
    case 'BETWEEN': {
      const a = num(actual);
      const r = expected as { min: number; max: number } | [number, number];
      const min = Array.isArray(r) ? r[0] : r?.min;
      const max = Array.isArray(r) ? r[1] : r?.max;
      if (a === null || num(min) === null || num(max) === null) return null;
      return a >= (min as number) - EPS && a <= (max as number) + EPS; // inclusive bounds
    }
    case 'IN':
    case 'NOT_IN': {
      if (!Array.isArray(expected) || actual === null || actual === undefined) return null;
      const actuals = Array.isArray(actual) ? actual : [actual];
      const hit = actuals.some((a) => expected.some((e) => eq(a, e) === true));
      return op === 'IN' ? hit : !hit;
    }
    case 'EXISTS':
      return Array.isArray(actual) ? actual.length > 0 : actual !== null && actual !== undefined && actual !== false;
    case 'NOT_EXISTS':
      return Array.isArray(actual) ? actual.length === 0 : actual === null || actual === undefined || actual === false;
    case 'WITHIN_DAYS':
    case 'NOT_WITHIN_DAYS': {
      const t = expected as TemporalExpectation;
      if (typeof actual !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(actual) || !t?.referenceDate) return null;
      const delta = daysBetween(actual, t.referenceDate);
      if (delta < 0) return null;
      return op === 'WITHIN_DAYS' ? delta < t.days : delta >= t.days;
    }
    default:
      return null;
  }
}

/** Human-readable symbol for rule expressions. */
export function opSymbol(op: Operator): string {
  return op;
}
