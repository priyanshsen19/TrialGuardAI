import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SCREENING_STAGE_GRAPH,
  type ClinicalFact,
  type Criterion,
  type QueueName,
  type RedactedDocument,
  type ScreeningState,
} from '@trialguard/agents';
import { canonicalJson, sha256Hex } from '../common/canonical-json';
import { AppError, conflict, notFound } from '../common/errors';
import { logger } from '../common/logger';
import { currentContext } from '../common/request-context';
import { loadConfig } from '../config/config';
import { AuditService } from '../audit/audit.service';
import { DossierService } from '../audit/dossier.service';
import type { AuthUser } from '../auth/roles';
import { LyzrRuntimeService } from '../lyzr/lyzr-runtime.service';
import { isUuid } from '../patients/patients.service';
import { PhiService } from '../phi/phi.service';
import { PrismaService } from '../prisma/prisma.service';
import { safeMessage } from '../protocols/protocols.service';
import { QueueService, type JobPayload } from '../queue/queue.service';
import { ageInYears } from '../rule-engine/dates';
import { RULE_ENGINE_VERSION } from '../rule-engine/evaluator';

export type ReviewActionName = 'APPROVE_ELIGIBLE' | 'APPROVE_INELIGIBLE' | 'REQUEST_MORE_INFORMATION' | 'REQUIRE_ADDITIONAL_REVIEW';

const todayUtc = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class ScreeningsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly lyzr: LyzrRuntimeService,
    private readonly audit: AuditService,
    private readonly dossier: DossierService,
    private readonly phi: PhiService,
  ) {}

  onModuleInit() {
    for (const { stage } of SCREENING_STAGE_GRAPH) {
      this.queue.register(stage, (data) => this.runStage(stage, data));
    }
  }

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------

  async create(input: { trialId: string; patientId: string; screeningDate?: string }, user: AuthUser, idempotencyHeader?: string) {
    const trial = await this.prisma.trial.findFirst({ where: isUuid(input.trialId) ? { id: input.trialId } : { code: input.trialId } });
    if (!trial) throw notFound('Trial');
    const patient = await this.prisma.patient.findFirst({ where: isUuid(input.patientId) ? { id: input.patientId } : { patientRef: input.patientId } });
    if (!patient) throw notFound('Patient');
    const pv = await this.prisma.protocolVersion.findFirst({ where: { protocol: { trialId: trial.id }, status: 'READY' }, orderBy: { createdAt: 'desc' }, include: { criteria: { orderBy: { criterionKey: 'asc' } } } });
    if (!pv) throw conflict('PROTOCOL_NOT_READY', 'Trial has no protocol with extracted criteria');
    const patVer = await this.prisma.patientVersion.findFirst({ where: { patientId: patient.id, status: 'READY' }, orderBy: { versionNumber: 'desc' }, include: { facts: { orderBy: { factKey: 'asc' } }, documents: true } });
    if (!patVer) throw conflict('PATIENT_NOT_READY', 'Patient record has not finished extraction');

    const screeningDate = input.screeningDate ?? loadConfig().screeningDateOverride ?? todayUtc();
    const idempotencyKey = idempotencyHeader
      ? `hdr:${sha256Hex(`${user.sub}|${idempotencyHeader}`)}`
      : `auto:${sha256Hex(canonicalJson({ trial: trial.id, protocolVersion: pv.id, patientVersion: patVer.id, screeningDate }))}`;
    const existing = await this.prisma.screening.findUnique({ where: { idempotencyKey } });
    if (existing) return { idempotentReplay: true, screening: await this.get(existing.id) };

    const identity = await this.phi.loadIdentity(patient.phiScope);
    const age = identity?.dateOfBirth ? ageInYears(identity.dateOfBirth, screeningDate) : null;
    const injection = ((patVer.injectionFindings as unknown[]) ?? []).length + ((pv.injectionFindings as unknown[]) ?? []).length;
    const rejections = ((patVer.groundingRejections as unknown[]) ?? []).length + ((pv.groundingRejections as unknown[]) ?? []).length;
    const clinicalNotes: RedactedDocument[] = patVer.documents.map((d) => ({ documentName: d.filename, pages: d.redactedPages as unknown as RedactedDocument['pages'] }));

    const [{ nextval }] = await this.prisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('screening_ref_seq')`;
    const screeningRef = `SCR-${String(nextval).padStart(5, '0')}`;
    const correlationId = currentContext()?.correlationId ?? null;

    let screening;
    try {
      screening = await this.prisma.screening.create({
        data: {
          screeningRef,
          trialId: trial.id,
          protocolVersionId: pv.id,
          patientId: patient.id,
          patientVersionId: patVer.id,
          screeningDate,
          status: 'QUEUED',
          idempotencyKey,
          correlationId,
          requestedById: user.sub,
          pipelineState: {},
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.screening.findUniqueOrThrow({ where: { idempotencyKey } });
        return { idempotentReplay: true, screening: await this.get(dup.id) };
      }
      throw err;
    }

    const state: ScreeningState = {
      screeningId: screening.id,
      screeningRef,
      trialCode: trial.code,
      protocolVersion: pv.version,
      patientRef: patient.patientRef,
      context: { screeningDate, patientSex: (patient.sex as 'F' | 'M' | null) ?? null, patientAgeYears: age },
      rawCriteria: pv.criteria.map((c) => stripResolution(c.definition) as Criterion),
      rawFacts: patVer.facts.map((f) => stripResolution(f.data) as ClinicalFact),
      clinicalNotes,
      injectionFindings: injection,
      groundingRejections: rejections,
      executions: [],
      completedStages: [],
    };
    await this.prisma.screening.update({ where: { id: screening.id }, data: { pipelineState: state as unknown as object } });

    const protocolRoot = await this.audit.latestRoot(`protocol:${pv.id}`);
    const patientRoot = await this.audit.latestRoot(`patient:${patVer.id}`);
    await this.audit.append(screening.id, {
      eventType: 'SCREENING_CREATED',
      actorType: 'USER',
      actorId: user.sub,
      component: 'screenings-service',
      componentVersion: '1.0.0',
      payload: { screeningRef, trialCode: trial.code, patientRef: patient.patientRef, screeningDate, requestedByRole: user.role, idempotencyKey, lyzrMode: this.lyzr.mode },
    });
    await this.audit.append(screening.id, {
      eventType: 'PROTOCOL_BOUND',
      actorType: 'SYSTEM',
      component: 'screenings-service',
      componentVersion: '1.0.0',
      input: pv.criteria.map((c) => c.definition),
      payload: { protocolVersionId: pv.id, version: pv.version, contentHash: pv.contentHash, redactedHash: pv.redactedHash, criteria: pv.criteria.length, protocolAuditRoot: protocolRoot?.rootHash ?? null },
    });
    await this.audit.append(screening.id, {
      eventType: 'PATIENT_SNAPSHOT_BOUND',
      actorType: 'SYSTEM',
      component: 'screenings-service',
      componentVersion: '1.0.0',
      input: patVer.facts.map((f) => f.data),
      payload: { patientRef: patient.patientRef, patientVersion: patVer.versionNumber, snapshotHash: patVer.snapshotHash, facts: patVer.facts.length, patientAuditRoot: patientRoot?.rootHash ?? null, derivedAgeYears: age, ageDerivation: 'deterministic from vaulted DOB; DOB never leaves the backend' },
    });
    const phi = (patVer.phiSummary ?? {}) as { totalRedactions?: number; byCategory?: Record<string, number> };
    await this.audit.append(screening.id, {
      eventType: 'PHI_REDACTION_CONFIRMED',
      actorType: 'SYSTEM',
      component: 'phi-redactor',
      componentVersion: '1.0.0',
      payload: { totalRedactions: phi.totalRedactions ?? 0, byCategory: phi.byCategory ?? {}, statement: 'Agents received PHI-redacted text only; alias vault not exported.' },
    });

    await this.enqueueStage(screening.id, 'ontology-validation');
    return { idempotentReplay: false, screening: await this.get(screening.id) };
  }

  private async enqueueStage(screeningId: string, stage: QueueName, extra: Record<string, unknown> = {}, jobSuffix = '') {
    try {
      await this.queue.enqueue(stage, { screeningId, ...extra }, { jobId: `${screeningId}:${stage}${jobSuffix}` });
    } catch (err) {
      if (this.queue.mode === 'bullmq') throw err;
      // inline mode: failure recorded on the screening row by runStage
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline stages (queue handlers)
  // ---------------------------------------------------------------------------

  async runStage(stage: QueueName, data: JobPayload) {
    const id = String(data.screeningId);
    const s = await this.prisma.screening.findUnique({ where: { id } });
    if (!s) throw Object.assign(new Error('screening not found'), { nonRetryable: true });
    const next = SCREENING_STAGE_GRAPH.find((g) => g.stage === stage)?.next ?? null;

    // Dossier regeneration after human review (not part of the first pass).
    if (stage === 'dossier-generation' && data.reason === 'review') {
      await this.dossier.generate(id);
      await this.audit.seal(id, 'REVIEW_RECORDED');
      return;
    }

    const state = s.pipelineState as unknown as ScreeningState;
    if (state.completedStages?.includes(stage)) {
      if (next) await this.enqueueStage(id, next);
      return;
    }
    if (s.status === 'QUEUED') await this.prisma.screening.update({ where: { id }, data: { status: 'RUNNING', startedAt: new Date() } });

    try {
      if (stage === 'dossier-generation') {
        await this.dossier.generate(id);
        const completedAt = new Date();
        const startedAt = s.startedAt ?? s.createdAt;
        await this.prisma.screening.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt, durationMs: completedAt.getTime() - startedAt.getTime(), pipelineState: { ...state, completedStages: [...state.completedStages, stage] } as unknown as object },
        });
        await this.audit.seal(id, 'SCREENING_COMPLETED');
        logger.log({ event: 'screening_completed', screeningId: id, decision: state.decision?.decision }, 'Screenings');
        return;
      }

      const updated = await this.lyzr.orchestrator.runStage(stage, state, { correlationId: data.correlationId });
      await this.lyzr.flush();
      await this.persistStage(id, stage, updated);
    } catch (err) {
      const message = safeMessage(err);
      await this.prisma.screening.update({ where: { id }, data: { status: 'FAILED', errorMessage: message } });
      await this.audit.append(id, { eventType: 'STAGE_FAILED', actorType: 'SYSTEM', component: 'screening-pipeline', componentVersion: '1.0.0', payload: { stage, error: message, attempt: data.attempt ?? null } });
      throw err;
    }
    if (next) await this.enqueueStage(id, next);
  }

  private async persistStage(id: string, stage: QueueName, state: ScreeningState) {
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.ScreeningUpdateInput = { pipelineState: state as unknown as object, status: 'RUNNING', errorMessage: null };
      if (stage === 'screening-evaluation' && state.evaluations) {
        await tx.criterionEvaluation.deleteMany({ where: { screeningId: id } });
        await tx.criterionEvaluation.createMany({
          data: state.evaluations.map((e) => ({
            screeningId: id,
            criterionKey: e.criterionId,
            category: e.category,
            mandatory: e.mandatory,
            requirement: e.requirement,
            result: e.result,
            conditionMet: e.conditionMet,
            operator: e.operator,
            expectedValue: e.expectedValue,
            actualValue: e.actualValue,
            ruleExpression: e.ruleExpression,
            reason: e.reason,
            reviewReasons: e.reviewReasons,
            evidence: e.evidence as unknown as object,
            confidence: e.confidence,
            sourcePage: e.source.page,
            sourceSection: e.source.section,
          })),
        });
      }
      if (stage === 'safety-validation' && state.decision) {
        await tx.safetyFlag.deleteMany({ where: { screeningId: id } });
        if (state.safetyFlags?.length) {
          await tx.safetyFlag.createMany({
            data: state.safetyFlags.map((f) => ({ screeningId: id, code: f.code, severity: f.severity, description: f.description, source: f.source, factIds: f.factIds, criterionIds: f.criterionIds })),
          });
        }
        data.decision = state.decision.decision;
        data.confidence = state.decision.confidence;
        data.decisionReasons = state.decision.reasons;
        data.confidenceBreakdown = state.decision.confidenceBreakdown;
      }
      if (stage === 'audit-generation' && state.narrative) data.narrative = state.narrative as unknown as object;
      await tx.screening.update({ where: { id }, data });
    });

    if (stage === 'safety-validation' && state.decision?.decision === 'REQUIRES_HUMAN_OVERVIEW') {
      const open = await this.prisma.reviewTask.findFirst({ where: { screeningId: id } });
      if (!open) {
        const blocking = (state.safetyFlags ?? []).some((f) => f.severity === 'BLOCKING');
        const task = await this.prisma.reviewTask.create({ data: { screeningId: id, reasons: state.decision.reasons, confidence: state.decision.confidence, priority: blocking ? 'HIGH' : 'NORMAL' } });
        await this.audit.append(id, {
          eventType: 'REVIEW_TASK_CREATED',
          actorType: 'SYSTEM',
          component: 'human-review',
          componentVersion: '1.0.0',
          payload: { reviewTaskId: task.id, priority: task.priority, reasons: state.decision.reasons },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Human review
  // ---------------------------------------------------------------------------

  async review(screeningId: string, input: { action: ReviewActionName; reason: string }, user: AuthUser, idempotencyHeader?: string) {
    const s = await this.prisma.screening.findUnique({ where: { id: screeningId }, include: { reviewTasks: { orderBy: { createdAt: 'desc' } } } });
    if (!s) throw notFound('Screening');
    if (idempotencyHeader) {
      const prior = await this.prisma.reviewDecision.findUnique({ where: { idempotencyKey: sha256Hex(`${user.sub}|${idempotencyHeader}`) } });
      if (prior) return { idempotentReplay: true, decision: prior, screening: await this.get(screeningId) };
    }
    if (s.status !== 'COMPLETED' || s.decision !== 'REQUIRES_HUMAN_OVERVIEW') {
      throw conflict('REVIEW_NOT_APPLICABLE', `Screening ${s.screeningRef} is ${s.status}/${s.decision}; only completed REQUIRES_HUMAN_OVERVIEW screenings can be reviewed.`);
    }
    const task = s.reviewTasks[0];
    if (!task) throw conflict('NO_REVIEW_TASK', 'No review task exists for this screening');
    if (task.status === 'RESOLVED') throw conflict('REVIEW_ALREADY_RESOLVED', 'This review task has already been resolved');

    const resultingDecision = input.action === 'APPROVE_ELIGIBLE' ? 'ELIGIBLE' : input.action === 'APPROVE_INELIGIBLE' ? 'INELIGIBLE' : null;
    const taskStatus = resultingDecision ? 'RESOLVED' : input.action === 'REQUEST_MORE_INFORMATION' ? 'AWAITING_INFORMATION' : 'ESCALATED';
    const signedAt = new Date();
    const lastEvent = (await this.audit.events(screeningId)).at(-1);
    const signatureHash = sha256Hex(
      canonicalJson({ reviewerId: user.sub, reviewerEmail: user.email, action: input.action, reason: input.reason, screeningId, signedAt: signedAt.toISOString(), chainHead: lastEvent?.eventHash ?? null }),
    );

    const decision = await this.prisma.$transaction(async (tx) => {
      const d = await tx.reviewDecision.create({
        data: {
          reviewTaskId: task.id,
          reviewerId: user.sub,
          reviewerRole: user.role,
          action: input.action,
          reason: input.reason,
          resultingDecision,
          signatureHash,
          idempotencyKey: idempotencyHeader ? sha256Hex(`${user.sub}|${idempotencyHeader}`) : null,
          createdAt: signedAt,
        },
      });
      await tx.reviewTask.update({ where: { id: task.id }, data: { status: taskStatus, resolvedAt: resultingDecision ? signedAt : null } });
      if (resultingDecision) await tx.screening.update({ where: { id: screeningId }, data: { finalDecision: resultingDecision } });
      return d;
    });

    await this.audit.append(screeningId, {
      eventType: 'REVIEW_DECISION_RECORDED',
      actorType: 'USER',
      actorId: user.sub,
      component: 'human-review',
      componentVersion: '1.0.0',
      input: { reviewTaskId: task.id, systemDecision: s.decision },
      output: { action: input.action, resultingDecision },
      payload: {
        reviewDecisionId: decision.id,
        reviewer: user.name,
        reviewerRole: user.role,
        action: input.action,
        reason: input.reason,
        resultingDecision,
        taskStatus,
        systemDecision: s.decision,
        signatureHash,
        note: 'Deterministic criterion evaluations and the system decision are retained unchanged.',
      },
    });
    await this.enqueueStage(screeningId, 'dossier-generation', { reason: 'review' }, `:review:${decision.id}`);
    return { idempotentReplay: false, decision, screening: await this.get(screeningId) };
  }

  async reviewQueue() {
    const tasks = await this.prisma.reviewTask.findMany({
      where: { status: { not: 'RESOLVED' } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: {
        screening: { select: { id: true, screeningRef: true, confidence: true, decision: true, screeningDate: true, patient: { select: { patientRef: true } }, trial: { select: { code: true } }, flags: { select: { code: true, severity: true } } } },
        decisions: { orderBy: { createdAt: 'desc' }, take: 1, include: { reviewer: { select: { displayName: true } } } },
      },
    });
    const resolved = await this.prisma.reviewTask.findMany({
      where: { status: 'RESOLVED' },
      orderBy: { resolvedAt: 'desc' },
      take: 20,
      include: { screening: { select: { id: true, screeningRef: true, finalDecision: true, patient: { select: { patientRef: true } } } }, decisions: { orderBy: { createdAt: 'desc' }, take: 1, include: { reviewer: { select: { displayName: true } } } } },
    });
    return { open: tasks, resolved };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async list(filter: { decision?: string; status?: string }) {
    const rows = await this.prisma.screening.findMany({
      where: { ...(filter.decision ? { decision: filter.decision as never } : {}), ...(filter.status ? { status: filter.status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { trial: { select: { code: true } }, patient: { select: { patientRef: true } }, _count: { select: { flags: true } }, reviewTasks: { select: { status: true } } },
    });
    return rows.map((s) => ({
      id: s.id,
      screeningRef: s.screeningRef,
      trialCode: s.trial.code,
      patientRef: s.patient.patientRef,
      status: s.status,
      decision: s.decision,
      finalDecision: s.finalDecision,
      confidence: s.confidence,
      screeningDate: s.screeningDate,
      safetyFlags: s._count.flags,
      reviewStatus: s.reviewTasks[0]?.status ?? null,
      durationMs: s.durationMs,
      createdAt: s.createdAt,
    }));
  }

  async get(idOrRef: string) {
    const s = await this.prisma.screening.findFirst({
      where: isUuid(idOrRef) ? { id: idOrRef } : { screeningRef: idOrRef },
      include: {
        trial: true,
        patient: { select: { id: true, patientRef: true, sex: true, synthetic: true } },
        protocolVersion: { select: { id: true, version: true, contentHash: true, redactedHash: true, pageCount: true } },
        patientVersion: { select: { id: true, versionNumber: true, snapshotHash: true, phiSummary: true, injectionFindings: true } },
        evaluations: true,
        flags: { orderBy: { createdAt: 'asc' } },
        reviewTasks: { orderBy: { createdAt: 'desc' }, include: { decisions: { orderBy: { createdAt: 'asc' }, include: { reviewer: { select: { displayName: true, email: true } } } } } },
        dossiers: { orderBy: { version: 'desc' }, select: { version: true, jsonHash: true, pdfHash: true, auditRootHash: true, chainValid: true, generatedAt: true } },
        executions: { orderBy: { startedAt: 'asc' } },
      },
    });
    if (!s) throw notFound('Screening');
    const order = (k: string) => (k.startsWith('INC') ? 0 : k.startsWith('EXC') ? 1 : 2) * 1000 + Number(k.slice(4));
    const state = s.pipelineState as unknown as Partial<ScreeningState>;
    const { pipelineState: _p, idempotencyKey: _i, ...rest } = s;
    return {
      ...rest,
      evaluations: [...s.evaluations].sort((a, b) => order(a.criterionKey) - order(b.criterionKey)),
      stages: SCREENING_STAGE_GRAPH.map((g) => ({ stage: g.stage, description: g.description, completed: !!state.completedStages?.includes(g.stage) })),
      context: state.context ?? null,
      ontologySummary: state.ontologySummary ?? null,
      safetySummary: state.safetySummary ?? null,
      ruleEngineVersion: RULE_ENGINE_VERSION,
      lyzrMode: this.lyzr.mode,
    };
  }

  async timeline(id: string) {
    await this.ensureExists(id);
    return (await this.audit.events(id)).map((e) => ({
      sequence: e.sequence,
      timestamp: e.timestamp,
      eventType: e.eventType,
      actorType: e.actorType,
      actorId: e.actorId,
      component: e.component,
      componentVersion: e.componentVersion,
      payload: e.payload,
      eventHash: e.eventHash,
      previousEventHash: e.previousEventHash,
    }));
  }

  async evidence(id: string) {
    const s = await this.prisma.screening.findUnique({ where: { id }, include: { evaluations: true, patientVersion: { include: { facts: { orderBy: { factKey: 'asc' } }, documents: { select: { filename: true, redactedPages: true, sha256: true } } } } } });
    if (!s) throw notFound('Screening');
    return {
      facts: s.patientVersion.facts.map((f) => f.data),
      documents: s.patientVersion.documents.map((d) => ({ filename: d.filename, sha256: d.sha256, pages: d.redactedPages })),
      criterionEvidence: s.evaluations.map((e) => ({ criterionId: e.criterionKey, result: e.result, evidence: e.evidence })),
      notice: 'All document text shown is PHI-redacted.',
    };
  }

  private async ensureExists(id: string) {
    if (!isUuid(id) || !(await this.prisma.screening.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Screening');
  }

  validateScreeningDate(d?: string) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new AppError('VALIDATION_FAILED', 'screeningDate must be YYYY-MM-DD');
  }
}

function stripResolution(v: unknown): unknown {
  const { resolution: _r, ...rest } = v as Record<string, unknown>;
  return rest;
}
