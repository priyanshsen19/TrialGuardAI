import * as React from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function Progress({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'pass' | 'warn' | 'fail' }) {
  const color = { primary: 'bg-primary', pass: 'bg-pass', warn: 'bg-warn', fail: 'bg-fail' }[tone];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'fail' | 'pass'; title?: string; children?: React.ReactNode; className?: string }) {
  const styles = { info: 'border-info/40 bg-info/10', warn: 'border-warn/40 bg-warn/10', fail: 'border-fail/40 bg-fail/10', pass: 'border-pass/40 bg-pass/10' }[tone];
  return (
    <div role={tone === 'fail' ? 'alert' : 'status'} className={cn('rounded-md border px-3 py-2 text-sm', styles, className)}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className="text-[13px] text-foreground/90">{children}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn('-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors', value === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded bg-muted px-1 text-[10px]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
