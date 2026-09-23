import { describe, expect, it } from 'vitest';
import { applyOperator } from '../../backend/src/rule-engine/operators';
import { ageInYears, daysBetween } from '../../backend/src/rule-engine/dates';
import { evaluateCriterion } from '../../backend/src/rule-engine/evaluator';
import { calculateConfidence, decide } from '../../backend/src/rule-engine/decision';
import type { CriterionEvaluation, SafetyFlagRecord } from '@trialguard/agents';
import { criterion, ctx, fact } from '../helpers';

const REF = '2026-09-23';
const washoutDays = (days: number) => {
  const d = new Date(Date.UTC(2026, 8, 23) - days * 86_400_000).toISOString().slice(0, 10);
  return d;
};

describe('rule engine — critical operator tests', () => {
  it('5 >= 5 → PASS', () => expect(applyOperator('>=', 5, 5)).toBe(true));
  it('5 > 5 → FAIL', () => expect(applyOperator('>', 5, 5)).toBe(false));
  it('5 <= 5 → PASS', () => expect(applyOperator('<=', 5, 5)).toBe(true));
  it('5 < 5 → FAIL', () => expect(applyOperator('<', 5, 5)).toBe(false));
  it('6.5 BETWEEN 6.5 AND 8 → PASS', () => expect(applyOperator('BETWEEN', 6.5, { min: 6.5, max: 8 })).toBe(true));
  it('8.1 BETWEEN 6.5 AND 8 → FAIL', () => expect(applyOperator('BETWEEN', 8.1, { min: 6.5, max: 8 })).toBe(false));
  it('30 day washout >= 30 → PASS', () => {
    const end = washoutDays(30);
    expect(daysBetween(end, REF)).toBe(30);
    expect(applyOperator('NOT_WITHIN_DAYS', end, { days: 30, referenceDate: REF })).toBe(true);
    expect(applyOperator('>=', daysBetween(end, REF), 30)).toBe(true);
  });
  it('29 day washout >= 30 → FAIL', () => {
    const end = washoutDays(29);
    expect(daysBetween(end, REF)).toBe(29);
    expect(applyOperator('NOT_WITHIN_DAYS', end, { days: 30, referenceDate: REF })).toBe(false);
    expect(applyOperator('>=', daysBetween(end, REF), 30)).toBe(false);
  });
});

describe('rule engine — all operators', () => {
  it('= and != (numeric and case-insensitive strings)', () => {
    expect(applyOperator('=', 60, 60)).toBe(true);
    expect(applyOperator('=', 'Negative', 'negative')).toBe(true);
    expect(applyOperator('!=', 'negative', 'positive')).toBe(true);
    expect(applyOperator('!=', 1, 1)).toBe(false);
  });
  it('IN / NOT_IN', () => {
    expect(applyOperator('IN', 'b', ['a', 'b'])).toBe(true);
    expect(applyOperator('IN', ['x', 'b'], ['a', 'b'])).toBe(true);
    expect(applyOperator('NOT_IN', 'c', ['a', 'b'])).toBe(true);
  });
  it('EXISTS / NOT_EXISTS', () => {
    expect(applyOperator('EXISTS', [1], null)).toBe(true);
    expect(applyOperator('EXISTS', [], null)).toBe(false);
    expect(applyOperator('NOT_EXISTS', null, null)).toBe(true);
  });
  it('WITHIN_DAYS / NOT_WITHIN_DAYS boundaries', () => {
    expect(applyOperator('WITHIN_DAYS', washoutDays(0), { days: 30, referenceDate: REF })).toBe(true);
    expect(applyOperator('WITHIN_DAYS', washoutDays(29), { days: 30, referenceDate: REF })).toBe(true);
    expect(applyOperator('WITHIN_DAYS', washoutDays(30), { days: 30, referenceDate: REF })).toBe(false);
  });
  it('returns null (never guesses) for non-evaluable input', () => {
    expect(applyOperator('>=', 'n/a', 60)).toBeNull();
    expect(applyOperator('>=', null, 60)).toBeNull();
    expect(applyOperator('WITHIN_DAYS', 'sometime last month', { days: 30, referenceDate: REF })).toBeNull();
    expect(applyOperator('WITHIN_DAYS', '2026-10-01', { days: 30, referenceDate: REF })).toBeNull(); // future event
  });
  it('spec temporal example: corticosteroid ended 2026-09-01, screening 2026-09-23 → 22 days → FAIL', () => {
    expect(daysBetween('2026-09-01', '2026-09-23')).toBe(22);
    const c = criterion({ id: 'EXC-005', domain: 'medication', field: 'systemic corticosteroid', operator: 'EXISTS', temporal: { operator: 'WITHIN_DAYS', days: 30, anchor: 'end' } });
    const f = fact({ category: 'medication', concept: { system: 'RXNORM', code: '8640', display: 'Prednisone' }, startDate: '2026-08-18', endDate: '2026-09-01', status: 'completed' });
    const e = evaluateCriterion(c, [f], ctx);
    expect(e.result).toBe('FAIL');
    expect(e.ruleExpression).toContain('days_since=22');
  });
  it('age in completed years', () => {
    expect(ageInYears('1972-03-14', '2026-09-23')).toBe(54);
    expect(ageInYears('1972-09-24', '2026-09-23')).toBe(53);
    expect(ageInYears('1972-09-23', '2026-09-23')).toBe(54);
  });
});

describe('rule engine — criterion evaluation', () => {
  const egfr = criterion({ id: 'INC-004', domain: 'laboratory', field: 'eGFR', operator: '>=', value: 60, unit: 'mL/min/1.73m2', lookbackDays: 30 });
  const egfrFact = (v: number, date: string, doc = 'lab.pdf') =>
    fact({ category: 'observation', concept: { system: 'LOINC', code: '62238-1', display: 'eGFR (CKD-EPI)' }, value: v, unit: 'mL/min/1.73m2', observedAt: date, source: { document: doc, page: 2 } });

  it('eGFR 72 >= 60 → PASS with expected/actual/rule/evidence', () => {
    const e = evaluateCriterion(egfr, [egfrFact(72, '2026-09-10')], ctx);
    expect(e.result).toBe('PASS');
    expect(e.ruleExpression).toBe('72 >= 60 → true');
    expect(e.expectedValue).toContain('>= 60 mL/min/1.73m2');
    expect(e.actualValue).toContain('72');
    expect(e.evidence[0]).toMatchObject({ sourceDocument: 'lab.pdf', page: 2, observedAt: '2026-09-10' });
  });
  it('conflicting results with different outcomes → UNKNOWN (CONFLICTING_EVIDENCE)', () => {
    const e = evaluateCriterion(egfr, [egfrFact(72, '2026-09-12'), egfrFact(48, '2026-09-14', 'outside.pdf')], ctx);
    expect(e.result).toBe('UNKNOWN');
    expect(e.reviewReasons).toContain('CONFLICTING_EVIDENCE');
    expect(e.evidence).toHaveLength(2);
  });
  it('consistent repeated results → most recent is used', () => {
    const e = evaluateCriterion(egfr, [egfrFact(72, '2026-09-10'), egfrFact(68, '2026-09-15')], ctx);
    expect(e.result).toBe('PASS');
    expect(e.actualValue).toContain('68');
  });
  it('missing result → UNKNOWN (MISSING_EVIDENCE)', () => {
    const e = evaluateCriterion(egfr, [], ctx);
    expect(e.result).toBe('UNKNOWN');
    expect(e.reviewReasons).toContain('MISSING_EVIDENCE');
  });
  it('stale result outside look-back → UNKNOWN (STALE_EVIDENCE)', () => {
    const e = evaluateCriterion(egfr, [egfrFact(72, '2026-06-01')], ctx);
    expect(e.result).toBe('UNKNOWN');
    expect(e.reviewReasons).toContain('STALE_EVIDENCE');
  });
  it('supported unit conversion: HbA1c 64 mmol/mol → 8.01 % within 7–10.5', () => {
    const c = criterion({ id: 'INC-003', domain: 'laboratory', field: 'HbA1c', operator: 'BETWEEN', range: { min: 7, max: 10.5 }, unit: '%' });
    const f = fact({ category: 'observation', concept: { system: 'LOINC', code: '4548-4', display: 'Hemoglobin A1c' }, value: 64, unit: 'mmol/mol', observedAt: '2026-09-10' });
    const e = evaluateCriterion(c, [f], ctx);
    expect(e.result).toBe('PASS');
    expect(e.evidence[0].normalizedValue).toBeCloseTo(8.01, 2);
  });
  it('unsupported unit conversion → UNKNOWN (UNSUPPORTED_UNIT)', () => {
    const f = fact({ category: 'observation', concept: { system: 'LOINC', code: '62238-1', display: 'eGFR' }, value: 1.2, unit: 'mL/s', observedAt: '2026-09-10' });
    const e = evaluateCriterion(egfr, [f], ctx);
    expect(e.result).toBe('UNKNOWN');
    expect(e.reviewReasons).toContain('UNSUPPORTED_UNIT');
  });
  it('ambiguous criterion is never machine-evaluated', () => {
    const c = criterion({ id: 'INC-011', domain: 'laboratory', field: 'renal function', operator: 'EXISTS', requiresHumanReview: true, ambiguity: 1 });
    const e = evaluateCriterion(c, [egfrFact(90, '2026-09-10')], ctx);
    expect(e.result).toBe('UNKNOWN');
    expect(e.reviewReasons).toContain('AMBIGUOUS_CRITERION');
  });
  it('vague medication stop date → UNKNOWN (AMBIGUOUS_DATE)', () => {
    const c = criterion({ id: 'EXC-005', domain: 'medication', field: 'systemic corticosteroid', operator: 'EXISTS', temporal: { operator: 'WITHIN_DAYS', days: 30, anchor: 'end' } });
    const f = fact({ category: 'medication', concept: { system: 'RXNORM', code: '8640', display: 'Prednisone' }, endDate: null, datePrecision: 'unknown', dateText: 'end: sometime last month', status: 'unknown' });
    const e = evaluateCriterion(c, [f], ctx);
    expect(e.result).toBe('UNKNOWN');
    expect(e.reviewReasons).toContain('AMBIGUOUS_DATE');
  });
  it('month-precision dates are decided when every day in the month agrees', () => {
    const c = criterion({ id: 'EXC-005', domain: 'medication', field: 'systemic corticosteroid', operator: 'EXISTS', temporal: { operator: 'WITHIN_DAYS', days: 30, anchor: 'end' } });
    const old = fact({ category: 'medication', concept: { system: 'RXNORM', code: '8640', display: 'Prednisone' }, endDate: '2026-05', datePrecision: 'month', status: 'completed' });
    expect(evaluateCriterion(c, [old], ctx).result).toBe('PASS');
    const recent = fact({ category: 'medication', concept: { system: 'RXNORM', code: '8640', display: 'Prednisone' }, endDate: '2026-08', datePrecision: 'month', status: 'completed' });
    expect(evaluateCriterion(c, [recent], ctx).result).toBe('UNKNOWN'); // Aug 1 → 53 days, Aug 31 → 23 days
  });
  it('ongoing therapy counts as exposure at screening', () => {
    const c = criterion({ id: 'EXC-006', domain: 'medication', field: 'medication (any of)', values: ['GLP-1 receptor agonist', 'insulin'], operator: 'IN', temporal: { operator: 'WITHIN_DAYS', days: 90, anchor: 'end' } });
    const f = fact({ category: 'medication', concept: { system: 'RXNORM', code: '1991302', display: 'Semaglutide' }, startDate: '2025-01-01', status: 'ongoing' });
    expect(evaluateCriterion(c, [f], ctx).result).toBe('FAIL');
  });
  it('unmapped medication cannot be ruled out for an exclusion', () => {
    const c = criterion({ id: 'EXC-005', domain: 'medication', field: 'systemic corticosteroid', operator: 'EXISTS', temporal: { operator: 'WITHIN_DAYS', days: 30, anchor: 'end' } });
    const f = fact({ category: 'medication', concept: { system: 'UNMAPPED', code: null, display: 'Zorblaxin' }, endDate: '2026-09-20', status: 'completed' });
    const e = evaluateCriterion(c, [f], ctx);
    expect(e.result).toBe('UNKNOWN');
    expect(e.reviewReasons).toContain('UNRESOLVED_TERMINOLOGY');
  });
  it('sex-restricted criterion → NOT_APPLICABLE for other sex', () => {
    const c = criterion({ id: 'EXC-004', domain: 'reproductive', field: 'pregnancy test', operator: '=', value: 'positive', appliesTo: { sex: 'F' } });
    expect(evaluateCriterion(c, [], { ...ctx, patientSex: 'M' }).result).toBe('NOT_APPLICABLE');
    expect(evaluateCriterion(c, [], { ...ctx, patientSex: 'F' }).result).toBe('UNKNOWN');
  });
});

describe('decision + confidence', () => {
  const ev = (id: string, result: CriterionEvaluation['result'], confidence = 0.99, mandatory = true): CriterionEvaluation => ({
    criterionId: id,
    category: id.startsWith('EXC') ? 'exclusion' : 'inclusion',
    mandatory,
    requirement: id,
    result,
    conditionMet: null,
    operator: '>=',
    expectedValue: '',
    actualValue: null,
    ruleExpression: '',
    reason: `${id} reason`,
    reviewReasons: [],
    evidence: [],
    confidence: result === 'UNKNOWN' ? 0 : confidence,
    source: { page: 1, section: 's' },
  });
  const flag = (severity: SafetyFlagRecord['severity']): SafetyFlagRecord => ({ code: 'POTENTIAL_SAFETY_SIGNAL', severity, description: 'x', factIds: [], criterionIds: [], source: 'agent' });

  it('ELIGIBLE when all mandatory PASS / N/A and confidence ≥ 90%', () => {
    const d = decide([ev('INC-001', 'PASS'), ev('EXC-004', 'NOT_APPLICABLE', 1), ev('GDN-001', 'UNKNOWN', 0, false)], []);
    expect(d.decision).toBe('ELIGIBLE');
  });
  it('INELIGIBLE when any mandatory criterion FAILs (even with unknowns)', () => {
    expect(decide([ev('INC-001', 'PASS'), ev('EXC-005', 'FAIL'), ev('INC-003', 'UNKNOWN')], []).decision).toBe('INELIGIBLE');
  });
  it('REQUIRES_HUMAN_OVERVIEW on UNKNOWN mandatory criterion', () => {
    expect(decide([ev('INC-001', 'PASS'), ev('INC-003', 'UNKNOWN')], []).decision).toBe('REQUIRES_HUMAN_OVERVIEW');
  });
  it('REQUIRES_HUMAN_OVERVIEW on blocking safety flag', () => {
    expect(decide([ev('INC-001', 'PASS')], [flag('BLOCKING')]).decision).toBe('REQUIRES_HUMAN_OVERVIEW');
  });
  it('REQUIRES_HUMAN_OVERVIEW when confidence < 90%', () => {
    const d = decide([ev('INC-001', 'PASS', 0.85), ev('INC-002', 'PASS', 0.88)], []);
    expect(d.confidence).toBeLessThan(0.9);
    expect(d.decision).toBe('REQUIRES_HUMAN_OVERVIEW');
  });
  it('safety flags can never turn INELIGIBLE into ELIGIBLE', () => {
    expect(decide([ev('EXC-005', 'FAIL')], []).decision).toBe('INELIGIBLE');
  });
  it('confidence formula is deterministic', () => {
    const { confidence, breakdown } = calculateConfidence([ev('INC-001', 'PASS', 1), ev('INC-002', 'PASS', 0.9)], [flag('WARNING')]);
    expect(breakdown.criterionMean).toBe(0.95);
    expect(breakdown.safetyPenalty).toBe(0.02);
    expect(confidence).toBe(0.93);
  });
});
