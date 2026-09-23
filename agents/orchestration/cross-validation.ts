/**
 * Deterministic cross-validation ("dual extraction") — the Criteria Validation
 * step of the TrialGuard pipeline.
 *
 * In live mode every protocol criterion and clinical fact is read twice:
 *   1. by the Lyzr agent (LLM), and
 *   2. by an independent deterministic reference parser that is grounded by
 *      construction (it only emits values that literally appear in the text).
 * Both results are ontology-resolved, reduced to a semantic signature
 * (operator, concepts, threshold, unit, time window, anchor, look-back,
 * activity, sex restriction, ambiguity) and compared field by field.
 *
 *   agree                       → accept, provenance "cross-validated"
 *   disagree, reference complete → reference wins, disagreement recorded
 *   present only in reference   → recovered (LLM omission caught)
 *   present only in LLM output  → accepted as single-source, conservatively:
 *                                 criteria → requiresHumanReview;
 *                                 facts    → uncertain, confidence capped
 *
 * This catches the failure mode grounding alone cannot: every number is in the
 * text, but the operator, window direction or anchor is wrong (observed live:
 * "metformin for at least 90 days" extracted as WITHIN_DAYS 90).
 * No extra LLM calls or tokens are used.
 */
import type { ClinicalFact, CrossValidationReport, ExtractionProvenance, ResolvedCriterion, ResolvedFact } from '../contracts';

const SINGLE_SOURCE_FACT_CONFIDENCE = 0.8;

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

function defaultAnchor(domain: string) {
  if (domain === 'medication') return 'end';
  if (domain === 'procedure') return 'observed';
  return 'onset';
}

function criterionSignature(c: ResolvedCriterion): Record<string, string> {
  const ambiguous = c.requiresHumanReview || c.ambiguity === 1;
  if (ambiguous) return { category: c.category, mandatory: String(c.mandatory), ambiguous: 'true' };

  let op: string = c.operator;
  let temporal = c.temporal;
  if ((op === 'WITHIN_DAYS' || op === 'NOT_WITHIN_DAYS') && typeof c.value === 'number') {
    temporal = { operator: op, days: c.value, anchor: defaultAnchor(c.domain) as 'onset' };
    op = 'EXISTS';
  }
  const concepts = [...new Set(c.resolution.conceptKeys)].sort();
  if (op === 'IN' && concepts.length === 1) op = 'EXISTS';
  if (op === 'EXISTS' && concepts.length > 1) op = 'IN';
  const comparison = ['=', '!=', '>', '>=', '<', '<='].includes(op);
  return {
    category: c.category,
    mandatory: String(c.mandatory),
    ambiguous: 'false',
    operator: op,
    concepts: concepts.length ? concepts.join('|') : `UNRESOLVED(${c.resolution.unresolvedTerms.join('|').toLowerCase()})`,
    value: comparison ? (typeof c.value === 'number' ? String(c.value) : String(c.value ?? '').trim().toLowerCase()) : '-',
    range: op === 'BETWEEN' && c.range ? `${c.range.min}..${c.range.max}` : '-',
    unit: comparison || op === 'BETWEEN' ? String(c.resolution.canonicalUnit ?? '-') : '-',
    temporal: temporal ? `${temporal.operator} ${temporal.days}d @${temporal.anchor}` : '-',
    lookbackDays: c.lookbackDays ? String(c.lookbackDays) : '-',
    requireActive: String(!!c.requireActive),
    appliesToSex: c.appliesTo?.sex ?? '-',
  };
}

function diff(llm: Record<string, string>, ref: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(llm), ...Object.keys(ref)]);
  const out: string[] = [];
  for (const k of keys) {
    if ((llm[k] ?? '-') !== (ref[k] ?? '-')) out.push(`${k}: LLM=${llm[k] ?? '-'} vs deterministic=${ref[k] ?? '-'}`);
  }
  return out;
}

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const withProvenance = <T extends object>(x: T, extraction: ExtractionProvenance): T => ({ ...x, extraction });

export function crossValidateCriteria(llm: ResolvedCriterion[], reference: ResolvedCriterion[], llmOutputRejected?: string[]) {
  const byId = new Map(llm.map((c) => [c.id, c]));
  const byText = new Map(llm.map((c) => [normText(c.text), c]));
  const used = new Set<ResolvedCriterion>();
  const report: CrossValidationReport = {
    method: 'dual-extraction',
    llmItems: llm.length,
    deterministicItems: reference.length,
    agreed: [],
    resolved: [],
    recovered: [],
    llmOnly: [],
    ...(llmOutputRejected ? { llmOutputRejected } : {}),
    agreementRate: 0,
  };
  const out: ResolvedCriterion[] = [];

  for (const ref of reference) {
    const candidate = byId.get(ref.id) ?? byText.get(normText(ref.text));
    if (!candidate || used.has(candidate)) {
      report.recovered.push(ref.id);
      out.push(withProvenance(ref, { method: 'deterministic-recovery' }));
      continue;
    }
    used.add(candidate);
    const d = diff(criterionSignature(candidate), criterionSignature(ref));
    if (d.length === 0) {
      report.agreed.push(ref.id);
      out.push(withProvenance({ ...candidate, id: ref.id }, { method: 'cross-validated' }));
    } else {
      report.resolved.push({ id: ref.id, disagreements: d });
      out.push(withProvenance(ref, { method: 'deterministic-resolution', disagreements: d }));
    }
  }

  for (const c of llm) {
    if (used.has(c)) continue;
    report.llmOnly.push(c.id);
    out.push(
      withProvenance(
        { ...c, requiresHumanReview: true, ambiguity: 1 as const, ambiguityReason: 'Single-source extraction (LLM only): not confirmed by the deterministic reference parser.' },
        { method: 'llm-only' },
      ),
    );
  }

  const compared = report.agreed.length + report.resolved.length;
  report.agreementRate = compared ? Math.round((report.agreed.length / compared) * 1000) / 1000 : 0;
  return { criteria: out, report };
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

const normStatus = (s?: string) => (s === 'ongoing' || s === 'active' ? 'active' : s === 'completed' || s === 'resolved' ? 'ended' : 'unknown');
const normUnit = (u: string | null) => (u ? u.replace(/\s+/g, '').toLowerCase() : '-');

function factSignature(f: ResolvedFact): Record<string, string> {
  const sig: Record<string, string> = {
    category: f.category,
    concept: f.resolution.concept?.key ?? `UNMAPPED(${f.concept.display.toLowerCase()})`,
    datePrecision: f.datePrecision,
  };
  if (f.category === 'observation' || f.category === 'demographic') {
    sig.value = typeof f.value === 'number' ? String(f.value) : String(f.value ?? '-').trim().toLowerCase();
    sig.unit = normUnit(f.unit);
  }
  if (f.category === 'observation' || f.category === 'procedure' || f.category === 'administrative') sig.observedAt = f.observedAt ?? '-';
  if (f.category === 'condition') sig.onsetDate = f.onsetDate ?? '-';
  if (f.category === 'medication') {
    sig.startDate = f.startDate ?? '-';
    sig.endDate = f.endDate ?? '-';
    sig.status = normStatus(f.status);
  }
  return sig;
}

const quoteKey = (f: ClinicalFact) => `${f.source.document}#${f.source.page}#${normText(f.sourceQuote)}`;

export function crossValidateFacts(llm: ResolvedFact[], reference: ResolvedFact[], llmOutputRejected?: string[]) {
  const pool = new Map<string, ResolvedFact[]>();
  for (const f of llm) {
    const k = quoteKey(f);
    pool.set(k, [...(pool.get(k) ?? []), f]);
  }
  const report: CrossValidationReport = {
    method: 'dual-extraction',
    llmItems: llm.length,
    deterministicItems: reference.length,
    agreed: [],
    resolved: [],
    recovered: [],
    llmOnly: [],
    ...(llmOutputRejected ? { llmOutputRejected } : {}),
    agreementRate: 0,
  };
  const merged: ResolvedFact[] = [];

  for (const ref of reference) {
    const k = quoteKey(ref);
    const candidates = pool.get(k) ?? [];
    // Prefer the candidate describing the same concept (a line may yield >1 fact).
    const idx = Math.max(0, candidates.findIndex((c) => (c.resolution.concept?.key ?? null) === (ref.resolution.concept?.key ?? null)));
    const candidate = candidates.length ? candidates.splice(idx, 1)[0] : undefined;
    if (!candidate) {
      report.recovered.push(ref.sourceQuote);
      merged.push(withProvenance(ref, { method: 'deterministic-recovery' }));
      continue;
    }
    const d = diff(factSignature(candidate), factSignature(ref));
    if (d.length === 0) {
      report.agreed.push(ref.sourceQuote);
      merged.push(withProvenance({ ...candidate, extractionConfidence: Math.max(candidate.extractionConfidence, ref.extractionConfidence) }, { method: 'cross-validated' }));
    } else {
      report.resolved.push({ id: ref.sourceQuote, disagreements: d });
      merged.push(withProvenance(ref, { method: 'deterministic-resolution', disagreements: d }));
    }
  }

  for (const rest of pool.values()) {
    for (const f of rest) {
      report.llmOnly.push(f.sourceQuote);
      merged.push(
        withProvenance(
          {
            ...f,
            uncertainty: { isUncertain: true, reason: [f.uncertainty.reason, 'single-source extraction (LLM only), not confirmed by the deterministic reference parser'].filter(Boolean).join('; ') },
            extractionConfidence: Math.min(f.extractionConfidence, SINGLE_SOURCE_FACT_CONFIDENCE),
          },
          { method: 'llm-only' },
        ),
      );
    }
  }

  // Stable, sequential ids after merging.
  const facts = merged.map((f, i) => ({ ...f, factId: `FACT-${String(i + 1).padStart(3, '0')}` }));
  const compared = report.agreed.length + report.resolved.length;
  report.agreementRate = compared ? Math.round((report.agreed.length / compared) * 1000) / 1000 : 0;
  return { facts, report };
}
