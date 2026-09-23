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

/** Download an authenticated binary (dossier PDF/JSON) and hand it to the browser. */
export async function downloadFile(path: string, filename: string, open = false) {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', `Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (open) {
    window.open(url, '_blank', 'noopener');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
