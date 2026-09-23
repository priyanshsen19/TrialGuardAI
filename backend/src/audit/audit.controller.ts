import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { notFound } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

const TamperSchema = z.object({ sequence: z.number().int().positive() }).strict();

@Controller('audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /** Audit overview: every screening chain with its size and latest sealed root. */
  @Get()
  async overview() {
    const screenings = await this.prisma.screening.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, screeningRef: true, decision: true, finalDecision: true, status: true, createdAt: true, patient: { select: { patientRef: true } }, trial: { select: { code: true } } },
    });
    const counts = await this.prisma.auditEvent.groupBy({ by: ['chainId'], _count: true, where: { chainId: { in: screenings.map((s) => s.id) } } });
    const roots = await this.prisma.auditRoot.findMany({ where: { chainId: { in: screenings.map((s) => s.id) } }, orderBy: { sealedAt: 'desc' } });
    return screenings.map((s) => ({
      ...s,
      events: counts.find((c) => c.chainId === s.id)?._count ?? 0,
      latestRoot: roots.find((r) => r.chainId === s.id) ?? null,
    }));
  }

  @Get(':screeningId')
  async events(@Param('screeningId', ParseUUIDPipe) screeningId: string) {
    const s = await this.prisma.screening.findUnique({ where: { id: screeningId }, select: { id: true, screeningRef: true, protocolVersionId: true, patientVersionId: true } });
    if (!s) throw notFound('Screening');
    const [events, roots, protocolEvents, patientEvents] = await Promise.all([
      this.audit.events(screeningId),
      this.prisma.auditRoot.findMany({ where: { chainId: screeningId }, orderBy: { sealedAt: 'asc' } }),
      this.audit.events(`protocol:${s.protocolVersionId}`),
      this.audit.events(`patient:${s.patientVersionId}`),
    ]);
    return {
      screeningId,
      screeningRef: s.screeningRef,
      chainId: screeningId,
      events,
      roots,
      upstreamChains: [
        { chainId: `protocol:${s.protocolVersionId}`, events: protocolEvents.length, rootHash: protocolEvents.at(-1)?.eventHash ?? null },
        { chainId: `patient:${s.patientVersionId}`, events: patientEvents.length, rootHash: patientEvents.at(-1)?.eventHash ?? null },
      ],
    };
  }

  @Get(':screeningId/verify')
  async verify(@Param('screeningId', ParseUUIDPipe) screeningId: string) {
    const r = await this.audit.verify(screeningId);
    return { valid: r.valid, eventsVerified: r.eventsVerified, rootHash: r.rootHash, sealedRootHash: r.sealedRootHash, sealedRootMatches: r.sealedRootMatches, ...(r.reason ? { reason: r.reason, firstInvalidSequence: r.firstInvalidSequence } : {}), verifiedAt: new Date().toISOString() };
  }

  /** Demo: verify an in-memory copy with one event altered. Stored records are never modified. */
  @Post(':screeningId/simulate-tamper')
  @HttpCode(200)
  simulate(@Param('screeningId', ParseUUIDPipe) screeningId: string, @Body(new ZodPipe(TamperSchema)) body: z.infer<typeof TamperSchema>) {
    return this.audit.simulateTamper(screeningId, body.sequence);
  }
}
