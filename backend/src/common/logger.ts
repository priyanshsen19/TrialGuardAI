import type { LoggerService } from '@nestjs/common';
import { currentContext } from './request-context';

/**
 * Structured JSON logger. Every line carries requestId/correlationId from the
 * async context. Values under sensitive keys are replaced before serialisation
 * so PHI, API keys, prompts and document bodies can never reach the logs.
 */
const SENSITIVE_KEYS = /^(authorization|password|passwordhash|token|accesstoken|apikey|api_key|x-api-key|secret|jwt|cookie|prompt|text|pages|redactedpages|documents|demographics|name|dob|dateofbirth|email|phone|address|mrn|ssn|insuranceid|original|plaintext|ciphertext|content|body)$/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 200).replace(SECRET_VALUE, '[redacted]')}…[truncated]` : value.replace(SECRET_VALUE, '[redacted]');
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: sanitize(value.message, depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class JsonLogger implements LoggerService {
  private readonly min: number;
  constructor(level: string = process.env.LOG_LEVEL ?? 'info', private readonly service = 'trialguard-backend') {
    this.min = LEVELS[(level as Level) in LEVELS ? (level as Level) : 'info'];
  }

  private write(level: Level, message: unknown, meta: unknown[]) {
    if (LEVELS[level] < this.min) return;
    const ctx = currentContext();
    const context = meta.find((m) => typeof m === 'string') as string | undefined;
    const extra = meta.find((m) => m && typeof m === 'object');
    const line = {
      ts: new Date().toISOString(),
      level,
      service: this.service,
      context,
      msg: typeof message === 'string' ? sanitize(message) : undefined,
      data: typeof message === 'object' ? sanitize(message) : extra ? sanitize(extra) : undefined,
      requestId: ctx?.requestId,
      correlationId: ctx?.correlationId,
    };
    const out = JSON.stringify(line);
    if (level === 'error' || level === 'warn') process.stderr.write(out + '\n');
    else process.stdout.write(out + '\n');
  }

  log(message: unknown, ...meta: unknown[]) {
    this.write('info', message, meta);
  }
  error(message: unknown, ...meta: unknown[]) {
    this.write('error', message, meta.filter((m) => typeof m !== 'string' || !m.includes('\n    at ')));
  }
  warn(message: unknown, ...meta: unknown[]) {
    this.write('warn', message, meta);
  }
  debug(message: unknown, ...meta: unknown[]) {
    this.write('debug', message, meta);
  }
  verbose(message: unknown, ...meta: unknown[]) {
    this.write('debug', message, meta);
  }
}

export const logger = new JsonLogger();
