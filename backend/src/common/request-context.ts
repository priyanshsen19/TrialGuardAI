import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  correlationId: string;
  userId?: string;
  role?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const currentContext = (): RequestContext | undefined => requestContext.getStore();
