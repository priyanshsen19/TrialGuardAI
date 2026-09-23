/**
 * Regression test built from a REAL Lyzr response (gpt-4o-mini, temperature 0)
 * captured during live testing. That response had correct numbers but wrong
 * semantics — exactly what grounding alone cannot catch.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ProtocolExtractionOutputSchema,
  SafeAi,
  crossValidateCriteria,
  crossValidateFacts,
  mockExtractFacts,
  mockExtractProtocol,
  normalizeCriterion,
  normalizeFact,
  normalizeList,
  type ClinicalFact,
} from '@trialguard/agents';
import { OntologyResolver } from '../../backend/src/ontology/resolver';
import { decide } from '../../backend/src/rule-engine/decision';
import { evaluateAll } from '../../backend/src/rule-engine/evaluator';
import { ROOT, patientDocs, protocolDoc } from '../helpers';

const fixture = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/live-lyzr-protocol-v1.0.0-gpt-4o-mini.json'), 'utf8'));
const ontology = new OntologyResolver();
const safe = new SafeAi();
const doc = protocolDoc();
const ctx = { screeningDate: '2026-09-23', patientSex: 'F' as const, patientAgeYears: 54 };

const parseLive = () => safe.parseStructured(fixture.responseText, ProtocolExtractionOutputSchema, (j) => normalizeList(j, 'criteria', normalizeCriterion));

describe('live Lyzr protocol response (captured fixture)', () => {
  it('fails strict validation without normalisation (the bug found live)', () => {
    const r = safe.parseStructured(fixture.responseText, ProtocolExtractionOutputSchema);
    expect(r.ok).toBe(false);
  });

  it('passes strict validation after structural normalisation', () => {
    const r = parseLive();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.criteria.length).toBe(18);
  });

  it('trusting the raw LLM semantics would make the ELIGIBLE patient (PAT-001) INELIGIBLE', () => {
    const r = parseLive();
    if (!r.ok) throw new Error('parse failed');
    const criteria = ontology.resolveCriteria(safe.groundCriteria(r.data.criteria, doc).accepted);
    const facts = ontology.resolveFacts(mockExtractFacts(patientDocs('PAT-001')).facts);
    const ev = evaluateAll(criteria, facts, ctx);
    // "metformin for at least 90 days" extracted as WITHIN_DAYS 90 → long-term user fails.
    expect(ev.find((e) => e.criterionId === 'INC-008')?.result).toBe('FAIL');
    expect(decide(ev, []).decision).toBe('INELIGIBLE');
  });

  it('cross-validation catches every semantic error and restores the correct decision', () => {
    const r = parseLive();
    if (!r.ok) throw new Error('parse failed');
    const llm = ontology.resolveCriteria(safe.groundCriteria(r.data.criteria, doc).accepted);
    const reference = ontology.resolveCriteria(mockExtractProtocol(doc).criteria);
    const { criteria, report } = crossValidateCriteria(llm, reference);

    const resolvedIds = report.resolved.map((x) => x.id);
    const why = (id: string) => report.resolved.find((x) => x.id === id)?.disagreements.join(' ') ?? '';
    // inverted duration window
    expect(resolvedIds).toContain('INC-008');
    expect(why('INC-008')).toMatch(/temporal: LLM=WITHIN_DAYS 90d @start vs deterministic=NOT_WITHIN_DAYS 90d @start/);
    // missing minimum-duration window
    expect(why('INC-002')).toMatch(/temporal: LLM=- vs deterministic=NOT_WITHIN_DAYS 180d @onset/);
    // EXISTS instead of "= positive"
    expect(why('EXC-004')).toMatch(/operator: LLM=EXISTS vs deterministic==/);
    // T1DM only, DKA dropped
    expect(why('EXC-001')).toMatch(/concepts/);
    // dropped non-binding ambiguous guidance is recovered
    expect(report.recovered).toContain('GDN-001');

    expect(criteria).toHaveLength(19);
    expect(criteria.every((c) => c.extraction)).toBe(true);

    const facts = ontology.resolveFacts(mockExtractFacts(patientDocs('PAT-001')).facts);
    const ev = evaluateAll(criteria, facts, ctx);
    expect(ev.find((e) => e.criterionId === 'INC-008')?.result).toBe('PASS');
    expect(decide(ev, []).decision).toBe('ELIGIBLE');
  });

  it('LLM-only criteria (not confirmed by the reference) are routed to human review', () => {
    const extra = ontology.resolveCriteria([{ ...mockExtractProtocol(doc).criteria[0], id: 'INC-099', text: 'Something the reference parser never found.' }]);
    const { criteria, report } = crossValidateCriteria(extra, []);
    expect(report.llmOnly).toEqual(['INC-099']);
    expect(criteria[0]).toMatchObject({ requiresHumanReview: true, ambiguity: 1, extraction: { method: 'llm-only' } });
  });

  it('LLM cannot self-certify provenance', () => {
    const n = normalizeCriterion({ id: 'INC-001', extraction: { method: 'cross-validated' } }) as Record<string, unknown>;
    expect(n.extraction).toBeUndefined();
    const f = normalizeFact({ factId: 'FACT-001', extraction: { method: 'cross-validated' } }) as Record<string, unknown>;
    expect(f.extraction).toBeUndefined();
  });
});

describe('fact cross-validation', () => {
  const docs = patientDocs('PAT-002');
  const reference = () => ontology.resolveFacts(mockExtractFacts(docs).facts);

  it('recovers a fact the LLM omitted (e.g. the excluding prednisone course)', () => {
    const ref = reference();
    const llm = ref.filter((f) => f.concept.display !== 'Prednisone');
    const { facts, report } = crossValidateFacts(llm, ref);
    expect(report.recovered.some((q) => q.includes('Prednisone'))).toBe(true);
    expect(facts.find((f) => f.concept.display === 'Prednisone')?.extraction?.method).toBe('deterministic-recovery');
  });

  it('resolves a wrong end date in favour of the verbatim-grounded reference', () => {
    const ref = reference();
    const llm = ref.map((f) => (f.concept.display === 'Prednisone' ? { ...f, endDate: '2026-08-01' } : f));
    const { facts, report } = crossValidateFacts(llm, ref);
    expect(report.resolved[0].disagreements.join()).toMatch(/endDate: LLM=2026-08-01 vs deterministic=2026-09-01/);
    expect(facts.find((f) => f.concept.display === 'Prednisone')?.endDate).toBe('2026-09-01');
  });

  it('keeps LLM-only facts but marks them uncertain with capped confidence', () => {
    const ref = reference();
    const narrative: ClinicalFact = { ...ref[0], factId: 'FACT-099', concept: { system: 'UNMAPPED', code: null, display: 'Oral prednisone taper' }, sourceQuote: 'COPD exacerbation treated in August 2026 with an oral prednisone taper, completed 2026-09-01.', source: { document: 'clinic-note.txt', page: 1 } };
    const { facts, report } = crossValidateFacts([...ref, ...ontology.resolveFacts([narrative])], ref);
    expect(report.llmOnly).toHaveLength(1);
    const f = facts.find((x) => x.extraction?.method === 'llm-only')!;
    expect(f.uncertainty.isUncertain).toBe(true);
    expect(f.extractionConfidence).toBeLessThanOrEqual(0.8);
    expect(facts.map((x) => x.factId)).toEqual(facts.map((_, i) => `FACT-${String(i + 1).padStart(3, '0')}`));
  });
});
