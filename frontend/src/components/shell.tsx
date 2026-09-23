'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Activity, ClipboardCheck, FileSearch, FlaskConical, LayoutDashboard, LogOut, Menu, ScrollText, ShieldCheck, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { login } from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { useHealth, useSession } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/trials', label: 'Trials', icon: FlaskConical },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/screenings', label: 'Screenings', icon: FileSearch },
  { href: '/review', label: 'Human Review', icon: ClipboardCheck },
  { href: '/audit', label: 'Audit', icon: ScrollText },
];

const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
const DEMO_ROLES = ['admin', 'coordinator', 'reviewer', 'auditor'];

export function DemoBanner() {
  const { data } = useHealth();
  const live = data?.lyzr.mode === 'live';
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-widest text-warn" role="note">
      <span>{live ? 'Live Lyzr mode' : 'Demo mode'} — synthetic data</span>
      <span className="hidden font-normal normal-case tracking-normal text-warn/80 sm:inline">
        {live ? 'Agents run on Lyzr; eligibility is decided by the deterministic rule engine.' : 'Agents are simulated locally (mock) — outputs are not from Lyzr.'} Not for clinical use · not FDA approved.
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, ready } = useSession();
  const { data: health } = useHealth();
  const [open, setOpen] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);

  React.useEffect(() => {
    if (ready && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [ready, user, router, pathname]);

  React.useEffect(() => setOpen(false), [pathname]);

  if (!ready || !user) return <div className="p-8 text-sm text-muted-foreground">Loading session…</div>;

  const switchRole = async (role: string) => {
    if (!DEMO_PASSWORD) return;
    setSwitching(true);
    try {
      await login(`${role}@trialguard.demo`, DEMO_PASSWORD);
      qc.clear();
    } finally {
      setSwitching(false);
    }
  };

  const nav = (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors', active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-panel-2 hover:text-foreground')}
          >
            <Icon className={cn('size-4', active && 'text-primary')} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const system = (
    <div className="mt-auto space-y-2 border-t border-border p-3 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">API</span>
        <Badge variant={health?.status === 'ok' ? 'pass' : 'warn'}>{health?.status ?? '…'}</Badge>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Agents</span>
        <Badge variant={health?.lyzr.mode === 'live' ? 'info' : 'muted'}>{health?.lyzr.mode === 'live' ? 'Lyzr live' : 'Mock'}</Badge>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Queue</span>
        <Badge variant="muted">{health?.checks.queue.mode ?? '…'}</Badge>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-panel lg:flex">
          <Brand />
          {nav}
          {system}
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
            <aside className="flex h-full w-64 flex-col border-r border-border bg-panel" onClick={(e) => e.stopPropagation()}>
              <Brand />
              {nav}
              {system}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
            <div className="flex items-center gap-2">
              <button className="rounded p-1.5 hover:bg-panel-2 lg:hidden" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen((o) => !o)}>
                {open ? <X className="size-4" /> : <Menu className="size-4" />}
              </button>
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <Activity className="size-3.5 text-pass" aria-hidden /> Clinical Operations Command Center
              </span>
            </div>
            <div className="flex items-center gap-2">
              {DEMO_PASSWORD && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="hidden sm:inline">Demo role</span>
                  <Select aria-label="Switch demo role" className="h-7 w-36 text-xs" value={user.role.toLowerCase()} disabled={switching} onChange={(e) => switchRole(e.target.value)}>
                    {DEMO_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <div className="hidden text-right leading-tight md:block">
                <div className="text-xs font-medium">{user.name}</div>
                <div className="text-[10px] text-muted-foreground">{user.role}</div>
              </div>
              <button
                className="rounded p-1.5 text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                aria-label="Sign out"
                onClick={() => {
                  clearSession();
                  qc.clear();
                  router.replace('/login');
                }}
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 lg:px-6">{children}</main>
          <footer className="border-t border-border px-6 py-3 text-[11px] text-muted-foreground">
            TrialGuard AI · AI-assisted clinical trial screening with deterministic eligibility evaluation, human-in-the-loop review and Part-11-oriented audit controls. Synthetic clinical data only — not
            clinically validated, not FDA approved, not for direct clinical decision-making.
          </footer>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
      <div className="flex size-8 items-center justify-center rounded-md bg-primary/20 ring-1 ring-primary/40">
        <ShieldCheck className="size-4.5 text-primary" aria-hidden />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">TrialGuard AI</div>
        <div className="text-[10px] text-muted-foreground">Governed screening</div>
      </div>
    </Link>
  );
}
