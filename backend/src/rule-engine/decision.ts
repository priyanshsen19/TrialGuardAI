/**
 * Deterministic decision + confidence calculation.
 *
 *   INELIGIBLE             ⇐ any mandatory criterion FAIL
 *   REQUIRES_HUMAN_OVERVIEW  ⇐ any mandatory UNKNOWN, any BLOCKING safety flag,
 *                            or confidence < 0.90
 *   ELIGIBLE               ⇐ otherwise (all mandatory PASS / NOT_APPLICABLE)
 *
 * confidence = mean(criterion confidence over mandatory criteria; UNKNOWN = 0)
 *              − 0.02 × WARNING flags − 0.05 × BLOCKING flags   (penalty ≤ 0.20)
 */
import type { CriterionEvaluation, DecisionOutcome, SafetyFlagRecord } from '@trialguard/agents';

export const CONFIDENCE_THRESHOLD = 0.9;
export const CONFIDENCE_FORMULA =
  'mean(mandatory criterion confidence; UNKNOWN=0) - (0.02 x WARNING + 0.05 x BLOCKING safety flags, capped at 0.20); criterion confidence = extraction confidence x terminology mapping confidence (absence-of-record = 0.95, not-applicable/derived = 1.0)';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function calculateConfidence(evaluations: CriterionEvaluation[], flags: SafetyFlagRecord[]) {
  const mandatory = evaluations.filter((e) => e.mandatory);
  const criterionMean = mandatory.length ? mandatory.reduce((s, e) => s + (e.result === 'UNKNOWN' ? 0 : e.confidence), 0) / mandatory.length : 0;
  const warnings = flags.filter((f) => f.severity === 'WARNING').length;
  const blocking = flags.filter((f) => f.severity === 'BLOCKING').length;
  const safetyPenalty = Math.min(0.2, 0.02 * warnings + 0.05 * blocking);
  const unknownPenalty = mandatory.length ? mandatory.filter((e) => e.result === 'UNKNOWN').length / mandatory.length : 0;
  return {
    confidence: round4(Math.max(0, Math.min(1, criterionMean - safetyPenalty))),
    breakdown: { criterionMean: round4(criterionMean), safetyPenalty: round4(safetyPenalty), unknownPenalty: round4(unknownPenalty), formula: CONFIDENCE_FORMULA },
  };
}

export function decide(evaluations: CriterionEvaluation[], flags: SafetyFlagRecord[]): DecisionOutcome {
  const { confidence, breakdown } = calculateConfidence(evaluations, flags);
  const mandatory = evaluations.filter((e) => e.mandatory);
  const failed = mandatory.filter((e) => e.result === 'FAIL');
  const unknown = mandatory.filter((e) => e.result === 'UNKNOWN');
  const blocking = flags.filter((f) => f.severity === 'BLOCKING');
  const reasons: string[] = [];

  if (failed.length) {
    for (const f of failed) reasons.push(`${f.criterionId} FAIL — ${f.reason}`);
    for (const u of unknown) reasons.push(`${u.criterionId} UNKNOWN (not required for this outcome) — ${u.reason}`);
    return { decision: 'INELIGIBLE', confidence, reasons, confidenceBreakdown: breakdown };
  }
  for (const u of unknown) reasons.push(`${u.criterionId} UNKNOWN — ${u.reason}`);
  for (const b of blocking) reasons.push(`Blocking safety flag ${b.code}: ${b.description}`);
  if (confidence < CONFIDENCE_THRESHOLD) reasons.push(`Confidence ${(confidence * 100).toFixed(1)}% is below the ${CONFIDENCE_THRESHOLD * 100}% threshold.`);
  if (reasons.length) return { decision: 'REQUIRES_HUMAN_OVERVIEW', confidence, reasons, confidenceBreakdown: breakdown };
  return {
    decision: 'ELIGIBLE',
    confidence,
    reasons: [`All ${mandatory.length} mandatory criteria passed or were not applicable; no blocking safety issues; confidence ${(confidence * 100).toFixed(1)}% ≥ ${CONFIDENCE_THRESHOLD * 100}%.`],
    confidenceBreakdown: breakdown,
  };
}
