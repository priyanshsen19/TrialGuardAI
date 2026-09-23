/**
 * MOCK MODE ONLY — deterministic local simulator of the Lyzr Safety Validator
 * Agent. Reviews redacted facts, rule-engine results and clinical notes for
 * evidence-quality problems a human reviewer should see. Adds flags only.
 */
import type { CriterionEvaluation, RedactedDocument, ResolvedFact, SafetyFlag, SafetyValidationOutput } from '../contracts';

export interface SafetyAgentInput {
  facts: ResolvedFact[];
  evaluations: CriterionEvaluation[];
  clinicalNotes: RedactedDocument[];
}

export function mockValidateSafety(input: SafetyAgentInput): SafetyValidationOutput {
  const flags: SafetyFlag[] = [];
  const criteriaUsing = (factId: string) =>
    input.evaluations.filter((e) => e.evidence.some((ev) => ev.factId === factId)).map((e) => e.criterionId);

  for (const f of input.facts) {
    if (f.category === 'medication' && f.datePrecision === 'unknown') {
      flags.push({
        code: 'AMBIGUOUS_HISTORY',
        severity: 'WARNING',
        description: `Medication "${f.concept.display}" has an imprecise date ("${f.dateText ?? 'not documented'}"); washout cannot be verified from the record.`,
        factIds: [f.factId],
        criterionIds: criteriaUsing(f.factId),
      });
    } else if (f.uncertainty.isUncertain) {
      flags.push({
        code: 'AMBIGUOUS_HISTORY',
        severity: 'INFO',
        description: `"${f.concept.display}" is marked uncertain (${f.uncertainty.reason ?? 'unspecified'}).`,
        factIds: [f.factId],
        criterionIds: criteriaUsing(f.factId),
      });
    }
  }

  const noteText = input.clinicalNotes.flatMap((d) => d.pages.map((p) => p.text)).join('\n');
  const sentences = noteText.split(/(?<=[.!?])\s+/);
  for (const f of input.facts.filter((x) => x.category === 'medication' && x.status === 'ongoing')) {
    const drug = f.concept.display.toLowerCase();
    const hit = sentences.find((s) => s.toLowerCase().includes(drug) && /\b(stopped|discontinued|held|no longer taking)\b/i.test(s));
    if (hit) {
      flags.push({
        code: 'MEDICATION_INCONSISTENCY',
        severity: 'WARNING',
        description: `Medication list shows "${f.concept.display}" as ongoing, but a clinical note suggests it was stopped or held.`,
        factIds: [f.factId],
        criterionIds: criteriaUsing(f.factId),
      });
    }
  }

  for (const f of input.facts.filter((x) => x.category === 'observation' && typeof x.value === 'number')) {
    const key = f.resolution.concept?.key;
    const v = f.value as number;
    if (key === 'LOINC:62238-1' && v < 45) {
      flags.push({ code: 'POTENTIAL_SAFETY_SIGNAL', severity: 'WARNING', description: `eGFR ${v} ${f.unit ?? ''} on ${f.observedAt} indicates reduced renal function.`, factIds: [f.factId], criterionIds: criteriaUsing(f.factId) });
    }
    if ((key === 'LOINC:1742-6' || key === 'LOINC:1920-8') && v > 120) {
      flags.push({ code: 'POTENTIAL_SAFETY_SIGNAL', severity: 'WARNING', description: `${f.concept.display} ${v} ${f.unit ?? ''} is markedly elevated.`, factIds: [f.factId], criterionIds: criteriaUsing(f.factId) });
    }
  }
  if (/\bsevere hypoglyc/i.test(noteText)) {
    flags.push({ code: 'POTENTIAL_SAFETY_SIGNAL', severity: 'WARNING', description: 'Clinical note mentions severe hypoglycaemia.', factIds: [], criterionIds: [] });
  }

  const summary = flags.length
    ? `${flags.length} evidence-quality or safety observation(s) raised for human awareness. Rule-engine results were not modified.`
    : 'No additional evidence-quality or safety concerns identified. Rule-engine results were not modified.';
  return { flags, summary };
}
