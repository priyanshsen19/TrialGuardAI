'use client';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'COORDINATOR' | 'REVIEWER' | 'AUDITOR';
  permissions: string[];
}

const TOKEN_KEY = 'tg.token';
const USER_KEY = 'tg.user';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: SessionUser) {
  window.sessionStorage.setItem(TOKEN_KEY, token);
  window.sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event('tg-session'));
}

export function clearSession() {
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event('tg-session'));
}

export const can = (user: SessionUser | null, ...roles: SessionUser['role'][]) => !!user && (user.role === 'ADMIN' || roles.includes(user.role));
