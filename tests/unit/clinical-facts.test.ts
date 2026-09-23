import { describe, expect, it } from 'vitest';
import { ClinicalFactsOutputSchema, mockExtractFacts, SafeAi } from '@trialguard/agents';
import { patientDocs } from '../helpers';

describe('Clinical Facts Agent (mock simulator + grounding)', () => {
  it('extracts labs with value, unit, date and page provenance', () => {
    const out = mockExtractFacts(patientDocs('PAT-001'));
    expect(ClinicalFactsOutputSchema.safeParse(out).success).toBe(true);
    const egfr = out.facts.find((f) => f.concept.display.startsWith('eGFR'))!;
    expect(egfr).toMatchObject({ value: 72, unit: 'mL/min/1.73m2', observedAt: '2026-09-10', source: { document: 'lab-report.pdf', page: 2 }, concept: { system: 'LOINC', code: '62238-1' } });
  });
  it('preserves vague medication dates verbatim instead of inferring them (PAT-003)', () => {
    const med = mockExtractFacts(patientDocs('PAT-003')).facts.find((f) => f.concept.display === 'Prednisone')!;
    expect(med).toMatchObject({ endDate: null, datePrecision: 'unknown', uncertainty: { isUncertain: true } });
    expect(med.dateText).toContain('sometime last month');
  });
  it('keeps conflicting results as separate facts (PAT-004)', () => {
    const egfr = mockExtractFacts(patientDocs('PAT-004')).facts.filter((f) => f.concept.display.startsWith('eGFR'));
    expect(egfr.map((f) => f.value).sort()).toEqual([48, 72]);
  });
  it('does not invent a missing lab (PAT-005 has no HbA1c)', () => {
    expect(mockExtractFacts(patientDocs('PAT-005')).facts.some((f) => /a1c/i.test(f.concept.display))).toBe(false);
  });
  it('never extracts structured facts from narrative text (incl. injected instructions)', () => {
    const out = mockExtractFacts(patientDocs('PAT-002'));
    expect(out.facts.some((f) => /eligible/i.test(JSON.stringify(f)))).toBe(false);
  });
  it('grounding rejects fabricated values and quotes', () => {
    const docs = patientDocs('PAT-001');
    const facts = mockExtractFacts(docs).facts;
    const egfr = facts.find((f) => f.concept.display.startsWith('eGFR'))!;
    const r = new SafeAi().groundFacts([{ ...egfr, value: 95 }, { ...egfr, factId: 'FACT-900', sourceQuote: '2026-09-10 | eGFR (CKD-EPI) | 95 | mL/min/1.73m2', value: 95 }], docs);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });
});
