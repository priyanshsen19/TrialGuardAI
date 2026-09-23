import { Injectable } from '@nestjs/common';
import {
  agentManifest,
  createAgentRuntime,
  describeEnvironment,
  SCREENING_STAGE_GRAPH,
  type ExecutionTelemetry,
  type OrchestrationPorts,
} from '@trialguard/agents';
import { logger } from '../common/logger';
import { AuditService } from '../audit/audit.service';
import { OntologyService } from '../ontology/ontology.service';
import { PhiService } from '../phi/phi.service';
import { PrismaService } from '../prisma/prisma.service';
import { RuleEngineService } from '../rule-engine/rule-engine.service';

/**
 * Backend adapter for the /agents package: injects the deterministic backend
 * services as orchestration ports and persists PHI-free Lyzr execution
 * telemetry (LyzrExecution rows; flagged for AIMS export when enabled).
 */
@Injectable()
export class LyzrRuntimeService {
  readonly runtime: ReturnType<typeof createAgentRuntime>;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    phi: PhiService,
    ontology: OntologyService,
    ruleEngine: RuleEngineService,
    audit: AuditService,
  ) {
    const ports: OrchestrationPorts = {
      phi,
      ontology,
      ruleEngine: { version: ruleEngine.version, evaluate: (c, f, ctx) => ruleEngine.evaluate(c, f, ctx) },
      safety: { check: (input) => ruleEngine.safetyChecks(input) },
      decision: { decide: (e, f) => ruleEngine.decide(e, f) },
      audit,
    };
    const cacheEnabled = (process.env.LYZR_CACHE_ENABLED ?? 'true') !== 'false';
    this.runtime = createAgentRuntime(ports, {
      cache: cacheEnabled
        ? {
            get: async (key) => {
              const row = await this.prisma.inferenceCache.findUnique({ where: { key } });
              if (!row) return null;
              await this.prisma.inferenceCache.update({ where: { key }, data: { hits: { increment: 1 }, lastHitAt: new Date() } });
              return { text: row.responseText, executionId: row.executionId };
            },
            set: async (key, e) => {
              await this.prisma.inferenceCache.upsert({
                where: { key },
                create: { key, agentKey: e.agentKey, agentVersion: e.agentVersion, responseText: e.text, executionId: e.executionId },
                update: {},
              });
            },
          }
        : undefined,
      onTelemetry: (t) => this.persist(t),
      onClientEvent: (e) => logger.log({ event: `lyzr_${e.type}`, path: e.path, attempt: e.attempt }, 'LyzrClient'),
    });
    logger.log({ event: 'lyzr_runtime_ready', mode: this.runtime.config.mode, aims: this.runtime.config.aimsEnabled }, 'Lyzr');
  }

  get orchestrator() {
    return this.runtime.orchestrator;
  }

  get mode() {
    return this.runtime.config.mode;
  }

  private persist(t: ExecutionTelemetry) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(t.sessionId);
    const p = this.prisma.lyzrExecution
      .create({
        data: {
          id: t.executionId,
          agentKey: t.agentKey,
          agentName: t.agentName,
          agentVersion: t.agentVersion,
          agentId: t.agentId,
          provider: t.provider,
          environmentId: t.environmentId,
          status: t.status,
          errorCode: t.errorCode ?? null,
          latencyMs: t.latencyMs,
          attempts: t.attempts,
          inputHash: t.inputHash,
          outputHash: t.outputHash,
          injectionDetected: t.injectionDetected,
          safeAiFindings: t.safeAiFindings,
          cacheHit: t.cacheHit,
          correlationId: t.correlationId ?? null,
          aimsExport: t.aimsExport,
          chainId: t.sessionId,
          screeningId: isUuid ? t.sessionId : null,
          startedAt: new Date(t.startedAt),
          completedAt: new Date(t.completedAt),
        },
      })
      .catch((err) => logger.warn({ event: 'lyzr_execution_persist_failed', error: (err as Error).message }, 'Lyzr'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
    if (t.aimsExport) {
      // AIMS hook: telemetry is PHI-free by construction (hashes, timings, verdicts only).
      logger.log({ event: 'aims_telemetry', executionId: t.executionId, agent: t.agentKey, provider: t.provider, status: t.status, cacheHit: t.cacheHit, latencyMs: t.latencyMs, injectionDetected: t.injectionDetected }, 'AIMS');
    }
  }

  /** Wait until all telemetry rows are written (called at the end of each job stage). */
  async flush() {
    await Promise.allSettled([...this.pending]);
  }

  describe() {
    return {
      environment: describeEnvironment(this.runtime.config),
      agents: agentManifest(),
      stageGraph: SCREENING_STAGE_GRAPH,
      demoLabel: this.runtime.config.mode === 'mock' ? 'DEMO MODE — SYNTHETIC DATA (mock agents, not Lyzr)' : 'LIVE LYZR MODE — SYNTHETIC DATA',
    };
  }
}
