/**
 * Deterministic protocol criteria parser. Two roles:
 *   - MOCK MODE: local simulator of the Lyzr Protocol Criteria Agent (always
 *     labelled provider="mock"; never presented as Lyzr output).
 *   - LIVE MODE: independent reference parser for cross-validation of the
 *     Lyzr agent's output (orchestration/cross-validation.ts).
 *
 * It parses protocol criteria using a transparent phrase grammar so that demo
 * mode works offline and behaves like a well-instructed LLM would:
 *   - numbered INC-/EXC-/GDN- criteria are extracted with page + section
 *   - explicit thresholds, units and time windows are captured verbatim
 *   - qualitative language ("adequate renal function") is NEVER converted into
 *     a threshold — it is returned with requiresHumanReview=true, ambiguity=1
 *   - text outside criteria sections (including injected instructions) is ignored
 */
import type { Criterion, CriterionDomain, ProtocolExtractionOutput, RedactedDocument, TemporalConstraint } from '../contracts';

interface LexEntry {
  re: RegExp;
  field: string;
  domain: CriterionDomain;
}

const LEXICON: LexEntry[] = [
  { re: /\baged?\b[^.]*\byears\b/, field: 'age', domain: 'demographic' },
  { re: /type 1 diabetes/, field: 'type 1 diabetes mellitus', domain: 'diagnosis' },
  { re: /diabetic ketoacidosis/, field: 'diabetic ketoacidosis', domain: 'diagnosis' },
  { re: /type 2 diabetes/, field: 'type 2 diabetes mellitus', domain: 'diagnosis' },
  { re: /\bhba1c\b|hemoglobin a1c/, field: 'HbA1c', domain: 'laboratory' },
  { re: /\begfr\b|glomerular filtration/, field: 'eGFR', domain: 'laboratory' },
  { re: /\balt\b|alanine aminotransferase/, field: 'ALT', domain: 'laboratory' },
  { re: /\bast\b|aspartate aminotransferase/, field: 'AST', domain: 'laboratory' },
  { re: /bilirubin/, field: 'total bilirubin', domain: 'laboratory' },
  { re: /\bbmi\b|body mass index/, field: 'BMI', domain: 'vital' },
  { re: /metformin/, field: 'metformin', domain: 'medication' },
  { re: /informed consent/, field: 'informed consent', domain: 'administrative' },
  { re: /myocardial infarction/, field: 'myocardial infarction', domain: 'diagnosis' },
  { re: /\bstroke\b/, field: 'stroke', domain: 'diagnosis' },
  { re: /hospitali[sz]ation for heart failure|heart failure hospitali[sz]ation/, field: 'heart failure hospitalization', domain: 'diagnosis' },
  { re: /major surgery/, field: 'major surgery', domain: 'procedure' },
  { re: /percutaneous coronary intervention/, field: 'percutaneous coronary intervention', domain: 'procedure' },
  { re: /pregnancy test/, field: 'pregnancy test', domain: 'reproductive' },
  { re: /corticosteroid/, field: 'systemic corticosteroid', domain: 'medication' },
  { re: /glp-1 receptor agonist/, field: 'GLP-1 receptor agonist', domain: 'medication' },
  { re: /\binsulin\b/, field: 'insulin', domain: 'medication' },
  { re: /pancreatitis/, field: 'pancreatitis', domain: 'diagnosis' },
  { re: /malignan|\bcancer\b/, field: 'malignancy', domain: 'diagnosis' },
  { re: /renal function/, field: 'renal function', domain: 'laboratory' },
  { re: /hepatic (?:function|disease)/, field: 'hepatic function', domain: 'laboratory' },
];

const UNIT_RE = '(%|mL/min/1\\.73\\s?m2|U/L|mg/dL|kg/m2|mmol/mol|years)';
const NUM = '(\\d+(?:\\.\\d+)?)';
const VAGUE_RE = /\b(adequate|clinically significant|in the opinion of|at the discretion|as judged by|sufficient|appropriate|acceptable)\b/;

const CRITERION_START = /^\s*((?:INC|EXC|GDN)-\d{3})[.:)]\s*(.*)$/;
const SECTION_RE = /^\s*(\d+(?:\.\d+)*)\s+(.*(?:criteria|guidance).*)$/i;

function toDays(n: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('week')) return n * 7;
  if (u.startsWith('month')) return n * 30;
  if (u.startsWith('year')) return n * 365;
  return n;
}

function defaultAnchor(domain: CriterionDomain): TemporalConstraint['anchor'] {
  if (domain === 'medication') return 'end';
  if (domain === 'procedure') return 'observed';
  if (domain === 'diagnosis') return 'onset';
  return 'observed';
}

export function parseCriterionText(
  id: string,
  text: string,
  source: { page: number; section: string },
): Criterion {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const category: Criterion['category'] = id.startsWith('EXC') ? 'exclusion' : 'inclusion';
  const mandatory = !id.startsWith('GDN') && !/non-binding/i.test(source.section);

  const matches = LEXICON.filter((l) => l.re.test(t));
  const primary = matches[0];
  const sameDomain = primary ? matches.filter((m) => m.domain === primary.domain) : [];

  const base: Criterion = {
    id,
    category,
    domain: primary?.domain ?? 'administrative',
    field: primary?.field ?? 'unspecified',
    operator: 'EXISTS',
    value: null,
    unit: null,
    mandatory,
    text: text.replace(/\s+/g, ' ').trim(),
    source,
    requiresHumanReview: false,
    ambiguity: 0,
  };

  const ambiguous = (reason: string): Criterion => ({
    ...base,
    operator: 'EXISTS',
    value: null,
    requiresHumanReview: true,
    ambiguity: 1,
    ambiguityReason: reason,
  });

  if (!primary) return ambiguous('No recognisable clinical concept or explicit rule could be extracted.');

  // ---- temporal windows --------------------------------------------------
  let temporal: TemporalConstraint | undefined;
  let lookbackDays: number | undefined;
  const within = new RegExp(`within\\s+${NUM}\\s+(days?|weeks?|months?|years?)\\s+prior to screening`).exec(t);
  const atLeast = new RegExp(`(?:for\\s+)?at least\\s+${NUM}\\s+(days?|weeks?|months?|years?)\\s+prior to screening`).exec(t);
  const isMeasurement = primary.domain === 'laboratory' || primary.domain === 'vital';
  if (within) {
    const days = toDays(Number(within[1]), within[2]);
    if (isMeasurement) lookbackDays = days;
    else temporal = { operator: 'WITHIN_DAYS', days, anchor: defaultAnchor(primary.domain) };
  }
  if (atLeast) {
    const days = toDays(Number(atLeast[1]), atLeast[2]);
    temporal = { operator: 'NOT_WITHIN_DAYS', days, anchor: primary.domain === 'medication' ? 'start' : 'onset' };
  }
  const requireActive = primary.domain === 'medication' && /\b(receiving|currently|stable|ongoing)\b/.test(t) ? true : undefined;
  const appliesTo = /female participants only|women of childbearing|females only/.test(t) ? { sex: 'F' as const } : undefined;

  // ---- numeric comparisons ---------------------------------------------
  const ageRange = new RegExp(`aged?\\s+${NUM}\\s+(?:to|-|and)\\s+${NUM}\\s+years`).exec(t);
  const between = new RegExp(`between\\s+${NUM}\\s*${UNIT_RE}?\\s+and\\s+${NUM}\\s*${UNIT_RE}?`, 'i').exec(t);
  const comparators: Array<[RegExp, Criterion['operator']]> = [
    [new RegExp(`(?:greater than or equal to|>=|at least)\\s+${NUM}\\s*${UNIT_RE}?`, 'i'), '>='],
    [new RegExp(`(?:less than or equal to|<=|no more than|at most)\\s+${NUM}\\s*${UNIT_RE}?`, 'i'), '<='],
    [new RegExp(`(?:greater than|more than|above|>)\\s+${NUM}\\s*${UNIT_RE}?`, 'i'), '>'],
    [new RegExp(`(?:less than|below|<)\\s+${NUM}\\s*${UNIT_RE}?`, 'i'), '<'],
  ];

  const unitFix = (u?: string) => (u ? u.replace(/\s/g, '').replace(/ml\/min\/1\.73m2/i, 'mL/min/1.73m2').replace(/^u\/l$/i, 'U/L').replace(/^mg\/dl$/i, 'mg/dL') : null);

  if (primary.field === 'age' && ageRange) {
    return { ...base, operator: 'BETWEEN', range: { min: Number(ageRange[1]), max: Number(ageRange[2]) }, unit: 'years', appliesTo };
  }

  if (isMeasurement) {
    if (between) {
      return {
        ...base,
        operator: 'BETWEEN',
        range: { min: Number(between[1]), max: Number(between[3]) },
        unit: unitFix(between[4] ?? between[2]),
        lookbackDays,
      };
    }
    // Only consider comparator phrases that are NOT part of the time window text.
    const numericPart = t.replace(/(?:for\s+)?at least\s+\d+\s+(?:days?|weeks?|months?|years?)/g, '').replace(/within\s+\d+\s+(?:days?|weeks?|months?|years?)/g, '');
    for (const [re, op] of comparators) {
      const m = re.exec(numericPart);
      if (m) return { ...base, operator: op, value: Number(m[1]), unit: unitFix(m[2]), lookbackDays };
    }
    return ambiguous(
      VAGUE_RE.test(t)
        ? 'Qualitative requirement without an explicit threshold; no threshold was inferred.'
        : 'Measurement criterion without an explicit operator/threshold.',
    );
  }

  if (VAGUE_RE.test(t)) {
    return ambiguous('Qualitative requirement depends on investigator judgement; not machine-evaluable.');
  }

  if (primary.field === 'pregnancy test') {
    return { ...base, operator: '=', value: /negative pregnancy/.test(t) ? 'negative' : 'positive', appliesTo };
  }

  // ---- presence criteria (diagnosis / medication / procedure / admin) -----
  const out: Criterion = {
    ...base,
    operator: sameDomain.length > 1 ? 'IN' : 'EXISTS',
    field: sameDomain.length > 1 ? `${primary.domain} (any of)` : primary.field,
    values: sameDomain.length > 1 ? sameDomain.map((m) => m.field) : undefined,
  };
  if (temporal) out.temporal = temporal;
  if (requireActive) out.requireActive = true;
  if (appliesTo) out.appliesTo = appliesTo;
  return out;
}

export function mockExtractProtocol(doc: RedactedDocument): ProtocolExtractionOutput {
  const criteria: Criterion[] = [];
  const notes: string[] = [];
  let section: string | null = null;
  let current: { id: string; lines: string[]; page: number; section: string } | null = null;

  const flush = () => {
    if (!current) return;
    const text = current.lines.reduce((acc, l) => (acc.endsWith('-') ? acc + l : acc ? `${acc} ${l}` : l), '');
    criteria.push(parseCriterionText(current.id, text, { page: current.page, section: current.section }));
    current = null;
  };

  for (const page of doc.pages) {
    for (const rawLine of page.text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        flush();
        continue;
      }
      const sec = SECTION_RE.exec(line);
      if (sec && !CRITERION_START.test(line)) {
        flush();
        section = `${sec[1]} ${sec[2]}`.trim();
        continue;
      }
      if (/^\d+(\.\d+)*\s+[A-Z][A-Z &/-]+$/.test(line)) {
        // Any other numbered heading ends the criteria sections.
        flush();
        section = null;
        continue;
      }
      const start = CRITERION_START.exec(line);
      if (start && section) {
        flush();
        current = { id: start[1], lines: [start[2]], page: page.page, section };
        continue;
      }
      if (current && !/^=+\s*PAGE/i.test(line) && !/^CT-\d{4}-\d{3}\s*\|/.test(line) && !/^Page \d+ of \d+/i.test(line)) {
        // A criterion is one sentence. A line that starts a new sentence after the
        // criterion already ended is NOT a wrapped continuation (e.g. an injected
        // instruction placed between criteria) — close the criterion instead.
        const last = current.lines[current.lines.length - 1];
        if (/[.;!?]["')\]]?$/.test(last) && /^[A-Z<"'(]/.test(line)) {
          flush();
          continue;
        }
        current.lines.push(line);
      }
    }
    // criteria never span a page boundary in provenance; close at page end
    flush();
  }

  const ambiguousCount = criteria.filter((c) => c.ambiguity === 1).length;
  if (ambiguousCount) notes.push(`${ambiguousCount} criterion/criteria contain qualitative language and were flagged for human review; no thresholds were inferred.`);
  if (!criteria.some((c) => c.category === 'inclusion')) notes.push('No inclusion criteria found.');
  if (!criteria.some((c) => c.category === 'exclusion')) notes.push('No exclusion criteria found.');
  return { criteria, notes };
}
