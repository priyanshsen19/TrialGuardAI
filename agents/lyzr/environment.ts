/**
 * Lyzr Environment configuration.
 *
 * A "Lyzr Environment" in TrialGuard is the set of credentials, endpoint, agent
 * IDs and governance switches (Safe AI, AIMS) that one deployment talks to.
 * Everything is read from environment variables — secrets are never hardcoded.
 */

export type LyzrMode = 'mock' | 'live';

export interface LyzrEnvironmentConfig {
  mode: LyzrMode;
  apiKey: string | null;
  baseUrl: string;
  environmentId: string | null;
  agentIds: {
    protocol: string | null;
    patient: string | null;
    safety: string | null;
    audit: string | null;
  };
  aimsEnabled: boolean;
  timeoutMs: number;
  maxRetries: number;
  /** Stable pseudonymous user id sent to Lyzr (never a real user identity). */
  userId: string;
}

export class LyzrConfigurationError extends Error {
  readonly code = 'LYZR_CONFIGURATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'LyzrConfigurationError';
  }
}

const DEFAULT_BASE_URL = 'https://agent-prod.studio.lyzr.ai';

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadLyzrEnvironment(env: NodeJS.ProcessEnv = process.env): LyzrEnvironmentConfig {
  const modeRaw = (env.LYZR_MODE ?? 'mock').toLowerCase();
  if (modeRaw !== 'mock' && modeRaw !== 'live') {
    throw new LyzrConfigurationError(`LYZR_MODE must be "mock" or "live" (got "${modeRaw}")`);
  }
  const cfg: LyzrEnvironmentConfig = {
    mode: modeRaw,
    apiKey: env.LYZR_API_KEY?.trim() || null,
    baseUrl: (env.LYZR_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    environmentId: env.LYZR_ENVIRONMENT_ID?.trim() || null,
    agentIds: {
      protocol: env.LYZR_PROTOCOL_AGENT_ID?.trim() || null,
      patient: env.LYZR_PATIENT_AGENT_ID?.trim() || null,
      safety: env.LYZR_SAFETY_AGENT_ID?.trim() || null,
      audit: env.LYZR_AUDIT_AGENT_ID?.trim() || null,
    },
    aimsEnabled: bool(env.LYZR_AIMS_ENABLED, false),
    timeoutMs: int(env.LYZR_TIMEOUT_MS, 60_000),
    maxRetries: int(env.LYZR_MAX_RETRIES, 3),
    userId: env.LYZR_USER_ID?.trim() || 'trialguard-service',
  };
  if (cfg.mode === 'live') validateLiveEnvironment(cfg);
  return cfg;
}

export function validateLiveEnvironment(cfg: LyzrEnvironmentConfig): void {
  const missing: string[] = [];
  if (!cfg.apiKey) missing.push('LYZR_API_KEY');
  if (!cfg.agentIds.protocol) missing.push('LYZR_PROTOCOL_AGENT_ID');
  if (!cfg.agentIds.patient) missing.push('LYZR_PATIENT_AGENT_ID');
  if (!cfg.agentIds.safety) missing.push('LYZR_SAFETY_AGENT_ID');
  if (!cfg.agentIds.audit) missing.push('LYZR_AUDIT_AGENT_ID');
  if (missing.length) {
    throw new LyzrConfigurationError(
      `LYZR_MODE=live requires: ${missing.join(', ')}. Run "pnpm --filter @trialguard/agents provision" to create the agents, or set LYZR_MODE=mock.`,
    );
  }
  if (!/^https:\/\//.test(cfg.baseUrl)) {
    throw new LyzrConfigurationError('LYZR_BASE_URL must use https://');
  }
}

/** Safe, secret-free description of the environment for health checks and UI. */
export function describeEnvironment(cfg: LyzrEnvironmentConfig) {
  return {
    mode: cfg.mode,
    baseUrl: cfg.baseUrl,
    environmentId: cfg.environmentId,
    apiKeyConfigured: Boolean(cfg.apiKey),
    agentsConfigured: {
      protocol: Boolean(cfg.agentIds.protocol),
      patient: Boolean(cfg.agentIds.patient),
      safety: Boolean(cfg.agentIds.safety),
      audit: Boolean(cfg.agentIds.audit),
    },
    aimsEnabled: cfg.aimsEnabled,
    timeoutMs: cfg.timeoutMs,
    maxRetries: cfg.maxRetries,
  };
}
