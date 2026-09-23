/**
 * Deterministic medical-safety / evidence-quality checks. These run before and
 * independently of the Lyzr Safety Validator Agent and cannot be switched off.
 */
import type { CriterionEvaluation, ResolvedCriterion, ResolvedFact, SafetyFlagRecord } from '@trialguard/agents';

export function deterministicSafetyChecks(input: {
  criteria: ResolvedCriterion[];
  facts: ResolvedFact[];
  evaluations: CriterionEvaluation[];
  injectionFindings: number;
  groundingRejections?: number;
}): SafetyFlagRecord[] {
  const flags: SafetyFlagRecord[] = [];
  const factIds = (e: CriterionEvaluation) => e.evidence.map((x) => x.factId).filter((id) => id.startsWith('FACT-'));

  for (const e of input.evaluations) {
    if (!e.mandatory) continue;
    const rr = e.reviewReasons;
    if (rr.includes('CONFLICTING_EVIDENCE')) {
      flags.push({ code: 'CONTRADICTORY_EVIDENCE', severity: 'BLOCKING', source: 'deterministic', description: `${e.criterionId}: ${e.reason}`, factIds: factIds(e), criterionIds: [e.criterionId] });
    }
    if (rr.includes('MISSING_EVIDENCE')) {
      flags.push({ code: 'MISSING_EVIDENCE', severity: 'WARNING', source: 'deterministic', description: `${e.criterionId}: ${e.reason}`, factIds: factIds(e), criterionIds: [e.criterionId] });
    }
    if (rr.includes('STALE_EVIDENCE')) {
      flags.push({ code: 'STALE_EVIDENCE', severity: 'WARNING', source: 'deterministic', description: `${e.criterionId}: ${e.reason}`, factIds: factIds(e), criterionIds: [e.criterionId] });
    }
    if (rr.includes('AMBIGUOUS_DATE')) {
      flags.push({ code: 'AMBIGUOUS_HISTORY', severity: 'WARNING', source: 'deterministic', description: `${e.criterionId}: ${e.reason}`, factIds: factIds(e), criterionIds: [e.criterionId] });
    }
    if (rr.includes('UNRESOLVED_TERMINOLOGY')) {
      flags.push({ code: 'UNRESOLVED_TERMINOLOGY', severity: 'WARNING', source: 'deterministic', description: `${e.criterionId}: ${e.reason}`, factIds: factIds(e), criterionIds: [e.criterionId] });
    }
    if (rr.includes('UNSUPPORTED_UNIT')) {
      flags.push({ code: 'UNSUPPORTED_UNIT', severity: 'WARNING', source: 'deterministic', description: `${e.criterionId}: ${e.reason}`, factIds: factIds(e), criterionIds: [e.criterionId] });
    }
  }

  const ambiguousFacts = input.facts.filter((f) => f.resolution.status === 'AMBIGUOUS');
  if (ambiguousFacts.length) {
    flags.push({
      code: 'UNRESOLVED_TERMINOLOGY',
      severity: 'WARNING',
      source: 'deterministic',
      description: `Terminology conflict for ${ambiguousFacts.length} fact(s): ${ambiguousFacts.map((f) => f.resolution.note).join(' ')}`,
      factIds: ambiguousFacts.map((f) => f.factId),
      criterionIds: [],
    });
  }

  if (input.injectionFindings > 0) {
    flags.push({
      code: 'PROMPT_INJECTION_DETECTED',
      severity: 'BLOCKING',
      source: 'deterministic',
      description: `${input.injectionFindings} prompt-injection pattern(s) found in uploaded documents. Treated strictly as document data; a human must confirm the record before any eligible determination is relied upon.`,
      factIds: [],
      criterionIds: [],
    });
  }

  if (input.groundingRejections && input.groundingRejections > 0) {
    flags.push({
      code: 'UNGROUNDED_EXTRACTION',
      severity: 'WARNING',
      source: 'deterministic',
      description: `${input.groundingRejections} agent-extracted item(s) were rejected because they could not be matched verbatim to the source documents.`,
      factIds: [],
      criterionIds: [],
    });
  }
  return flags;
}
