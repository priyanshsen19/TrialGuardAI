/**
 * Deterministic unit normalisation and conversion. Only explicitly listed
 * conversions are supported; anything else returns null → UNKNOWN → review.
 */
const ALIASES: Record<string, string> = {
  '%': '%',
  'percent': '%',
  'mmol/mol': 'mmol/mol',
  'ml/min/1.73m2': 'mL/min/1.73m2',
  'ml/min/1.73 m2': 'mL/min/1.73m2',
  'ml/min/1.73m²': 'mL/min/1.73m2',
  'ml/min/1.73 m²': 'mL/min/1.73m2',
  'ml/min/{1.73_m2}': 'mL/min/1.73m2',
  'u/l': 'U/L',
  'iu/l': 'U/L',
  'mg/dl': 'mg/dL',
  'umol/l': 'umol/L',
  'µmol/l': 'umol/L',
  'μmol/l': 'umol/L',
  'kg/m2': 'kg/m2',
  'kg/m²': 'kg/m2',
  'years': 'years',
  'yrs': 'years',
};

export function normalizeUnit(u: string | null | undefined): string | null {
  if (u === null || u === undefined) return null;
  const k = u.trim().toLowerCase().replace(/\s+/g, ' ');
  if (k === '' || k === '-') return null;
  return ALIASES[k] ?? ALIASES[k.replace(/\s/g, '')] ?? u.trim();
}

type Converter = (v: number) => number;

/** conceptKey → "from->to" → converter */
const CONVERSIONS: Record<string, Record<string, Converter>> = {
  // HbA1c: NGSP % = 0.09148 × IFCC mmol/mol + 2.152
  'LOINC:4548-4': {
    'mmol/mol->%': (v) => Math.round((0.09148 * v + 2.152) * 100) / 100,
    '%->mmol/mol': (v) => Math.round(((v - 2.152) / 0.09148) * 10) / 10,
  },
  // Total bilirubin: 1 mg/dL = 17.1 µmol/L
  'LOINC:1975-2': {
    'umol/L->mg/dL': (v) => Math.round((v / 17.1) * 100) / 100,
    'mg/dL->umol/L': (v) => Math.round(v * 17.1 * 10) / 10,
  },
};

export interface ConversionResult {
  value: number;
  unit: string | null;
  converted: boolean;
}

/** Convert `value` in `from` to `to` for a concept. Returns null when unsupported. */
export function convertUnit(conceptKey: string | null, value: number, from: string | null, to: string | null): ConversionResult | null {
  const f = normalizeUnit(from);
  const t = normalizeUnit(to);
  if (t === null) return { value, unit: f, converted: false }; // criterion has no unit requirement
  if (f === t) return { value, unit: t, converted: false };
  if (f === null) return null; // value without unit cannot be compared to a unit-bearing threshold
  const conv = conceptKey ? CONVERSIONS[conceptKey]?.[`${f}->${t}`] : undefined;
  return conv ? { value: conv(value), unit: t, converted: true } : null;
}
