/**
 * TrialGuard Safe AI layer.
 *
 * Wraps every Lyzr agent call with application-level guardrails that mirror
 * Lyzr Responsible AI (PII redaction, prompt-injection, secrets detection,
 * groundedness) and add clinical-specific controls. These run in BOTH mock and
 * live mode, so safety does not depend on tenant configuration.
 *
 * PRE-FLIGHT  (before anything leaves the process)
 *   - residual PHI scan: blocks the call if any PHI pattern survived redaction
 *   - secrets scan: blocks the call if credentials appear in the payload
 *   - prompt-injection scan: flags injected instructions (document stays data)
 *
 * POST-FLIGHT (before anything enters the pipeline)
 *   - strict JSON parsing + zod schema validation (unknown fields rejected)
 *   - grounding: every extracted item must quote the source verbatim and every
 *     number it carries must appear in that quote — otherwise it is dropped
 *   - narrative guard: audit narratives may not introduce new numbers,
 *     contradict the decision, or make regulatory claims
 */
import type { ZodTypeAny, output as ZodOutput } from 'zod';
import type { Criterion, ClinicalFact, RedactedDocument } from '../contracts';

export interface SafeAiFinding {
  kind: 'RESIDUAL_PHI' | 'SECRET' | 'PROMPT_INJECTION';
  pattern: string;
  location: string;
  /** Never contains the matched text for PHI/secrets; injection excerpts are safe to show. */
  excerpt?: string;
}

export interface PreflightReport {
  passed: boolean;
  blocked: boolean;
  findings: SafeAiFinding[];
  injectionDetected: boolean;
  checkedAt: string;
}

export class SafeAiBlockedError extends Error {
  readonly code = 'SAFE_AI_BLOCKED';
  constructor(
    message: string,
    readonly findings: SafeAiFinding[],
  ) {
    super(message);
    this.name = 'SafeAiBlockedError';
  }
}

export type ResidualPhiScanner = (text: string) => Array<{ category: string }>;

const BUILTIN_PHI_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { name: 'phone', re: /(?<![\d.])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/ },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'mrn', re: /\bMRN[\s:#-]*\d{3,}/i },
  { name: 'dob', re: /\b(?:DOB|date of birth)\b\s*[:\-]?\s*\d/i },
];

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
];

export const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore-instructions', re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?)\b/i },
  { name: 'declare-eligible', re: /\b(declare|mark|classify|consider|make)\b[^.\n]{0,40}\b(every|all|any|this)\b[^.\n]{0,20}\b(patients?|participants?|subjects?)\b[^.\n]{0,20}\beligible\b/i },
  { name: 'role-hijack', re: /\b(you are now|act as|pretend to be|new system prompt|system override)\b/i },
  { name: 'prompt-exfiltration', re: /\b(reveal|print|show|repeat)\b[^.\n]{0,30}\b(system prompt|instructions|api key)\b/i },
];

export function detectPromptInjection(text: string, location: string): SafeAiFinding[] {
  const findings: SafeAiFinding[] = [];
  for (const { name, re } of INJECTION_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 20);
      findings.push({
        kind: 'PROMPT_INJECTION',
        pattern: name,
        location,
        excerpt: text.slice(start, Math.min(text.length, m.index + m[0].length + 20)).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return findings;
}

export class SafeAi {
  constructor(private readonly residualPhiScanner?: ResidualPhiScanner) {}

  /** Scan a fully rendered outbound payload. Throws SafeAiBlockedError if PHI or secrets remain. */
  preflight(payload: string, documents: RedactedDocument[] = []): PreflightReport {
    const findings: SafeAiFinding[] = [];
    for (const { name, re } of BUILTIN_PHI_PATTERNS) {
      if (re.test(payload)) findings.push({ kind: 'RESIDUAL_PHI', pattern: name, location: 'outbound-payload' });
    }
    if (this.residualPhiScanner) {
      for (const hit of this.residualPhiScanner(payload)) {
        findings.push({ kind: 'RESIDUAL_PHI', pattern: hit.category, location: 'outbound-payload' });
      }
    }
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(payload)) findings.push({ kind: 'SECRET', pattern: name, location: 'outbound-payload' });
    }
    for (const doc of documents) {
      for (const p of doc.pages) {
        findings.push(...detectPromptInjection(p.text, `${doc.documentName}#page=${p.page}`));
      }
    }
    const blocking = findings.filter((f) => f.kind !== 'PROMPT_INJECTION');
    const report: PreflightReport = {
      passed: blocking.length === 0,
      blocked: blocking.length > 0,
      findings,
      injectionDetected: findings.some((f) => f.kind === 'PROMPT_INJECTION'),
      checkedAt: new Date().toISOString(),
    };
    if (report.blocked) {
      throw new SafeAiBlockedError(
        `Safe AI pre-flight blocked outbound agent call: ${blocking.map((b) => `${b.kind}:${b.pattern}`).join(', ')}`,
        blocking,
      );
    }
    return report;
  }

  /** Parse an LLM response into JSON (tolerating code fences) and validate it strictly. */
  parseStructured<S extends ZodTypeAny>(
    raw: string,
    schema: S,
    normalize?: (json: unknown) => unknown,
  ): { ok: true; data: ZodOutput<S> } | { ok: false; errors: string[] } {
    let json = extractJson(raw);
    if (json === undefined) return { ok: false, errors: ['response was not valid JSON'] };
    if (normalize) json = normalize(json);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    }
    return { ok: true, data: parsed.data as ZodOutput<S> };
  }

  /**
   * Per-item parsing: one malformed item must not discard the valid ones.
   * Returns every item that passes the strict item schema, plus the rejected
   * ones with their errors. Fails only if the envelope itself is unusable.
   */
  parseItems<S extends ZodTypeAny>(
    raw: string,
    key: string,
    itemSchema: S,
    normalizeItem?: (item: unknown) => unknown,
  ): { ok: true; items: ZodOutput<S>[]; invalid: Array<{ index: number; id: string; errors: string[] }>; notes: string[]; summary: string } | { ok: false; errors: string[] } {
    const json = extractJson(raw);
    if (json === undefined || typeof json !== 'object' || json === null) return { ok: false, errors: ['response was not a JSON object'] };
    // The envelope stays strict: unexpected top-level fields (e.g. a smuggled
    // "decision": "ELIGIBLE") reject the whole response loudly.
    const unexpected = Object.keys(json as Record<string, unknown>).filter((k) => ![key, 'notes', 'summary'].includes(k));
    if (unexpected.length) return { ok: false, errors: [`unexpected top-level field(s): ${unexpected.join(', ')}`] };
    const list = (json as Record<string, unknown>)[key];
    if (!Array.isArray(list)) return { ok: false, errors: [`response has no "${key}" array`] };
    const items: ZodOutput<S>[] = [];
    const invalid: Array<{ index: number; id: string; errors: string[] }> = [];
    list.forEach((item, index) => {
      const n = normalizeItem ? normalizeItem(item) : item;
      const r = itemSchema.safeParse(n);
      if (r.success) items.push(r.data as ZodOutput<S>);
      else {
        const o = n as Record<string, unknown> | null;
        const id = String(o?.id ?? o?.factId ?? o?.code ?? `#${index}`);
        invalid.push({ index, id, errors: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(item)'}: ${i.message}`) });
      }
    });
    const notesRaw = (json as Record<string, unknown>).notes;
    const summaryRaw = (json as Record<string, unknown>).summary;
    return {
      ok: true,
      items,
      invalid,
      notes: Array.isArray(notesRaw) ? notesRaw.filter((x): x is string => typeof x === 'string') : [],
      summary: typeof summaryRaw === 'string' ? summaryRaw : '',
    };
  }

  groundCriteria(criteria: Criterion[], doc: RedactedDocument): GroundingResult<Criterion> {
    const pageText = new Map(doc.pages.map((p) => [p.page, normalise(p.text)]));
    const all = normalise(doc.pages.map((p) => p.text).join('\n'));
    const accepted: Criterion[] = [];
    const rejected: GroundingViolation[] = [];
    for (const c of criteria) {
      const quote = normalise(c.text);
      const page = pageText.get(c.source.page);
      if (!(page?.includes(quote) || all.includes(quote))) {
        rejected.push({ id: c.id, reason: 'criterion text not found verbatim in protocol' });
        continue;
      }
      const numbers = [c.value, c.range?.min, c.range?.max, c.temporal?.days, c.lookbackDays].filter(
        (n): n is number => typeof n === 'number',
      );
      const missing = numbers.filter((n) => !numberAppears(n, quote) && !yearsToDaysAppears(n, quote));
      if (missing.length) {
        rejected.push({ id: c.id, reason: `threshold(s) ${missing.join(', ')} not present in quoted criterion text` });
        continue;
      }
      accepted.push(c);
    }
    return { accepted, rejected };
  }

  groundFacts(facts: ClinicalFact[], docs: RedactedDocument[]): GroundingResult<ClinicalFact> {
    const index = new Map<string, string>();
    for (const d of docs) for (const p of d.pages) index.set(`${d.documentName}#${p.page}`, normalise(p.text));
    const accepted: ClinicalFact[] = [];
    const rejected: GroundingViolation[] = [];
    for (const f of facts) {
      const page = index.get(`${f.source.document}#${f.source.page}`);
      const quote = normalise(f.sourceQuote);
      if (!page || !page.includes(quote)) {
        rejected.push({ id: f.factId, reason: 'source quote not found verbatim on cited document page' });
        continue;
      }
      if (typeof f.value === 'number' && !numberAppears(f.value, quote)) {
        rejected.push({ id: f.factId, reason: `value ${f.value} not present in source quote` });
        continue;
      }
      const dates = [f.observedAt, f.onsetDate, f.startDate, f.endDate].filter((d): d is string => typeof d === 'string');
      const badDate = dates.find((d) => !quote.includes(d));
      if (badDate) {
        rejected.push({ id: f.factId, reason: `date ${badDate} not present in source quote` });
        continue;
      }
      accepted.push(f);
    }
    return { accepted, rejected };
  }

  /**
   * Narrative guard for the audit agent. The narrative may only reuse numbers
   * that appear in the verified input, must name the actual decision, and must
   * not make regulatory claims. Returns violations (empty = safe).
   */
  checkNarrative(narrative: string, verifiedInput: unknown, decision: string): string[] {
    const violations: string[] = [];
    const inputText = JSON.stringify(verifiedInput);
    const inputNumbers = new Set((inputText.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
    for (const n of narrative.match(/\d+(?:\.\d+)?/g) ?? []) {
      if (!inputNumbers.has(String(Number(n)))) violations.push(`introduces number "${n}" not present in verified data`);
    }
    const decisions = ['REQUIRES_HUMAN_OVERVIEW', 'INELIGIBLE', 'ELIGIBLE'];
    const upper = narrative.toUpperCase().replace(/REQUIRES[ _]HUMAN[ _]REVIEW/g, 'REQUIRES_HUMAN_OVERVIEW');
    const mentioned = decisions.filter((d) => new RegExp(`(?<![A-Z_])${d}(?![A-Z_])`).test(upper));
    if (!mentioned.includes(decision)) violations.push(`does not state the actual decision ${decision}`);
    for (const m of mentioned) if (m !== decision) violations.push(`mentions conflicting decision ${m}`);
    const claim = /(?<!not\s)(?<!never\s)\b(FDA[- ]approved|FDA[- ]compliant|clinically validated|FDA[- ]cleared)\b/i.exec(narrative);
    if (claim) violations.push(`makes a prohibited regulatory claim ("${claim[1]}")`);
    return violations;
  }
}

export interface GroundingViolation {
  id: string;
  reason: string;
}
export interface GroundingResult<T> {
  accepted: T[];
  rejected: GroundingViolation[];
}

export function normalise(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[–—]/g, '-')
    .replace(/(\w)-\s+/g, '$1-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function numberAppears(n: number, text: string): boolean {
  const candidates = new Set([String(n), n.toFixed(1), n.toFixed(2)]);
  for (const c of candidates) {
    if (new RegExp(`(?<![\\d.])${c.replace('.', '\\.')}(?![\\d])`).test(text)) return true;
  }
  return false;
}

/** "within 5 years" legitimately becomes 1825 days; allow exact year/month conversions. */
function yearsToDaysAppears(days: number, text: string): boolean {
  if (days % 365 === 0 && numberAppears(days / 365, text) && /\byears?\b/.test(text)) return true;
  if (days % 30 === 0 && numberAppears(days / 30, text) && /\bmonths?\b/.test(text)) return true;
  if (days % 7 === 0 && numberAppears(days / 7, text) && /\bweeks?\b/.test(text)) return true;
  return false;
}

export function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
