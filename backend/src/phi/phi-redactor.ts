/**
 * Application-level PHI/PII detection and deterministic aliasing.
 *
 * Runs BEFORE any Lyzr inference. Detects names, DOB, addresses, email, phone,
 * MRN, SSN, insurance identifiers and hospital identifiers using:
 *   1. known identifiers supplied at registration (exact, case-insensitive)
 *   2. labelled fields ("DOB:", "MRN:", "Insurance Member ID:" …)
 *   3. format patterns (email, phone, SSN, MRN-12345, street addresses …)
 *   4. name heuristics (honorifics, "Patient <First> <Last>")
 *
 * Each value is replaced with a deterministic alias derived from an HMAC
 * (e.g. PATIENT_NAME_REDACTED_3F9A1C) so the same value always gets the same
 * alias without revealing it. The alias→value mapping is returned to the
 * caller for encrypted vault storage and is never logged or sent anywhere.
 *
 * Clinical dates (lab dates, medication dates) are intentionally preserved;
 * only dates labelled as birth dates are PHI-redacted. Age is derived
 * deterministically from the vaulted DOB (HIPAA Safe Harbor permits age < 90).
 */
import { hmacHex } from '../common/crypto';

export type PhiCategory = 'PATIENT_NAME' | 'DOB' | 'ADDRESS' | 'EMAIL' | 'PHONE' | 'MRN' | 'SSN' | 'INSURANCE_ID' | 'HOSPITAL_ID';

export interface PhiReplacement {
  category: PhiCategory;
  alias: string;
  original: string;
}

export interface RedactionResult {
  text: string;
  replacements: PhiReplacement[];
}

export interface KnownPhi {
  names?: string[];
  dateOfBirth?: string | null;
  mrn?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  insuranceId?: string | null;
  ssn?: string | null;
  hospitalId?: string | null;
}

const LABELLED: Array<{ category: PhiCategory; re: RegExp }> = [
  { category: 'PATIENT_NAME', re: /\b(?:Patient Name|Patient|Name|Full Name)\s*:\s*([^\n|]+)/gi },
  { category: 'DOB', re: /\b(?:DOB|D\.O\.B\.|Date of Birth|Birth ?Date)\s*[:\-]?\s*([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4})/gi },
  { category: 'ADDRESS', re: /\b(?:Address|Home Address|Street Address)\s*:\s*([^\n|]+)/gi },
  { category: 'MRN', re: /\b(?:MRN|Medical Record (?:Number|No\.?)|Chart (?:No\.?|Number))\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/gi },
  { category: 'INSURANCE_ID', re: /\b(?:Insurance(?: Member)? ID|Member ID|Policy (?:No\.?|Number)|Subscriber ID)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi },
  { category: 'HOSPITAL_ID', re: /\b(?:Hospital ID|Facility ID|Encounter (?:No\.?|Number|#)|Account (?:No\.?|Number))\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi },
  { category: 'PHONE', re: /\b(?:Phone|Tel|Telephone|Mobile|Cell)\s*[:#]?\s*([+()0-9][0-9 ().-]{6,}[0-9])/gi },
  { category: 'SSN', re: /\b(?:SSN|Social Security (?:No\.?|Number))\s*[:#]?\s*([0-9]{3}-?[0-9]{2}-?[0-9]{4})/gi },
];

const PATTERNS: Array<{ category: PhiCategory; re: RegExp }> = [
  { category: 'EMAIL', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { category: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { category: 'PHONE', re: /(?<![\d.-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d-])/g },
  { category: 'MRN', re: /\bMRN[-\s]?\d{3,}\b/gi },
  { category: 'INSURANCE_ID', re: /\bINS-\d{5,}\b/g },
  { category: 'HOSPITAL_ID', re: /\bHOSP-ID-\d{3,}\b/g },
  {
    category: 'ADDRESS',
    re: /\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,4}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Boulevard|Blvd\.?|Way|Place|Pl\.?|Terrace|Circle)\b(?:,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)?/g,
  },
  { category: 'PATIENT_NAME', re: /\b(?:Mr|Mrs|Ms|Miss|Mx)\.?\s+[A-Z][a-z]+(?:[- ][A-Z][a-z]+){0,2}/g },
];

const ALIAS_PREFIX: Record<PhiCategory, string> = {
  PATIENT_NAME: 'PATIENT_NAME_REDACTED',
  DOB: 'DOB_REDACTED',
  ADDRESS: 'ADDRESS_REDACTED',
  EMAIL: 'EMAIL_REDACTED',
  PHONE: 'PHONE_REDACTED',
  MRN: 'MRN_REDACTED',
  SSN: 'SSN_REDACTED',
  INSURANCE_ID: 'INSURANCE_ID_REDACTED',
  HOSPITAL_ID: 'HOSPITAL_ID_REDACTED',
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class PhiRedactor {
  constructor(private readonly aliasKey: Buffer) {}

  alias(category: PhiCategory, value: string): string {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
    return `${ALIAS_PREFIX[category]}_${hmacHex(this.aliasKey, `${category}:${normalized}`).slice(0, 6).toUpperCase()}`;
  }

  /** Expand known identifiers into the literal strings that must be removed. */
  private knownTerms(known?: KnownPhi): Array<{ category: PhiCategory; value: string }> {
    if (!known) return [];
    const terms: Array<{ category: PhiCategory; value: string }> = [];
    for (const n of known.names ?? []) {
      if (!n?.trim()) continue;
      terms.push({ category: 'PATIENT_NAME', value: n.trim() });
      // Individual name parts (≥ 3 letters) are also identifiers.
      for (const part of n.trim().split(/[\s-]+/)) if (part.length >= 3) terms.push({ category: 'PATIENT_NAME', value: part });
    }
    const add = (category: PhiCategory, v?: string | null) => v?.trim() && terms.push({ category, value: v.trim() });
    add('DOB', known.dateOfBirth);
    add('MRN', known.mrn);
    add('EMAIL', known.email);
    add('PHONE', known.phone);
    add('ADDRESS', known.address);
    add('INSURANCE_ID', known.insuranceId);
    add('SSN', known.ssn);
    add('HOSPITAL_ID', known.hospitalId);
    // Longest first so "Harriet Quillfeather" is replaced before "Harriet".
    return terms.sort((a, b) => b.value.length - a.value.length);
  }

  redact(text: string, known?: KnownPhi): RedactionResult {
    const replacements = new Map<string, PhiReplacement>();
    const record = (category: PhiCategory, original: string) => {
      const alias = this.alias(category, original);
      replacements.set(`${category}:${original}`, { category, alias, original });
      return alias;
    };
    let out = text;

    // 1. Labelled fields (value only is replaced; label kept for context).
    for (const { category, re } of LABELLED) {
      out = out.replace(re, (full, value: string) => {
        const v = value.trim();
        if (!v || /_REDACTED_/.test(v)) return full;
        return full.replace(value, (m) => m.replace(v, record(category, v)));
      });
    }

    // 2. Format-based patterns (before name parts, so "john@example.com" is redacted as one EMAIL).
    for (const { category, re } of PATTERNS) {
      out = out.replace(re, (m) => (/_REDACTED_/.test(m) ? m : record(category, m)));
    }

    // 3. Known identifiers anywhere in the text (full values, then individual name parts).
    for (const { category, value } of this.knownTerms(known)) {
      const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(value)}(?![A-Za-z0-9_])`, 'gi');
      out = out.replace(re, (m) => record(category, m));
    }

    return { text: out, replacements: [...replacements.values()] };
  }

  /** Returns categories of any known identifier still present (used by Safe AI pre-flight). */
  residualScan(text: string, known?: KnownPhi): Array<{ category: string }> {
    const hits: Array<{ category: string }> = [];
    for (const { category, value } of this.knownTerms(known)) {
      const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(value)}(?![A-Za-z0-9_])`, 'i');
      if (re.test(text)) hits.push({ category });
    }
    return hits;
  }
}

export function summarize(replacements: PhiReplacement[]) {
  const byCategory: Record<string, number> = {};
  for (const r of replacements) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  return { totalRedactions: replacements.length, byCategory };
}
