/** Test helper: boots the real Nest application (same hardening as main.ts). */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap';
import { JsonLogger } from '../common/logger';

export async function createTestApp() {
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger('error') });
  await configureApp(app);
  await app.init();
  return app;
}
