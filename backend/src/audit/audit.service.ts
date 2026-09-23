import { Injectable } from '@nestjs/common';
import type { AuditEvent } from '@prisma/client';
import type { AuditEventInput, AuditPort } from '@trialguard/agents';
import { randomUUID } from 'node:crypto';
import { hashObject } from '../common/canonical-json';
import { currentContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { sealEvent, verifyChain, type ChainEvent, type VerificationResult } from './hash-chain';

export function toChainEvent(e: AuditEvent): ChainEvent {
  return {
    eventId: e.id,
    chainId: e.chainId,
    sequence: e.sequence,
    timestamp: e.timestamp,
    eventType: e.eventType,
    actorType: e.actorType,
    actorId: e.actorId,
    component: e.component,
    componentVersion: e.componentVersion,
    inputHash: e.inputHash,
    outputHash: e.outputHash,
    payload: e.payload,
    previousEventHash: e.previousEventHash,
    eventHash: e.eventHash,
  };
}

/**
 * Append-only audit trail with SHA-256 hash chaining. Appends are serialised
 * per chain with a Postgres advisory lock; UPDATE/DELETE are rejected by
 * database triggers. Inputs/outputs are stored only as hashes; payloads carry
 * PHI-free summaries.
 */
@Injectable()
export class AuditService implements AuditPort {
  constructor(private readonly prisma: PrismaService) {}

  async record(chainId: string, event: AuditEventInput): Promise<void> {
    await this.append(chainId, event);
  }

  async append(chainId: string, event: AuditEventInput, opts: { screeningId?: string | null } = {}): Promise<ChainEvent> {
    const screeningId = opts.screeningId ?? (chainId.startsWith('screening:') ? chainId.slice('screening:'.length) : isUuid(chainId) ? chainId : null);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chainId}))`;
      const last = await tx.auditEvent.findFirst({ where: { chainId }, orderBy: { sequence: 'desc' } });
      const sealed = sealEvent({
        eventId: randomUUID(),
        chainId,
        sequence: (last?.sequence ?? 0) + 1,
        timestamp: new Date().toISOString(),
        eventType: event.eventType,
        actorType: event.actorType,
        actorId: event.actorId ?? null,
        component: event.component,
        componentVersion: event.componentVersion,
        inputHash: event.input === undefined ? null : hashObject(event.input),
        outputHash: event.output === undefined ? null : hashObject(event.output),
        payload: JSON.parse(JSON.stringify(event.payload ?? {})),
        previousEventHash: last?.eventHash ?? '0'.repeat(64),
      });
      await tx.auditEvent.create({
        data: {
          id: sealed.eventId,
          chainId,
          sequence: sealed.sequence,
          screeningId,
          timestamp: sealed.timestamp,
          eventType: sealed.eventType,
          actorType: sealed.actorType,
          actorId: sealed.actorId,
          component: sealed.component,
          componentVersion: sealed.componentVersion,
          inputHash: sealed.inputHash,
          outputHash: sealed.outputHash,
          payload: sealed.payload as object,
          previousEventHash: sealed.previousEventHash,
          eventHash: sealed.eventHash,
          correlationId: currentContext()?.correlationId ?? null,
        },
      });
      return sealed;
    });
  }

  async events(chainId: string): Promise<AuditEvent[]> {
    return this.prisma.auditEvent.findMany({ where: { chainId }, orderBy: { sequence: 'asc' } });
  }

  async verify(chainId: string): Promise<VerificationResult & { sealedRootHash: string | null; sealedRootMatches: boolean | null }> {
    const rows = await this.events(chainId);
    const result = verifyChain(rows.map(toChainEvent));
    const root = await this.prisma.auditRoot.findFirst({ where: { chainId }, orderBy: { sealedAt: 'desc' } });
    let sealedRootMatches: boolean | null = null;
    if (root) {
      const at = rows.find((r) => r.sequence === root.eventCount);
      sealedRootMatches = result.valid && !!at && at.eventHash === root.rootHash;
      if (result.valid && !sealedRootMatches) {
        return { ...result, valid: false, reason: 'sealed audit root does not match chain', sealedRootHash: root.rootHash, sealedRootMatches };
      }
    }
    return { ...result, sealedRootHash: root?.rootHash ?? null, sealedRootMatches };
  }

  /**
   * Demonstrates tamper detection WITHOUT touching stored records: verifies an
   * in-memory copy of the chain in which event `sequence` has been altered.
   */
  async simulateTamper(chainId: string, sequence: number): Promise<VerificationResult & { tamperedSequence: number }> {
    const rows = (await this.events(chainId)).map(toChainEvent);
    const target = rows.find((r) => r.sequence === sequence);
    if (target) target.payload = { ...(target.payload as object), __tampered: true, tamperedAt: new Date().toISOString() };
    return { ...verifyChain(rows), tamperedSequence: sequence };
  }

  async seal(chainId: string, reason: string, screeningId?: string | null) {
    const result = await this.verify(chainId);
    if (!result.valid || !result.rootHash) throw new Error(`Refusing to seal invalid audit chain ${chainId}: ${result.reason}`);
    return this.prisma.auditRoot.create({ data: { chainId, screeningId: screeningId ?? null, rootHash: result.rootHash, eventCount: result.eventsVerified, reason } });
  }

  async latestRoot(chainId: string) {
    return this.prisma.auditRoot.findFirst({ where: { chainId }, orderBy: { sealedAt: 'desc' } });
  }
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
