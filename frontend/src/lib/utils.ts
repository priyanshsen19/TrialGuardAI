import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`);

export const shortHash = (h?: string | null, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : '—');

export function fmtDate(v?: string | Date | null) {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtMs(ms?: number | null) {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
