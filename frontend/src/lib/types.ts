export type Decision = 'ELIGIBLE' | 'INELIGIBLE' | 'REQUIRES_HUMAN_OVERVIEW';
export type Result = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface Evidence {
  factId: string;
  display: string;
  value: unknown;
  unit: string | null;
  normalizedValue?: unknown;
  normalizedUnit?: string | null;
  observedAt: string | null;
  sourceDocument: string;
  page: number;
  quote: string;
}

export interface Evaluation {
  id: string;
  criterionKey: string;
  category: 'inclusion' | 'exclusion';
  mandatory: boolean;
  requirement: string;
  result: Result;
  operator: string;
  expectedValue: string;
  actualValue: string | null;
  ruleExpression: string;
  reason: string;
  reviewReasons: string[];
  evidence: Evidence[];
  confidence: number;
  sourcePage: number;
  sourceSection: string;
}

export interface Flag {
  id: string;
  code: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  description: string;
  source: string;
  criterionIds: string[];
  factIds: string[];
}

export interface ReviewDecision {
  id: string;
  action: string;
  reason: string;
  reviewerRole: string;
  resultingDecision: Decision | null;
  signatureHash: string;
  createdAt: string;
  reviewer: { displayName: string; email: string };
}

export interface ReviewTask {
  id: string;
  status: 'OPEN' | 'AWAITING_INFORMATION' | 'ESCALATED' | 'RESOLVED';
  reasons: string[];
  priority: string;
  confidence: number;
  createdAt: string;
  resolvedAt: string | null;
  decisions: ReviewDecision[];
}

export interface Execution {
  id: string;
  agentKey: string;
  agentName: string;
  agentVersion: string;
  agentId: string | null;
  provider: 'mock' | 'lyzr';
  status: string;
  latencyMs: number;
  attempts: number;
  inputHash: string;
  outputHash: string | null;
  injectionDetected: boolean;
  cacheHit?: boolean;
  startedAt: string;
}

export interface ScreeningDetail {
  id: string;
  screeningRef: string;
  status: string;
  decision: Decision | null;
  finalDecision: Decision | null;
  confidence: number | null;
  decisionReasons: string[] | null;
  confidenceBreakdown: { criterionMean: number; safetyPenalty: number; formula: string } | null;
  screeningDate: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  trial: { id: string; code: string; title: string };
  patient: { id: string; patientRef: string; sex: string | null };
  protocolVersion: { id: string; version: string; contentHash: string; redactedHash: string | null; pageCount: number };
  patientVersion: { id: string; versionNumber: number; snapshotHash: string; phiSummary: { totalRedactions: number; byCategory: Record<string, number> } | null };
  evaluations: Evaluation[];
  flags: Flag[];
  reviewTasks: ReviewTask[];
  dossiers: Array<{ version: number; jsonHash: string; pdfHash: string; auditRootHash: string; chainValid: boolean; generatedAt: string }>;
  executions: Execution[];
  stages: Array<{ stage: string; description: string; completed: boolean }>;
  context: { screeningDate: string; patientSex: string | null; patientAgeYears: number | null } | null;
  ontologySummary: { version: string; mappedFacts: number; unmappedFacts: string[]; unresolvedCriteria: string[] } | null;
  safetySummary: string | null;
  narrative: { narrative: { summary: string; keyPoints: string[] }; source: string; violations: string[] } | null;
  ruleEngineVersion: string;
  lyzrMode: 'mock' | 'live';
}

export interface ScreeningRow {
  id: string;
  screeningRef: string;
  trialCode: string;
  patientRef: string;
  status: string;
  decision: Decision | null;
  finalDecision: Decision | null;
  confidence: number | null;
  screeningDate: string;
  safetyFlags: number;
  reviewStatus: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  sequence: number;
  timestamp: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  component: string;
  componentVersion: string;
  inputHash: string | null;
  outputHash: string | null;
  payload: Record<string, unknown>;
  previousEventHash: string;
  eventHash: string;
}

export interface Verification {
  valid: boolean;
  eventsVerified: number;
  rootHash: string | null;
  sealedRootHash?: string | null;
  sealedRootMatches?: boolean | null;
  reason?: string;
  firstInvalidSequence?: number;
  verifiedAt?: string;
}
