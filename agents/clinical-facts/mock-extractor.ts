/**
 * Deterministic clinical fact parser. Two roles:
 *   - MOCK MODE: local simulator of the Lyzr Clinical Facts Agent (labelled
 *     provider="mock"; never presented as Lyzr output).
 *   - LIVE MODE: independent reference parser for cross-validation of the
 *     Lyzr agent's output (orchestration/cross-validation.ts).
 *
 * Parses the section-structured synthetic EHR format used in /synthetic-data:
 *   DEMOGRAPHICS · PROBLEM LIST · LABORATORY RESULTS · VITAL SIGNS ·
 *   MEDICATIONS · PROCEDURES · ADMINISTRATIVE · CLINICAL NOTE
 * Vague dates are preserved verbatim with datePrecision="unknown"; conflicting
 * values are emitted as separate facts and never reconciled.
 */
import type { ClinicalFact, ClinicalFactsOutput, Concept, DatePrecision, RedactedDocument } from '../contracts';

/** What a well-read LLM might propose; the backend ontology service validates every code. */
const CODE_HINTS: Record<string, Pick<Concept, 'system' | 'code'>> = {
  'hemoglobin a1c': { system: 'LOINC', code: '4548-4' },
  hba1c: { system: 'LOINC', code: '4548-4' },
  'egfr (ckd-epi)': { system: 'LOINC', code: '62238-1' },
  egfr: { system: 'LOINC', code: '62238-1' },
  'alt (alanine aminotransferase)': { system: 'LOINC', code: '1742-6' },
  alt: { system: 'LOINC', code: '1742-6' },
  'ast (aspartate aminotransferase)': { system: 'LOINC', code: '1920-8' },
  ast: { system: 'LOINC', code: '1920-8' },
  'total bilirubin': { system: 'LOINC', code: '1975-2' },
  bmi: { system: 'LOINC', code: '39156-5' },
  'type 2 diabetes mellitus': { system: 'ICD-10', code: 'E11.9' },
  'essential hypertension': { system: 'ICD-10', code: 'I10' },
  metformin: { system: 'RXNORM', code: '6809' },
  prednisone: { system: 'RXNORM', code: '8640' },
};

const ISO_FULL = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const ISO_YEAR = /^\d{4}$/;

function parseDate(raw: string | undefined): { date: string | null; precision: DatePrecision; text?: string } {
  const s = (raw ?? '').trim();
  if (ISO_FULL.test(s)) return { date: s, precision: 'day' };
  if (ISO_MONTH.test(s)) return { date: s, precision: 'month' };
  if (ISO_YEAR.test(s)) return { date: s, precision: 'year' };
  return { date: null, precision: 'unknown', text: s || undefined };
}

function concept(display: string): Concept {
  const hint = CODE_HINTS[display.toLowerCase()];
  return hint ? { ...hint, display } : { system: 'UNMAPPED', code: null, display };
}

function cells(line: string): string[] {
  return line
    .replace(/^[-*•]\s*/, '')
    .split('|')
    .map((c) => c.trim());
}

type Section = 'DEMOGRAPHICS' | 'PROBLEM LIST' | 'LABORATORY RESULTS' | 'VITAL SIGNS' | 'MEDICATIONS' | 'PROCEDURES' | 'ADMINISTRATIVE' | 'CLINICAL NOTE';
const SECTIONS: Section[] = ['DEMOGRAPHICS', 'PROBLEM LIST', 'LABORATORY RESULTS', 'VITAL SIGNS', 'MEDICATIONS', 'PROCEDURES', 'ADMINISTRATIVE', 'CLINICAL NOTE'];

export function mockExtractFacts(docs: RedactedDocument[]): ClinicalFactsOutput {
  const facts: ClinicalFact[] = [];
  const notes: string[] = [];
  let n = 0;
  const nextId = () => `FACT-${String(++n).padStart(3, '0')}`;

  for (const doc of docs) {
    for (const page of doc.pages) {
      let section: Section | null = null;
      for (const raw of page.text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const heading = SECTIONS.find((s) => line.toUpperCase() === s || line.toUpperCase().startsWith(`${s}:`) && line.length < s.length + 3);
        if (heading) {
          section = heading;
          continue;
        }
        const source = { document: doc.documentName, page: page.page };
        const uncertainMarker = /patient[- ]reported|approximately|unsure|unknown|unclear|\?/i.test(line);

        if (section === 'DEMOGRAPHICS') {
          const sex = /^sex:\s*(female|male)\b/i.exec(line);
          if (sex) {
            facts.push({
              factId: nextId(),
              category: 'demographic',
              concept: { system: 'LOCAL', code: 'sex', display: 'Administrative sex' },
              value: sex[1].toLowerCase() === 'female' ? 'F' : 'M',
              unit: null,
              observedAt: null,
              datePrecision: 'unknown',
              source,
              sourceQuote: line,
              uncertainty: { isUncertain: false },
              extractionConfidence: 0.99,
            });
          }
          continue;
        }

        if (section === 'PROBLEM LIST' && /^[-*•]/.test(line)) {
          const c = cells(line);
          const name = c[0];
          const onsetCell = c.find((x) => /^onset\b/i.test(x));
          const onset = parseDate(onsetCell?.replace(/^onset\s*/i, ''));
          const statusCell = c.find((x) => /^(active|resolved|historical|inactive)$/i.test(x));
          facts.push({
            factId: nextId(),
            category: 'condition',
            concept: concept(name),
            value: true,
            unit: null,
            observedAt: null,
            onsetDate: onset.date,
            status: statusCell ? (/active/i.test(statusCell) ? 'active' : 'resolved') : 'unknown',
            datePrecision: onset.precision,
            ...(onset.text ? { dateText: onset.text } : {}),
            source,
            sourceQuote: line,
            uncertainty: uncertainMarker || onset.precision === 'unknown' ? { isUncertain: true, reason: 'onset date imprecise or patient-reported' } : { isUncertain: false },
            extractionConfidence: onset.precision === 'day' ? 0.98 : 0.8,
          });
          continue;
        }

        if ((section === 'LABORATORY RESULTS' || section === 'VITAL SIGNS') && /^\d{4}-\d{2}-\d{2}\s*\|/.test(line)) {
          const [date, name, valueRaw, unitRaw] = cells(line);
          const num = Number(valueRaw);
          const value: number | string = Number.isFinite(num) && valueRaw !== '' ? num : valueRaw.toLowerCase();
          facts.push({
            factId: nextId(),
            category: 'observation',
            concept: concept(name),
            value,
            unit: unitRaw && unitRaw !== '-' ? unitRaw : null,
            observedAt: date,
            datePrecision: 'day',
            source,
            sourceQuote: line,
            uncertainty: { isUncertain: false },
            extractionConfidence: 0.99,
          });
          continue;
        }

        if (section === 'MEDICATIONS' && /^[-*•]/.test(line)) {
          const c = cells(line);
          const drug = (c[0].match(/^[A-Za-z][A-Za-z0-9 \-/]*?(?=\s+\d|\s*\(|$)/)?.[0] ?? c[0]).trim();
          const startCell = c.find((x) => /^start\b/i.test(x))?.replace(/^start\s*/i, '');
          const endCell = c.find((x) => /^end\b/i.test(x))?.replace(/^end\s*/i, '');
          const start = parseDate(startCell);
          const ongoing = /^(ongoing|current|continuing)$/i.test(endCell ?? '');
          const end = ongoing ? { date: null, precision: 'day' as DatePrecision, text: undefined } : parseDate(endCell);
          const precision: DatePrecision = end.precision === 'unknown' ? 'unknown' : start.precision === 'unknown' && !ongoing ? 'unknown' : end.precision;
          const vague = [start.text && start.precision === 'unknown' ? `start: ${start.text}` : null, end.text ? `end: ${end.text}` : null].filter(Boolean).join('; ');
          facts.push({
            factId: nextId(),
            category: 'medication',
            concept: concept(drug),
            value: c[0],
            unit: null,
            observedAt: null,
            startDate: start.date,
            endDate: end.date,
            status: ongoing ? 'ongoing' : end.date ? 'completed' : 'unknown',
            datePrecision: ongoing ? start.precision : precision,
            ...(vague ? { dateText: vague } : {}),
            source,
            sourceQuote: line,
            uncertainty:
              uncertainMarker || (!ongoing && end.precision === 'unknown')
                ? { isUncertain: true, reason: 'medication dates imprecise and/or patient-reported' }
                : { isUncertain: false },
            extractionConfidence: !ongoing && end.precision === 'unknown' ? 0.6 : 0.97,
          });
          continue;
        }

        if (section === 'PROCEDURES' && /^[-*•]/.test(line)) {
          const c = cells(line);
          const d = parseDate(c[1]);
          facts.push({
            factId: nextId(),
            category: 'procedure',
            concept: concept(c[0]),
            value: true,
            unit: null,
            observedAt: d.date,
            datePrecision: d.precision,
            ...(d.text ? { dateText: d.text } : {}),
            source,
            sourceQuote: line,
            uncertainty: d.precision === 'unknown' ? { isUncertain: true, reason: 'procedure date unknown' } : { isUncertain: false },
            extractionConfidence: d.precision === 'day' ? 0.97 : 0.7,
          });
          continue;
        }

        if (section === 'ADMINISTRATIVE' && /^[-*•]/.test(line)) {
          const c = cells(line);
          const d = parseDate(c[1]);
          facts.push({
            factId: nextId(),
            category: 'administrative',
            concept: { system: 'LOCAL', code: /consent/i.test(c[0]) ? 'informed-consent' : null, display: c[0] },
            value: true,
            unit: null,
            observedAt: d.date,
            datePrecision: d.precision,
            source,
            sourceQuote: line,
            uncertainty: { isUncertain: false },
            extractionConfidence: 0.98,
          });
          continue;
        }
        // CLINICAL NOTE and anything else: narrative is left for the safety agent;
        // the extractor does not infer structured facts from free text.
      }
    }
  }
  const imprecise = facts.filter((f) => f.datePrecision === 'unknown' && f.category === 'medication').length;
  if (imprecise) notes.push(`${imprecise} medication record(s) have imprecise dates; values preserved verbatim, not inferred.`);
  return { facts, notes };
}
