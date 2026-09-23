import { describe, expect, it } from 'vitest';
import { mockExtractProtocol, parseCriterionText, ProtocolExtractionOutputSchema, SafeAi } from '@trialguard/agents';
import { protocolDoc } from '../helpers';

describe('Protocol Criteria Agent (mock simulator + Safe AI post-flight)', () => {
  const doc = protocolDoc();
  const out = mockExtractProtocol(doc);

  it('extracts 10 inclusion, 8 exclusion and 1 non-binding guidance criterion', () => {
    expect(out.criteria.filter((c) => c.id.startsWith('INC'))).toHaveLength(10);
    expect(out.criteria.filter((c) => c.id.startsWith('EXC'))).toHaveLength(8);
    expect(out.criteria.find((c) => c.id === 'GDN-001')?.mandatory).toBe(false);
  });
  it('eGFR criterion matches the documented contract (field, operator, threshold, unit, provenance)', () => {
    expect(out.criteria.find((c) => c.id === 'INC-004')).toMatchObject({
      id: 'INC-004',
      category: 'inclusion',
      domain: 'laboratory',
      field: 'eGFR',
      operator: '>=',
      value: 60,
      unit: 'mL/min/1.73m2',
      source: { page: 5, section: '5.1 Inclusion Criteria' },
      requiresHumanReview: false,
    });
  });
  it('captures temporal constraints deterministically (washout, duration, look-back, 5 years → 1825 days)', () => {
    expect(out.criteria.find((c) => c.id === 'EXC-005')?.temporal).toEqual({ operator: 'WITHIN_DAYS', days: 30, anchor: 'end' });
    expect(out.criteria.find((c) => c.id === 'INC-002')?.temporal).toEqual({ operator: 'NOT_WITHIN_DAYS', days: 180, anchor: 'onset' });
    expect(out.criteria.find((c) => c.id === 'INC-003')?.lookbackDays).toBe(30);
    expect(out.criteria.find((c) => c.id === 'EXC-008')?.temporal?.days).toBe(1825);
  });
  it('"adequate renal function" → requiresHumanReview, ambiguity 1, NO invented threshold', () => {
    const c = parseCriterionText('INC-011', 'Adequate renal function.', { page: 5, section: '5.1 Inclusion Criteria' });
    expect(c).toMatchObject({ requiresHumanReview: true, ambiguity: 1, value: null });
    expect(c.range).toBeUndefined();
    expect(JSON.stringify(c)).not.toMatch(/\b60\b/);
  });
  it('output passes strict schema; every criterion is grounded verbatim in the protocol', () => {
    expect(ProtocolExtractionOutputSchema.safeParse(out).success).toBe(true);
    expect(new SafeAi().groundCriteria(out.criteria, doc).rejected).toEqual([]);
  });
  it('grounding rejects hallucinated thresholds and invented criteria', () => {
    const safe = new SafeAi();
    const inc4 = out.criteria.find((c) => c.id === 'INC-004')!;
    const invented = { ...inc4, value: 45 };
    const fabricated = { ...inc4, id: 'INC-099', text: 'eGFR greater than or equal to 30 mL/min/1.73m2.', value: 30 };
    const r = safe.groundCriteria([invented, fabricated], doc);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected.map((x) => x.id)).toEqual(['INC-004', 'INC-099']);
  });
  it('strict schema rejects extra fields an LLM might add (e.g. an eligibility verdict)', () => {
    const bad = { criteria: [{ ...out.criteria[0], eligible: true }], notes: [] };
    expect(new SafeAi().parseStructured(JSON.stringify(bad), ProtocolExtractionOutputSchema).ok).toBe(false);
  });
});
