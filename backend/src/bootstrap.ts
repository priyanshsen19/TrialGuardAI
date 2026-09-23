import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AuthService } from './auth/auth.service';
import { loadConfig } from './config/config';

/** Shared HTTP hardening used by main.ts and the integration tests. */
export async function configureApp(app: INestApplication) {
  const cfg = loadConfig();
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.enableCors({
    origin: cfg.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id', 'x-correlation-id'],
    exposedHeaders: ['x-request-id', 'x-correlation-id', 'x-dossier-sha256', 'content-disposition'],
    maxAge: 600,
  });
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  express.set('trust proxy', 1);
  await app.get(AuthService).ensureRolesAndDemoUsers();
}
