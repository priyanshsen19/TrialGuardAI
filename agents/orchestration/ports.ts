/**
 * Ports the orchestration layer depends on. They are implemented by the backend
 * (deterministic services) and injected at runtime, so /agents never depends on
 * the rule engine, database or PHI vault — and the rule engine never depends on
 * Lyzr.
 */
import type {
  ClinicalFact,
  Criterion,
  CriterionEvaluation,
  DecisionOutcome,
  RedactedDocument,
  ResolvedCriterion,
  ResolvedFact,
  SafetyFlagRecord,
} from '../contracts';

export interface RawDocument {
  documentName: string;
  pages: Array<{ page: number; text: string }>;
}

export interface KnownIdentifiers {
  names?: string[];
  dateOfBirth?: string | null;
  mrn?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  insuranceId?: string | null;
  ssn?: string | null;
}

export interface PhiRedactionSummary {
  totalRedactions: number;
  byCategory: Record<string, number>;
}

export interface PhiPort {
  /** Replace PHI with deterministic aliases. The alias→value vault never leaves the backend. */
  redact(docs: RawDocument[], known?: KnownIdentifiers): Promise<{ documents: RedactedDocument[]; summary: PhiRedactionSummary }>;
  /** Scanner used by Safe AI pre-flight to block any residual known identifiers. */
  residualScanner?: (text: string) => Array<{ category: string }>;
}

export interface OntologyPort {
  version: string;
  resolveCriteria(criteria: Criterion[]): ResolvedCriterion[];
  resolveFacts(facts: ClinicalFact[]): ResolvedFact[];
}

export interface EvaluationContext {
  screeningDate: string; // YYYY-MM-DD
  patientSex: 'F' | 'M' | null;
  patientAgeYears: number | null;
}

export interface RuleEnginePort {
  version: string;
  evaluate(criteria: ResolvedCriterion[], facts: ResolvedFact[], ctx: EvaluationContext): CriterionEvaluation[];
}

export interface DeterministicSafetyPort {
  check(input: {
    criteria: ResolvedCriterion[];
    facts: ResolvedFact[];
    evaluations: CriterionEvaluation[];
    injectionFindings: number;
    groundingRejections?: number;
  }): SafetyFlagRecord[];
}

export interface DecisionPort {
  decide(evaluations: CriterionEvaluation[], flags: SafetyFlagRecord[]): DecisionOutcome;
}

export interface AuditEventInput {
  eventType: string;
  actorType: 'SYSTEM' | 'AGENT' | 'USER';
  actorId?: string;
  component: string;
  componentVersion: string;
  input?: unknown;
  output?: unknown;
  payload?: Record<string, unknown>;
}

export interface AuditPort {
  record(chainId: string, event: AuditEventInput): Promise<void>;
}

export interface OrchestrationPorts {
  phi: PhiPort;
  ontology: OntologyPort;
  ruleEngine: RuleEnginePort;
  safety: DeterministicSafetyPort;
  decision: DecisionPort;
  audit: AuditPort;
}
