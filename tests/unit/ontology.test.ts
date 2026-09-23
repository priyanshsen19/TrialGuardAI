import { describe, expect, it } from 'vitest';
import { OntologyResolver, lookupByCode } from '../../backend/src/ontology/resolver';
import { convertUnit, normalizeUnit } from '../../backend/src/ontology/units';
import { criterion, fact } from '../helpers';

const r = new OntologyResolver();

describe('ontology resolution', () => {
  it('maps LOINC by code + display with full confidence', () => {
    const f = fact({ category: 'observation', concept: { system: 'LOINC', code: '62238-1', display: 'eGFR (CKD-EPI)' } });
    expect(f.resolution).toMatchObject({ status: 'MAPPED', method: 'code', mappingConfidence: 1 });
    expect(f.resolution.concept?.key).toBe('LOINC:62238-1');
  });
  it('maps by synonym when no code is proposed', () => {
    const f = fact({ category: 'observation', concept: { system: 'UNMAPPED', code: null, display: 'Urine hCG pregnancy test' } });
    expect(f.resolution.status).toBe('MAPPED');
    expect(f.resolution.concept?.key).toBe('LOINC:2106-3');
  });
  it('ICD-10 descendant codes resolve via prefix crosswalk to SNOMED CT (longest prefix wins)', () => {
    expect(lookupByCode('ICD-10', 'E11.9')?.key).toBe('SNOMED:44054006');
    expect(lookupByCode('ICD-10', 'E11.10')?.key).toBe('SNOMED:420422005'); // DKA, not plain T2DM
    expect(lookupByCode('ICD-10', 'C50.9')?.key).toBe('SNOMED:363346000');
  });
  it('drug class membership (prednisone ∈ systemic corticosteroids ATC H02AB)', () => {
    const f = fact({ category: 'medication', concept: { system: 'RXNORM', code: '8640', display: 'Prednisone' } });
    expect(f.resolution.classes).toContain('ATC:H02AB');
  });
  it('code/display disagreement → AMBIGUOUS (never silently guessed)', () => {
    const f = fact({ category: 'observation', concept: { system: 'LOINC', code: '4548-4', display: 'eGFR' } });
    expect(f.resolution.status).toBe('AMBIGUOUS');
    expect(f.resolution.concept).toBeNull();
  });
  it('unknown term → UNMAPPED', () => {
    const f = fact({ category: 'medication', concept: { system: 'UNMAPPED', code: null, display: 'mystery herbal tea' } });
    expect(f.resolution).toMatchObject({ status: 'UNMAPPED', concept: null, mappingConfidence: 0 });
  });
  it('criterion names resolve to canonical keys; unresolvable terms are reported', () => {
    expect(criterion({ id: 'EXC-006', domain: 'medication', field: 'x', operator: 'IN', values: ['GLP-1 receptor agonist', 'insulin'] }).resolution.conceptKeys).toEqual(['ATC:A10BJ', 'ATC:A10A']);
    expect(criterion({ id: 'GDN-001', domain: 'laboratory', field: 'renal function', operator: 'EXISTS' }).resolution.unresolvedTerms).toEqual(['renal function']);
  });
  it('units: normalisation and supported / unsupported conversions', () => {
    expect(normalizeUnit('mL/min/1.73 m²')).toBe('mL/min/1.73m2');
    expect(normalizeUnit('IU/L')).toBe('U/L');
    expect(convertUnit('LOINC:1975-2', 17.1, 'umol/L', 'mg/dL')?.value).toBe(1);
    expect(convertUnit('LOINC:62238-1', 1.2, 'mL/s', 'mL/min/1.73m2')).toBeNull();
    expect(r.version).toMatch(/^tg-local-/);
  });
});
