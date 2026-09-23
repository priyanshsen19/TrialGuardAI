'use client';

import { clearSession, getToken, setSession, type SessionUser } from './auth';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
  if (res.status === 401 && token) {
    clearSession();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) window.location.href = '/login';
  }
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, body.error?.code ?? 'HTTP_ERROR', body.error?.message ?? `Request failed (${res.status})`, body.error?.details);
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}), headers }),
};

export async function login(email: string, password: string) {
  const r = await request<{ accessToken: string; user: SessionUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  setSession(r.accessToken, r.user);
  return r.user;
}

/**
 * Download an authenticated binary (dossier PDF/JSON).
 * `open` shows it in a new tab: the tab is opened synchronously inside the
 * click (browsers block window.open after an await) and navigated once the
 * file has arrived; if the tab was blocked the file is downloaded instead.
 */
export async function downloadFile(path: string, filename: string, open = false) {
  const tab = open ? window.open('', '_blank') : null;
  if (tab) tab.document.title = 'Loading dossier…';
  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` }, cache: 'no-store' });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the TrialGuard API (network error, or the server is waking up). Please try again in a moment.');
    }
    if (!res.ok) {
      let message = `Export failed (HTTP ${res.status})`;
      try {
        const body = (await res.json()) as { error?: { message?: string; requestId?: string } };
        if (body.error?.message) message = `${body.error.message}${body.error.requestId ? ` (request ${body.error.requestId.slice(0, 8)})` : ''}`;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, 'DOWNLOAD_FAILED', message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (tab && !tab.closed) {
      tab.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
