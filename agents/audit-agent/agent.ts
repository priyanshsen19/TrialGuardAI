/**
 * Lyzr Audit Narration Agent.
 *
 * Receives ONLY verified structured data and produces a readable narrative.
 * It cannot modify results, values, timestamps, evidence, decisions or
 * confidence: dossier critical fields are rendered from application data, and
 * the narrative itself is rejected (deterministic fallback used) if it
 * introduces numbers, contradicts the decision, or makes regulatory claims.
 */
import { AuditNarrativeSchema, type AuditNarrative, type VerifiedScreeningSummary } from '../contracts';
import type { ExecutionTelemetry, LyzrInference } from '../lyzr/inference';
import { UNTRUSTED_DATA_CLAUSE } from '../lyzr/prompt-guard';
import type { PreflightReport } from '../lyzr/safe-ai';
import { templateNarrative } from './mock-narrator';

export interface AuditNarrationResult {
  narrative: AuditNarrative;
  source: 'agent' | 'deterministic-fallback';
  violations: string[];
  telemetry: ExecutionTelemetry | null;
  preflight: PreflightReport | null;
}

export class AuditNarrationAgent {
  constructor(private readonly inference: LyzrInference) {}

  buildMessage(summary: VerifiedScreeningSummary): string {
    return [
      'TASK: Write {"summary":"...","keyPoints":[...]} describing this verified screening. Restate values exactly; add nothing.',
      UNTRUSTED_DATA_CLAUSE,
      `VERIFIED_SCREENING_DATA:\n${JSON.stringify(summary)}`,
    ].join('\n\n');
  }

  async narrate(summary: VerifiedScreeningSummary, ctx: { sessionId: string; correlationId?: string }): Promise<AuditNarrationResult> {
    try {
      const res = await this.inference.invoke({
        agentKey: 'audit',
        sessionId: ctx.sessionId,
        correlationId: ctx.correlationId,
        message: this.buildMessage(summary),
        documents: [],
        simulate: () => JSON.stringify(templateNarrative(summary)),
      });
      const parsed = this.inference.safeAi.parseStructured(res.text, AuditNarrativeSchema);
      const violations = parsed.ok
        ? this.inference.safeAi.checkNarrative([parsed.data.summary, ...parsed.data.keyPoints].join(' '), summary, summary.decision)
        : parsed.errors;
      if (parsed.ok && violations.length === 0) {
        return { narrative: parsed.data, source: 'agent', violations: [], telemetry: res.telemetry, preflight: res.preflight };
      }
      return { narrative: templateNarrative(summary), source: 'deterministic-fallback', violations, telemetry: res.telemetry, preflight: res.preflight };
    } catch (err) {
      return {
        narrative: templateNarrative(summary),
        source: 'deterministic-fallback',
        violations: [`narration agent unavailable: ${(err as Error).message}`],
        telemetry: null,
        preflight: null,
      };
    }
  }
}
