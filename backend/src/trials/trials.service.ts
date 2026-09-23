import { Injectable } from '@nestjs/common';
import { conflict, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ProtocolsService } from '../protocols/protocols.service';

export interface CreateTrialInput {
  code: string;
  title: string;
  phase: string;
  sponsor: string;
  indication: string;
}

@Injectable()
export class TrialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly protocols: ProtocolsService,
  ) {}

  async create(input: CreateTrialInput) {
    if (await this.prisma.trial.findUnique({ where: { code: input.code } })) throw conflict('TRIAL_EXISTS', `Trial ${input.code} already exists`);
    return this.prisma.trial.create({ data: { ...input, synthetic: true } });
  }

  async list() {
    const trials = await this.prisma.trial.findMany({ orderBy: { createdAt: 'desc' }, include: { protocols: { include: { versions: { orderBy: { createdAt: 'desc' }, take: 1, include: { _count: { select: { criteria: true } } } } } } } });
    const counts = await this.prisma.screening.groupBy({ by: ['trialId', 'decision'], _count: true });
    return trials.map((t) => {
      const latest = t.protocols[0]?.versions[0] ?? null;
      const byDecision: Record<string, number> = {};
      for (const c of counts.filter((x) => x.trialId === t.id)) byDecision[c.decision ?? 'PENDING'] = c._count;
      return {
        id: t.id,
        code: t.code,
        title: t.title,
        phase: t.phase,
        sponsor: t.sponsor,
        indication: t.indication,
        status: t.status,
        synthetic: t.synthetic,
        createdAt: t.createdAt,
        protocol: latest ? { versionId: latest.id, version: latest.version, status: latest.status, contentHash: latest.contentHash, criteria: latest._count.criteria, pages: latest.pageCount } : null,
        screenings: { total: Object.values(byDecision).reduce((a, b) => a + b, 0), ...byDecision },
      };
    });
  }

  async get(id: string) {
    const t = await this.prisma.trial.findUnique({ where: { id }, include: { protocols: { include: { versions: { orderBy: { createdAt: 'desc' } } } } } });
    if (!t) throw notFound('Trial');
    const latest = t.protocols[0]?.versions[0];
    const screenings = await this.prisma.screening.findMany({
      where: { trialId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, screeningRef: true, decision: true, finalDecision: true, confidence: true, status: true, createdAt: true, patient: { select: { patientRef: true } } },
    });
    return {
      ...t,
      protocolVersions: t.protocols.flatMap((p) => p.versions.map(({ id: vid, version, status, contentHash, pageCount, createdAt, extractedAt, errorMessage }) => ({ id: vid, version, status, contentHash, pageCount, createdAt, extractedAt, errorMessage }))),
      activeProtocol: latest ? await this.protocols.getVersion(latest.id) : null,
      screenings,
    };
  }
}
