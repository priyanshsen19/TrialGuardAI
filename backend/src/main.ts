import 'reflect-metadata';
import './config/env';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { logger } from './common/logger';
import { loadConfig } from './config/config';
import { QueueService } from './queue/queue.service';

async function main() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, { logger, bodyParser: false });
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  await configureApp(app);
  app.enableShutdownHooks();
  if (cfg.queueMode === 'bullmq' && cfg.runWorkersInApi) app.get(QueueService).startWorkers();
  await app.listen(cfg.port, '0.0.0.0');
  logger.log({ event: 'api_started', port: cfg.port, queueMode: cfg.queueMode, demoMode: cfg.demoMode }, 'Bootstrap');
}

main().catch((err) => {
  logger.error({ event: 'startup_failed', error: (err as Error).message }, 'Bootstrap');
  process.exit(1);
});
