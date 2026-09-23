import { Injectable, OnModuleInit } from '@nestjs/common';
import type { ClinicalFact, RawDocument, ResolvedFact } from '@trialguard/agents';
import { randomUUID } from 'node:crypto';
import { hashObject } from '../common/canonical-json';
import { AppError, notFound } from '../common/errors';
import { logger } from '../common/logger';
import { AuditService } from '../audit/audit.service';
import { LyzrRuntimeService } from '../lyzr/lyzr-runtime.service';
import { OntologyService } from '../ontology/ontology.service';
import type { KnownPhi } from '../phi/phi-redactor';
import { PhiService } from '../phi/phi.service';
import { PrismaService } from '../prisma/prisma.service';
import { safeMessage } from '../protocols/protocols.service';
import { QueueService, type JobPayload } from '../queue/queue.service';
import { splitTextPages } from '../storage/document-parser';
import { StorageService } from '../storage/storage.service';

export interface CreatePatientInput {
  patientRef?: string;
  synthetic: true;
  demographics: {
    name: string;
    dateOfBirth: string;
    sex: 'F' | 'M';
    mrn?: string;
    email?: string;
    phone?: string;
    address?: string;
    insuranceId?: string;
    hospitalId?: string;
    ssn?: string;
  };
  documents: Array<{ name: string; text?: string; pages?: string[] }>;
}

@Injectable()
export class PatientsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phi: PhiService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly lyzr: LyzrRuntimeService,
    private readonly ontology: OntologyService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.queue.register('patient-extraction', (data) => this.runExtraction(data));
  }

  private known(d: CreatePatientInput['demographics']): KnownPhi {
    return { names: [d.name], dateOfBirth: d.dateOfBirth, mrn: d.mrn ?? null, email: d.email ?? null, phone: d.phone ?? null, address: d.address ?? null, insuranceId: d.insuranceId ?? null, hospitalId: d.hospitalId ?? null, ssn: d.ssn ?? null };
  }

  private rawDocuments(docs: CreatePatientInput['documents']): RawDocument[] {
    return docs.map((d) => ({
      documentName: d.name,
      pages: d.pages?.length ? d.pages.map((t, i) => ({ page: i + 1, text: t })) : splitTextPages(d.text ?? ''),
    }));
  }

  async create(input: CreatePatientInput) {
    const known = this.known(input.demographics);
    let patient = input.patientRef ? await this.prisma.patient.findUnique({ where: { patientRef: input.patientRef } }) : null;
    if (!patient) {
      const id = randomUUID();
      const patientRef = input.patientRef ?? `PAT-${id.slice(0, 4).toUpperCase()}`;
      patient = await this.prisma.patient.create({ data: { id, patientRef, sex: input.demographics.sex, phiScope: `patient:${id}`, synthetic: true } });
    }
    await this.phi.storeIdentity(patient.phiScope, known);

    // Deterministic, local redaction up-front → PHI-free snapshot hash for idempotent versioning.
    const raw = this.rawDocuments(input.documents);
    const redacted = await this.phi.runInScope(patient.phiScope, known, () => this.phi.redact(raw, known));
    const snapshotHash = hashObject(redacted.documents);

    const existing = await this.prisma.patientVersion.findUnique({ where: { patientId_snapshotHash: { patientId: patient.id, snapshotHash } } });
    if (existing) {
      if (existing.status === 'FAILED') await this.enqueue(existing.id);
      return { idempotentReplay: true, patient: await this.get(patient.id) };
    }
    const versionNumber = (await this.prisma.patientVersion.count({ where: { patientId: patient.id } })) + 1;
    const pv = await this.prisma.patientVersion.create({ data: { patientId: patient.id, versionNumber, snapshotHash, status: 'PENDING', phiSummary: redacted.summary as unknown as object } });

    for (let i = 0; i < raw.length; i++) {
      const buf = Buffer.from(JSON.stringify(raw[i]), 'utf8');
      const stored = await this.storage.put(`documents/patients/${pv.id}/${String(i).padStart(3, "0")}.bin`, buf, { encrypt: true });
      await this.prisma.document.create({
        data: {
          kind: 'PATIENT_RECORD',
          filename: redacted.documents[i].documentName,
          mimeType: 'text/plain',
          sizeBytes: buf.length,
          sha256: stored.sha256,
          storageKey: stored.key,
          redactedPages: redacted.documents[i].pages as unknown as object,
          patientVersionId: pv.id,
        },
      });
    }
    await this.audit.append(`patient:${pv.id}`, {
      eventType: 'PATIENT_RECORD_REGISTERED',
      actorType: 'USER',
      component: 'patients-service',
      componentVersion: '1.0.0',
      payload: { patientRef: patient.patientRef, versionNumber, snapshotHash, documents: raw.length, phi: redacted.summary, synthetic: true },
    });
    await this.enqueue(pv.id);
    return { idempotentReplay: false, patient: await this.get(patient.id) };
  }

  private async enqueue(patientVersionId: string) {
    try {
      await this.queue.enqueue('patient-extraction', { patientVersionId }, { jobId: `patient-extraction:${patientVersionId}` });
    } catch (err) {
      if (this.queue.mode === 'bullmq') throw err;
    }
  }

  async runExtraction(data: JobPayload) {
    const id = String(data.patientVersionId);
    const pv = await this.prisma.patientVersion.findUnique({ where: { id }, include: { patient: true, documents: { orderBy: { storageKey: 'asc' } } } });
    if (!pv) throw Object.assign(new Error('patient version not found'), { nonRetryable: true });
    if (pv.status === 'READY') return;
    await this.prisma.patientVersion.update({ where: { id }, data: { status: 'PROCESSING', errorMessage: null } });
    try {
      const known = (await this.phi.loadIdentity(pv.patient.phiScope)) ?? undefined;
      const raw: RawDocument[] = [];
      for (const d of pv.documents) raw.push(JSON.parse((await this.storage.get(d.storageKey, { encrypted: true })).toString('utf8')));
      const chainId = `patient:${id}`;
      const result = await this.phi.runInScope(pv.patient.phiScope, known, () =>
        this.lyzr.orchestrator.extractPatient(chainId, raw, known ?? {}, { correlationId: data.correlationId }),
      );
      await this.lyzr.flush();
      const mappingIds = new Map<string, string>();
      for (const f of result.facts) mappingIds.set(f.factId, await this.ontology.persistMapping(f));

      await this.prisma.$transaction(async (tx) => {
        await tx.clinicalFact.deleteMany({ where: { patientVersionId: id } });
        for (const f of result.facts) {
          await tx.clinicalFact.create({
            data: {
              patientVersionId: id,
              factKey: f.factId,
              category: f.category,
              display: f.concept.display,
              value: f.value === null ? undefined : (f.value as never),
              unit: f.unit,
              observedAt: f.observedAt ?? f.endDate ?? f.startDate ?? f.onsetDate ?? null,
              datePrecision: f.datePrecision,
              sourceDocument: f.source.document,
              sourcePage: f.source.page,
              mappingStatus: f.resolution.status,
              ontologyMappingId: mappingIds.get(f.factId),
              data: f as unknown as object,
            },
          });
        }
        const sexFact = result.facts.find((f) => f.resolution.concept?.key === 'LOCAL:sex');
        if (sexFact && typeof sexFact.value === 'string') await tx.patient.update({ where: { id: pv.patientId }, data: { sex: sexFact.value } });
        await tx.patientVersion.update({
          where: { id },
          data: {
            status: 'READY',
            phiSummary: result.phi as unknown as object,
            injectionFindings: result.injectionFindings,
            crossValidation: (result.crossValidation ?? undefined) as unknown as object | undefined,
            groundingRejections: result.rejected as unknown as object,
            extractionNotes: result.notes,
            agentExecutionId: result.execution.executionId,
            extractedAt: new Date(),
          },
        });
      });
      await this.audit.seal(chainId, 'PATIENT_EXTRACTION_COMPLETED');
      logger.log({ event: 'patient_extracted', patientVersionId: id, facts: result.facts.length, provider: result.execution.provider, agreementRate: result.crossValidation?.agreementRate }, 'Patients');
    } catch (err) {
      await this.prisma.patientVersion.update({ where: { id }, data: { status: 'FAILED', errorMessage: safeMessage(err) } });
      throw err;
    }
  }

  async list() {
    const patients = await this.prisma.patient.findMany({
      orderBy: { patientRef: 'asc' },
      include: {
        versions: { orderBy: { versionNumber: 'desc' }, take: 1, include: { _count: { select: { facts: true } } } },
        screenings: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, screeningRef: true, decision: true, finalDecision: true, confidence: true } },
        _count: { select: { screenings: true } },
      },
    });
    return patients.map((p) => ({
      id: p.id,
      patientRef: p.patientRef,
      sex: p.sex,
      synthetic: p.synthetic,
      createdAt: p.createdAt,
      latestVersion: p.versions[0] ? { id: p.versions[0].id, versionNumber: p.versions[0].versionNumber, status: p.versions[0].status, facts: p.versions[0]._count.facts, snapshotHash: p.versions[0].snapshotHash, phiSummary: p.versions[0].phiSummary } : null,
      latestScreening: p.screenings[0] ?? null,
      screeningCount: p._count.screenings,
    }));
  }

  async get(id: string) {
    const p = await this.prisma.patient.findFirst({
      where: { OR: [{ id: isUuid(id) ? id : undefined }, { patientRef: id }] },
      include: { versions: { orderBy: { versionNumber: 'desc' }, include: { facts: { orderBy: { factKey: 'asc' } }, documents: { select: { id: true, filename: true, sizeBytes: true, sha256: true, redactedPages: true } } } } },
    });
    if (!p) throw notFound('Patient');
    const latest = p.versions[0];
    return {
      id: p.id,
      patientRef: p.patientRef,
      sex: p.sex,
      synthetic: p.synthetic,
      createdAt: p.createdAt,
      phiNotice: 'Identifiers are stored only as AES-256-GCM ciphertext in the PHI vault and are never returned by the API.',
      versions: p.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status,
        snapshotHash: v.snapshotHash,
        phiSummary: v.phiSummary,
        injectionFindings: v.injectionFindings,
        groundingRejections: v.groundingRejections,
        extractionNotes: v.extractionNotes,
        crossValidation: v.crossValidation,
        errorMessage: v.errorMessage,
        createdAt: v.createdAt,
        extractedAt: v.extractedAt,
      })),
      facts: latest?.facts.map((f) => f.data as unknown as ResolvedFact) ?? [],
      redactedDocuments: latest?.documents.map((d) => ({ id: d.id, filename: d.filename, sha256: d.sha256, pages: d.redactedPages })) ?? [],
    };
  }

  async latestReadyVersion(patientId: string) {
    return this.prisma.patientVersion.findFirst({ where: { patientId, status: 'READY' }, orderBy: { versionNumber: 'desc' }, include: { facts: true, documents: true } });
  }
}

export function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export type { ClinicalFact };
