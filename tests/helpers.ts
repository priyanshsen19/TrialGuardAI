import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClinicalFact, Criterion, RedactedDocument, ResolvedCriterion, ResolvedFact } from '@trialguard/agents';
import { OntologyResolver } from '../backend/src/ontology/resolver';

export const ROOT = resolve(__dirname, '..');
export const dbTestsEnabled = process.env.SKIP_DB_TESTS !== '1';

export function protocolDoc(): RedactedDocument {
  const txt = readFileSync(resolve(ROOT, 'synthetic-data/protocols/CT-2026-001.txt'), 'utf8');
  const parts = txt.split(/^=== PAGE (\d+) ===$/m).slice(1);
  const pages = [];
  for (let i = 0; i < parts.length; i += 2) pages.push({ page: Number(parts[i]), text: parts[i + 1] });
  return { documentName: 'CT-2026-001.txt', pages };
}

export function patientJson(ref: string) {
  return JSON.parse(readFileSync(resolve(ROOT, `synthetic-data/patients/${ref}.json`), 'utf8'));
}

export function patientDocs(ref: string): RedactedDocument[] {
  return patientJson(ref).documents.map((d: { name: string; pages: string[] }) => ({ documentName: d.name, pages: d.pages.map((t, i) => ({ page: i + 1, text: t })) }));
}

const resolver = new OntologyResolver();

let factSeq = 0;
/** Build a resolved fact for rule-engine tests. */
export function fact(partial: Partial<ClinicalFact> & Pick<ClinicalFact, 'category' | 'concept'>): ResolvedFact {
  const f: ClinicalFact = {
    factId: `FACT-${String(++factSeq).padStart(3, '0')}`,
    value: null,
    unit: null,
    observedAt: null,
    datePrecision: 'day',
    source: { document: 'test.txt', page: 1 },
    sourceQuote: 'test',
    uncertainty: { isUncertain: false },
    extractionConfidence: 0.99,
    ...partial,
  };
  return resolver.resolveFact(f);
}

export function criterion(partial: Partial<Criterion> & Pick<Criterion, 'id' | 'domain' | 'field' | 'operator'>): ResolvedCriterion {
  const c: Criterion = {
    category: partial.id.startsWith('EXC') ? 'exclusion' : 'inclusion',
    mandatory: true,
    text: 'test criterion',
    source: { page: 1, section: '5.1 Inclusion Criteria' },
    requiresHumanReview: false,
    ambiguity: 0,
    ...partial,
  };
  return resolver.resolveCriterion(c);
}

export const ctx = { screeningDate: '2026-09-23', patientSex: 'M' as const, patientAgeYears: 50 };
