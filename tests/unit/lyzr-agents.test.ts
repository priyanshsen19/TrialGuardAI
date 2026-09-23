import { describe, expect, it, vi } from 'vitest';
import {
  AuditNarrationAgent,
  LyzrClient,
  LyzrConfigurationError,
  LyzrError,
  LyzrInference,
  SafeAi,
  agentManifest,
  loadLyzrEnvironment,
  mockExtractProtocol,
  templateNarrative,
  toLyzrAgentDefinition,
  AGENT_DEFINITIONS,
  type VerifiedScreeningSummary,
} from '@trialguard/agents';
import { fact, protocolDoc } from '../helpers';

const liveCfg = () =>
  loadLyzrEnvironment({
    LYZR_MODE: 'live',
    LYZR_API_KEY: 'secret-test-key-123',
    LYZR_BASE_URL: 'https://lyzr.test',
    LYZR_PROTOCOL_AGENT_ID: 'p',
    LYZR_PATIENT_AGENT_ID: 'c',
    LYZR_SAFETY_AGENT_ID: 's',
    LYZR_AUDIT_AGENT_ID: 'a',
    LYZR_MAX_RETRIES: '2',
    LYZR_TIMEOUT_MS: '50',
  } as NodeJS.ProcessEnv);

describe('Lyzr environment + client', () => {
  it('defaults to mock mode with no credentials', () => {
    const cfg = loadLyzrEnvironment({} as NodeJS.ProcessEnv);
    expect(cfg.mode).toBe('mock');
    expect(cfg.apiKey).toBeNull();
  });
  it('live mode without credentials fails fast with a structured error', () => {
    expect(() => loadLyzrEnvironment({ LYZR_MODE: 'live' } as NodeJS.ProcessEnv)).toThrow(LyzrConfigurationError);
  });
  it('sends the documented v3 chat request (x-api-key, agent_id, session_id, user_id, message)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ response: 'ok' }), { status: 200 }));
    const client = new LyzrClient(liveCfg(), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await client.chat({ agentId: 'p', sessionId: 'sess', message: 'hi' });
    expect(r.response).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://lyzr.test/v3/inference/chat/');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('secret-test-key-123');
    expect(JSON.parse(String(init.body))).toMatchObject({ agent_id: 'p', session_id: 'sess', message: 'hi', user_id: 'trialguard-service' });
  });
  it('retries 503 with backoff then succeeds; emits runtime events', async () => {
    let n = 0;
    const events: string[] = [];
    const fetchImpl = (async () => (++n < 2 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ response: 'ok' }), { status: 200 }))) as unknown as typeof fetch;
    const client = new LyzrClient(liveCfg(), { fetchImpl, sleep: async () => undefined, onEvent: (e) => events.push(e.type) });
    const r = await client.chat({ agentId: 'p', sessionId: 's', message: 'm' });
    expect(r.attempts).toBe(2);
    expect(events).toEqual(['request.started', 'request.retrying', 'request.started', 'request.succeeded']);
  });
  it('does not retry auth errors and never leaks the API key', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 401 }));
    const client = new LyzrClient(liveCfg(), { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => undefined });
    const err = await client.chat({ agentId: 'p', sessionId: 's', message: 'm' }).catch((e) => e);
    expect(err).toBeInstanceOf(LyzrError);
    expect(err.code).toBe('LYZR_AUTH');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.toJSON()) + err.message).not.toContain('secret-test-key-123');
  });
  it('times out with LYZR_TIMEOUT after bounded retries', async () => {
    const fetchImpl = ((_: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const client = new LyzrClient(liveCfg(), { fetchImpl, sleep: async () => undefined });
    const err = await client.chat({ agentId: 'p', sessionId: 's', message: 'm' }).catch((e) => e);
    expect(err.code).toBe('LYZR_TIMEOUT');
    expect(err.details.attempts).toBe(3);
  });
  it('agent definitions map onto the documented POST /v3/agents/ payload', () => {
    const body = toLyzrAgentDefinition(AGENT_DEFINITIONS.protocol);
    expect(body).toMatchObject({ agent_role: expect.any(String), agent_instructions: expect.stringContaining('untrusted data'), temperature: 0, response_format: { type: 'json_object' } });
    expect(agentManifest()).toHaveLength(4);
  });
});

describe('Lyzr mock mode', () => {
  it('mock responses are labelled provider "mock" (never presented as Lyzr)', async () => {
    const inference = new LyzrInference(loadLyzrEnvironment({} as NodeJS.ProcessEnv), new SafeAi());
    const seen: string[] = [];
    inference.onTelemetry((t) => seen.push(`${t.provider}:${t.agentId}`));
    const doc = protocolDoc();
    const r = await inference.invoke({ agentKey: 'protocol', sessionId: 's', message: 'm', documents: [doc], simulate: () => JSON.stringify(mockExtractProtocol(doc)) });
    expect(r.telemetry.provider).toBe('mock');
    expect(r.telemetry.agentId).toBeNull();
    expect(seen).toEqual(['mock:null']);
  });
});

describe('Audit narration guard', () => {
  const summary: VerifiedScreeningSummary = {
    screeningId: 'SCR-00002',
    trialCode: 'CT-2026-001',
    protocolVersion: '2.0',
    patientRef: 'PAT-002',
    decision: 'INELIGIBLE',
    confidencePct: 92.4,
    counts: { total: 19, pass: 16, fail: 1, unknown: 1, notApplicable: 1 },
    failed: [{ criterionId: 'EXC-005', ruleExpression: 'days_since=22; WITHIN_DAYS 30 → true' }],
    unknown: [],
    safetyFlags: [{ code: 'PROMPT_INJECTION_DETECTED', severity: 'BLOCKING' }],
  };
  const safe = new SafeAi();
  it('template narrative passes the guard', () => {
    const n = templateNarrative(summary);
    expect(safe.checkNarrative([n.summary, ...n.keyPoints].join(' '), summary, 'INELIGIBLE')).toEqual([]);
  });
  it('rejects invented numbers, contradicting decisions and regulatory claims', () => {
    expect(safe.checkNarrative('Patient is INELIGIBLE; eGFR was 58.', summary, 'INELIGIBLE').join()).toContain('58');
    expect(safe.checkNarrative('Patient is ELIGIBLE.', summary, 'INELIGIBLE').length).toBeGreaterThan(0);
    expect(safe.checkNarrative('INELIGIBLE. This FDA-approved system decided.', summary, 'INELIGIBLE').join()).toContain('regulatory');
    expect(safe.checkNarrative('INELIGIBLE. The system is not FDA approved.', summary, 'INELIGIBLE')).toEqual([]);
  });
  it('falls back to the deterministic template when the agent output violates the guard', async () => {
    const inference = new LyzrInference(loadLyzrEnvironment({} as NodeJS.ProcessEnv), new SafeAi());
    (inference as unknown as { invoke: unknown }).invoke = async () => ({ text: JSON.stringify({ summary: 'ELIGIBLE with 99% confidence', keyPoints: [] }), telemetry: { provider: 'mock' }, preflight: {} });
    const r = await new AuditNarrationAgent(inference).narrate(summary, { sessionId: 's' });
    expect(r.source).toBe('deterministic-fallback');
    expect(r.narrative.summary).toContain('INELIGIBLE');
  });
});

describe('inference cache (cost optimisation)', () => {
  it('reuses an identical temperature-0 Lyzr response without a second HTTP call, and records the hit', async () => {
    const store = new Map<string, { text: string; executionId: string }>();
    const cache = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, e: { text: string; executionId: string }) => void store.set(k, e) };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ response: '{"flags":[],"summary":"ok"}' }), { status: 200 }));
    const cfg = liveCfg();
    const client = new LyzrClient(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const inference = new LyzrInference(cfg, new SafeAi(), { client, cache });
    const req = { agentKey: 'safety' as const, sessionId: 's', message: 'identical redacted input', documents: [], simulate: () => '' };
    const first = await inference.invoke(req);
    const second = await inference.invoke({ ...req, sessionId: 'another-session' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.telemetry).toMatchObject({ provider: 'lyzr', cacheHit: false });
    expect(second.telemetry).toMatchObject({ provider: 'lyzr', cacheHit: true, attempts: 0, cachedFromExecutionId: first.telemetry.executionId });
    expect(second.telemetry.outputHash).toBe(first.telemetry.outputHash);
    await inference.invoke({ ...req, message: 'different input' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('safety agent flag grounding', () => {
  it('downgrades flags that cite no evidence and annotates cited evidence with the deterministic result', async () => {
    const { SafetyValidatorAgent } = await import('@trialguard/agents');
    const inference = new LyzrInference(loadLyzrEnvironment({} as NodeJS.ProcessEnv), new SafeAi());
    // Shapes observed live from gpt-4o-mini: one unsupported flag, one factually wrong but evidence-citing flag.
    const agentText = JSON.stringify({
      flags: [
        { code: 'MISSING_EVIDENCE', severity: 'WARNING', description: 'No fact regarding medication adherence.', factIds: [], criterionIds: [] },
        { code: 'POTENTIAL_SAFETY_SIGNAL', severity: 'WARNING', description: 'Prednisone completed less than 30 days ago.', factIds: ['FACT-015'], criterionIds: [] },
      ],
      summary: 'x',
    });
    (inference as unknown as { invoke: unknown }).invoke = async () => ({ text: agentText, telemetry: { provider: 'lyzr' }, preflight: {} });
    const evaluation = { criterionId: 'EXC-005', result: 'PASS', ruleExpression: 'Prednisone: end=2026-06-01 → days_since=114; WITHIN_DAYS 30 → false', evidence: [{ factId: 'FACT-015' }] };
    const r = await new SafetyValidatorAgent(inference).validate(
      { facts: [{ ...fact({ category: 'medication', concept: { system: 'RXNORM', code: '8640', display: 'Prednisone' }, endDate: '2026-06-01', status: 'completed' }), factId: 'FACT-015' }], evaluations: [evaluation] as never, clinicalNotes: [] },
      { sessionId: 's' },
    );
    expect(r.flags[0]).toMatchObject({ code: 'MISSING_EVIDENCE', severity: 'INFO' });
    expect(r.flags[0].description).toMatch(/Unsupported/);
    expect(r.flags[1]).toMatchObject({ code: 'POTENTIAL_SAFETY_SIGNAL', severity: 'WARNING' });
    expect(r.flags[1].description).toContain('EXC-005 PASS: Prednisone: end=2026-06-01 → days_since=114');
  });
});
