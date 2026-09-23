import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { QUEUES, type QueueName } from '@trialguard/agents';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { logger } from '../common/logger';
import { currentContext, requestContext } from '../common/request-context';
import { loadConfig } from '../config/config';

export interface JobPayload {
  correlationId?: string;
  [key: string]: unknown;
}
export type JobHandler = (data: JobPayload, meta: { jobId: string; attempt: number; queue: QueueName }) => Promise<void>;

interface JobRecord {
  jobId: string;
  queue: QueueName;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'retrying';
  attempts: number;
  correlationId?: string;
  error?: string;
  enqueuedAt: string;
  finishedAt?: string;
}

const MAX_ATTEMPTS = 3;

/**
 * Queue abstraction over BullMQ (Redis) with an in-process "inline" fallback
 * (QUEUE_MODE=inline or no REDIS_URL) so the demo and tests run without Redis.
 *
 * Every job is idempotent (deterministic jobId + stage-level completion
 * markers), retryable (3 attempts, exponential backoff), observable (job
 * records + structured logs) and correlation-ID aware (the originating
 * request's correlation id is propagated into the worker's async context).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly mode = loadConfig().queueMode;
  private readonly handlers = new Map<QueueName, JobHandler>();
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private connection: IORedis | null = null;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly recent: JobRecord[] = [];

  register(queue: QueueName, handler: JobHandler) {
    this.handlers.set(queue, handler);
  }

  private redis(): IORedis {
    if (!this.connection) {
      this.connection = new IORedis(loadConfig().redisUrl!, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
    }
    return this.connection;
  }

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.redis(), prefix: 'trialguard' });
      this.queues.set(name, q);
    }
    return q;
  }

  private track(rec: JobRecord) {
    const i = this.recent.findIndex((r) => r.jobId === rec.jobId && r.queue === rec.queue);
    if (i >= 0) this.recent[i] = rec;
    else this.recent.unshift(rec);
    if (this.recent.length > 200) this.recent.pop();
  }

  /** Enqueue a job. `jobId` must be deterministic for idempotency (duplicates are ignored). */
  async enqueue(queue: QueueName, data: JobPayload, opts: { jobId: string }): Promise<{ jobId: string; mode: string }> {
    const correlationId = data.correlationId ?? currentContext()?.correlationId ?? randomUUID();
    const payload = { ...data, correlationId };
    const jobId = opts.jobId.replace(/:/g, '__');
    logger.log({ event: 'job_enqueued', queue, jobId, mode: this.mode }, 'Queue');

    if (this.mode === 'bullmq') {
      await this.queue(queue).add(queue, payload, {
        jobId,
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 5000 },
      });
      this.track({ jobId, queue, status: 'queued', attempts: 0, correlationId, enqueuedAt: new Date().toISOString() });
      return { jobId, mode: this.mode };
    }

    // inline mode: execute now (awaited), de-duplicating concurrent identical jobs
    const key = `${queue}/${jobId}`;
    const existing = this.inflight.get(key);
    if (existing) {
      await existing;
      return { jobId, mode: this.mode };
    }
    const run = this.runInline(queue, payload, jobId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    await run;
    return { jobId, mode: this.mode };
  }

  private async runInline(queue: QueueName, data: JobPayload, jobId: string) {
    const handler = this.handlers.get(queue);
    if (!handler) throw new Error(`No handler registered for queue ${queue}`);
    const rec: JobRecord = { jobId, queue, status: 'active', attempts: 0, correlationId: data.correlationId, enqueuedAt: new Date().toISOString() };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      rec.attempts = attempt;
      this.track({ ...rec, status: 'active' });
      try {
        await requestContext.run({ requestId: jobId, correlationId: data.correlationId ?? jobId }, () => handler(data, { jobId, attempt, queue }));
        this.track({ ...rec, status: 'completed', finishedAt: new Date().toISOString() });
        logger.log({ event: 'job_completed', queue, jobId, attempt }, 'Queue');
        return;
      } catch (err) {
        const message = (err as Error).message;
        const retryable = (err as { retryable?: boolean }).retryable !== false && attempt < MAX_ATTEMPTS && !(err as { nonRetryable?: boolean }).nonRetryable;
        logger.warn({ event: retryable ? 'job_retrying' : 'job_failed', queue, jobId, attempt, error: message }, 'Queue');
        if (!retryable) {
          this.track({ ...rec, status: 'failed', error: message, finishedAt: new Date().toISOString() });
          throw err;
        }
        this.track({ ...rec, status: 'retrying', error: message });
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
  }

  /** Start BullMQ workers for every queue that has a handler (worker process). */
  startWorkers(concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4)) {
    if (this.mode !== 'bullmq') return;
    for (const name of QUEUES) {
      const handler = this.handlers.get(name);
      if (!handler) continue;
      const worker = new Worker(
        name,
        async (job: Job<JobPayload>) => {
          const correlationId = job.data.correlationId ?? String(job.id);
          await requestContext.run({ requestId: String(job.id), correlationId }, () => handler(job.data, { jobId: String(job.id), attempt: job.attemptsMade + 1, queue: name }));
        },
        { connection: this.redis(), prefix: 'trialguard', concurrency },
      );
      worker.on('completed', (job) => logger.log({ event: 'job_completed', queue: name, jobId: job.id, attempts: job.attemptsMade }, 'Worker'));
      worker.on('failed', (job, err) => logger.warn({ event: 'job_failed', queue: name, jobId: job?.id, attempts: job?.attemptsMade, error: err.message }, 'Worker'));
      this.workers.push(worker);
    }
    logger.log({ event: 'workers_started', queues: this.workers.length, concurrency }, 'Worker');
  }

  async stats() {
    if (this.mode === 'bullmq') {
      const out: Record<string, unknown> = {};
      for (const name of QUEUES) {
        try {
          out[name] = await this.queue(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        } catch (e) {
          out[name] = { error: (e as Error).message };
        }
      }
      return { mode: this.mode, queues: out };
    }
    const counts: Record<string, Record<string, number>> = {};
    for (const name of QUEUES) counts[name] = { completed: 0, failed: 0, active: 0 };
    for (const r of this.recent) {
      const c = counts[r.queue];
      if (r.status === 'completed') c.completed++;
      else if (r.status === 'failed') c.failed++;
      else c.active++;
    }
    return { mode: this.mode, queues: counts };
  }

  recentJobs(limit = 50) {
    return this.recent.slice(0, limit);
  }

  async ping(): Promise<boolean> {
    if (this.mode !== 'bullmq') return true;
    try {
      return (await this.redis().ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    if (this.connection) this.connection.disconnect();
  }
}
