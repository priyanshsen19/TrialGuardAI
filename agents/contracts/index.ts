/**
 * Shared, versioned data contracts for every TrialGuard agent.
 *
 * These schemas are the *only* shape an agent response can take. Every Lyzr
 * response is parsed with `.strict()` schemas, so an LLM cannot smuggle extra
 * fields (e.g. `"eligible": true`) into the pipeline.
 */
import { z } from 'zod';

export const CONTRACT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Operators supported by the deterministic rule engine
// ---------------------------------------------------------------------------
export const OPERATORS = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'IN',
  'NOT_IN',
  'BETWEEN',
  'EXISTS',
  'NOT_EXISTS',
  'WITHIN_DAYS',
  'NOT_WITHIN_DAYS',
] as const;
export const OperatorSchema = z.enum(OPERATORS);
export type Operator = z.infer<typeof OperatorSchema>;

export const CRITERION_DOMAINS = [
  'demographic',
  'diagnosis',
  'laboratory',
  'medication',
  'procedure',
  'vital',
  'reproductive',
  'administrative',
] as const;
export const CriterionDomainSchema = z.enum(CRITERION_DOMAINS);
export type CriterionDomain = z.infer<typeof CriterionDomainSchema>;

export const TemporalConstraintSchema = z
  .object({
    operator: z.enum(['WITHIN_DAYS', 'NOT_WITHIN_DAYS']),
    days: z.number().int().positive(),
    /** Which date on the matching fact the window is measured from. */
    anchor: z.enum(['onset', 'start', 'end', 'observed']),
  })
  .strict();
export type TemporalConstraint = z.infer<typeof TemporalConstraintSchema>;

// ---------------------------------------------------------------------------
// Extraction provenance — set ONLY by TrialGuard after cross-validation.
// Any value an LLM puts here is stripped before validation.
// ---------------------------------------------------------------------------
export const ExtractionProvenanceSchema = z
  .object({
    method: z.enum(['cross-validated', 'deterministic-resolution', 'deterministic-recovery', 'llm-only', 'simulator']),
    disagreements: z.array(z.string()).optional(),
  })
  .strict();
export type ExtractionProvenance = z.infer<typeof ExtractionProvenanceSchema>;

// ---------------------------------------------------------------------------
// Protocol criteria (output of the Protocol Criteria Agent)
// ---------------------------------------------------------------------------
export const CriterionSchema = z
  .object({
    id: z.string().regex(/^(INC|EXC|GDN)-\d{3}$/, 'criterion id must look like INC-001 / EXC-001 / GDN-001'),
    category: z.enum(['inclusion', 'exclusion']),
    domain: CriterionDomainSchema,
    /** Human-readable concept name, e.g. "eGFR" or "systemic corticosteroid". */
    field: z.string().min(1),
    operator: OperatorSchema,
    value: z.union([z.number(), z.string(), z.boolean()]).nullable().optional(),
    /** Concept names for IN / NOT_IN. */
    values: z.array(z.string().min(1)).optional(),
    range: z.object({ min: z.number(), max: z.number() }).strict().optional(),
    unit: z.string().nullable().optional(),
    temporal: TemporalConstraintSchema.optional(),
    /** Evidence freshness requirement (e.g. lab within 30 days prior to screening). */
    lookbackDays: z.number().int().positive().optional(),
    /** Matching medication/condition must still be active at screening. */
    requireActive: z.boolean().optional(),
    appliesTo: z.object({ sex: z.enum(['F', 'M']).optional() }).strict().optional(),
    /** Mandatory criteria gate eligibility. Non-binding guidance does not. */
    mandatory: z.boolean(),
    /** Verbatim protocol text — used for grounding verification. */
    text: z.string().min(1),
    source: z.object({ page: z.number().int().positive(), section: z.string().min(1) }).strict(),
    requiresHumanReview: z.boolean(),
    ambiguity: z.union([z.literal(0), z.literal(1)]),
    ambiguityReason: z.string().optional(),
    extraction: ExtractionProvenanceSchema.optional(),
  })
  .strict();
export type Criterion = z.infer<typeof CriterionSchema>;

export const ProtocolExtractionOutputSchema = z
  .object({
    criteria: z.array(CriterionSchema),
    notes: z.array(z.string()).default([]),
  })
  .strict();
export type ProtocolExtractionOutput = z.infer<typeof ProtocolExtractionOutputSchema>;

// ---------------------------------------------------------------------------
// Clinical facts (output of the Clinical Facts Agent)
// ---------------------------------------------------------------------------
export const TERMINOLOGY_SYSTEMS = ['LOINC', 'SNOMED', 'ICD-10', 'RXNORM', 'LOCAL', 'UNMAPPED'] as const;
export const ConceptSchema = z
  .object({
    system: z.enum(TERMINOLOGY_SYSTEMS),
    code: z.string().nullable(),
    display: z.string().min(1),
  })
  .strict();
export type Concept = z.infer<typeof ConceptSchema>;

export const DatePrecisionSchema = z.enum(['day', 'month', 'year', 'unknown']);
export type DatePrecision = z.infer<typeof DatePrecisionSchema>;

const IsoDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'dates must be ISO-8601 (YYYY, YYYY-MM or YYYY-MM-DD)');

export const ClinicalFactSchema = z
  .object({
    factId: z.string().regex(/^FACT-\d{3,}$/),
    category: z.enum(['demographic', 'condition', 'observation', 'medication', 'procedure', 'administrative']),
    concept: ConceptSchema,
    value: z.union([z.number(), z.string(), z.boolean()]).nullable(),
    unit: z.string().nullable(),
    observedAt: IsoDate.nullable(),
    onsetDate: IsoDate.nullable().optional(),
    startDate: IsoDate.nullable().optional(),
    endDate: IsoDate.nullable().optional(),
    status: z.enum(['active', 'resolved', 'completed', 'ongoing', 'unknown']).optional(),
    datePrecision: DatePrecisionSchema,
    /** Verbatim date text when the date is imprecise ("sometime last month"). */
    dateText: z.string().optional(),
    source: z.object({ document: z.string().min(1), page: z.number().int().positive() }).strict(),
    /** Verbatim span from the (redacted) source — used for grounding verification. */
    sourceQuote: z.string().min(1),
    uncertainty: z.object({ isUncertain: z.boolean(), reason: z.string().optional() }).strict(),
    extractionConfidence: z.number().min(0).max(1),
    extraction: ExtractionProvenanceSchema.optional(),
  })
  .strict();
export type ClinicalFact = z.infer<typeof ClinicalFactSchema>;

export const ClinicalFactsOutputSchema = z
  .object({
    facts: z.array(ClinicalFactSchema),
    notes: z.array(z.string()).default([]),
  })
  .strict();
export type ClinicalFactsOutput = z.infer<typeof ClinicalFactsOutputSchema>;

// ---------------------------------------------------------------------------
// Safety flags (output of the Safety Validator Agent + deterministic checks)
// ---------------------------------------------------------------------------
export const SAFETY_FLAG_CODES = [
  'CONTRADICTORY_EVIDENCE',
  'MISSING_EVIDENCE',
  'STALE_EVIDENCE',
  'AMBIGUOUS_HISTORY',
  'MEDICATION_INCONSISTENCY',
  'POTENTIAL_SAFETY_SIGNAL',
  'UNRESOLVED_TERMINOLOGY',
  'PROMPT_INJECTION_DETECTED',
  'UNGROUNDED_EXTRACTION',
  'UNSUPPORTED_UNIT',
] as const;
export const SafetyFlagCodeSchema = z.enum(SAFETY_FLAG_CODES);
export type SafetyFlagCode = z.infer<typeof SafetyFlagCodeSchema>;

export const SafetySeveritySchema = z.enum(['INFO', 'WARNING', 'BLOCKING']);
export type SafetySeverity = z.infer<typeof SafetySeveritySchema>;

export const SafetyFlagSchema = z
  .object({
    code: SafetyFlagCodeSchema,
    severity: SafetySeveritySchema,
    description: z.string().min(1),
    factIds: z.array(z.string()).default([]),
    criterionIds: z.array(z.string()).default([]),
  })
  .strict();
export type SafetyFlag = z.infer<typeof SafetyFlagSchema>;

export const SafetyValidationOutputSchema = z
  .object({
    flags: z.array(SafetyFlagSchema),
    summary: z.string().default(''),
  })
  .strict();
export type SafetyValidationOutput = z.infer<typeof SafetyValidationOutputSchema>;

// ---------------------------------------------------------------------------
// Audit narration (output of the Audit Agent — non-authoritative)
// ---------------------------------------------------------------------------
export const AuditNarrativeSchema = z
  .object({
    summary: z.string().min(1),
    keyPoints: z.array(z.string()).max(12),
  })
  .strict();
export type AuditNarrative = z.infer<typeof AuditNarrativeSchema>;

// ---------------------------------------------------------------------------
// Rule-engine output (produced ONLY by deterministic code, never by an LLM)
// ---------------------------------------------------------------------------
export type CriterionResult = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type Decision = 'ELIGIBLE' | 'INELIGIBLE' | 'REQUIRES_HUMAN_OVERVIEW';

export interface EvidenceRef {
  factId: string;
  display: string;
  value: number | string | boolean | null;
  unit: string | null;
  normalizedValue?: number | string | boolean | null;
  normalizedUnit?: string | null;
  observedAt: string | null;
  sourceDocument: string;
  page: number;
  quote: string;
}

export interface CriterionEvaluation {
  criterionId: string;
  category: 'inclusion' | 'exclusion';
  mandatory: boolean;
  requirement: string;
  result: CriterionResult;
  /** For exclusion criteria: whether the exclusion condition was met. */
  conditionMet: boolean | null;
  operator: Operator;
  expectedValue: string;
  actualValue: string | null;
  ruleExpression: string;
  reason: string;
  reviewReasons: string[];
  evidence: EvidenceRef[];
  confidence: number;
  source: { page: number; section: string };
}

// ---------------------------------------------------------------------------
// Documents handed to agents (always PHI-redacted before they get here)
// ---------------------------------------------------------------------------
export interface RedactedPage {
  page: number;
  text: string;
}
export interface RedactedDocument {
  documentName: string;
  pages: RedactedPage[];
}

// ---------------------------------------------------------------------------
// Ontology-resolved shapes (produced by the deterministic ontology service)
// ---------------------------------------------------------------------------
export interface CanonicalConcept {
  /** Stable key, e.g. "LOINC:62238-1" or "CLASS:systemic-corticosteroid". */
  key: string;
  system: string;
  code: string;
  display: string;
}

export interface ResolvedCriterion extends Criterion {
  resolution: {
    /** Canonical concept keys the criterion refers to (empty when unresolved). */
    conceptKeys: string[];
    unresolvedTerms: string[];
    canonicalUnit: string | null;
  };
}

export interface ResolvedFact extends ClinicalFact {
  resolution: {
    status: 'MAPPED' | 'UNMAPPED' | 'AMBIGUOUS';
    concept: CanonicalConcept | null;
    /** Canonical keys of classes this concept belongs to (e.g. prednisone → systemic corticosteroid). */
    classes: string[];
    mappingConfidence: number;
    method: 'code' | 'synonym' | 'none';
    note?: string;
  };
}

export interface SafetyFlagRecord extends SafetyFlag {
  source: 'deterministic' | 'agent';
}

export interface DecisionOutcome {
  decision: Decision;
  confidence: number;
  reasons: string[];
  confidenceBreakdown: {
    criterionMean: number;
    safetyPenalty: number;
    unknownPenalty: number;
    formula: string;
  };
}

/** Verified, deterministic data given to the audit narration agent. */
export interface VerifiedScreeningSummary {
  screeningId: string;
  trialCode: string;
  protocolVersion: string;
  patientRef: string;
  decision: Decision;
  confidencePct: number;
  counts: { total: number; pass: number; fail: number; unknown: number; notApplicable: number };
  failed: Array<{ criterionId: string; ruleExpression: string }>;
  unknown: Array<{ criterionId: string; reason: string }>;
  safetyFlags: Array<{ code: string; severity: string }>;
  review?: { reviewerRole: string; outcome: string } | null;
}

/** Result of comparing LLM extraction with the deterministic reference parser. */
export interface CrossValidationReport {
  method: 'dual-extraction';
  llmItems: number;
  deterministicItems: number;
  agreed: string[];
  resolved: Array<{ id: string; disagreements: string[] }>;
  recovered: string[];
  llmOnly: string[];
  /** Schema errors when the LLM output was rejected entirely (deterministic parse used). */
  llmOutputRejected?: string[];
  agreementRate: number;
}
