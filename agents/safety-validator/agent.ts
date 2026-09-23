/**
 * Lyzr Safety Validator Agent.
 *
 * Adds evidence-quality / safety flags to a screening. It can only ADD flags;
 * it never changes rule-engine output. A BLOCKING flag can move an otherwise
 * ELIGIBLE screening to REQUIRES_HUMAN_OVERVIEW, never to ELIGIBLE, and never
 * overturns INELIGIBLE.
 */
import { SafetyFlagSchema, type SafetyFlagRecord } from '../contracts';
import type { ExecutionTelemetry, LyzrInference } from '../lyzr/inference';
import { UNTRUSTED_DATA_CLAUSE, wrapUntrusted } from '../lyzr/prompt-guard';
import type { PreflightReport } from '../lyzr/safe-ai';
import { AgentOutputError } from '../protocol-criteria/agent';
import { renderDocuments } from '../clinical-facts/agent';
import { normalizeFlag } from '../lyzr/normalize';
import { mockValidateSafety, type SafetyAgentInput } from './mock-validator';

export interface SafetyValidationResult {
  flags: SafetyFlagRecord[];
  summary: string;
  telemetry: ExecutionTelemetry;
  preflight: PreflightReport;
  droppedFlags: number;
}

export class SafetyValidatorAgent {
  constructor(private readonly inference: LyzrInference) {}

  buildMessage(input: SafetyAgentInput): string {
    const structured = {
      facts: input.facts.map((f) => ({
        factId: f.factId,
        category: f.category,
        concept: f.resolution.concept ?? f.concept,
        mapping: f.resolution.status,
        value: f.value,
        unit: f.unit,
        observedAt: f.observedAt,
        onsetDate: f.onsetDate ?? null,
        startDate: f.startDate ?? null,
        endDate: f.endDate ?? null,
        status: f.status ?? null,
        datePrecision: f.datePrecision,
        dateText: f.dateText ?? null,
        uncertainty: f.uncertainty,
      })),
      evaluations: input.evaluations.map((e) => ({
        criterionId: e.criterionId,
        category: e.category,
        mandatory: e.mandatory,
        result: e.result,
        ruleExpression: e.ruleExpression,
        reason: e.reason,
        evidenceFactIds: e.evidence.map((x) => x.factId),
      })),
    };
    return [
      'TASK: Review the structured screening data and redacted clinical notes. Return {"flags":[...],"summary":"..."}.',
      'You may only add flags. Never change results or decide eligibility.',
      UNTRUSTED_DATA_CLAUSE,
      `STRUCTURED_DATA (verified, application-generated):\n${JSON.stringify(structured)}`,
      wrapUntrusted('clinical-notes', renderDocuments(input.clinicalNotes)),
    ].join('\n\n');
  }

  async validate(input: SafetyAgentInput, ctx: { sessionId: string; correlationId?: string }): Promise<SafetyValidationResult> {
    const res = await this.inference.invoke({
      agentKey: 'safety',
      sessionId: ctx.sessionId,
      correlationId: ctx.correlationId,
      message: this.buildMessage(input),
      documents: input.clinicalNotes,
      simulate: () => JSON.stringify(mockValidateSafety(input)),
    });
    const parsed = this.inference.safeAi.parseItems(res.text, 'flags', SafetyFlagSchema, normalizeFlag);
    if (!parsed.ok) throw new AgentOutputError('safety', parsed.errors, res.telemetry);

    // Referential integrity: flags may only reference facts/criteria that exist.
    const factIds = new Set(input.facts.map((f) => f.factId));
    const criterionIds = new Set(input.evaluations.map((e) => e.criterionId));
    let dropped = parsed.invalid.length;
    const flags: SafetyFlagRecord[] = [];
    for (const f of parsed.items) {
      if (f.factIds.some((id) => !factIds.has(id)) || f.criterionIds.some((id) => !criterionIds.has(id))) {
        dropped++;
        continue;
      }
      // Groundedness: a flag that cites no evidence stays visible to the
      // reviewer but carries no weight (INFO → no confidence penalty).
      if (f.factIds.length === 0 && f.criterionIds.length === 0) {
        flags.push({ ...f, severity: 'INFO', description: `[Unsupported — cites no fact or criterion; informational only] ${f.description}`, source: 'agent' });
        continue;
      }
      // Deterministic cross-check: show the reviewer what the rule engine
      // computed from the same evidence, next to the agent's claim.
      const checks = input.evaluations
        .filter((e) => f.criterionIds.includes(e.criterionId) || e.evidence.some((ev) => f.factIds.includes(ev.factId)))
        .map((e) => `${e.criterionId} ${e.result}: ${e.ruleExpression}`);
      flags.push({ ...f, description: checks.length ? `${f.description} [Deterministic cross-check on cited evidence — ${checks.join('; ')}]` : f.description, source: 'agent' });
    }
    return { flags, summary: parsed.summary, telemetry: res.telemetry, preflight: res.preflight, droppedFlags: dropped };
  }
}
