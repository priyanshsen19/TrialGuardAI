'use client';

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { api } from './api';
import { getUser, type SessionUser } from './auth';

export function useSession() {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const sync = () => setUser(getUser());
    sync();
    setReady(true);
    window.addEventListener('tg-session', sync);
    return () => window.removeEventListener('tg-session', sync);
  }, []);
  return { user, ready };
}

export interface Health {
  status: string;
  checks: { database: string; queue: { mode: string; status: string } };
  lyzr: { mode: 'mock' | 'live'; environmentId: string | null; apiKeyConfigured: boolean; agentsConfigured: Record<string, boolean>; aimsEnabled: boolean };
  dataNotice: string;
  uptimeSeconds: number;
}

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/health'), refetchInterval: 30_000 });
}
