/**
 * Deterministic terminology resolver (no network, no LLM).
 *
 * Facts: validate the agent-proposed code against the dictionary AND the
 * display text; disagreement ⇒ AMBIGUOUS, no match ⇒ UNMAPPED. Criteria:
 * map concept names to canonical keys; unmapped names are reported, never
 * guessed.
 */
import type { ClinicalFact, Criterion, ResolvedCriterion, ResolvedFact } from '@trialguard/agents';
import { DICTIONARY, ONTOLOGY_VERSION, type OntologyEntry } from './dictionary';
import { normalizeUnit } from './units';

const bySynonym = new Map<string, OntologyEntry>();
for (const e of DICTIONARY) for (const s of e.synonyms) bySynonym.set(norm(s), e);

function norm(s: string): string {
  return s.toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
}

/** Candidate strings for synonym lookup: full text, text without parentheticals, parenthetical contents. */
function candidates(display: string): string[] {
  const full = norm(display);
  const stripped = norm(display.replace(/\([^)]*\)/g, ' '));
  const inner = [...display.matchAll(/\(([^)]*)\)/g)].map((m) => norm(m[1]));
  return [...new Set([full, stripped, ...inner].filter(Boolean))];
}

export function lookupBySynonym(text: string): OntologyEntry | null {
  for (const c of candidates(text)) {
    const hit = bySynonym.get(c);
    if (hit) return hit;
  }
  return null;
}

export function lookupByCode(system: string, code: string): OntologyEntry | null {
  const sys = system.toUpperCase();
  let best: { e: OntologyEntry; len: number } | null = null;
  for (const e of DICTIONARY) {
    if (e.system === sys && e.code === code) return e;
    for (const alt of e.altCodes ?? []) {
      if (alt.system !== sys) continue;
      const matches = alt.prefix ? code === alt.code || code.startsWith(alt.code) : code === alt.code;
      if (matches && (!best || alt.code.length > best.len)) best = { e, len: alt.code.length };
    }
  }
  return best?.e ?? null;
}

export function entryByKey(key: string): OntologyEntry | undefined {
  return DICTIONARY.find((e) => e.key === key);
}

export class OntologyResolver {
  readonly version = ONTOLOGY_VERSION;

  resolveFact(f: ClinicalFact): ResolvedFact {
    const byCode = f.concept.code && f.concept.system !== 'UNMAPPED' ? lookupByCode(f.concept.system, f.concept.code) : null;
    const bySyn = lookupBySynonym(f.concept.display);

    let entry: OntologyEntry | null = null;
    let method: ResolvedFact['resolution']['method'] = 'none';
    let confidence = 0;
    let status: ResolvedFact['resolution']['status'] = 'UNMAPPED';
    let note: string | undefined;

    if (byCode && bySyn && byCode.key !== bySyn.key) {
      status = 'AMBIGUOUS';
      note = `Proposed code ${f.concept.system}:${f.concept.code} (${byCode.display}) disagrees with display text "${f.concept.display}" (${bySyn.display}).`;
    } else if (byCode && bySyn) {
      entry = byCode;
      method = 'code';
      confidence = 1;
      status = 'MAPPED';
    } else if (byCode) {
      entry = byCode;
      method = 'code';
      confidence = 0.95;
      status = 'MAPPED';
      note = 'Mapped by code only; display text not in dictionary.';
    } else if (bySyn) {
      entry = bySyn;
      method = 'synonym';
      confidence = f.concept.code ? 0.9 : 0.98; // an unrecognised proposed code lowers confidence
      status = 'MAPPED';
      if (f.concept.code) note = `Proposed code ${f.concept.system}:${f.concept.code} not recognised; mapped by display text.`;
    } else {
      note = `No terminology mapping for "${f.concept.display}".`;
    }

    return {
      ...f,
      resolution: {
        status,
        concept: entry ? { key: entry.key, system: entry.system, code: entry.code, display: entry.display } : null,
        classes: entry?.classes ?? [],
        mappingConfidence: confidence,
        method,
        ...(note ? { note } : {}),
      },
    };
  }

  resolveFacts(facts: ClinicalFact[]): ResolvedFact[] {
    return facts.map((f) => this.resolveFact(f));
  }

  resolveCriterion(c: Criterion): ResolvedCriterion {
    const names = c.values?.length ? c.values : [c.field];
    const conceptKeys: string[] = [];
    const unresolvedTerms: string[] = [];
    for (const n of names) {
      const e = lookupBySynonym(n);
      if (e) conceptKeys.push(e.key);
      else unresolvedTerms.push(n);
    }
    const primary = conceptKeys[0] ? entryByKey(conceptKeys[0]) : undefined;
    return {
      ...c,
      resolution: {
        conceptKeys,
        unresolvedTerms,
        canonicalUnit: normalizeUnit(c.unit ?? null) ?? primary?.canonicalUnit ?? null,
      },
    };
  }

  resolveCriteria(criteria: Criterion[]): ResolvedCriterion[] {
    return criteria.map((c) => this.resolveCriterion(c));
  }
}
