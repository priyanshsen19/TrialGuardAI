import { randomBytes, createHash } from 'node:crypto';
import { logger } from '../common/logger';

/**
 * Centralised, validated configuration. Secrets come from the environment only.
 * In non-production environments missing secrets fall back to clearly-labelled
 * development values (with a warning) so the demo runs out of the box.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string | null;
  queueMode: 'bullmq' | 'inline';
  runWorkersInApi: boolean;
  jwtSecret: string;
  jwtTtlSeconds: number;
  masterKey: Buffer;
  storageDir: string;
  maxUploadBytes: number;
  corsOrigins: string[];
  demoMode: boolean;
  demoUserPassword: string;
  screeningDateOverride: string | null;
  rateLimitPerMinute: number;
}

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const nodeEnv = env.NODE_ENV ?? 'development';
  const prod = nodeEnv === 'production';

  const jwtSecret = env.JWT_SECRET ?? (prod ? '' : randomBytes(32).toString('hex'));
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be set (>= 32 chars)');
  if (!env.JWT_SECRET) logger.warn('JWT_SECRET not set — using an ephemeral development secret (tokens reset on restart)', 'Config');

  let masterKey: Buffer;
  if (env.ENCRYPTION_MASTER_KEY) {
    masterKey = /^[0-9a-f]{64,}$/i.test(env.ENCRYPTION_MASTER_KEY)
      ? Buffer.from(env.ENCRYPTION_MASTER_KEY, 'hex')
      : Buffer.from(env.ENCRYPTION_MASTER_KEY, 'base64');
  } else if (prod) {
    throw new Error('ENCRYPTION_MASTER_KEY must be set in production');
  } else {
    logger.warn('ENCRYPTION_MASTER_KEY not set — using a deterministic DEVELOPMENT key. Never use this with real data.', 'Config');
    masterKey = createHash('sha256').update('trialguard-dev-only-master-key-synthetic-data').digest();
  }

  const redisUrl = env.REDIS_URL?.trim() || null;
  const queueMode = env.QUEUE_MODE === 'inline' || !redisUrl ? 'inline' : 'bullmq';

  cached = {
    nodeEnv,
    port: Number(env.PORT ?? 4000),
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl,
    queueMode,
    runWorkersInApi: env.RUN_WORKERS_IN_API === 'true',
    jwtSecret,
    jwtTtlSeconds: Number(env.JWT_TTL_SECONDS ?? 8 * 3600),
    masterKey,
    storageDir: env.STORAGE_DIR ?? './storage',
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    demoMode: (env.DEMO_MODE ?? 'true') === 'true',
    demoUserPassword: env.DEMO_USER_PASSWORD ?? 'TrialGuard!Demo2026',
    screeningDateOverride: env.SCREENING_DATE_OVERRIDE?.trim() || null,
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 300),
  };
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}
