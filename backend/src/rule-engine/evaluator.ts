/**
 * Deterministic criterion evaluator.
 *
 * Input : ontology-resolved criteria + ontology-resolved facts + context
 * Output: one CriterionEvaluation per criterion with result, expected/actual
 *         value, operator, human-readable rule expression, reason and evidence.
 *
 * There is no LLM anywhere in this file. Every uncertain situation (missing,
 * stale, conflicting, ambiguous, unmapped, unconvertible) produces UNKNOWN
 * with an explicit review reason instead of a guess.
 */
import type { CriterionEvaluation, EvidenceRef, Operator, ResolvedCriterion, ResolvedFact } from '@trialguard/agents';
import { convertUnit } from '../ontology/units';
import { dateBounds, daysBetween, type Precision } from './dates';
import { applyOperator } from './operators';

export const RULE_ENGINE_VERSION = '1.0.0';

export interface EvalContext {
  screeningDate: string;
  patientSex: 'F' | 'M' | null;
  patientAgeYears: number | null;
}

export type ReviewReason =
  | 'AMBIGUOUS_CRITERION'
  | 'UNRESOLVED_TERMINOLOGY'
  | 'MISSING_EVIDENCE'
  | 'STALE_EVIDENCE'
  | 'CONFLICTING_EVIDENCE'
  | 'AMBIGUOUS_DATE'
  | 'UNSUPPORTED_UNIT'
  | 'UNKNOWN_SEX';

const COMPARISON_OPS: Operator[] = ['=', '!=', '>', '>=', '<', '<=', 'BETWEEN'];
const DOMAIN_TO_CATEGORY: Record<string, ResolvedFact['category'][]> = {
  laboratory: ['observation'],
  vital: ['observation'],
  reproductive: ['observation'],
  diagnosis: ['condition'],
  medication: ['medication'],
  procedure: ['procedure'],
  administrative: ['administrative'],
  demographic: ['demographic'],
};

function fmt(n: unknown): string {
  if (typeof n === 'number') return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
  return String(n);
}

export function describeExpected(c: ResolvedCriterion): string {
  const unit = c.unit ? ` ${c.unit}` : '';
  let core: string;
  switch (c.operator) {
    case 'BETWEEN':
      core = `BETWEEN ${fmt(c.range?.min)} AND ${fmt(c.range?.max)}${unit} (inclusive)`;
      break;
    case 'IN':
    case 'NOT_IN':
      core = `${c.operator} [${(c.values ?? []).join(', ')}]`;
      break;
    case 'EXISTS':
    case 'NOT_EXISTS':
      core = `${c.operator} ${c.field}`;
      break;
    default:
      core = `${c.operator} ${fmt(c.value)}${unit}`;
  }
  if (c.temporal) core += ` ${c.temporal.operator} ${c.temporal.days} days (anchor: ${c.temporal.anchor} date)`;
  if (c.lookbackDays) core += `; evidence within ${c.lookbackDays} days before screening`;
  if (c.requireActive) core += '; must be active at screening';
  if (c.category === 'exclusion') core = `exclusion condition: ${core}`;
  return core;
}

function evidenceOf(f: ResolvedFact, normalized?: { value: unknown; unit: string | null }): EvidenceRef {
  return {
    factId: f.factId,
    display: f.resolution.concept ? `${f.concept.display} [${f.resolution.concept.system} ${f.resolution.concept.code}]` : `${f.concept.display} [UNMAPPED]`,
    value: f.value,
    unit: f.unit,
    ...(normalized ? { normalizedValue: normalized.value as number, normalizedUnit: normalized.unit } : {}),
    observedAt: f.observedAt ?? f.endDate ?? f.startDate ?? f.onsetDate ?? null,
    sourceDocument: f.source.document,
    page: f.source.page,
    quote: f.sourceQuote,
  };
}

function factConfidence(f: ResolvedFact): number {
  return Math.round(f.extractionConfidence * (f.resolution.mappingConfidence || 0) * 1000) / 1000;
}

function matches(f: ResolvedFact, keys: string[]): boolean {
  const k = f.resolution.concept?.key;
  return (!!k && keys.includes(k)) || f.resolution.classes.some((c) => keys.includes(c));
}

function anchorDate(f: ResolvedFact, anchor: 'onset' | 'start' | 'end' | 'observed'): string | null | undefined {
  if (anchor === 'onset') return f.onsetDate ?? f.observedAt;
  if (anchor === 'start') return f.startDate;
  if (anchor === 'end') return f.endDate;
  return f.observedAt;
}

function isActive(f: ResolvedFact, screeningDate: string): boolean | null {
  if (f.status === 'ongoing' || f.status === 'active') return f.endDate ? daysBetween(f.endDate, screeningDate) <= 0 : true;
  if (f.endDate && f.datePrecision === 'day') return daysBetween(f.endDate, screeningDate) <= 0;
  if (f.status === 'completed' || f.status === 'resolved') return false;
  return null;
}

type Tri = { outcome: boolean | null; delta: [number, number] | null; date: string | null };

/** Evaluate a temporal window on one fact using the full range of its date precision. */
function temporalOutcome(f: ResolvedFact, c: ResolvedCriterion, ref: string): Tri {
  const t = c.temporal!;
  // Ongoing therapy has no end date: exposure continues through screening (Δ = 0).
  if (t.anchor === 'end' && !f.endDate && (f.status === 'ongoing' || f.status === 'active')) {
    return { outcome: applyOperator(t.operator, ref, { days: t.days, referenceDate: ref }), delta: [0, 0], date: ref };
  }
  const raw = anchorDate(f, t.anchor);
  const precision = (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? 'day' : f.datePrecision) as Precision;
  const bounds = dateBounds(raw ?? null, raw ? precision : 'unknown');
  if (!bounds) return { outcome: null, delta: null, date: raw ?? null };
  const [early, late] = bounds;
  const a = applyOperator(t.operator, early, { days: t.days, referenceDate: ref });
  const b = applyOperator(t.operator, late, { days: t.days, referenceDate: ref });
  const delta: [number, number] = [daysBetween(late, ref), daysBetween(early, ref)];
  return { outcome: a !== null && a === b ? a : null, delta, date: raw ?? null };
}

function finalize(
  c: ResolvedCriterion,
  partial: Omit<CriterionEvaluation, 'criterionId' | 'category' | 'mandatory' | 'requirement' | 'operator' | 'expectedValue' | 'source' | 'result'> & {
    conditionMet: boolean | null;
    forced?: 'NOT_APPLICABLE';
  },
): CriterionEvaluation {
  let result: CriterionEvaluation['result'];
  if (partial.forced) result = partial.forced;
  else if (partial.conditionMet === null) result = 'UNKNOWN';
  else if (c.category === 'inclusion') result = partial.conditionMet ? 'PASS' : 'FAIL';
  else result = partial.conditionMet ? 'FAIL' : 'PASS';
  const { forced: _forced, ...rest } = partial;
  return {
    criterionId: c.id,
    category: c.category,
    mandatory: c.mandatory,
    requirement: c.text,
    operator: c.operator,
    expectedValue: describeExpected(c),
    source: c.source,
    result,
    ...rest,
    confidence: result === 'UNKNOWN' ? 0 : rest.confidence,
  };
}

export function evaluateCriterion(c: ResolvedCriterion, facts: ResolvedFact[], ctx: EvalContext): CriterionEvaluation {
  const unknown = (reason: string, reviewReasons: ReviewReason[], evidence: EvidenceRef[] = [], actualValue: string | null = null, ruleExpression = 'not evaluable') =>
    finalize(c, { conditionMet: null, actualValue, ruleExpression, reason, reviewReasons, evidence, confidence: 0 });

  // 1. Ambiguous protocol language is never machine-evaluated.
  if (c.requiresHumanReview || c.ambiguity === 1) {
    return unknown(`Protocol criterion is qualitative/ambiguous (${c.ambiguityReason ?? 'no explicit threshold'}); no threshold was inferred.`, ['AMBIGUOUS_CRITERION'], [], null, 'ambiguous protocol language → requires human judgement (no threshold inferred)');
  }

  // 2. Sex-restricted criteria.
  if (c.appliesTo?.sex) {
    if (!ctx.patientSex) return unknown('Criterion applies to one sex only and patient sex is not documented.', ['UNKNOWN_SEX']);
    if (ctx.patientSex !== c.appliesTo.sex) {
      return finalize(c, {
        conditionMet: null,
        forced: 'NOT_APPLICABLE',
        actualValue: `sex = ${ctx.patientSex}`,
        ruleExpression: `sex ${ctx.patientSex} ≠ ${c.appliesTo.sex} → not applicable`,
        reason: `Criterion applies only to sex ${c.appliesTo.sex}.`,
        reviewReasons: [],
        evidence: [],
        confidence: 1,
      });
    }
  }

  // 3. Age: derived deterministically from the encrypted DOB (never sent to an LLM).
  if (c.domain === 'demographic' && c.resolution.conceptKeys.includes('LOCAL:age')) {
    if (ctx.patientAgeYears === null) return unknown('Date of birth unavailable; age cannot be computed.', ['MISSING_EVIDENCE']);
    const expected = c.operator === 'BETWEEN' ? c.range : c.value;
    const met = applyOperator(c.operator, ctx.patientAgeYears, expected);
    const ev: EvidenceRef = {
      factId: 'DERIVED-AGE',
      display: 'Age at screening [derived from encrypted DOB in PHI vault]',
      value: ctx.patientAgeYears,
      unit: 'years',
      observedAt: ctx.screeningDate,
      sourceDocument: 'PHI vault (demographics)',
      page: 1,
      quote: `age computed deterministically on ${ctx.screeningDate}`,
    };
    const expr = c.operator === 'BETWEEN' ? `${ctx.patientAgeYears} BETWEEN ${fmt(c.range?.min)} AND ${fmt(c.range?.max)}` : `${ctx.patientAgeYears} ${c.operator} ${fmt(c.value)}`;
    return finalize(c, {
      conditionMet: met,
      actualValue: `${ctx.patientAgeYears} years`,
      ruleExpression: `${expr} → ${met}`,
      reason: met === null ? 'Age comparison could not be evaluated.' : `Age ${ctx.patientAgeYears} ${met ? 'satisfies' : 'does not satisfy'} ${describeExpected(c)}.`,
      reviewReasons: met === null ? ['MISSING_EVIDENCE'] : [],
      evidence: [ev],
      confidence: 1,
    });
  }

  // 4. Terminology must resolve.
  if (c.resolution.conceptKeys.length === 0 || c.resolution.unresolvedTerms.length > 0) {
    return unknown(`Criterion concept(s) could not be mapped to a terminology: ${c.resolution.unresolvedTerms.join(', ') || c.field}.`, ['UNRESOLVED_TERMINOLOGY']);
  }

  const categories = DOMAIN_TO_CATEGORY[c.domain] ?? [];
  const domainFacts = facts.filter((f) => categories.includes(f.category));
  const candidates = domainFacts.filter((f) => f.resolution.status === 'MAPPED' && matches(f, c.resolution.conceptKeys));
  const unmappedInDomain = domainFacts.filter((f) => f.resolution.status !== 'MAPPED');

  const isComparison = COMPARISON_OPS.includes(c.operator) && ['laboratory', 'vital', 'reproductive'].includes(c.domain);
  if (isComparison) return evaluateMeasurement(c, candidates, unmappedInDomain, ctx, unknown);
  return evaluatePresence(c, candidates, unmappedInDomain, ctx, unknown);
}

type UnknownFn = (reason: string, reviewReasons: ReviewReason[], evidence?: EvidenceRef[], actualValue?: string | null, ruleExpression?: string) => CriterionEvaluation;

function evaluateMeasurement(c: ResolvedCriterion, candidates: ResolvedFact[], unmapped: ResolvedFact[], ctx: EvalContext, unknown: UnknownFn): CriterionEvaluation {
  const ref = ctx.screeningDate;
  if (candidates.length === 0) {
    const why = unmapped.length ? ` ${unmapped.length} unmapped observation(s) in the record could be relevant.` : '';
    return unknown(`No ${c.field} result found in the patient record.${why}`, unmapped.length ? ['MISSING_EVIDENCE', 'UNRESOLVED_TERMINOLOGY'] : ['MISSING_EVIDENCE'], unmapped.map((f) => evidenceOf(f)), 'no result', `${c.field}: no result in record → cannot evaluate ${describeExpected(c)}`);
  }
  const dated = candidates.filter((f) => f.observedAt && /^\d{4}-\d{2}-\d{2}$/.test(f.observedAt) && daysBetween(f.observedAt, ref) >= 0);
  if (dated.length === 0) return unknown(`${c.field} result(s) have no usable observation date on or before screening.`, ['AMBIGUOUS_DATE'], candidates.map((f) => evidenceOf(f)));
  const fresh = c.lookbackDays ? dated.filter((f) => applyOperator('WITHIN_DAYS', f.observedAt, { days: c.lookbackDays!, referenceDate: ref }) === true) : dated;
  if (fresh.length === 0) {
    const newest = [...dated].sort((a, b) => (a.observedAt! < b.observedAt! ? 1 : -1))[0];
    return unknown(
      `Most recent ${c.field} (${newest.observedAt}, ${daysBetween(newest.observedAt!, ref)} days before screening) is outside the ${c.lookbackDays}-day window.`,
      ['STALE_EVIDENCE'],
      dated.map((f) => evidenceOf(f)),
      `${fmt(newest.value)} ${newest.unit ?? ''} (${newest.observedAt})`.trim(),
    );
  }

  const expected = c.operator === 'BETWEEN' ? c.range : c.value;
  const targetUnit = c.unit ?? c.resolution.canonicalUnit;
  const evaluated: Array<{ f: ResolvedFact; value: unknown; unit: string | null; outcome: boolean | null }> = [];
  for (const f of fresh) {
    if (typeof f.value === 'number') {
      const conv = convertUnit(f.resolution.concept?.key ?? null, f.value, f.unit, c.unit ?? null);
      if (!conv) {
        evaluated.push({ f, value: f.value, unit: f.unit, outcome: null });
        continue;
      }
      evaluated.push({ f, value: conv.value, unit: conv.unit ?? targetUnit, outcome: applyOperator(c.operator, conv.value, expected) });
    } else {
      evaluated.push({ f, value: f.value, unit: f.unit, outcome: applyOperator(c.operator, f.value, expected) });
    }
  }
  const unconvertible = evaluated.filter((e) => e.outcome === null && typeof e.f.value === 'number');
  if (unconvertible.length === evaluated.length) {
    return unknown(
      `Unit conversion from "${unconvertible[0].f.unit}" to "${c.unit}" is not supported for ${c.field}.`,
      ['UNSUPPORTED_UNIT'],
      evaluated.map((e) => evidenceOf(e.f)),
      evaluated.map((e) => `${fmt(e.f.value)} ${e.f.unit ?? ''}`.trim()).join('; '),
    );
  }
  const decisive = evaluated.filter((e) => e.outcome !== null);
  const outcomes = new Set(decisive.map((e) => e.outcome));
  const evidence = evaluated.map((e) => evidenceOf(e.f, { value: e.value, unit: e.unit }));
  const exprOf = (e: (typeof evaluated)[number]) =>
    c.operator === 'BETWEEN' ? `${fmt(e.value)} BETWEEN ${fmt(c.range?.min)} AND ${fmt(c.range?.max)}` : `${fmt(e.value)} ${c.operator} ${fmt(c.value)}`;

  if (outcomes.size > 1) {
    return unknown(
      `Conflicting ${c.field} results within the evidence window lead to different outcomes: ${decisive.map((e) => `${fmt(e.value)} ${e.unit ?? ''} on ${e.f.observedAt} (${e.f.source.document} p.${e.f.source.page})`).join(' vs ')}.`,
      ['CONFLICTING_EVIDENCE'],
      evidence,
      decisive.map((e) => `${fmt(e.value)} ${e.unit ?? ''}`.trim()).join(' vs '),
      decisive.map((e) => `${exprOf(e)} → ${e.outcome}`).join(' | '),
    );
  }
  const latest = [...decisive].sort((a, b) => (a.f.observedAt! < b.f.observedAt! ? 1 : -1))[0];
  const met = latest.outcome as boolean;
  return finalize(c, {
    conditionMet: met,
    actualValue: `${fmt(latest.value)} ${latest.unit ?? ''} (${latest.f.observedAt})`.replace(/\s+\(/, ' (').trim(),
    ruleExpression: `${exprOf(latest)} → ${met}`,
    reason: `${c.field} ${fmt(latest.value)}${latest.unit ? ' ' + latest.unit : ''} on ${latest.f.observedAt} ${met ? 'satisfies' : 'does not satisfy'} ${c.operator === 'BETWEEN' ? `${fmt(c.range?.min)}–${fmt(c.range?.max)}` : `${c.operator} ${fmt(c.value)}`}${c.unit ? ' ' + c.unit : ''}.${decisive.length > 1 ? ` ${decisive.length} consistent results in window.` : ''}`,
    reviewReasons: [],
    evidence,
    confidence: Math.min(...decisive.map((e) => factConfidence(e.f))),
  });
}

function evaluatePresence(c: ResolvedCriterion, candidates: ResolvedFact[], unmapped: ResolvedFact[], ctx: EvalContext, unknown: UnknownFn): CriterionEvaluation {
  const ref = ctx.screeningDate;
  // WITHIN_DAYS / NOT_WITHIN_DAYS used as primary operators are normalised to EXISTS + temporal.
  let crit = c;
  if ((c.operator === 'WITHIN_DAYS' || c.operator === 'NOT_WITHIN_DAYS') && typeof c.value === 'number') {
    crit = { ...c, operator: 'EXISTS', temporal: { operator: c.operator, days: c.value, anchor: c.domain === 'medication' ? 'end' : c.domain === 'procedure' ? 'observed' : 'onset' } };
  }
  const negate = crit.operator === 'NOT_EXISTS' || crit.operator === 'NOT_IN';

  let pool = candidates;
  const activity = crit.requireActive ? pool.map((f) => ({ f, active: isActive(f, ref) })) : [];
  if (crit.requireActive) pool = activity.filter((a) => a.active === true).map((a) => a.f);
  const activityUnknown = activity.filter((a) => a.active === null).map((a) => a.f);

  const results = pool.map((f) => ({ f, t: crit.temporal ? temporalOutcome(f, crit, ref) : ({ outcome: true, delta: null, date: null } as Tri) }));
  const hits = results.filter((r) => r.t.outcome === true);
  const ambiguous = results.filter((r) => r.t.outcome === null);

  const label = crit.values?.length ? crit.values.join(' / ') : crit.field;
  const tDesc = crit.temporal ? ` ${crit.temporal.operator} ${crit.temporal.days} days` : '';
  const describe = (r: (typeof results)[number]) => {
    if (!crit.temporal) return `${r.f.concept.display} documented`;
    const d = r.t.delta;
    if (!d) {
      const anchor = crit.temporal.anchor;
      const part = r.f.dateText?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${anchor}:`));
      const shownText = part ? part.slice(anchor.length + 1).trim() : (r.f.dateText ?? 'not documented');
      return `${r.f.concept.display}: ${anchor} date "${shownText}" → days_since not computable`;
    }
    const days = d[0] === d[1] ? `${d[0]}` : `${d[0]}–${d[1]}`;
    const shown = r.t.date === ref && !anchorDate(r.f, crit.temporal.anchor) ? 'ongoing' : r.t.date;
    return `${r.f.concept.display}: ${crit.temporal.anchor}=${shown} → days_since=${days}; ${crit.temporal.operator} ${crit.temporal.days} → ${r.t.outcome}`;
  };

  let conditionMet: boolean | null;
  let reason: string;
  const reviewReasons: ReviewReason[] = [];
  let confidence: number;
  let evidenceFacts: ResolvedFact[];

  if (hits.length > 0) {
    conditionMet = true;
    evidenceFacts = hits.map((h) => h.f);
    confidence = Math.max(...hits.map((h) => factConfidence(h.f)));
    reason = `Matching record found: ${hits.map(describe).join('; ')}.`;
  } else if (ambiguous.length > 0 || activityUnknown.length > 0) {
    conditionMet = null;
    evidenceFacts = [...ambiguous.map((a) => a.f), ...activityUnknown];
    reviewReasons.push('AMBIGUOUS_DATE');
    reason = `Cannot determine whether ${label}${tDesc} applies: ${[...ambiguous.map(describe), ...activityUnknown.map((f) => `${f.concept.display}: activity status unknown`)].join('; ')}.`;
    confidence = 0;
  } else if (unmapped.length > 0 && c.category === 'exclusion') {
    // An unmapped record in the same domain could be the excluded concept — do not assume absence.
    conditionMet = null;
    evidenceFacts = unmapped;
    reviewReasons.push('UNRESOLVED_TERMINOLOGY');
    reason = `No mapped record of ${label}, but ${unmapped.length} unmapped ${c.domain} record(s) (${unmapped.map((f) => `"${f.concept.display}"`).join(', ')}) cannot be ruled out.`;
    confidence = 0;
  } else if (results.length > 0) {
    conditionMet = false;
    evidenceFacts = results.map((r) => r.f);
    confidence = Math.min(...results.map((r) => factConfidence(r.f)));
    reason = `Matching record(s) exist but do not satisfy the rule: ${results.map(describe).join('; ')}.`;
  } else if (c.category === 'inclusion' && !negate) {
    // Absence of a required positive finding is missing evidence, not a failure.
    conditionMet = null;
    evidenceFacts = candidates;
    reviewReasons.push('MISSING_EVIDENCE');
    reason = `No documented evidence of ${label}${crit.requireActive ? ' (active at screening)' : ''} found in the patient record.`;
    confidence = 0;
  } else {
    conditionMet = false;
    evidenceFacts = [];
    confidence = 0.95; // negative evidence: complete record reviewed, nothing matched
    reason = `No record of ${label}${tDesc} found in the patient record.`;
  }

  if (conditionMet !== null && negate) conditionMet = !conditionMet;

  const actualValue =
    hits.length > 0
      ? hits.map(describe).join('; ')
      : ambiguous.length > 0
        ? ambiguous.map(describe).join('; ')
        : results.length > 0
          ? results.map(describe).join('; ')
          : 'no matching record';

  const ruleExpression = crit.temporal
    ? results.length
      ? results.map(describe).join(' | ')
      : `${crit.operator} ${label}${tDesc} → no matching record`
    : `${crit.operator} ${label} → ${conditionMet === null ? 'undetermined' : negate ? !conditionMet : conditionMet}`;

  if (conditionMet === null) return unknown(reason, reviewReasons, evidenceFacts.map((f) => evidenceOf(f)), actualValue, ruleExpression);
  return finalize(c, { conditionMet, actualValue, ruleExpression, reason, reviewReasons, evidence: evidenceFacts.map((f) => evidenceOf(f)), confidence });
}

export function evaluateAll(criteria: ResolvedCriterion[], facts: ResolvedFact[], ctx: EvalContext): CriterionEvaluation[] {
  return criteria.map((c) => evaluateCriterion(c, facts, ctx));
}
