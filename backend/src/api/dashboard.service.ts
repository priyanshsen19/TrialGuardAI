import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LyzrRuntimeService } from '../lyzr/lyzr-runtime.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lyzr: LyzrRuntimeService,
    private readonly queue: QueueService,
  ) {}

  async stats() {
    const [trials, patients, screenings, byDecision, byFinal, duration, flags, openReviews, phiVersions, phiProtocols, phiEvents, recent, executions] = await Promise.all([
      this.prisma.trial.count(),
      this.prisma.patient.count(),
      this.prisma.screening.count(),
      this.prisma.screening.groupBy({ by: ['decision'], _count: true }),
      this.prisma.screening.groupBy({ by: ['finalDecision'], _count: true, where: { finalDecision: { not: null } } }),
      this.prisma.screening.aggregate({ _avg: { durationMs: true, confidence: true }, where: { status: 'COMPLETED' } }),
      this.prisma.safetyFlag.groupBy({ by: ['severity'], _count: true }),
      this.prisma.reviewTask.count({ where: { status: { not: 'RESOLVED' } } }),
      this.prisma.patientVersion.findMany({ select: { phiSummary: true } }),
      this.prisma.protocolVersion.findMany({ select: { phiSummary: true } }),
      this.prisma.auditEvent.count({ where: { eventType: 'PHI_REDACTED' } }),
      this.prisma.auditEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 15, select: { id: true, chainId: true, screeningId: true, timestamp: true, eventType: true, actorType: true, component: true, eventHash: true } }),
      this.prisma.lyzrExecution.groupBy({ by: ['provider', 'status'], _count: true }),
    ]);
    const count = (k: string) => byDecision.find((d) => d.decision === k)?._count ?? 0;
    const phiTotal = [...phiVersions, ...phiProtocols].reduce((sum, v) => sum + ((v.phiSummary as { totalRedactions?: number } | null)?.totalRedactions ?? 0), 0);
    const phiByCategory: Record<string, number> = {};
    for (const v of phiVersions) for (const [k, n] of Object.entries((v.phiSummary as { byCategory?: Record<string, number> } | null)?.byCategory ?? {})) phiByCategory[k] = (phiByCategory[k] ?? 0) + n;
    return {
      trials,
      patients,
      screenings,
      eligible: count('ELIGIBLE'),
      ineligible: count('INELIGIBLE'),
      humanReview: count('REQUIRES_HUMAN_OVERVIEW'),
      openReviewTasks: openReviews,
      humanFinalDecisions: Object.fromEntries(byFinal.map((b) => [b.finalDecision, b._count])),
      averageScreeningDurationMs: duration._avg.durationMs ? Math.round(duration._avg.durationMs) : null,
      averageConfidence: duration._avg.confidence,
      safetyFlags: { total: flags.reduce((s, f) => s + f._count, 0), bySeverity: Object.fromEntries(flags.map((f) => [f.severity, f._count])) },
      phi: { redactionEvents: phiEvents, redactedIdentifiers: phiTotal, byCategory: phiByCategory },
      agentExecutions: executions.map((e) => ({ provider: e.provider, status: e.status, count: e._count })),
      recentActivity: recent,
      system: { lyzrMode: this.lyzr.mode, queueMode: this.queue.mode },
    };
  }
}
