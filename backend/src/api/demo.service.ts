import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { loadConfig } from '../config/config';
import type { AuthUser } from '../auth/roles';
import { PatientsService, type CreatePatientInput } from '../patients/patients.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProtocolsService } from '../protocols/protocols.service';
import { ScreeningsService } from '../screenings/screenings.service';

export function syntheticDataDir(): string {
  const candidates = [process.env.SYNTHETIC_DATA_DIR, resolve(__dirname, '../../../synthetic-data'), resolve(process.cwd(), 'synthetic-data'), resolve(process.cwd(), '../synthetic-data')].filter(Boolean) as string[];
  const hit = candidates.find((c) => existsSync(join(c, 'scenarios')));
  if (!hit) throw new AppError('SYNTHETIC_DATA_MISSING', 'synthetic-data directory not found (set SYNTHETIC_DATA_DIR)', 500);
  return hit;
}

const TRIAL = {
  code: 'CT-2026-001',
  title: 'GLYCO-SHIELD-2: Phase II study of TGX-417 add-on to metformin in adults with type 2 diabetes (SYNTHETIC)',
  phase: 'II',
  sponsor: 'Northwind Therapeutics (fictional)',
  indication: 'Type 2 diabetes mellitus',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly protocols: ProtocolsService,
    private readonly patients: PatientsService,
    private readonly screenings: ScreeningsService,
  ) {}

  /**
   * Demo-only reset. Uses TRUNCATE (row-level append-only triggers do not fire
   * on TRUNCATE) and is available only when DEMO_MODE=true to ADMIN users.
   */
  async reset() {
    if (!loadConfig().demoMode) throw new AppError('DEMO_DISABLED', 'Demo reset is only available when DEMO_MODE=true', 403);
    await this.prisma.$executeRawUnsafe(
      'TRUNCATE "AuditDossier","ReviewDecision","ReviewTask","SafetyFlag","CriterionEvaluation","LyzrExecution","Screening","ClinicalFact","OntologyMapping","ProtocolCriterion","ProtocolVersion","Protocol","Document","PatientVersion","Patient","PhiVaultEntry","AuditRoot","AuditEvent","Trial" CASCADE',
    );
    await this.prisma.$executeRawUnsafe('ALTER SEQUENCE screening_ref_seq RESTART WITH 1');
    logger.warn({ event: 'demo_reset' }, 'Demo');
  }

  private async waitFor<T>(fn: () => Promise<T | null>, what: string, timeoutMs = 180_000): Promise<T> {
    const started = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - started > timeoutMs) throw new AppError('DEMO_TIMEOUT', `Timed out waiting for ${what}`, 504);
      await sleep(500);
    }
  }

  async seed(user: AuthUser, opts: { reset?: boolean; runScreenings?: boolean } = {}) {
    if (!loadConfig().demoMode) throw new AppError('DEMO_DISABLED', 'Demo seeding is only available when DEMO_MODE=true', 403);
    if (opts.reset) await this.reset();
    const dir = syntheticDataDir();
    const scenario = JSON.parse(readFileSync(join(dir, 'scenarios/ct-2026-001-demo.json'), 'utf8')) as {
      screeningDate: string;
      protocolFile: string;
      protocolSourceText: string;
      scenarios: Array<{ patientRef: string; expectedDecision: string; description: string }>;
    };

    const trial = (await this.prisma.trial.findUnique({ where: { code: TRIAL.code } })) ?? (await this.prisma.trial.create({ data: { ...TRIAL, synthetic: true } }));

    const pdfPath = join(dir, scenario.protocolFile);
    const usePdf = existsSync(pdfPath);
    const file = usePdf
      ? { buffer: readFileSync(pdfPath), originalname: 'CT-2026-001.pdf', mimetype: 'application/pdf' }
      : { buffer: readFileSync(join(dir, scenario.protocolSourceText)), originalname: 'CT-2026-001.txt', mimetype: 'text/plain' };
    const uploaded = await this.protocols.upload(trial.id, file);
    const pv = await this.waitFor(async () => {
      const v = await this.prisma.protocolVersion.findUnique({ where: { id: uploaded.protocolVersion.id } });
      if (v?.status === 'FAILED') throw new AppError('PROTOCOL_EXTRACTION_FAILED', v.errorMessage ?? 'protocol extraction failed', 500);
      return v?.status === 'READY' ? v : null;
    }, 'protocol extraction');

    const results: Array<Record<string, unknown>> = [];
    for (const sc of scenario.scenarios) {
      const p = JSON.parse(readFileSync(join(dir, `patients/${sc.patientRef}.json`), 'utf8')) as { demographics: CreatePatientInput['demographics']; documents: CreatePatientInput['documents'] };
      const created = await this.patients.create({ patientRef: sc.patientRef, synthetic: true, demographics: p.demographics, documents: p.documents });
      const patientId = created.patient.id;
      await this.waitFor(async () => {
        const v = await this.prisma.patientVersion.findFirst({ where: { patientId }, orderBy: { versionNumber: 'desc' } });
        if (v?.status === 'FAILED') throw new AppError('PATIENT_EXTRACTION_FAILED', v.errorMessage ?? 'patient extraction failed', 500);
        return v?.status === 'READY' ? v : null;
      }, `patient ${sc.patientRef} extraction`);

      if (opts.runScreenings === false) continue;
      const r = await this.screenings.create({ trialId: trial.id, patientId, screeningDate: scenario.screeningDate }, user);
      const done = await this.waitFor(async () => {
        const s = await this.prisma.screening.findUnique({ where: { id: r.screening.id } });
        if (s?.status === 'FAILED') throw new AppError('SCREENING_FAILED', s.errorMessage ?? 'screening failed', 500);
        return s?.status === 'COMPLETED' ? s : null;
      }, `screening of ${sc.patientRef}`);
      results.push({
        patientRef: sc.patientRef,
        screeningId: done.id,
        screeningRef: done.screeningRef,
        expectedDecision: sc.expectedDecision,
        decision: done.decision,
        confidence: done.confidence,
        matchesExpectation: done.decision === sc.expectedDecision,
        scenario: sc.description,
      });
    }
    return {
      trialId: trial.id,
      protocolVersionId: pv.id,
      protocolSource: usePdf ? 'PDF' : 'text',
      screeningDate: scenario.screeningDate,
      allMatch: results.every((r) => r.matchesExpectation),
      results,
    };
  }
}
