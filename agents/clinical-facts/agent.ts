/**
 * Lyzr Clinical Facts Agent.
 *
 * Input : PHI-redacted patient documents
 * Output: grounded, structured clinical facts with provenance and uncertainty
 *
 * The agent NEVER determines eligibility, calculates durations, or reconciles
 * conflicting values — those are deterministic backend responsibilities.
 */
import { ClinicalFactSchema, type ClinicalFact, type RedactedDocument } from '../contracts';
import type { ExecutionTelemetry, LyzrInference } from '../lyzr/inference';
import { UNTRUSTED_DATA_CLAUSE, wrapUntrusted } from '../lyzr/prompt-guard';
import type { GroundingViolation, PreflightReport } from '../lyzr/safe-ai';
import { AgentOutputError } from '../protocol-criteria/agent';
import { normalizeFact } from '../lyzr/normalize';
import { mockExtractFacts } from './mock-extractor';

export interface ClinicalFactsResult {
  facts: ClinicalFact[];
  rejected: GroundingViolation[];
  notes: string[];
  telemetry: ExecutionTelemetry;
  preflight: PreflightReport;
}

export function renderDocuments(docs: RedactedDocument[]): string {
  return docs
    .map((d) => d.pages.map((p) => `=== DOCUMENT: ${d.documentName} | PAGE ${p.page} ===\n${p.text}`).join('\n'))
    .join('\n');
}

export class ClinicalFactsAgent {
  constructor(private readonly inference: LyzrInference) {}

  buildMessage(docs: RedactedDocument[]): string {
    return [
      'TASK: Extract all clinical facts from the patient record below as JSON {"facts":[...],"notes":[...]}.',
      'Preserve values, units, dates and provenance verbatim. Mark vague dates as datePrecision "unknown". Do not determine eligibility.',
      UNTRUSTED_DATA_CLAUSE,
      wrapUntrusted('patient-record', renderDocuments(docs)),
    ].join('\n\n');
  }

  async extract(docs: RedactedDocument[], ctx: { sessionId: string; correlationId?: string }): Promise<ClinicalFactsResult> {
    const res = await this.inference.invoke({
      agentKey: 'patient',
      sessionId: ctx.sessionId,
      correlationId: ctx.correlationId,
      message: this.buildMessage(docs),
      documents: docs,
      simulate: () => JSON.stringify(mockExtractFacts(docs)),
    });
    const parsed = this.inference.safeAi.parseItems(res.text, 'facts', ClinicalFactSchema, normalizeFact);
    if (!parsed.ok) throw new AgentOutputError('patient', parsed.errors, res.telemetry);
    const grounded = this.inference.safeAi.groundFacts(parsed.items, docs);
    return {
      facts: grounded.accepted,
      rejected: [...parsed.invalid.map((x) => ({ id: x.id, reason: `schema: ${x.errors.join('; ')}` })), ...grounded.rejected],
      notes: parsed.notes,
      telemetry: res.telemetry,
      preflight: res.preflight,
    };
  }
}
