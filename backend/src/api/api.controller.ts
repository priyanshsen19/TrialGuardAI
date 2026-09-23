import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, type AuthUser } from '../auth/roles';
import { LyzrRuntimeService } from '../lyzr/lyzr-runtime.service';
import { OntologyService } from '../ontology/ontology.service';
import { QueueService } from '../queue/queue.service';
import { ScreeningsService } from '../screenings/screenings.service';
import { DashboardService } from './dashboard.service';
import { DemoService } from './demo.service';

const SeedSchema = z.object({ reset: z.boolean().optional(), runScreenings: z.boolean().optional() }).strict();

@Controller()
export class ApiController {
  constructor(
    private readonly demo: DemoService,
    private readonly dashboard: DashboardService,
    private readonly screenings: ScreeningsService,
    private readonly lyzr: LyzrRuntimeService,
    private readonly ontology: OntologyService,
    private readonly queue: QueueService,
  ) {}

  /** Seed trial CT-2026-001, its protocol PDF, five synthetic patients, and run all screenings. */
  @Post('demo/seed')
  @HttpCode(200)
  @Roles('COORDINATOR')
  seed(@Body(new ZodPipe(SeedSchema)) body: z.infer<typeof SeedSchema>, @CurrentUser() user: AuthUser) {
    return this.demo.seed(user, body);
  }

  @Get('dashboard/stats')
  stats() {
    return this.dashboard.stats();
  }

  @Get('review/queue')
  reviewQueue() {
    return this.screenings.reviewQueue();
  }

  @Get('system/agents')
  agents() {
    return this.lyzr.describe();
  }

  @Get('system/ontology')
  ontologyDictionary() {
    return this.ontology.dictionary();
  }

  @Get('system/jobs')
  async jobs() {
    return { ...(await this.queue.stats()), recent: this.queue.recentJobs() };
  }
}
