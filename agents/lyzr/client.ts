/**
 * Lyzr Agent API client.
 *
 * Implements the documented Lyzr Agent API v3 surface used by TrialGuard:
 *   POST {base}/v3/inference/chat/   — agent inference (x-api-key auth)
 *   POST {base}/v3/agents/           — agent creation (provisioning script)
 *   GET  {base}/v3/agents/{id}       — agent lookup (health / provisioning)
 *
 * Reference: https://docs.lyzr.ai/agent-lab/agents/api/MultimodalChat
 *            https://docs.lyzr.ai/agent-apis/agents/Create%20Agent
 *
 * Features: timeouts (AbortController), bounded exponential backoff with
 * jitter for 408/429/5xx/network errors, structured errors that never contain
 * the API key or request payload, and runtime events for observability.
 */
import type { LyzrEnvironmentConfig } from './environment';

export type LyzrErrorCode =
  | 'LYZR_TIMEOUT'
  | 'LYZR_NETWORK'
  | 'LYZR_AUTH'
  | 'LYZR_RATE_LIMITED'
  | 'LYZR_HTTP_ERROR'
  | 'LYZR_BAD_RESPONSE'
  | 'LYZR_NOT_CONFIGURED';

export class LyzrError extends Error {
  constructor(
    readonly code: LyzrErrorCode,
    message: string,
    readonly details: { status?: number; retryable: boolean; attempts: number; path: string },
  ) {
    super(message);
    this.name = 'LyzrError';
  }
  toJSON() {
    return { name: this.name, code: this.code, message: this.message, ...this.details };
  }
}

/** Runtime events emitted by the client. Payload-free by design (no prompts, no PHI). */
export type LyzrRuntimeEvent =
  | { type: 'request.started'; requestId: string; path: string; attempt: number; at: string }
  | { type: 'request.retrying'; requestId: string; path: string; attempt: number; delayMs: number; reason: string; at: string }
  | { type: 'request.succeeded'; requestId: string; path: string; attempt: number; status: number; latencyMs: number; at: string }
  | { type: 'request.failed'; requestId: string; path: string; attempt: number; code: LyzrErrorCode; status?: number; at: string };

export type LyzrEventListener = (event: LyzrRuntimeEvent) => void;

export interface LyzrChatRequest {
  agentId: string;
  sessionId: string;
  message: string;
  userId?: string;
  systemPromptVariables?: Record<string, string>;
  filterVariables?: Record<string, unknown>;
  assets?: string[];
}

export interface LyzrChatResponse {
  response: string;
  /** Any additional documented/undocumented fields returned by Lyzr, kept for diagnostics. */
  raw: Record<string, unknown>;
  status: number;
  attempts: number;
  latencyMs: number;
}

type FetchLike = typeof fetch;

export interface LyzrClientOptions {
  fetchImpl?: FetchLike;
  onEvent?: LyzrEventListener;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class LyzrClient {
  private readonly fetchImpl: FetchLike;
  private readonly listeners: LyzrEventListener[] = [];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private seq = 0;

  constructor(
    private readonly cfg: LyzrEnvironmentConfig,
    opts: LyzrClientOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    if (opts.onEvent) this.listeners.push(opts.onEvent);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  on(listener: LyzrEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** POST /v3/inference/chat/ */
  async chat(req: LyzrChatRequest): Promise<LyzrChatResponse> {
    const body: Record<string, unknown> = {
      user_id: req.userId ?? this.cfg.userId,
      agent_id: req.agentId,
      session_id: req.sessionId,
      message: req.message,
    };
    if (req.systemPromptVariables) body.system_prompt_variables = req.systemPromptVariables;
    if (req.filterVariables) body.filter_variables = req.filterVariables;
    if (req.assets?.length) body.assets = req.assets;

    const { json, status, attempts, latencyMs } = await this.request('POST', '/v3/inference/chat/', body);
    if (!json || typeof json !== 'object' || typeof (json as { response?: unknown }).response !== 'string') {
      throw new LyzrError('LYZR_BAD_RESPONSE', 'Lyzr inference response did not contain a string "response" field', {
        status,
        retryable: false,
        attempts,
        path: '/v3/inference/chat/',
      });
    }
    const raw = json as Record<string, unknown>;
    return { response: raw.response as string, raw, status, attempts, latencyMs };
  }

  /** POST /v3/agents/ — used by the provisioning script only. */
  async createAgent(definition: Record<string, unknown>): Promise<{ agentId: string }> {
    const { json } = await this.request('POST', '/v3/agents/', definition);
    const id = (json as { agent_id?: unknown })?.agent_id;
    if (typeof id !== 'string') {
      throw new LyzrError('LYZR_BAD_RESPONSE', 'Agent creation response missing agent_id', {
        retryable: false,
        attempts: 1,
        path: '/v3/agents/',
      });
    }
    return { agentId: id };
  }

  /**
   * Asset upload for multimodal inference (the chat API accepts `assets: [assetId]`).
   *
   * SAFETY: TrialGuard only ever uploads *already-redacted* text renderings —
   * raw PDFs/EHRs contain PHI and are never sent to Lyzr. The upload route is
   * configurable (LYZR_ASSET_UPLOAD_PATH) because it is tenant/version specific;
   * asset upload is off unless LYZR_ASSET_UPLOADS_ENABLED=true.
   */
  async uploadRedactedAssets(
    files: Array<{ filename: string; redactedText: string }>,
    uploadPath = process.env.LYZR_ASSET_UPLOAD_PATH || '/v3/assets/upload',
  ): Promise<string[]> {
    if (!this.cfg.apiKey) {
      throw new LyzrError('LYZR_NOT_CONFIGURED', 'LYZR_API_KEY is not configured', { retryable: false, attempts: 0, path: uploadPath });
    }
    const form = new FormData();
    for (const f of files) {
      form.append('files', new Blob([f.redactedText], { type: 'text/plain' }), f.filename.replace(/[^\w.-]/g, '_'));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}${uploadPath}`, {
        method: 'POST',
        headers: { 'x-api-key': this.cfg.apiKey },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new LyzrError(res.status === 401 || res.status === 403 ? 'LYZR_AUTH' : 'LYZR_HTTP_ERROR', `Asset upload failed with HTTP ${res.status}`, {
          status: res.status,
          retryable: RETRYABLE_STATUS.has(res.status),
          attempts: 1,
          path: uploadPath,
        });
      }
      const json = (await res.json()) as { results?: Array<{ asset_id?: string }>; asset_ids?: string[] };
      const ids = json.asset_ids ?? (json.results ?? []).map((r) => r.asset_id).filter((x): x is string => typeof x === 'string');
      return ids;
    } finally {
      clearTimeout(timer);
    }
  }

  /** PUT /v3/agents/{id} — keeps an existing agent in sync with its definition in code. */
  async updateAgent(agentId: string, definition: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { json } = await this.request('PUT', `/v3/agents/${encodeURIComponent(agentId)}`, definition);
    return (json ?? {}) as Record<string, unknown>;
  }

  /** GET /v3/agents/{id} */
  async getAgent(agentId: string): Promise<Record<string, unknown>> {
    const { json } = await this.request('GET', `/v3/agents/${encodeURIComponent(agentId)}`);
    return (json ?? {}) as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------

  private emit(e: LyzrRuntimeEvent) {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* listeners must never break inference */
      }
    }
  }

  private backoff(attempt: number, retryAfterHeader: string | null): number {
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 30_000);
    const base = Math.min(500 * 2 ** (attempt - 1), 8_000);
    return Math.round(base / 2 + (this.random() * base) / 2);
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<{ json: unknown; status: number; attempts: number; latencyMs: number }> {
    if (!this.cfg.apiKey) {
      throw new LyzrError('LYZR_NOT_CONFIGURED', 'LYZR_API_KEY is not configured', { retryable: false, attempts: 0, path });
    }
    const requestId = `lyzr-${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
    const maxAttempts = Math.max(1, this.cfg.maxRetries + 1);
    const started = Date.now();
    let lastError: LyzrError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.emit({ type: 'request.started', requestId, path, attempt, at: new Date().toISOString() });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
          method,
          headers: {
            'x-api-key': this.cfg.apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const aborted = (err as { name?: string })?.name === 'AbortError';
        lastError = new LyzrError(
          aborted ? 'LYZR_TIMEOUT' : 'LYZR_NETWORK',
          aborted ? `Lyzr request timed out after ${this.cfg.timeoutMs}ms` : 'Network error contacting Lyzr',
          { retryable: true, attempts: attempt, path },
        );
        if (attempt < maxAttempts) {
          const delayMs = this.backoff(attempt, null);
          this.emit({ type: 'request.retrying', requestId, path, attempt, delayMs, reason: lastError.code, at: new Date().toISOString() });
          await this.sleep(delayMs);
          continue;
        }
        this.emit({ type: 'request.failed', requestId, path, attempt, code: lastError.code, at: new Date().toISOString() });
        throw lastError;
      }
      clearTimeout(timer);

      if (res.ok) {
        let json: unknown = null;
        const text = await res.text();
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          throw new LyzrError('LYZR_BAD_RESPONSE', 'Lyzr returned non-JSON content', {
            status: res.status,
            retryable: false,
            attempts: attempt,
            path,
          });
        }
        const latencyMs = Date.now() - started;
        this.emit({ type: 'request.succeeded', requestId, path, attempt, status: res.status, latencyMs, at: new Date().toISOString() });
        return { json, status: res.status, attempts: attempt, latencyMs };
      }

      const code: LyzrErrorCode =
        res.status === 401 || res.status === 403 ? 'LYZR_AUTH' : res.status === 429 ? 'LYZR_RATE_LIMITED' : 'LYZR_HTTP_ERROR';
      const retryable = RETRYABLE_STATUS.has(res.status);
      // Deliberately do not echo the response body: it may reflect our prompt back.
      lastError = new LyzrError(code, `Lyzr request failed with HTTP ${res.status}`, {
        status: res.status,
        retryable,
        attempts: attempt,
        path,
      });
      if (retryable && attempt < maxAttempts) {
        const delayMs = this.backoff(attempt, res.headers.get('retry-after'));
        this.emit({ type: 'request.retrying', requestId, path, attempt, delayMs, reason: `HTTP ${res.status}`, at: new Date().toISOString() });
        await this.sleep(delayMs);
        continue;
      }
      this.emit({ type: 'request.failed', requestId, path, attempt, code, status: res.status, at: new Date().toISOString() });
      throw lastError;
    }
    throw lastError ?? new LyzrError('LYZR_NETWORK', 'Unknown Lyzr failure', { retryable: false, attempts: maxAttempts, path });
  }
}
