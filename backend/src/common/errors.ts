import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { logger } from './logger';
import { currentContext } from './request-context';

export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);
export const conflict = (code: string, message: string) => new AppError(code, message, HttpStatus.CONFLICT);

/**
 * Safe error handling: clients receive a stable code, message and request id —
 * never stack traces, SQL, prompts or document content.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = currentContext()?.requestId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: { code: string; message: string; details?: unknown } = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      const r = exception.getResponse() as { code: string; message: string; details?: unknown };
      body = r;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? exception.message);
      body = {
        code: status === 429 ? 'RATE_LIMITED' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'HTTP_ERROR',
        message: Array.isArray(message) ? message.join('; ') : String(message),
      };
    } else if ((exception as { code?: string })?.code === 'SAFE_AI_BLOCKED') {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      body = { code: 'SAFE_AI_BLOCKED', message: 'Safe AI pre-flight blocked an outbound agent call (residual PHI or secrets detected). Nothing was sent.' };
    }

    if (status >= 500) logger.error({ event: 'unhandled_exception', status, errorType: exception instanceof Error ? exception.name : typeof exception, errorMessage: exception instanceof Error ? exception.message : String(exception) }, 'GlobalExceptionFilter');
    res.status(status).json({ error: { ...body, requestId } });
  }
}
