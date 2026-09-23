/**
 * Lyzr Inference gateway.
 *
 * One entry point (`invoke`) for every agent call. It:
 *   1. runs Safe AI pre-flight on the exact outbound payload (PHI/secrets block)
 *   2. routes to Lyzr (LYZR_MODE=live) or to the local deterministic simulator
 *      (LYZR_MODE=mock) — mock responses are always labelled provider "mock"
 *      and are never presented as Lyzr output
 *   3. emits PHI-free execution telemetry (hashes, latency, safety verdicts)
 *      which the backend persists as LyzrExecution rows and, when
 *      LYZR_AIMS_ENABLED=true, marks for AIMS export
 */
import { createHash, randomUUID } from 'node:crypto';
import type { RedactedDocument } from '../contracts';
import { LyzrClient, LyzrError, type LyzrEventListener } from './client';
import { AGENT_DEFINITIONS, agentIdFor, type AgentKey } from './configuration';
import type { LyzrEnvironmentConfig } from './environment';
import { SafeAi, type PreflightReport } from './safe-ai';

export type InferenceProvider = 'lyzr' | 'mock';

/**
 * Response cache port (implemented by the backend). At temperature 0 the same
 * agent definition + same PHI-redacted input yields the same output, so a live
 * Lyzr response is reused instead of re-billed. Hits are recorded as such.
 */
export interface InferenceCache {
  get(key: string): Promise<{ text: string; executionId: string } | null>;
  set(key: string, entry: { text: string; executionId: string; agentKey: AgentKey; agentVersion: string }): Promise<void>;
}

export interface InferenceRequest {
  agentKey: AgentKey;
  sessionId: string;
  message: string;
  documents: RedactedDocument[];
  /** Local deterministic simulator used when LYZR_MODE=mock. Returns raw LLM-like text. */
  simulate: () => string;
  correlationId?: string;
}

export interface ExecutionTelemetry {
  executionId: string;
  agentKey: AgentKey;
  agentName: string;
  agentVersion: string;
  agentId: string | null;
  provider: InferenceProvider;
  /** Lyzr session id = TrialGuard audit chain id (screening / protocol / patient). */
  sessionId: string;
  environmentId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED';
  errorCode?: string;
  latencyMs: number;
  attempts: number;
  inputHash: string;
  outputHash: string | null;
  injectionDetected: boolean;
  safeAiFindings: Array<{ kind: string; pattern: string; location: string }>;
  /** True when the Lyzr response was served from the inference cache (no new Lyzr call). */
  cacheHit: boolean;
  /** Execution that originally produced a cached response. */
  cachedFromExecutionId?: string;
  correlationId?: string;
  aimsExport: boolean;
  startedAt: string;
  completedAt: string;
}

export interface InferenceResult {
  text: string;
  telemetry: ExecutionTelemetry;
  preflight: PreflightReport;
}

export type TelemetryListener = (t: ExecutionTelemetry) => void;

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export class LyzrInference {
  private readonly client: LyzrClient | null;
  private readonly telemetryListeners: TelemetryListener[] = [];

  constructor(
    readonly cfg: LyzrEnvironmentConfig,
    readonly safeAi: SafeAi,
    opts: { client?: LyzrClient; onClientEvent?: LyzrEventListener; cache?: InferenceCache } = {},
  ) {
    this.client = cfg.mode === 'live' ? (opts.client ?? new LyzrClient(cfg, { onEvent: opts.onClientEvent })) : null;
    this.cache = opts.cache ?? null;
  }

  private readonly cache: InferenceCache | null;

  /** Cache key: agent identity + exact instructions + model + exact outbound message. */
  cacheKey(agentKey: AgentKey, message: string): string {
    const def = AGENT_DEFINITIONS[agentKey];
    return sha256([agentKey, def.version, sha256(def.instructions), agentIdFor(this.cfg, agentKey) ?? '', message].join('\u0000'));
  }

  get mode() {
    return this.cfg.mode;
  }

  onTelemetry(l: TelemetryListener) {
    this.telemetryListeners.push(l);
  }

  async invoke(req: InferenceRequest): Promise<InferenceResult> {
    const def = AGENT_DEFINITIONS[req.agentKey];
    const executionId = randomUUID();
    const startedAt = new Date();
    const inputHash = sha256(req.message);
    const provider: InferenceProvider = this.cfg.mode === 'live' ? 'lyzr' : 'mock';
    const agentId = provider === 'lyzr' ? agentIdFor(this.cfg, req.agentKey) : null;

    const base = {
      executionId,
      agentKey: req.agentKey,
      agentName: def.name,
      agentVersion: def.version,
      agentId,
      provider,
      cacheHit: false,
      sessionId: req.sessionId,
      environmentId: this.cfg.environmentId,
      inputHash,
      correlationId: req.correlationId,
      aimsExport: this.cfg.aimsEnabled,
      startedAt: startedAt.toISOString(),
    };

    let preflight: PreflightReport;
    try {
      preflight = this.safeAi.preflight(req.message, req.documents);
    } catch (err) {
      const t: ExecutionTelemetry = {
        ...base,
        status: 'BLOCKED',
        errorCode: 'SAFE_AI_BLOCKED',
        latencyMs: Date.now() - startedAt.getTime(),
        attempts: 0,
        outputHash: null,
        injectionDetected: false,
        safeAiFindings: ((err as { findings?: ExecutionTelemetry['safeAiFindings'] }).findings ?? []).map(strip),
        completedAt: new Date().toISOString(),
      };
      this.emit(t);
      throw err;
    }

    try {
      let text: string;
      let attempts = 1;
      let cachedFrom: string | undefined;
      if (provider === 'lyzr') {
        if (!this.client || !agentId) {
          throw new LyzrError('LYZR_NOT_CONFIGURED', `Lyzr agent id for "${req.agentKey}" is not configured`, {
            retryable: false,
            attempts: 0,
            path: '/v3/inference/chat/',
          });
        }
        const key = this.cacheKey(req.agentKey, req.message);
        const hit = this.cache ? await this.cache.get(key).catch(() => null) : null;
        if (hit) {
          text = hit.text;
          attempts = 0;
          cachedFrom = hit.executionId;
        } else {
          const res = await this.client.chat({ agentId, sessionId: req.sessionId, message: req.message });
          text = res.response;
          attempts = res.attempts;
          if (this.cache) await this.cache.set(key, { text, executionId, agentKey: req.agentKey, agentVersion: def.version }).catch(() => undefined);
        }
      } else {
        text = req.simulate();
      }
      const t: ExecutionTelemetry = {
        ...base,
        status: 'SUCCEEDED',
        cacheHit: !!cachedFrom,
        ...(cachedFrom ? { cachedFromExecutionId: cachedFrom } : {}),
        latencyMs: Date.now() - startedAt.getTime(),
        attempts,
        outputHash: sha256(text),
        injectionDetected: preflight.injectionDetected,
        safeAiFindings: preflight.findings.map(strip),
        completedAt: new Date().toISOString(),
      };
      this.emit(t);
      return { text, telemetry: t, preflight };
    } catch (err) {
      const t: ExecutionTelemetry = {
        ...base,
        status: 'FAILED',
        errorCode: (err as { code?: string }).code ?? 'UNKNOWN',
        latencyMs: Date.now() - startedAt.getTime(),
        attempts: (err as LyzrError).details?.attempts ?? 1,
        outputHash: null,
        injectionDetected: preflight.injectionDetected,
        safeAiFindings: preflight.findings.map(strip),
        completedAt: new Date().toISOString(),
      };
      this.emit(t);
      throw err;
    }
  }

  private emit(t: ExecutionTelemetry) {
    for (const l of this.telemetryListeners) {
      try {
        l(t);
      } catch {
        /* telemetry must never break inference */
      }
    }
  }
}

function strip(f: { kind: string; pattern: string; location: string }) {
  return { kind: f.kind, pattern: f.pattern, location: f.location };
}
