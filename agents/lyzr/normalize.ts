/**
 * Structural normalisation of LLM JSON before strict schema validation.
 *
 * Real LLMs (observed live with gpt-4o-mini on Lyzr) return the right content
 * in slightly different *shapes*: `null` instead of omitting a field, dotted
 * keys such as "appliesTo.sex", "female" instead of "F", a string where an
 * array is expected. These repairs are purely structural and meaning-
 * preserving. They NEVER infer thresholds, operators, dates or values — every
 * semantic field is still verified downstream by grounding and by
 * deterministic cross-validation.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** {"appliesTo.sex": "F"} → {"appliesTo": {"sex": "F"}} (one level). */
function expandDottedKeys(o: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    const dot = k.indexOf('.');
    if (dot > 0) {
      const head = k.slice(0, dot);
      const tail = k.slice(dot + 1);
      const target = isObj(out[head]) ? (out[head] as Obj) : {};
      if (v !== null && v !== undefined) target[tail] = v;
      out[head] = target;
    } else if (!(k in out) || !isObj(out[k])) {
      out[k] = v;
    } else if (isObj(v)) {
      out[k] = { ...(out[k] as Obj), ...v };
    }
  }
  return out;
}

function dropNulls(o: Obj, keys: string[]) {
  for (const k of keys) if (o[k] === null) delete o[k];
}

function normSex(v: unknown): 'F' | 'M' | undefined {
  if (typeof v !== 'string') return undefined;
  if (/^f(emale)?$/i.test(v.trim())) return 'F';
  if (/^m(ale)?$/i.test(v.trim())) return 'M';
  return undefined;
}

const MEASUREMENT_DOMAINS = new Set(['laboratory', 'vital', 'reproductive']);

const CRITERION_TOP_LEVEL = ['requiresHumanReview', 'ambiguity', 'ambiguityReason', 'mandatory', 'category', 'domain', 'operator'];

export function normalizeCriterion(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const c = expandDottedKeys(raw);
  delete c.extraction; // provenance is set by TrialGuard only
  // Hoist top-level fields a model mistakenly nested inside `source`.
  if (isObj(c.source)) {
    for (const k of CRITERION_TOP_LEVEL) {
      if (k in c.source) {
        if (c[k] === undefined || c[k] === null) c[k] = c.source[k];
        delete c.source[k];
      }
    }
  }
  // Non-binding guidance is modelled as a non-mandatory inclusion criterion.
  if (c.category === 'guidance') {
    c.category = 'inclusion';
    if (c.mandatory === undefined || c.mandatory === null) c.mandatory = false;
  }
  dropNulls(c, ['values', 'range', 'temporal', 'lookbackDays', 'requireActive', 'appliesTo', 'ambiguityReason']);
  if (typeof c.ambiguity === 'boolean') c.ambiguity = c.ambiguity ? 1 : 0;
  // Omitted flags mean "not flagged". Safe because cross-validation compares the
  // ambiguity flag with the deterministic parse, and LLM-only criteria are
  // always routed to review.
  if (c.requiresHumanReview === undefined || c.requiresHumanReview === null) c.requiresHumanReview = c.ambiguity === 1;
  if (c.ambiguity === undefined || c.ambiguity === null) c.ambiguity = c.requiresHumanReview === true ? 1 : 0;
  if (isObj(c.appliesTo)) {
    const sex = normSex(c.appliesTo.sex);
    if (sex) c.appliesTo = { sex };
    else delete c.appliesTo;
  }
  if (typeof c.values === 'string') {
    const parts = c.values.split(/\s*(?:,|\||;|\bor\b|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length) c.values = parts;
    else delete c.values;
  }
  // Representational equivalence in our model: a look-back window on a
  // measurement is `lookbackDays`, not a `temporal` anchor on the observation.
  if (MEASUREMENT_DOMAINS.has(String(c.domain)) && isObj(c.temporal) && c.temporal.operator === 'WITHIN_DAYS' && (c.temporal.anchor === 'observed' || c.temporal.anchor === undefined) && c.lookbackDays === undefined) {
    c.lookbackDays = c.temporal.days;
    delete c.temporal;
  }
  if (isObj(c.source)) dropNulls(c.source, ['section']);
  return c;
}

const SYSTEM_ALIASES: Record<string, string> = {
  'icd10': 'ICD-10',
  'icd-10': 'ICD-10',
  'icd-10-cm': 'ICD-10',
  'icd10cm': 'ICD-10',
  'snomed': 'SNOMED',
  'snomed ct': 'SNOMED',
  'snomed-ct': 'SNOMED',
  'snomedct': 'SNOMED',
  'loinc': 'LOINC',
  'rxnorm': 'RXNORM',
  'local': 'LOCAL',
  'unmapped': 'UNMAPPED',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

export function normalizeFact(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const f = expandDottedKeys(raw);
  delete f.extraction;
  dropNulls(f, ['status', 'dateText']);
  if (isObj(f.uncertainty)) dropNulls(f.uncertainty, ['reason']);
  if (f.uncertainty === null || f.uncertainty === undefined) f.uncertainty = { isUncertain: false };
  if (isObj(f.concept)) {
    const sys = typeof f.concept.system === 'string' ? SYSTEM_ALIASES[f.concept.system.trim().toLowerCase()] : undefined;
    if (sys) f.concept.system = sys;
    else {
      // Unknown vocabulary (e.g. "ATC", "CPT"): keep the display text, let the
      // ontology service map it — never trust an unvalidated code.
      f.concept.system = 'UNMAPPED';
      f.concept.code = null;
    }
    if (f.concept.code === undefined || f.concept.code === '') f.concept.code = null;
  }
  for (const k of ['observedAt', 'onsetDate', 'startDate', 'endDate']) {
    if (f[k] === '' || f[k] === 'null') f[k] = null;
  }
  if (f.observedAt === undefined) f.observedAt = null;
  if (f.unit === undefined || f.unit === '' || f.unit === '-') f.unit = null;
  if (f.value === undefined) f.value = null;
  // Derive precision from the date strings the model itself returned (no new dates are created).
  if (f.datePrecision === undefined || f.datePrecision === null) {
    const dates = ['observedAt', 'onsetDate', 'startDate', 'endDate'].map((k) => f[k]).filter((d): d is string => typeof d === 'string');
    f.datePrecision = dates.length && dates.every((d) => ISO_DAY.test(d)) ? 'day' : dates.some((d) => ISO_MONTH.test(d)) ? 'month' : 'unknown';
  }
  // A missing self-reported confidence gets a conservative default; it only lowers downstream confidence.
  if (typeof f.extractionConfidence !== 'number') f.extractionConfidence = 0.8;
  return f;
}

export function normalizeFlag(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const f = expandDottedKeys(raw);
  if (f.factIds === null) f.factIds = [];
  if (f.criterionIds === null) f.criterionIds = [];
  if (typeof f.severity === 'string') f.severity = f.severity.toUpperCase();
  return f;
}

/** Apply a per-item normaliser to the array under `key` of a parsed agent response. */
export function normalizeList(json: unknown, key: string, fn: (x: unknown) => unknown): unknown {
  if (!isObj(json)) return json;
  const out: Obj = { ...json };
  if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(fn);
  if (out.notes === null) out.notes = [];
  if (out.summary === null) out.summary = '';
  return out;
}
