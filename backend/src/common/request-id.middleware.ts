import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from './logger';
import { requestContext } from './request-context';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Assigns X-Request-Id / X-Correlation-Id, binds them to the async context, logs access (no bodies). */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    const corr = req.header('x-correlation-id');
    const correlationId = corr && SAFE_ID.test(corr) ? corr : requestId;
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-correlation-id', correlationId);
    const started = process.hrtime.bigint();
    requestContext.run({ requestId, correlationId }, () => {
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        logger.log({ event: 'http_request', method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, durationMs: Math.round(ms) }, 'HTTP');
      });
      next();
    });
  }
}
