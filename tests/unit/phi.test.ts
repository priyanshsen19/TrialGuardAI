import { describe, expect, it } from 'vitest';
import {
  createAgentRuntime,
  loadLyzrEnvironment,
  SafeAiBlockedError,
  type OrchestrationPorts,
  type PhiPort,
} from '@trialguard/agents';
import { KeyRing } from '../../backend/src/common/crypto';
import { decrypt, encrypt } from '../../backend/src/common/crypto';
import { sanitize } from '../../backend/src/common/logger';
import { OntologyResolver } from '../../backend/src/ontology/resolver';
import { PhiRedactor, summarize } from '../../backend/src/phi/phi-redactor';
import { decide } from '../../backend/src/rule-engine/decision';
import { evaluateAll } from '../../backend/src/rule-engine/evaluator';
import { deterministicSafetyChecks } from '../../backend/src/rule-engine/safety-checks';

const keys = new KeyRing(Buffer.alloc(32, 7));
const redactor = new PhiRedactor(keys.phiAliasKey);

const PHI = ['John Smith', 'john@example.com', '555-555-5555', 'MRN-12345', '123 Main Street'];
const RECORD = `DEMOGRAPHICS
Patient Name: John Smith
DOB: 1970-01-31
Sex: Male
MRN: MRN-12345
Address: 123 Main Street
Phone: 555-555-5555
Email: john@example.com
Insurance Member ID: INS-5550001
Hospital ID: HOSP-ID-9001
SSN: 123-45-6789
CLINICAL NOTE
Mr. Smith was seen today. Contact john@example.com or 555-555-5555. Lives at 123 Main Street.
LABORATORY RESULTS
2026-09-10 | Hemoglobin A1c | 7.8 | %`;

describe('PHI redaction', () => {
  it('detects and replaces all PHI categories with deterministic aliases', () => {
    const r = redactor.redact(RECORD, { names: ['John Smith'], dateOfBirth: '1970-01-31', mrn: 'MRN-12345' });
    for (const p of [...PHI, '1970-01-31', 'INS-5550001', 'HOSP-ID-9001', '123-45-6789']) expect(r.text).not.toContain(p);
    expect(r.text).toMatch(/PATIENT_NAME_REDACTED_[0-9A-F]{6}/);
    expect(r.text).toMatch(/MRN_REDACTED_[0-9A-F]{6}/);
    const cats = summarize(r.replacements).byCategory;
    for (const c of ['PATIENT_NAME', 'DOB', 'ADDRESS', 'EMAIL', 'PHONE', 'MRN', 'SSN', 'INSURANCE_ID', 'HOSPITAL_ID']) expect(cats[c]).toBeGreaterThan(0);
  });
  it('aliases are deterministic and do not reveal the value', () => {
    expect(redactor.alias('PATIENT_NAME', 'John Smith')).toBe(redactor.alias('PATIENT_NAME', 'john  smith'));
    expect(redactor.alias('PATIENT_NAME', 'John Smith')).not.toContain('John');
  });
  it('preserves clinical data (lab dates and values)', () => {
    const r = redactor.redact(RECORD, { names: ['John Smith'] });
    expect(r.text).toContain('2026-09-10 | Hemoglobin A1c | 7.8 | %');
    expect(r.text).toContain('Sex: Male');
  });
  it('vault encryption is authenticated (AES-256-GCM)', () => {
    const ct = encrypt(keys.phiVaultKey, 'John Smith', 'scope:alias');
    expect(ct).not.toContain('John');
    expect(decrypt(keys.phiVaultKey, ct, 'scope:alias').toString()).toBe('John Smith');
    expect(() => decrypt(keys.phiVaultKey, ct, 'other-scope')).toThrow();
  });
  it('structured logger never emits PHI-bearing keys or emails', () => {
    const out = JSON.stringify(sanitize({ name: 'John Smith', demographics: { dob: '1970' }, note: 'mail john@example.com', apiKey: 'sk-abcdefghijklmnopqrstuvwxyz' }));
    for (const p of ['John Smith', 'john@example.com', 'sk-abcdefghijklmnopqrstuvwxyz']) expect(out).not.toContain(p);
  });
});

function ports(phi: PhiPort): OrchestrationPorts {
  const ontology = new OntologyResolver();
  return {
    phi,
    ontology: { version: ontology.version, resolveCriteria: (c) => ontology.resolveCriteria(c), resolveFacts: (f) => ontology.resolveFacts(f) },
    ruleEngine: { version: '1.0.0', evaluate: evaluateAll },
    safety: { check: deterministicSafetyChecks },
    decision: { decide },
    audit: { record: async () => undefined },
  };
}

const realPhiPort: PhiPort = {
  async redact(docs, known) {
    let total = 0;
    const documents = docs.map((d) => ({
      documentName: d.documentName,
      pages: d.pages.map((p) => {
        const r = redactor.redact(p.text, known as never);
        total += r.replacements.length;
        return { page: p.page, text: r.text };
      }),
    }));
    return { documents, summary: { totalRedactions: total, byCategory: {} } };
  },
};

/** Live-mode runtime whose "Lyzr" is a fake fetch that records every outbound payload. */
function liveRuntime(phi: PhiPort) {
  const payloads: string[] = [];
  const config = loadLyzrEnvironment({
    LYZR_MODE: 'live',
    LYZR_API_KEY: 'test-key-not-real',
    LYZR_BASE_URL: 'https://lyzr.test',
    LYZR_PROTOCOL_AGENT_ID: 'a1',
    LYZR_PATIENT_AGENT_ID: 'a2',
    LYZR_SAFETY_AGENT_ID: 'a3',
    LYZR_AUDIT_AGENT_ID: 'a4',
  } as NodeJS.ProcessEnv);
  const rt = createAgentRuntime(ports(phi), { config });
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    payloads.push(String(init.body));
    return new Response(JSON.stringify({ response: JSON.stringify({ facts: [], notes: [] }) }), { status: 200 });
  }) as typeof fetch;
  // swap the client's fetch implementation
  (rt.inference as unknown as { client: { fetchImpl: typeof fetch } }).client.fetchImpl = fakeFetch;
  return { rt, payloads };
}

describe('PHI leakage — Lyzr payload', () => {
  const raw = [{ documentName: 'record.txt', pages: [{ page: 1, text: RECORD }] }];
  const known = { names: ['John Smith'], dateOfBirth: '1970-01-31', mrn: 'MRN-12345', email: 'john@example.com', phone: '555-555-5555', address: '123 Main Street' };

  it('none of the synthetic identifiers appear in the outbound Lyzr request', async () => {
    const { rt, payloads } = liveRuntime({ ...realPhiPort, residualScanner: (t) => redactor.residualScan(t, known) });
    await rt.orchestrator.extractPatient('patient:test', raw, known, {});
    expect(payloads.length).toBe(1);
    for (const p of PHI) expect(payloads[0]).not.toContain(p);
    expect(payloads[0]).toContain('PATIENT_NAME_REDACTED_');
    expect(payloads[0]).toContain('Hemoglobin A1c');
  });

  it('Safe AI blocks the call (nothing sent) if redaction is bypassed', async () => {
    const identity: PhiPort = { redact: async (docs) => ({ documents: docs, summary: { totalRedactions: 0, byCategory: {} } }), residualScanner: (t) => redactor.residualScan(t, known) };
    const { rt, payloads } = liveRuntime(identity);
    await expect(rt.orchestrator.extractPatient('patient:test', raw, known, {})).rejects.toBeInstanceOf(SafeAiBlockedError);
    expect(payloads).toHaveLength(0);
  });
});
