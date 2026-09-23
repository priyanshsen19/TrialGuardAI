/**
 * Lyzr Protocol Criteria Agent.
 *
 * Input : a PHI-redacted protocol (pages)
 * Output: structured, grounded inclusion/exclusion criteria with provenance
 *
 * The agent NEVER evaluates patients or decides eligibility.
 */
import { CriterionSchema, type Criterion, type RedactedDocument } from '../contracts';
import type { ExecutionTelemetry, LyzrInference } from '../lyzr/inference';
import { UNTRUSTED_DATA_CLAUSE, wrapUntrusted } from '../lyzr/prompt-guard';
import type { GroundingViolation, PreflightReport } from '../lyzr/safe-ai';
import { normalizeCriterion } from '../lyzr/normalize';
import { mockExtractProtocol } from './mock-extractor';

export interface ProtocolExtractionResult {
  criteria: Criterion[];
  rejected: GroundingViolation[];
  notes: string[];
  telemetry: ExecutionTelemetry;
  preflight: PreflightReport;
}

export class AgentOutputError extends Error {
  readonly code = 'AGENT_OUTPUT_INVALID';
  constructor(
    readonly agentKey: string,
    readonly errors: string[],
    readonly telemetry: ExecutionTelemetry,
  ) {
    super(`${agentKey} agent returned output that failed schema validation: ${errors.slice(0, 3).join('; ')}`);
    this.name = 'AgentOutputError';
  }
}

export function renderPages(doc: RedactedDocument): string {
  return doc.pages.map((p) => `=== PAGE ${p.page} ===\n${p.text}`).join('\n');
}

export class ProtocolCriteriaAgent {
  constructor(private readonly inference: LyzrInference) {}

  buildMessage(doc: RedactedDocument): string {
    return [
      'TASK: Extract all inclusion and exclusion criteria from the protocol below as JSON {"criteria":[...],"notes":[...]}.',
      'Do not decide eligibility. Do not invent thresholds for qualitative criteria.',
      UNTRUSTED_DATA_CLAUSE,
      wrapUntrusted(doc.documentName, renderPages(doc)),
    ].join('\n\n');
  }

  async extract(doc: RedactedDocument, ctx: { sessionId: string; correlationId?: string }): Promise<ProtocolExtractionResult> {
    const res = await this.inference.invoke({
      agentKey: 'protocol',
      sessionId: ctx.sessionId,
      correlationId: ctx.correlationId,
      message: this.buildMessage(doc),
      documents: [doc],
      simulate: () => JSON.stringify(mockExtractProtocol(doc)),
    });
    const parsed = this.inference.safeAi.parseItems(res.text, 'criteria', CriterionSchema, normalizeCriterion);
    if (!parsed.ok) throw new AgentOutputError('protocol', parsed.errors, res.telemetry);

    // Items failing the strict schema are rejected individually.
    const rejected: GroundingViolation[] = parsed.invalid.map((x) => ({ id: x.id, reason: `schema: ${x.errors.join('; ')}` }));
    // de-duplicate ids (keep first occurrence)
    const seen = new Set<string>();
    const unique = parsed.items.filter((c) => {
      if (seen.has(c.id)) {
        rejected.push({ id: c.id, reason: 'duplicate criterion id' });
        return false;
      }
      seen.add(c.id);
      return true;
    });

    // An ambiguous criterion must not carry an invented threshold.
    const sanitized = unique.map((c) =>
      c.ambiguity === 1 || c.requiresHumanReview
        ? { ...c, requiresHumanReview: true, ambiguity: 1 as const, value: null, range: undefined, values: undefined }
        : c,
    );

    const grounded = this.inference.safeAi.groundCriteria(sanitized, doc);
    return {
      criteria: grounded.accepted,
      rejected: [...rejected, ...grounded.rejected],
      notes: parsed.notes,
      telemetry: res.telemetry,
      preflight: res.preflight,
    };
  }
}
