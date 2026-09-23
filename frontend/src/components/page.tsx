import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-primary">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, tone, icon: Icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'pass' | 'fail' | 'warn' | 'info'; icon?: React.ComponentType<{ className?: string }> }) {
  const color = tone ? { pass: 'text-pass', fail: 'text-fail', warn: 'text-warn', info: 'text-info' }[tone] : 'text-foreground';
  return (
    <Card className="p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn('size-4', tone ? color : 'text-muted-foreground')} />}
      </div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', color)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="mt-1 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

export function KV({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className={cn('min-w-0 truncate text-right', mono && 'font-mono text-xs')}>{children}</dd>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-fail">{(error as Error).message ?? 'Something went wrong'}</p>;
}
