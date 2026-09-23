import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/roles';
import { LyzrRuntimeService } from '../lyzr/lyzr-runtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

const started = Date.now();

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly lyzr: LyzrRuntimeService,
  ) {}

  @Public()
  @Get()
  async health() {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const queueOk = await this.queue.ping();
    const env = this.lyzr.describe().environment;
    return {
      status: db && queueOk ? 'ok' : 'degraded',
      service: 'trialguard-backend',
      version: '1.0.0',
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      checks: { database: db ? 'up' : 'down', queue: { mode: this.queue.mode, status: queueOk ? 'up' : 'down' } },
      lyzr: { mode: env.mode, environmentId: env.environmentId, apiKeyConfigured: env.apiKeyConfigured, agentsConfigured: env.agentsConfigured, aimsEnabled: env.aimsEnabled },
      dataNotice: 'SYNTHETIC DATA ONLY — not for clinical use',
    };
  }
}
