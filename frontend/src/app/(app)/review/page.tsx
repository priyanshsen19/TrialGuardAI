'use client';

import { useQuery } from '@tanstack/react-query';
import { AppLink as Link } from '@/components/app-link';
import { ReviewForm } from '@/components/review-panel';
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from '@/components/page';
import { DecisionBadge, SeverityBadge, StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { can } from '@/lib/auth';
import { useSession } from '@/lib/hooks';
import { fmtDate, pct } from '@/lib/utils';

interface QueueTask {
  id: string;
  status: string;
  reasons: string[];
  priority: string;
  confidence: number;
  createdAt: string;
  screening: { id: string; screeningRef: string; confidence: number | null; decision: string; screeningDate: string; patient: { patientRef: string }; trial: { code: string }; flags: Array<{ code: string; severity: 'INFO' | 'WARNING' | 'BLOCKING' }> };
  decisions: Array<{ action: string; reason: string; createdAt: string; reviewer: { displayName: string } }>;
}
interface ResolvedTask {
  id: string;
  resolvedAt: string;
  screening: { id: string; screeningRef: string; finalDecision: string; patient: { patientRef: string } };
  decisions: Array<{ action: string; reason: string; reviewer: { displayName: string } }>;
}

export default function ReviewPage() {
  const { user } = useSession();
  const q = useQuery({ queryKey: ['review-queue'], queryFn: () => api.get<{ open: QueueTask[]; resolved: ResolvedTask[] }>('/review/queue'), refetchInterval: 15_000 });
  return (
    <>
      <PageHeader title="Human review queue" subtitle="Cases the deterministic engine could not decide automatically: unknown criteria, conflicting or stale evidence, unresolved terminology, blocking safety flags, or confidence below 90%." />
      {!can(user, 'REVIEWER') && <Alert tone="info" className="mb-4">You are signed in as {user?.role}. Switch to the REVIEWER demo role to adjudicate cases.</Alert>}
      {q.isLoading ? (
        <LoadingBlock rows={4} />
      ) : q.error ? (
        <ErrorText error={q.error} />
      ) : (
        <>
          {q.data!.open.length === 0 && <EmptyState title="Queue is empty">No screenings currently require human review.</EmptyState>}
          <div className="grid gap-4 xl:grid-cols-2">
            {q.data!.open.map((t) => (
              <Card key={t.id} className={t.priority === 'HIGH' ? 'border-warn/50' : undefined}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/screenings/${t.screening.id}`} className="font-mono text-base font-semibold text-info hover:underline">{t.screening.screeningRef}</Link>
                        <span className="font-mono text-sm">{t.screening.patient.patientRef}</span>
                        <span className="font-mono text-xs text-muted-foreground">{t.screening.trial.code}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <DecisionBadge decision="REQUIRES_HUMAN_OVERVIEW" />
                        <StatusBadge status={t.status} />
                        {t.priority === 'HIGH' && <Badge variant="fail">high priority</Badge>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-semibold tabular-nums">{pct(t.screening.confidence)}</div>
                      <div className="text-[11px] text-muted-foreground">confidence · created {fmtDate(t.createdAt)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reason</div>
                    <ul className="mt-1 space-y-1 text-[13px]">
                      {t.reasons.map((r) => <li key={r}>• {r}</li>)}
                    </ul>
                  </div>
                  {t.screening.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.screening.flags.map((f, i) => (
                        <span key={i} className="flex items-center gap-1"><SeverityBadge severity={f.severity} /><span className="font-mono text-[11px]">{f.code}</span></span>
                      ))}
                    </div>
                  )}
                  {t.decisions[0] && (
                    <p className="rounded bg-panel-2 px-2 py-1.5 text-xs text-muted-foreground">
                      Last action: <span className="font-mono">{t.decisions[0].action}</span> by {t.decisions[0].reviewer.displayName} — “{t.decisions[0].reason}”
                    </p>
                  )}
                  {can(user, 'REVIEWER') && <div className="border-t border-border pt-3"><ReviewForm screeningId={t.screening.id} /></div>}
                </CardContent>
              </Card>
            ))}
          </div>
          {q.data!.resolved.length > 0 && (
            <Card className="mt-6 overflow-x-auto">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">Recently resolved</div>
              <table className="table-dense w-full">
                <thead><tr><th>Screening</th><th>Patient</th><th>Final decision</th><th>Reviewer</th><th>Reason</th><th>Resolved</th></tr></thead>
                <tbody>
                  {q.data!.resolved.map((t) => (
                    <tr key={t.id}>
                      <td><Link className="whitespace-nowrap font-mono text-info hover:underline" href={`/screenings/${t.screening.id}`}>{t.screening.screeningRef}</Link></td>
                      <td className="whitespace-nowrap font-mono">{t.screening.patient.patientRef}</td>
                      <td><DecisionBadge decision={t.screening.finalDecision as never} /></td>
                      <td className="text-xs">{t.decisions[0]?.reviewer.displayName}</td>
                      <td className="max-w-md text-xs">{t.decisions[0]?.reason}</td>
                      <td className="text-xs text-muted-foreground">{fmtDate(t.resolvedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
