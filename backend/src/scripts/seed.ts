/**
 * Seed the synthetic demo (trial CT-2026-001, protocol PDF, five patients) and
 * run all five screenings.  Usage:  pnpm demo:seed  [--reset]
 */
import 'reflect-metadata';
import '../config/env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DemoService } from '../api/demo.service';
import { AuthService } from '../auth/auth.service';
import { JsonLogger } from '../common/logger';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: new JsonLogger('warn') });
  await app.get(AuthService).ensureRolesAndDemoUsers();
  if (app.get(QueueService).mode === 'bullmq') app.get(QueueService).startWorkers();
  const admin = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email: 'admin@trialguard.demo' }, include: { role: true } });
  const result = await app.get(DemoService).seed(
    { sub: admin.id, email: admin.email, role: 'ADMIN', name: admin.displayName },
    { reset: process.argv.includes('--reset') },
  );
  console.log('\nTrialGuard AI demo seed — SYNTHETIC DATA\n');
  console.table(result.results.map((r) => ({ patient: r.patientRef, screening: r.screeningRef, expected: r.expectedDecision, actual: r.decision, confidence: `${((r.confidence as number) * 100).toFixed(1)}%`, match: r.matchesExpectation ? 'yes' : 'NO' })));
  console.log(result.allMatch ? 'All decisions match expected scenarios.' : 'WARNING: some decisions did not match expectations.');
  await app.close();
  process.exit(result.allMatch ? 0 : 2);
}

main().catch((err) => {
  console.error('seed failed:', err?.message ?? err);
  process.exit(1);
});
