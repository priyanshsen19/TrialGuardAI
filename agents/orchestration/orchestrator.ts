/**
 * TrialGuard multi-agent orchestration.
 *
 * Coordinates the four Lyzr agents with the backend's deterministic services:
 *
 *   protocol-extraction  : PHI scrub → Protocol Criteria Agent → grounding → ontology
 *   patient-extraction   : PHI scrub → Clinical Facts Agent → grounding → ontology
 *   ontology-validation  : re-resolve criteria + facts against the pinned ontology
 *   screening-evaluation : deterministic rule engine (no LLM)
 *   safety-validation    : deterministic checks + Safety Validator Agent
 *                          → deterministic confidence → deterministic decision
 *   audit-generation     : Audit Narration Agent (verified data only, guarded)
 *   dossier-generation   : backend renders PDF/JSON from application data
 *
 * Each screening stage is a pure function of a serialisable ScreeningState so
 * the backend can run stages inline or as BullMQ jobs, idempotently.
 */
import type {
  AuditNarrative,
  ClinicalFact,
  Criterion,
  CrossValidationReport,
  CriterionEvaluation,
  DecisionOutcome,
  RedactedDocument,
  ResolvedCriterion,
  ResolvedFact,
  SafetyFlagRecord,
  VerifiedScreeningSummary,
} from '../contracts';
import { AuditNarrationAgent } from '../audit-agent/agent';
import { ClinicalFactsAgent } from '../clinical-facts/agent';
import { AGENT_DEFINITIONS } from '../lyzr/configuration';
import type { ExecutionTelemetry, LyzrInference } from '../lyzr/inference';
import { detectPromptInjection, type GroundingViolation } from '../lyzr/safe-ai';
import { AgentOutputError, ProtocolCriteriaAgent } from '../protocol-criteria/agent';
import { mockExtractProtocol } from '../protocol-criteria/mock-extractor';
import { mockExtractFacts } from '../clinical-facts/mock-extractor';
import { crossValidateCriteria, crossValidateFacts } from './cross-validation';
import { SafetyValidatorAgent } from '../safety-validator/agent';
import type { EvaluationContext, KnownIdentifiers, OrchestrationPorts, PhiRedactionSummary, RawDocument } from './ports';

export const ORCHESTRATOR_VERSION = '1.0.0';

export const QUEUES = [
  'protocol-extraction',
  'patient-extraction',
  'ontology-validation',
  'screening-evaluation',
  'safety-validation',
  'audit-generation',
  'dossier-generation',
] as const;
export type QueueName = (typeof QUEUES)[number];

/** Ordered screening stage graph. `next` drives queue chaining in the backend. */
export const SCREENING_STAGE_GRAPH: Array<{ stage: QueueName; next: QueueName | null; description: string }> = [
  { stage: 'ontology-validation', next: 'screening-evaluation', description: 'Resolve criteria and facts to LOINC / SNOMED CT / ICD-10 / RxNorm' },
  { stage: 'screening-evaluation', next: 'safety-validation', description: 'Deterministic rule engine evaluates every criterion' },
  { stage: 'safety-validation', next: 'audit-generation', description: 'Safety checks, confidence calculation, final decision' },
  { stage: 'audit-generation', next: 'dossier-generation', description: 'Guarded audit narrative + audit seal' },
  { stage: 'dossier-generation', next: null, description: 'FDA-style audit dossier (PDF + JSON)' },
];

export interface ScreeningState {
  screeningId: string;
  /** Stable human reference (SCR-00001). Used in agent inputs so identical screenings hit the inference cache. */
  screeningRef?: string;
  trialCode: string;
  protocolVersion: string;
  patientRef: string;
  context: EvaluationContext;
  rawCriteria: Criterion[];
  rawFacts: ClinicalFact[];
  clinicalNotes: RedactedDocument[];
  injectionFindings: number;
  groundingRejections: number;
  resolvedCriteria?: ResolvedCriterion[];
  resolvedFacts?: ResolvedFact[];
  ontologySummary?: { version: string; mappedFacts: number; unmappedFacts: string[]; unresolvedCriteria: string[] };
  evaluations?: CriterionEvaluation[];
  safetyFlags?: SafetyFlagRecord[];
  safetySummary?: string;
  decision?: DecisionOutcome;
  narrative?: { narrative: AuditNarrative; source: string; violations: string[] };
  executions: ExecutionTelemetry[];
  completedStages: QueueName[];
}

export interface ProtocolPipelineResult {
  documents: RedactedDocument[];
  phi: PhiRedactionSummary;
  criteria: ResolvedCriterion[];
  rejected: GroundingViolation[];
  notes: string[];
  injectionFindings: Array<{ pattern: string; location: string; excerpt?: string }>;
  execution: ExecutionTelemetry;
  /** Present in live mode: LLM vs deterministic reference parser comparison. */
  crossValidation: CrossValidationReport | null;
}

export interface PatientPipelineResult {
  documents: RedactedDocument[];
  phi: PhiRedactionSummary;
  facts: ResolvedFact[];
  rejected: GroundingViolation[];
  notes: string[];
  injectionFindings: Array<{ pattern: string; location: string; excerpt?: string }>;
  execution: ExecutionTelemetry;
  crossValidation: CrossValidationReport | null;
}

const hashable = (o: unknown) => o;

export class TrialGuardOrchestrator {
  readonly protocolAgent: ProtocolCriteriaAgent;
  readonly clinicalFactsAgent: ClinicalFactsAgent;
  readonly safetyAgent: SafetyValidatorAgent;
  readonly auditAgent: AuditNarrationAgent;

  constructor(
    readonly inference: LyzrInference,
    readonly ports: OrchestrationPorts,
  ) {
    this.protocolAgent = new ProtocolCriteriaAgent(inference);
    this.clinicalFactsAgent = new ClinicalFactsAgent(inference);
    this.safetyAgent = new SafetyValidatorAgent(inference);
    this.auditAgent = new AuditNarrationAgent(inference);
  }

  // -------------------------------------------------------------------------
  // Ingestion pipelines
  // -------------------------------------------------------------------------

  async extractProtocol(chainId: string, raw: RawDocument, ctx: { correlationId?: string }): Promise<ProtocolPipelineResult> {
    const { documents, summary } = await this.ports.phi.redact([raw]);
    await this.ports.audit.record(chainId, {
      eventType: 'PHI_REDACTED',
      actorType: 'SYSTEM',
      component: 'phi-redactor',
      componentVersion: '1.0.0',
      input: { documentName: raw.documentName, pages: raw.pages.length },
      output: summary,
      payload: { ...summary },
    });
    const doc = documents[0];
    const injection = doc.pages.flatMap((p) => detectPromptInjection(p.text, `${doc.documentName}#page=${p.page}`));

    // 1. LLM extraction (Lyzr in live mode, simulator in mock mode).
    let res: Awaited<ReturnType<ProtocolCriteriaAgent['extract']>> | null = null;
    let llmRejected: string[] | undefined;
    let telemetry: ExecutionTelemetry;
    try {
      res = await this.protocolAgent.extract(doc, { sessionId: chainId, correlationId: ctx.correlationId });
      telemetry = res.telemetry;
    } catch (err) {
      // Live-mode resilience: a malformed LLM response degrades to the
      // verified deterministic parse (recorded), instead of failing ingestion.
      if (!(err instanceof AgentOutputError) || err.telemetry.provider !== 'lyzr') throw err;
      llmRejected = err.errors;
      telemetry = err.telemetry;
    }
    await this.recordExecution(chainId, telemetry);

    // 2. Criteria Validation: in live mode, cross-validate against the
    //    deterministic reference parser (grounded by construction).
    let resolved: ResolvedCriterion[];
    let crossValidation: CrossValidationReport | null = null;
    if (telemetry.provider === 'lyzr') {
      const reference = this.inference.safeAi.groundCriteria(mockExtractProtocol(doc).criteria, doc).accepted;
      const cv = crossValidateCriteria(this.ports.ontology.resolveCriteria(res?.criteria ?? []), this.ports.ontology.resolveCriteria(reference), llmRejected);
      resolved = cv.criteria;
      crossValidation = cv.report;
      await this.ports.audit.record(chainId, {
        eventType: 'CRITERIA_CROSS_VALIDATED',
        actorType: 'SYSTEM',
        component: 'cross-validation',
        componentVersion: '1.0.0',
        input: { llm: res?.criteria ?? [], reference },
        output: resolved,
        payload: summarizeCrossValidation(cv.report),
      });
    } else {
      resolved = this.ports.ontology.resolveCriteria(res!.criteria).map((c) => ({ ...c, extraction: { method: 'simulator' as const } }));
    }
    await this.ports.audit.record(chainId, {
      eventType: 'CRITERIA_EXTRACTED',
      actorType: 'AGENT',
      actorId: telemetry.provider === 'lyzr' ? (telemetry.agentId ?? undefined) : 'mock:protocol',
      component: AGENT_DEFINITIONS.protocol.name,
      componentVersion: AGENT_DEFINITIONS.protocol.version,
      input: hashable({ inputHash: telemetry.inputHash }),
      output: resolved,
      payload: {
        provider: telemetry.provider,
        criteria: resolved.length,
        ambiguous: resolved.filter((c) => c.ambiguity === 1).map((c) => c.id),
        groundingRejected: res?.rejected ?? [],
        injectionFindings: injection.length,
        ontologyVersion: this.ports.ontology.version,
      },
    });
    return {
      documents,
      phi: summary,
      criteria: resolved,
      rejected: res?.rejected ?? [],
      notes: res?.notes ?? [],
      injectionFindings: injection.map(({ pattern, location, excerpt }) => ({ pattern, location, excerpt })),
      execution: telemetry,
      crossValidation,
    };
  }

  async extractPatient(chainId: string, raw: RawDocument[], known: KnownIdentifiers, ctx: { correlationId?: string }): Promise<PatientPipelineResult> {
    const { documents, summary } = await this.ports.phi.redact(raw, known);
    await this.ports.audit.record(chainId, {
      eventType: 'PHI_REDACTED',
      actorType: 'SYSTEM',
      component: 'phi-redactor',
      componentVersion: '1.0.0',
      input: { documents: raw.map((d) => ({ name: d.documentName, pages: d.pages.length })) },
      output: summary,
      payload: { ...summary },
    });
    const injection = documents.flatMap((d) => d.pages.flatMap((p) => detectPromptInjection(p.text, `${d.documentName}#page=${p.page}`)));

    let res: Awaited<ReturnType<ClinicalFactsAgent['extract']>> | null = null;
    let llmRejected: string[] | undefined;
    let telemetry: ExecutionTelemetry;
    try {
      res = await this.clinicalFactsAgent.extract(documents, { sessionId: chainId, correlationId: ctx.correlationId });
      telemetry = res.telemetry;
    } catch (err) {
      if (!(err instanceof AgentOutputError) || err.telemetry.provider !== 'lyzr') throw err;
      llmRejected = err.errors;
      telemetry = err.telemetry;
    }
    await this.recordExecution(chainId, telemetry);

    let resolved: ResolvedFact[];
    let crossValidation: CrossValidationReport | null = null;
    if (telemetry.provider === 'lyzr') {
      const reference = this.inference.safeAi.groundFacts(mockExtractFacts(documents).facts, documents).accepted;
      const cv = crossValidateFacts(this.ports.ontology.resolveFacts(res?.facts ?? []), this.ports.ontology.resolveFacts(reference), llmRejected);
      resolved = cv.facts;
      crossValidation = cv.report;
      await this.ports.audit.record(chainId, {
        eventType: 'FACTS_CROSS_VALIDATED',
        actorType: 'SYSTEM',
        component: 'cross-validation',
        componentVersion: '1.0.0',
        input: { llm: res?.facts ?? [], reference },
        output: resolved,
        payload: summarizeCrossValidation(cv.report),
      });
    } else {
      resolved = this.ports.ontology.resolveFacts(res!.facts).map((f) => ({ ...f, extraction: { method: 'simulator' as const } }));
    }
    await this.ports.audit.record(chainId, {
      eventType: 'FACTS_EXTRACTED',
      actorType: 'AGENT',
      actorId: telemetry.provider === 'lyzr' ? (telemetry.agentId ?? undefined) : 'mock:patient',
      component: AGENT_DEFINITIONS.patient.name,
      componentVersion: AGENT_DEFINITIONS.patient.version,
      input: { inputHash: telemetry.inputHash },
      output: resolved,
      payload: {
        provider: telemetry.provider,
        facts: resolved.length,
        unmapped: resolved.filter((f) => f.resolution.status !== 'MAPPED').map((f) => f.factId),
        groundingRejected: res?.rejected ?? [],
        injectionFindings: injection.length,
        ontologyVersion: this.ports.ontology.version,
      },
    });
    return {
      documents,
      phi: summary,
      facts: resolved,
      rejected: res?.rejected ?? [],
      notes: res?.notes ?? [],
      injectionFindings: injection.map(({ pattern, location, excerpt }) => ({ pattern, location, excerpt })),
      execution: telemetry,
      crossValidation,
    };
  }

  // -------------------------------------------------------------------------
  // Screening stages
  // -------------------------------------------------------------------------

  async runStage(stage: QueueName, state: ScreeningState, ctx: { correlationId?: string } = {}): Promise<ScreeningState> {
    if (state.completedStages.includes(stage)) return state; // idempotent re-delivery
    let next: ScreeningState;
    switch (stage) {
      case 'ontology-validation':
        next = await this.ontologyValidation(state);
        break;
      case 'screening-evaluation':
        next = await this.deterministicEvaluation(state);
        break;
      case 'safety-validation':
        next = await this.safetyAndDecision(state, ctx);
        break;
      case 'audit-generation':
        next = await this.auditNarration(state, ctx);
        break;
      case 'dossier-generation':
        next = state; // rendered by the backend dossier service
        break;
      default:
        throw new Error(`Stage ${stage} is not a screening stage`);
    }
    return { ...next, completedStages: [...next.completedStages, stage] };
  }

  /** Run the full screening graph in-process (used by inline queue mode and tests). */
  async runScreening(state: ScreeningState, ctx: { correlationId?: string } = {}): Promise<ScreeningState> {
    let s = state;
    for (const { stage } of SCREENING_STAGE_GRAPH) s = await this.runStage(stage, s, ctx);
    return s;
  }

  private async ontologyValidation(state: ScreeningState): Promise<ScreeningState> {
    const resolvedCriteria = this.ports.ontology.resolveCriteria(state.rawCriteria);
    const resolvedFacts = this.ports.ontology.resolveFacts(state.rawFacts);
    const ontologySummary = {
      version: this.ports.ontology.version,
      mappedFacts: resolvedFacts.filter((f) => f.resolution.status === 'MAPPED').length,
      unmappedFacts: resolvedFacts.filter((f) => f.resolution.status !== 'MAPPED').map((f) => f.factId),
      unresolvedCriteria: resolvedCriteria.filter((c) => c.resolution.unresolvedTerms.length > 0).map((c) => c.id),
    };
    await this.ports.audit.record(state.screeningId, {
      eventType: 'ONTOLOGY_VALIDATED',
      actorType: 'SYSTEM',
      component: 'ontology-service',
      componentVersion: this.ports.ontology.version,
      input: { criteria: state.rawCriteria, facts: state.rawFacts },
      output: { resolvedCriteria, resolvedFacts },
      payload: ontologySummary,
    });
    return { ...state, resolvedCriteria, resolvedFacts, ontologySummary };
  }

  private async deterministicEvaluation(state: ScreeningState): Promise<ScreeningState> {
    if (!state.resolvedCriteria || !state.resolvedFacts) throw new Error('ontology-validation must run before screening-evaluation');
    const evaluations = this.ports.ruleEngine.evaluate(state.resolvedCriteria, state.resolvedFacts, state.context);
    for (const e of evaluations) {
      const criterion = state.resolvedCriteria.find((c) => c.id === e.criterionId);
      await this.ports.audit.record(state.screeningId, {
        eventType: 'CRITERION_EVALUATED',
        actorType: 'SYSTEM',
        component: 'rule-engine',
        componentVersion: this.ports.ruleEngine.version,
        input: { criterion, evidence: e.evidence, context: state.context },
        output: e,
        payload: {
          criterionId: e.criterionId,
          result: e.result,
          operator: e.operator,
          expectedValue: e.expectedValue,
          actualValue: e.actualValue,
          ruleExpression: e.ruleExpression,
        },
      });
    }
    return { ...state, evaluations };
  }

  private async safetyAndDecision(state: ScreeningState, ctx: { correlationId?: string }): Promise<ScreeningState> {
    if (!state.evaluations || !state.resolvedFacts || !state.resolvedCriteria) throw new Error('screening-evaluation must run before safety-validation');
    const deterministic = this.ports.safety.check({
      criteria: state.resolvedCriteria,
      facts: state.resolvedFacts,
      evaluations: state.evaluations,
      injectionFindings: state.injectionFindings,
      groundingRejections: state.groundingRejections,
    });
    const agent = await this.safetyAgent.validate(
      { facts: state.resolvedFacts, evaluations: state.evaluations, clinicalNotes: state.clinicalNotes },
      { sessionId: state.screeningId, correlationId: ctx.correlationId },
    );
    await this.recordExecution(state.screeningId, agent.telemetry);

    const flags = dedupeFlags([...deterministic, ...agent.flags]);
    for (const f of flags) {
      await this.ports.audit.record(state.screeningId, {
        eventType: 'SAFETY_FLAG_RAISED',
        actorType: f.source === 'agent' ? 'AGENT' : 'SYSTEM',
        component: f.source === 'agent' ? AGENT_DEFINITIONS.safety.name : 'deterministic-safety',
        componentVersion: f.source === 'agent' ? AGENT_DEFINITIONS.safety.version : '1.0.0',
        output: f,
        payload: { code: f.code, severity: f.severity, source: f.source, criterionIds: f.criterionIds, factIds: f.factIds },
      });
    }
    await this.ports.audit.record(state.screeningId, {
      eventType: 'SAFETY_VALIDATION_COMPLETED',
      actorType: 'SYSTEM',
      component: 'safety-validation',
      componentVersion: '1.0.0',
      output: flags,
      payload: {
        flags: flags.length,
        blocking: flags.filter((f) => f.severity === 'BLOCKING').length,
        agentProvider: agent.telemetry.provider,
        agentFlagsDropped: agent.droppedFlags,
      },
    });

    const decision = this.ports.decision.decide(state.evaluations, flags);
    await this.ports.audit.record(state.screeningId, {
      eventType: 'CONFIDENCE_CALCULATED',
      actorType: 'SYSTEM',
      component: 'decision-engine',
      componentVersion: this.ports.ruleEngine.version,
      input: { evaluations: state.evaluations.map((e) => ({ id: e.criterionId, result: e.result, confidence: e.confidence })), flags: flags.map((f) => f.severity) },
      output: decision.confidenceBreakdown,
      payload: { confidence: decision.confidence, ...decision.confidenceBreakdown },
    });
    await this.ports.audit.record(state.screeningId, {
      eventType: 'DECISION_RENDERED',
      actorType: 'SYSTEM',
      component: 'decision-engine',
      componentVersion: this.ports.ruleEngine.version,
      input: { evaluations: state.evaluations, flags },
      output: decision,
      payload: { decision: decision.decision, confidence: decision.confidence, reasons: decision.reasons },
    });
    return { ...state, safetyFlags: flags, safetySummary: agent.summary, decision };
  }

  private async auditNarration(state: ScreeningState, ctx: { correlationId?: string }): Promise<ScreeningState> {
    if (!state.decision || !state.evaluations) throw new Error('safety-validation must run before audit-generation');
    const summary = buildVerifiedSummary(state);
    const res = await this.auditAgent.narrate(summary, { sessionId: state.screeningId, correlationId: ctx.correlationId });
    if (res.telemetry) await this.recordExecution(state.screeningId, res.telemetry);
    await this.ports.audit.record(state.screeningId, {
      eventType: 'NARRATIVE_GENERATED',
      actorType: res.source === 'agent' ? 'AGENT' : 'SYSTEM',
      component: res.source === 'agent' ? AGENT_DEFINITIONS.audit.name : 'narrative-template',
      componentVersion: AGENT_DEFINITIONS.audit.version,
      input: summary,
      output: res.narrative,
      payload: { source: res.source, guardViolations: res.violations.length, authoritative: false },
    });
    return { ...state, narrative: { narrative: res.narrative, source: res.source, violations: res.violations } };
  }

  private async recordExecution(chainId: string, t: ExecutionTelemetry) {
    await this.ports.audit.record(chainId, {
      eventType: 'AGENT_INVOKED',
      actorType: 'AGENT',
      actorId: t.provider === 'lyzr' ? (t.agentId ?? undefined) : `mock:${t.agentKey}`,
      component: t.agentName,
      componentVersion: t.agentVersion,
      payload: {
        executionId: t.executionId,
        provider: t.provider,
        status: t.status,
        cacheHit: t.cacheHit,
        ...(t.cachedFromExecutionId ? { cachedFromExecutionId: t.cachedFromExecutionId } : {}),
        latencyMs: t.latencyMs,
        attempts: t.attempts,
        inputHash: t.inputHash,
        outputHash: t.outputHash,
        injectionDetected: t.injectionDetected,
        environmentId: t.environmentId,
      },
    });
  }
}

export function buildVerifiedSummary(state: ScreeningState, review?: VerifiedScreeningSummary['review']): VerifiedScreeningSummary {
  const ev = state.evaluations ?? [];
  const d = state.decision!;
  return {
    screeningId: state.screeningRef ?? state.screeningId,
    trialCode: state.trialCode,
    protocolVersion: state.protocolVersion,
    patientRef: state.patientRef,
    decision: d.decision,
    confidencePct: Math.round(d.confidence * 1000) / 10,
    counts: {
      total: ev.length,
      pass: ev.filter((e) => e.result === 'PASS').length,
      fail: ev.filter((e) => e.result === 'FAIL').length,
      unknown: ev.filter((e) => e.result === 'UNKNOWN').length,
      notApplicable: ev.filter((e) => e.result === 'NOT_APPLICABLE').length,
    },
    failed: ev.filter((e) => e.result === 'FAIL').map((e) => ({ criterionId: e.criterionId, ruleExpression: e.ruleExpression })),
    unknown: ev.filter((e) => e.result === 'UNKNOWN').map((e) => ({ criterionId: e.criterionId, reason: e.reason })),
    safetyFlags: (state.safetyFlags ?? []).map((f) => ({ code: f.code, severity: f.severity })),
    review: review ?? null,
  };
}

export function dedupeFlags(flags: SafetyFlagRecord[]): SafetyFlagRecord[] {
  const out = new Map<string, SafetyFlagRecord>();
  const rank = { INFO: 0, WARNING: 1, BLOCKING: 2 } as const;
  for (const f of flags) {
    const key = `${f.code}|${[...f.criterionIds].sort().join(',')}|${[...f.factIds].sort().join(',')}`;
    const prev = out.get(key);
    if (!prev || rank[f.severity] > rank[prev.severity]) out.set(key, f);
  }
  return [...out.values()];
}

/** PHI-free audit summary of a cross-validation report. */
export function summarizeCrossValidation(r: CrossValidationReport) {
  return {
    method: r.method,
    llmItems: r.llmItems,
    deterministicItems: r.deterministicItems,
    agreed: r.agreed.length,
    resolved: r.resolved.map((x) => ({ id: x.id, fields: x.disagreements.map((d) => d.split(':')[0]) })),
    recovered: r.recovered.length,
    llmOnly: r.llmOnly.length,
    llmOutputRejected: !!r.llmOutputRejected,
    agreementRate: r.agreementRate,
  };
}
