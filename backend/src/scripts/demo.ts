/**
 * Complete end-to-end demo (no HTTP server required):
 *   1. reset + seed CT-2026-001 and five synthetic patients, run all screenings
 *   2. verify all three decision states
 *   3. verify every audit chain, then demonstrate tamper detection
 *   4. record a human review for PAT-003
 *   5. export PDF + JSON dossiers to ./demo-output
 * Usage: pnpm demo:run
 */
import 'reflect-metadata';
import '../config/env';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../app.module';
import { DemoService } from '../api/demo.service';
import { AuditService } from '../audit/audit.service';
import { DossierService } from '../audit/dossier.service';
import { AuthService } from '../auth/auth.service';
import { JsonLogger } from '../common/logger';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { ScreeningsService } from '../screenings/screenings.service';

const ok = (b: boolean) => (b ? 'PASS' : 'FAIL');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: new JsonLogger('warn') });
  await app.get(AuthService).ensureRolesAndDemoUsers();
  if (app.get(QueueService).mode === 'bullmq') app.get(QueueService).startWorkers();
  const prisma = app.get(PrismaService);
  const user = async (email: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
    return { sub: u.id, email: u.email, role: u.role.name as never, name: u.displayName };
  };
  const checks: Array<[string, boolean]> = [];

  console.log('\n== 1. Seed + screen (synthetic data, Lyzr mode:', process.env.LYZR_MODE ?? 'mock', ') ==');
  const seed = await app.get(DemoService).seed(await user('coordinator@trialguard.demo'), { reset: true });
  console.table(seed.results.map((r) => ({ patient: r.patientRef, screening: r.screeningRef, expected: r.expectedDecision, actual: r.decision, confidence: `${((r.confidence as number) * 100).toFixed(1)}%` })));
  checks.push(['all five decisions match expected scenarios', seed.allMatch]);
  const states = new Set(seed.results.map((r) => r.decision));
  checks.push(['ELIGIBLE / INELIGIBLE / REQUIRES_HUMAN_OVERVIEW all produced', states.size === 3]);

  console.log('\n== 2. Audit chain verification ==');
  const audit = app.get(AuditService);
  for (const r of seed.results) {
    const v = await audit.verify(String(r.screeningId));
    console.log(`  ${r.screeningRef}: valid=${v.valid} events=${v.eventsVerified} root=${v.rootHash?.slice(0, 16)}…`);
    checks.push([`${r.screeningRef} chain valid`, v.valid]);
  }
  const target = String(seed.results[1].screeningId);
  const tampered = await audit.simulateTamper(target, 5);
  console.log(`  tamper simulation on event #5 → valid=${tampered.valid} (${tampered.reason})`);
  checks.push(['tampering detected', !tampered.valid && tampered.firstInvalidSequence === 5]);
  checks.push(['stored chain still valid after simulation', (await audit.verify(target)).valid]);

  console.log('\n== 3. Human review (PAT-003) ==');
  const pat3 = seed.results.find((r) => r.patientRef === 'PAT-003')!;
  const rev = await app.get(ScreeningsService).review(
    String(pat3.screeningId),
    { action: 'APPROVE_INELIGIBLE', reason: 'Outside urgent-care records confirm prednisone stopped 2026-09-05 (18 days before screening), inside the 30-day washout.' },
    await user('reviewer@trialguard.demo'),
  );
  console.log(`  final decision: ${rev.screening.finalDecision} (system decision retained: ${rev.screening.decision}); signature ${rev.decision.signatureHash.slice(0, 16)}…`);
  checks.push(['human review recorded; system decision unchanged', rev.screening.finalDecision === 'INELIGIBLE' && rev.screening.decision === 'REQUIRES_HUMAN_OVERVIEW']);
  checks.push(['chain valid after review', (await audit.verify(String(pat3.screeningId))).valid]);

  console.log('\n== 4. Dossiers ==');
  const outDir = resolve(process.cwd(), 'demo-output');
  mkdirSync(outDir, { recursive: true });
  const dossier = app.get(DossierService);
  for (const r of seed.results) {
    const pdf = await dossier.latest(String(r.screeningId), 'pdf');
    const json = await dossier.latest(String(r.screeningId), 'json');
    writeFileSync(resolve(outDir, `${r.screeningRef}-${r.patientRef}.pdf`), pdf.buffer);
    writeFileSync(resolve(outDir, `${r.screeningRef}-${r.patientRef}.json`), json.buffer);
    checks.push([`${r.screeningRef} PDF generated`, pdf.buffer.subarray(0, 5).toString() === '%PDF-']);
  }
  console.log(`  written to ${outDir}`);

  console.log('\n== Summary ==');
  for (const [name, pass] of checks) console.log(`  [${ok(pass)}] ${name}`);
  const allPass = checks.every(([, p]) => p);
  console.log(allPass ? '\nDemo completed successfully.\n' : '\nDemo completed with failures.\n');
  await app.close();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('demo failed:', err?.message ?? err);
  process.exit(1);
});
