import 'reflect-metadata';
import './config/env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { logger } from './common/logger';
import { loadConfig } from './config/config';
import { QueueService } from './queue/queue.service';

/** BullMQ worker process: runs protocol/patient extraction and all screening stages. */
async function main() {
  const cfg = loadConfig();
  if (cfg.queueMode !== 'bullmq') {
    logger.warn('QUEUE_MODE is inline (no REDIS_URL) — jobs run inside the API process; worker has nothing to do.', 'Worker');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger });
  app.enableShutdownHooks();
  app.get(QueueService).startWorkers();
  logger.log({ event: 'worker_started', queueMode: cfg.queueMode }, 'Worker');
}

main().catch((err) => {
  logger.error({ event: 'worker_failed', error: (err as Error).message }, 'Worker');
  process.exit(1);
});
