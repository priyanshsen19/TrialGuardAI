import { AlertTriangle, CheckCircle2, CircleSlash, HelpCircle, ShieldAlert, UserCheck, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn, shortHash } from '@/lib/utils';
import type { Decision, Result } from '@/lib/types';

export function DecisionBadge({ decision, large = false, className }: { decision: Decision | null | undefined; large?: boolean; className?: string }) {
  if (!decision) return <Badge variant="muted">Pending</Badge>;
  const map = {
    ELIGIBLE: { v: 'pass' as const, icon: CheckCircle2, label: 'Eligible' },
    INELIGIBLE: { v: 'fail' as const, icon: XCircle, label: 'Ineligible' },
    REQUIRES_HUMAN_OVERVIEW: { v: 'warn' as const, icon: UserCheck, label: 'Requires human overview' },
  }[decision];
  const Icon = map.icon;
  return (
    <Badge variant={map.v} className={cn(large && 'px-2.5 py-1 text-sm', className)}>
      <Icon className={large ? 'size-4' : 'size-3'} aria-hidden />
      {map.label}
    </Badge>
  );
}

export function ResultBadge({ result }: { result: Result }) {
  const map = {
    PASS: { v: 'pass' as const, icon: CheckCircle2 },
    FAIL: { v: 'fail' as const, icon: XCircle },
    UNKNOWN: { v: 'warn' as const, icon: HelpCircle },
    NOT_APPLICABLE: { v: 'muted' as const, icon: CircleSlash },
  }[result];
  const Icon = map.icon;
  return (
    <Badge variant={map.v}>
      <Icon className="size-3" aria-hidden />
      {result === 'NOT_APPLICABLE' ? 'N/A' : result}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: 'INFO' | 'WARNING' | 'BLOCKING' }) {
  const v = severity === 'BLOCKING' ? 'fail' : severity === 'WARNING' ? 'warn' : 'info';
  return (
    <Badge variant={v}>
      {severity !== 'INFO' && <ShieldAlert className="size-3" aria-hidden />}
      {severity}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const v = status === 'READY' || status === 'COMPLETED' || status === 'RESOLVED' ? 'pass' : status === 'FAILED' ? 'fail' : status === 'OPEN' || status === 'ESCALATED' || status === 'AWAITING_INFORMATION' ? 'warn' : 'info';
  return <Badge variant={v}>{status.replace(/_/g, ' ')}</Badge>;
}

export function ProviderBadge({ provider }: { provider: string }) {
  return provider === 'lyzr' ? <Badge variant="info">Lyzr</Badge> : <Badge variant="muted">Mock (not Lyzr)</Badge>;
}

export function Hash({ value, n = 10, className }: { value?: string | null; n?: number; className?: string }) {
  return (
    <code title={value ?? undefined} className={cn('kbd-hash', className)}>
      {shortHash(value, n)}
    </code>
  );
}

export function ConfidenceMeter({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  const p = value * 100;
  const tone = p >= 90 ? 'bg-pass' : p >= 75 ? 'bg-warn' : 'bg-fail';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full', tone)} style={{ width: `${p}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums">{p.toFixed(1)}%</span>
    </div>
  );
}

export function WarningNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs text-warn">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
