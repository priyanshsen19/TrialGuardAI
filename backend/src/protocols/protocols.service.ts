import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Criterion, RawDocument } from '@trialguard/agents';
import { sha256Hex } from '../common/canonical-json';
import { AppError, notFound } from '../common/errors';
import { logger } from '../common/logger';
import { loadConfig } from '../config/config';
import { AuditService } from '../audit/audit.service';
import { LyzrRuntimeService } from '../lyzr/lyzr-runtime.service';
import { PhiService } from '../phi/phi.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService, type JobPayload } from '../queue/queue.service';
import { parseDocument } from '../storage/document-parser';
import { StorageService } from '../storage/storage.service';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class ProtocolsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly lyzr: LyzrRuntimeService,
    private readonly phi: PhiService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.queue.register('protocol-extraction', (data) => this.runExtraction(data));
  }

  async upload(trialId: string, file: UploadedFile) {
    const trial = await this.prisma.trial.findUnique({ where: { id: trialId } });
    if (!trial) throw notFound('Trial');
    const parsed = await parseDocument(file.buffer, file.originalname, file.mimetype, loadConfig().maxUploadBytes);
    const contentHash = sha256Hex(file.buffer);

    const protocol =
      (await this.prisma.protocol.findFirst({ where: { trialId } })) ??
      (await this.prisma.protocol.create({ data: { trialId, title: `${trial.code} clinical protocol` } }));

    const existing = await this.prisma.protocolVersion.findUnique({ where: { protocolId_contentHash: { protocolId: protocol.id, contentHash } } });
    if (existing) {
      if (existing.status === 'FAILED') await this.enqueue(existing.id);
      return { idempotentReplay: true, protocolVersion: await this.getVersion(existing.id) };
    }

    const allText = parsed.pages.map((p) => p.text).join('\n');
    const versionLabel = /Protocol Version\s*:?\s*([0-9]+(?:\.[0-9]+)*)/i.exec(allText)?.[1] ?? `${(await this.prisma.protocolVersion.count({ where: { protocolId: protocol.id } })) + 1}.0`;
    const stored = await this.storage.put(`documents/protocols/${contentHash}.bin`, file.buffer, { encrypt: true });
    const document = await this.prisma.document.create({
      data: { kind: 'PROTOCOL', filename: parsed.documentName, mimeType: parsed.mimeType, sizeBytes: file.buffer.length, sha256: stored.sha256, storageKey: stored.key, redactedPages: [] },
    });
    const pv = await this.prisma.protocolVersion.create({
      data: { protocolId: protocol.id, version: versionLabel, contentHash, documentId: document.id, pageCount: parsed.pages.length, status: 'PENDING' },
    });
    await this.audit.append(`protocol:${pv.id}`, {
      eventType: 'PROTOCOL_UPLOADED',
      actorType: 'USER',
      component: 'protocols-service',
      componentVersion: '1.0.0',
      payload: { trialCode: trial.code, version: versionLabel, contentHash, pages: parsed.pages.length, mimeType: parsed.mimeType, sizeBytes: file.buffer.length },
    });
    await this.enqueue(pv.id);
    return { idempotentReplay: false, protocolVersion: await this.getVersion(pv.id) };
  }

  private async enqueue(protocolVersionId: string) {
    try {
      await this.queue.enqueue('protocol-extraction', { protocolVersionId }, { jobId: `protocol-extraction:${protocolVersionId}` });
    } catch (err) {
      if (this.queue.mode === 'bullmq') throw err;
      // inline mode: failure already recorded on the version row
    }
  }

  async runExtraction(data: JobPayload) {
    const id = String(data.protocolVersionId);
    const pv = await this.prisma.protocolVersion.findUnique({ where: { id }, include: { document: true } });
    if (!pv || !pv.document) throw Object.assign(new Error('protocol version not found'), { nonRetryable: true });
    if (pv.status === 'READY') return; // idempotent
    await this.prisma.protocolVersion.update({ where: { id }, data: { status: 'PROCESSING', errorMessage: null } });
    try {
      const original = await this.storage.get(pv.document.storageKey, { encrypted: true });
      const parsed = await parseDocument(original, pv.document.filename, pv.document.mimeType, Number.MAX_SAFE_INTEGER);
      const raw: RawDocument = { documentName: parsed.documentName, pages: parsed.pages };
      const chainId = `protocol:${id}`;
      const result = await this.phi.runInScope(chainId, undefined, () => this.lyzr.orchestrator.extractProtocol(chainId, raw, { correlationId: data.correlationId }));
      await this.lyzr.flush();

      await this.prisma.$transaction(async (tx) => {
        await tx.protocolCriterion.deleteMany({ where: { protocolVersionId: id } });
        for (const c of result.criteria) {
          await tx.protocolCriterion.create({
            data: {
              protocolVersionId: id,
              criterionKey: c.id,
              category: c.category,
              domain: c.domain,
              field: c.field,
              operator: c.operator,
              text: c.text,
              page: c.source.page,
              section: c.source.section,
              mandatory: c.mandatory,
              requiresHumanReview: c.requiresHumanReview,
              ambiguity: c.ambiguity,
              definition: c as unknown as object,
            },
          });
        }
        await tx.document.update({ where: { id: pv.document!.id }, data: { redactedPages: result.documents[0].pages as unknown as object } });
        await tx.protocolVersion.update({
          where: { id },
          data: {
            status: 'READY',
            redactedHash: sha256Hex(JSON.stringify(result.documents[0].pages)),
            phiSummary: result.phi as unknown as object,
            extractionNotes: result.notes,
            groundingRejections: result.rejected as unknown as object,
            injectionFindings: result.injectionFindings,
            crossValidation: (result.crossValidation ?? undefined) as unknown as object | undefined,
            agentExecutionId: result.execution.executionId,
            extractedAt: new Date(),
          },
        });
      });
      await this.audit.seal(chainId, 'PROTOCOL_EXTRACTION_COMPLETED');
      logger.log({ event: 'protocol_extracted', protocolVersionId: id, criteria: result.criteria.length, provider: result.execution.provider, agreementRate: result.crossValidation?.agreementRate }, 'Protocols');
    } catch (err) {
      await this.prisma.protocolVersion.update({ where: { id }, data: { status: 'FAILED', errorMessage: safeMessage(err) } });
      throw err;
    }
  }

  async getVersion(id: string) {
    const pv = await this.prisma.protocolVersion.findUnique({
      where: { id },
      include: { criteria: { orderBy: { criterionKey: 'asc' } }, document: { select: { id: true, filename: true, mimeType: true, sizeBytes: true, sha256: true } } },
    });
    if (!pv) throw notFound('Protocol version');
    const execution = pv.agentExecutionId ? await this.prisma.lyzrExecution.findUnique({ where: { id: pv.agentExecutionId } }) : null;
    return { ...pv, criteria: pv.criteria.map(presentCriterion), execution };
  }

  async activeVersion(trialId: string) {
    return this.prisma.protocolVersion.findFirst({ where: { protocol: { trialId }, status: 'READY' }, orderBy: { createdAt: 'desc' }, include: { criteria: true } });
  }

  async criteria(trialId: string) {
    const pv = await this.prisma.protocolVersion.findFirst({ where: { protocol: { trialId } }, orderBy: { createdAt: 'desc' } });
    if (!pv) throw new AppError('NO_PROTOCOL', 'No protocol has been uploaded for this trial', 404);
    return this.getVersion(pv.id);
  }
}

export function presentCriterion(c: { definition: unknown; criterionKey: string }) {
  const d = c.definition as Criterion & { resolution?: unknown };
  return { ...(c as object), definition: d };
}

export function safeMessage(err: unknown): string {
  const e = err as { code?: string; message?: string; errors?: string[] };
  if (e?.code === 'SAFE_AI_BLOCKED') return 'Safe AI pre-flight blocked the agent call (residual PHI/secret detected). Nothing was sent.';
  if (e?.code === 'AGENT_OUTPUT_INVALID') return `Agent output failed schema validation: ${(e.errors ?? []).slice(0, 3).join('; ')}`;
  if (e?.code?.startsWith?.('LYZR_')) return `Lyzr error ${e.code}: ${e.message}`;
  return (e?.message ?? 'extraction failed').slice(0, 300);
}
