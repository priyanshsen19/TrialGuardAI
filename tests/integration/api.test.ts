/**
 * Full-stack integration tests: real Nest app, real PostgreSQL (test database),
 * inline queue, Lyzr mock mode. Exercises the documented REST API end-to-end.
 */
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../backend/src/testing/test-app';
import { PrismaService } from '../../backend/src/prisma/prisma.service';
import { ROOT, dbTestsEnabled, patientJson } from '../helpers';

const PASSWORD = 'TrialGuard!Demo2026';
const API = '/api/v1';

describe.skipIf(!dbTestsEnabled)('TrialGuard API — full screening workflow', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const tokens: Record<string, string> = {};
  let seed: { trialId: string; results: Array<{ patientRef: string; screeningId: string; decision: string; expectedDecision: string }> };
  const byRef = (ref: string) => seed.results.find((r) => r.patientRef === ref)!;

  const login = async (role: string) => {
    const r = await http.post(`${API}/auth/login`).send({ email: `${role}@trialguard.demo`, password: PASSWORD }).expect(200);
    return r.body.accessToken as string;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    for (const role of ['admin', 'coordinator', 'reviewer', 'auditor']) tokens[role] = await login(role);
    const r = await http.post(`${API}/demo/seed`).set(as('coordinator')).send({ reset: true }).expect(200);
    seed = r.body;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('platform', () => {
    it('GET /health is public and reports mock Lyzr mode + synthetic notice', async () => {
      const r = await http.get(`${API}/health`).expect(200);
      expect(r.body).toMatchObject({ status: 'ok', lyzr: { mode: 'mock', apiKeyConfigured: false } });
      expect(r.body.dataNotice).toMatch(/SYNTHETIC/);
      expect(r.headers['x-request-id']).toBeTruthy();
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    });
    it('propagates correlation ids', async () => {
      const r = await http.get(`${API}/health`).set('x-correlation-id', 'corr-test-123456').expect(200);
      expect(r.headers['x-correlation-id']).toBe('corr-test-123456');
    });
    it('requires JWT authentication', async () => {
      const r = await http.get(`${API}/trials`).expect(401);
      expect(r.body.error.code).toBe('UNAUTHENTICATED');
    });
    it('rejects bad credentials without revealing which part was wrong', async () => {
      const r = await http.post(`${API}/auth/login`).send({ email: 'admin@trialguard.demo', password: 'wrong' }).expect(401);
      expect(r.body.error.message).toBe('Invalid email or password');
    });
    it('enforces RBAC (auditor cannot create trials, coordinator cannot review)', async () => {
      await http.post(`${API}/trials`).set(as('auditor')).send({ code: 'CT-RBAC-1', title: 'RBAC test trial', phase: 'I', sponsor: 'Test', indication: 'Test' }).expect(403);
      await http.post(`${API}/screenings/${byRef('PAT-003').screeningId}/review`).set(as('coordinator')).send({ action: 'APPROVE_ELIGIBLE', reason: 'coordinator should not be able to do this' }).expect(403);
    });
    it('validates input (strict schemas, safe error body)', async () => {
      const r = await http.post(`${API}/trials`).set(as('coordinator')).send({ code: 'bad code', title: 'x', unexpected: true }).expect(400);
      expect(r.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(r.body)).not.toMatch(/stack|prisma/i);
    });
    it('rejects non-synthetic patient submissions', async () => {
      const p = patientJson('PAT-001');
      await http.post(`${API}/patients`).set(as('coordinator')).send({ demographics: p.demographics, documents: p.documents }).expect(400);
    });
    it('validates uploaded files (spoofed PDF rejected)', async () => {
      const t = await http.post(`${API}/trials`).set(as('coordinator')).send({ code: 'CT-FILE-001', title: 'File validation trial', phase: 'I', sponsor: 'Test', indication: 'Test' }).expect(201);
      const r = await http.post(`${API}/trials/${t.body.id}/protocol`).set(as('coordinator')).attach('file', Buffer.from('not really a pdf'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(400);
      expect(r.body.error.code).toBe('INVALID_FILE');
    });
  });

  describe('demo seed + decision states', () => {
    it('produces ELIGIBLE, INELIGIBLE and REQUIRES_HUMAN_OVERVIEW exactly as the scenarios expect', () => {
      expect(seed.results).toHaveLength(5);
      for (const r of seed.results) expect(r.decision).toBe(r.expectedDecision);
      expect(new Set(seed.results.map((r) => r.decision))).toEqual(new Set(['ELIGIBLE', 'INELIGIBLE', 'REQUIRES_HUMAN_OVERVIEW']));
    });
    it('protocol extraction from the PDF: 19 criteria with page provenance', async () => {
      const r = await http.get(`${API}/trials/${seed.trialId}/criteria`).set(as('auditor')).expect(200);
      expect(r.body.status).toBe('READY');
      expect(r.body.criteria).toHaveLength(19);
      const egfr = r.body.criteria.find((c: { criterionKey: string }) => c.criterionKey === 'INC-004');
      expect(egfr).toMatchObject({ operator: '>=', page: 5 });
      expect(egfr.definition).toMatchObject({ value: 60, unit: 'mL/min/1.73m2' });
      expect(r.body.execution.provider).toBe('mock');
    });
    it('screening detail exposes expected/actual/operator/rule/evidence per criterion', async () => {
      const r = await http.get(`${API}/screenings/${byRef('PAT-001').screeningId}`).set(as('auditor')).expect(200);
      expect(r.body).toMatchObject({ decision: 'ELIGIBLE', status: 'COMPLETED', lyzrMode: 'mock' });
      expect(r.body.confidence).toBeGreaterThanOrEqual(0.9);
      const inc4 = r.body.evaluations.find((e: { criterionKey: string }) => e.criterionKey === 'INC-004');
      expect(inc4).toMatchObject({ result: 'PASS', operator: '>=', ruleExpression: '72 >= 60 → true', sourcePage: 5 });
      expect(inc4.evidence[0]).toMatchObject({ sourceDocument: 'lab-report.pdf', page: 2, observedAt: '2026-09-10' });
      expect(r.body.stages.every((s: { completed: boolean }) => s.completed)).toBe(true);
    });
    it('PAT-002 is INELIGIBLE on the 22-day corticosteroid washout despite the injection attempt', async () => {
      const r = await http.get(`${API}/screenings/${byRef('PAT-002').screeningId}`).set(as('auditor')).expect(200);
      const exc5 = r.body.evaluations.find((e: { criterionKey: string }) => e.criterionKey === 'EXC-005');
      expect(exc5.result).toBe('FAIL');
      expect(exc5.ruleExpression).toContain('days_since=22');
      expect(r.body.flags.map((f: { code: string }) => f.code)).toContain('PROMPT_INJECTION_DETECTED');
    });
    it('review reasons are specific (ambiguous date, conflicting labs, missing lab)', async () => {
      const reasons = async (ref: string) => (await http.get(`${API}/screenings/${byRef(ref).screeningId}`).set(as('auditor'))).body.decisionReasons.join(' ');
      expect(await reasons('PAT-003')).toMatch(/EXC-005.*sometime last month/);
      expect(await reasons('PAT-004')).toMatch(/INC-004.*Conflicting eGFR/);
      expect(await reasons('PAT-005')).toMatch(/INC-003.*No HbA1c/);
    });
    it('dashboard aggregates counts, PHI redaction events and recent activity', async () => {
      const r = await http.get(`${API}/dashboard/stats`).set(as('auditor')).expect(200);
      expect(r.body).toMatchObject({ eligible: 1, ineligible: 1, humanReview: 3 });
      expect(r.body.phi.redactedIdentifiers).toBeGreaterThan(20);
      expect(r.body.recentActivity.length).toBeGreaterThan(0);
    });
  });

  describe('idempotency', () => {
    it('POST /screenings for the same trial/patient/date returns the existing screening', async () => {
      const s = byRef('PAT-001');
      const r = await http.post(`${API}/screenings`).set(as('coordinator')).send({ trialId: seed.trialId, patientId: 'PAT-001', screeningDate: '2026-09-23' }).expect(201);
      expect(r.body.idempotentReplay).toBe(true);
      expect(r.body.screening.id).toBe(s.screeningId);
    });
    it('Idempotency-Key header replays the first result', async () => {
      const body = { trialId: seed.trialId, patientId: 'PAT-001', screeningDate: '2026-09-24' };
      const a = await http.post(`${API}/screenings`).set(as('coordinator')).set('Idempotency-Key', 'idem-key-0001').send(body).expect(201);
      const b = await http.post(`${API}/screenings`).set(as('coordinator')).set('Idempotency-Key', 'idem-key-0001').send(body).expect(201);
      expect(a.body.idempotentReplay).toBe(false);
      expect(b.body.idempotentReplay).toBe(true);
      expect(b.body.screening.id).toBe(a.body.screening.id);
    });
    it('re-uploading the same protocol does not create a new version', async () => {
      const r = await http
        .post(`${API}/trials/${seed.trialId}/protocol`)
        .set(as('coordinator'))
        .attach('file', readFileSync(resolve(ROOT, 'synthetic-data/protocols/CT-2026-001.pdf')), { filename: 'CT-2026-001.pdf', contentType: 'application/pdf' })
        .expect(201);
      expect(r.body.idempotentReplay).toBe(true);
    });
  });

  describe('audit trail', () => {
    it('timeline contains the full provenance sequence', async () => {
      const r = await http.get(`${API}/screenings/${byRef('PAT-001').screeningId}/timeline`).set(as('auditor')).expect(200);
      const types = r.body.map((e: { eventType: string }) => e.eventType);
      for (const t of ['SCREENING_CREATED', 'PROTOCOL_BOUND', 'PATIENT_SNAPSHOT_BOUND', 'PHI_REDACTION_CONFIRMED', 'ONTOLOGY_VALIDATED', 'CRITERION_EVALUATED', 'AGENT_INVOKED', 'CONFIDENCE_CALCULATED', 'DECISION_RENDERED', 'NARRATIVE_GENERATED', 'DOSSIER_GENERATED']) {
        expect(types).toContain(t);
      }
      expect(types.filter((t: string) => t === 'CRITERION_EVALUATED')).toHaveLength(19);
    });
    it('GET /audit/:id/verify → valid chain with root hash', async () => {
      const r = await http.get(`${API}/audit/${byRef('PAT-002').screeningId}/verify`).set(as('auditor')).expect(200);
      expect(r.body).toMatchObject({ valid: true, sealedRootMatches: true });
      expect(r.body.eventsVerified).toBeGreaterThan(25);
      expect(r.body.rootHash).toMatch(/^[0-9a-f]{64}$/);
    });
    it('tamper simulation reports the modified event as invalid (stored data untouched)', async () => {
      const id = byRef('PAT-002').screeningId;
      const r = await http.post(`${API}/audit/${id}/simulate-tamper`).set(as('auditor')).send({ sequence: 5 }).expect(200);
      expect(r.body).toMatchObject({ valid: false, firstInvalidSequence: 5 });
      expect((await http.get(`${API}/audit/${id}/verify`).set(as('auditor'))).body.valid).toBe(true);
    });
    it('database triggers make audit events append-only (UPDATE and DELETE rejected)', async () => {
      const prisma = app.get(PrismaService);
      const ev = await prisma.auditEvent.findFirstOrThrow({ where: { chainId: byRef('PAT-001').screeningId, sequence: 5 } });
      await expect(prisma.auditEvent.update({ where: { id: ev.id }, data: { eventType: 'TAMPERED' } })).rejects.toThrow(/append-only/);
      await expect(prisma.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
    });
    it('direct tampering (bypassing triggers) is detected by verification, and restoring fixes it', async () => {
      const prisma = app.get(PrismaService);
      const id = byRef('PAT-001').screeningId;
      const ev = await prisma.auditEvent.findFirstOrThrow({ where: { chainId: id, sequence: 5 } });
      await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_append_only');
      try {
        await prisma.auditEvent.update({ where: { id: ev.id }, data: { payload: { ...(ev.payload as object), result: 'FAIL' } } });
        expect((await http.get(`${API}/audit/${id}/verify`).set(as('auditor'))).body).toMatchObject({ valid: false, firstInvalidSequence: 5 });
        await prisma.auditEvent.update({ where: { id: ev.id }, data: { payload: ev.payload as object } });
        expect((await http.get(`${API}/audit/${id}/verify`).set(as('auditor'))).body.valid).toBe(true);
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_event_append_only');
      }
    });
  });

  describe('human review', () => {
    it('review queue lists the three REQUIRES_HUMAN_OVERVIEW screenings with reasons', async () => {
      const r = await http.get(`${API}/review/queue`).set(as('reviewer')).expect(200);
      const refs = r.body.open.map((t: { screening: { patient: { patientRef: string } } }) => t.screening.patient.patientRef).sort();
      expect(refs).toEqual(['PAT-003', 'PAT-004', 'PAT-005']);
      expect(r.body.open[0].reasons.length).toBeGreaterThan(0);
    });
    it('reviewer must enter a reason', async () => {
      await http.post(`${API}/screenings/${byRef('PAT-003').screeningId}/review`).set(as('reviewer')).send({ action: 'APPROVE_INELIGIBLE', reason: '' }).expect(400);
    });
    it('cannot review a screening that did not require review', async () => {
      const r = await http.post(`${API}/screenings/${byRef('PAT-001').screeningId}/review`).set(as('reviewer')).send({ action: 'APPROVE_INELIGIBLE', reason: 'attempting to override a deterministic decision' }).expect(409);
      expect(r.body.error.code).toBe('REVIEW_NOT_APPLICABLE');
    });
    it('REQUEST_MORE_INFORMATION keeps the task open; approval resolves it; system decision is retained', async () => {
      const id = byRef('PAT-003').screeningId;
      await http.post(`${API}/screenings/${id}/review`).set(as('reviewer')).send({ action: 'REQUEST_MORE_INFORMATION', reason: 'Request urgent-care records for exact prednisone stop date.' }).expect(201);
      const approve = await http
        .post(`${API}/screenings/${id}/review`)
        .set(as('reviewer'))
        .set('Idempotency-Key', 'review-key-0001')
        .send({ action: 'APPROVE_INELIGIBLE', reason: 'Outside records confirm prednisone stopped 2026-09-05, within the 30-day window.' })
        .expect(201);
      expect(approve.body.screening).toMatchObject({ decision: 'REQUIRES_HUMAN_OVERVIEW', finalDecision: 'INELIGIBLE' });
      expect(approve.body.decision.signatureHash).toMatch(/^[0-9a-f]{64}$/);
      const replay = await http.post(`${API}/screenings/${id}/review`).set(as('reviewer')).set('Idempotency-Key', 'review-key-0001').send({ action: 'APPROVE_INELIGIBLE', reason: 'Outside records confirm prednisone stopped 2026-09-05, within the 30-day window.' }).expect(201);
      expect(replay.body.idempotentReplay).toBe(true);
      await http.post(`${API}/screenings/${id}/review`).set(as('reviewer')).send({ action: 'APPROVE_ELIGIBLE', reason: 'second attempt after resolution must be rejected' }).expect(409);
      const timeline = (await http.get(`${API}/screenings/${id}/timeline`).set(as('auditor'))).body.map((e: { eventType: string }) => e.eventType);
      expect(timeline.filter((t: string) => t === 'REVIEW_DECISION_RECORDED')).toHaveLength(2);
      expect((await http.get(`${API}/audit/${id}/verify`).set(as('auditor'))).body.valid).toBe(true);
    });
  });

  describe('dossier', () => {
    it('PDF dossier is generated', async () => {
      const r = await http.get(`${API}/screenings/${byRef('PAT-003').screeningId}/dossier`).set(as('auditor')).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(r.headers['x-dossier-sha256']).toMatch(/^[0-9a-f]{64}$/);
    });
    it('JSON dossier contains required sections, human review, verification and disclaimer', async () => {
      const r = await http.get(`${API}/screenings/${byRef('PAT-003').screeningId}/dossier.json`).set(as('auditor')).expect(200);
      const d = JSON.parse(r.text);
      expect(d.dossierType).toMatch(/FDA-style audit dossier/);
      expect(d.protocol.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(d.phiRedaction.confirmed).toBe(true);
      expect(d.decision).toMatchObject({ systemDecision: 'REQUIRES_HUMAN_OVERVIEW', finalDecision: 'INELIGIBLE' });
      expect(d.criterionEvaluations).toHaveLength(19);
      expect(d.humanReview.decisions).toHaveLength(2);
      expect(d.components).toMatchObject({ ruleEngine: '1.0.0', ontology: expect.stringMatching(/^tg-local/) });
      expect(d.agents).toHaveLength(4);
      expect(d.auditTrail.verification.valid).toBe(true);
      expect(d.disclaimer).toMatch(/NOT FDA approved/);
      expect(JSON.stringify(d)).not.toMatch(/FDA[- ]compliant(?! )/);
    });
  });

  describe('PHI leakage (end-to-end)', () => {
    const identifiers = () =>
      ['PAT-001', 'PAT-002', 'PAT-003', 'PAT-004', 'PAT-005'].flatMap((ref) => {
        const d = patientJson(ref).demographics;
        return [d.name, d.dateOfBirth, d.mrn, d.email, d.phone, d.address, d.insuranceId, d.hospitalId, ...d.name.split(/[\s-]+/)].filter((x: string) => x && x.length >= 4);
      });

    it('no identifier appears in any API response', async () => {
      const bodies: string[] = [];
      for (const ref of ['PAT-001', 'PAT-002', 'PAT-003', 'PAT-004', 'PAT-005']) {
        const s = byRef(ref);
        bodies.push((await http.get(`${API}/patients/${ref}`).set(as('auditor'))).text);
        bodies.push((await http.get(`${API}/screenings/${s.screeningId}`).set(as('auditor'))).text);
        bodies.push((await http.get(`${API}/screenings/${s.screeningId}/evidence`).set(as('auditor'))).text);
        bodies.push((await http.get(`${API}/screenings/${s.screeningId}/timeline`).set(as('auditor'))).text);
        bodies.push((await http.get(`${API}/screenings/${s.screeningId}/dossier.json`).set(as('auditor'))).text);
      }
      bodies.push((await http.get(`${API}/patients`).set(as('auditor'))).text);
      bodies.push((await http.get(`${API}/dashboard/stats`).set(as('auditor'))).text);
      const all = bodies.join('\n');
      for (const id of identifiers()) expect(all.includes(id), `leaked ${id}`).toBe(false);
    });
    it('no identifier is stored in plaintext in audit events, facts, documents or Lyzr executions', async () => {
      const prisma = app.get(PrismaService);
      const dump = JSON.stringify([
        await prisma.auditEvent.findMany(),
        await prisma.clinicalFact.findMany(),
        await prisma.document.findMany({ select: { filename: true, redactedPages: true } }),
        await prisma.lyzrExecution.findMany(),
        await prisma.screening.findMany(),
        await prisma.patientVersion.findMany(),
      ]);
      for (const id of identifiers()) expect(dump.includes(id), `stored ${id}`).toBe(false);
      const vault = await prisma.phiVaultEntry.findMany();
      expect(vault.length).toBeGreaterThan(0);
      for (const id of identifiers()) expect(JSON.stringify(vault).includes(id)).toBe(false);
    });
  });
});
