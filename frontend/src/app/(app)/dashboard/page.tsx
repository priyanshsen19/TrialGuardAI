'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle2, Clock, EyeOff, FileSearch, FlaskConical, Loader2, PlayCircle, RotateCcw, ShieldAlert, ShieldCheck, UserCheck, Users, XCircle } from 'lucide-react';
import Link from 'next/link';
import { ErrorText, Kpi, LoadingBlock, PageHeader } from '@/components/page';
import { DecisionBadge, Hash } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { can } from '@/lib/auth';
import { useHealth, useSession } from '@/lib/hooks';
import { fmtDate, fmtMs, pct } from '@/lib/utils';

interface Stats {
  trials: number;
  patients: number;
  screenings: number;
  eligible: number;
  ineligible: number;
  humanReview: number;
  openReviewTasks: number;
  humanFinalDecisions: Record<string, number>;
  averageScreeningDurationMs: number | null;
  averageConfidence: number | null;
  safetyFlags: { total: number; bySeverity: Record<string, number> };
  phi: { redactionEvents: number; redactedIdentifiers: number; byCategory: Record<string, number> };
  agentExecutions: Array<{ provider: string; status: string; count: number }>;
  recentActivity: Array<{ id: string; chainId: string; screeningId: string | null; timestamp: string; eventType: string; actorType: string; component: string; eventHash: string }>;
  system: { lyzrMode: string; queueMode: string };
}

interface AgentsInfo {
  environment: { mode: string; baseUrl: string; environmentId: string | null; apiKeyConfigured: boolean; aimsEnabled: boolean };
  agents: Array<{ key: string; name: string; version: string; role: string; queue: string; prohibitedActions: string[] }>;
  stageGraph: Array<{ stage: string; next: string | null; description: string }>;
  demoLabel: string;
}

interface SeedResult {
  allMatch: boolean;
  results: Array<{ patientRef: string; screeningRef: string; screeningId: string; expectedDecision: string; decision: string; confidence: number; matchesExpectation: boolean }>;
}

export default function DashboardPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/dashboard/stats'), refetchInterval: 15_000 });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentsInfo>('/system/agents') });
  const health = useHealth();
  const seed = useMutation({
    mutationFn: (reset: boolean) => api.post<SeedResult>('/demo/seed', { reset }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const s = stats.data;
  const total = s ? Math.max(1, s.eligible + s.ineligible + s.humanReview) : 1;

  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title="Screening operations"
        subtitle="AI-assisted clinical trial screening: agents extract, a deterministic rule engine decides, humans adjudicate ambiguity, and every step is hash-chained."
        actions={
          can(user, 'COORDINATOR') && (
            <>
              <Button onClick={() => seed.mutate(false)} disabled={seed.isPending}>
                {seed.isPending ? <Loader2 className="animate-spin" /> : <PlayCircle />} Run synthetic demo
              </Button>
              {user?.role === 'ADMIN' && (
                <Button variant="outline" onClick={() => confirm('Reset all demo data and reseed? (demo mode only)') && seed.mutate(true)} disabled={seed.isPending}>
                  <RotateCcw /> Reset & reseed
                </Button>
              )}
            </>
          )
        }
      />

      {seed.error && <Alert tone="fail" title="Demo seed failed" className="mb-4">{(seed.error as Error).message}</Alert>}
      {seed.data && (
        <Alert tone={seed.data.allMatch ? 'pass' : 'warn'} title={seed.data.allMatch ? 'Demo complete — all five decisions match the expected scenarios' : 'Demo complete — some decisions differ from expectations'} className="mb-4">
          <div className="mt-1 flex flex-wrap gap-2">
            {seed.data.results.map((r) => (
              <Link key={r.screeningId} href={`/screenings/${r.screeningId}`} className="flex items-center gap-1.5 rounded border border-border bg-panel px-2 py-1 text-xs hover:border-primary">
                <span className="font-mono">{r.patientRef}</span>
                <DecisionBadge decision={r.decision as never} />
              </Link>
            ))}
          </div>
        </Alert>
      )}

      {stats.isLoading ? (
        <LoadingBlock rows={3} />
      ) : stats.error ? (
        <ErrorText error={stats.error} />
      ) : s ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Trials" value={s.trials} icon={FlaskConical} />
            <Kpi label="Patients" value={s.patients} hint="synthetic" icon={Users} />
            <Kpi label="Screenings" value={s.screenings} icon={FileSearch} />
            <Kpi label="Eligible" value={s.eligible} tone="pass" icon={CheckCircle2} />
            <Kpi label="Ineligible" value={s.ineligible} tone="fail" icon={XCircle} />
            <Kpi label="Human review" value={s.humanReview} hint={`${s.openReviewTasks} open task(s)`} tone="warn" icon={UserCheck} />
            <Kpi label="Avg. screening duration" value={fmtMs(s.averageScreeningDurationMs)} hint="end-to-end pipeline" icon={Clock} />
            <Kpi label="Avg. confidence" value={pct(s.averageConfidence)} icon={Activity} />
            <Kpi label="Safety flags" value={s.safetyFlags.total} hint={Object.entries(s.safetyFlags.bySeverity).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'none'} tone={s.safetyFlags.bySeverity.BLOCKING ? 'warn' : undefined} icon={ShieldAlert} />
            <Kpi label="PHI redaction events" value={s.phi.redactionEvents} hint={`${s.phi.redactedIdentifiers} identifiers aliased before inference`} tone="info" icon={EyeOff} />
            <Kpi label="Agent executions" value={s.agentExecutions.reduce((a, b) => a + b.count, 0)} hint={s.agentExecutions.map((e) => `${e.count} ${e.provider}/${e.status.toLowerCase()}`).join(' · ') || '—'} icon={Activity} />
            <Kpi label="Human final decisions" value={Object.values(s.humanFinalDecisions).reduce((a, b) => a + b, 0)} hint={Object.entries(s.humanFinalDecisions).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'none yet'} icon={UserCheck} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>Decision distribution</CardTitle>
                  <CardDescription>System decisions from the deterministic rule engine</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Eligible ${s.eligible}, ineligible ${s.ineligible}, human review ${s.humanReview}`}>
                  <div className="bg-pass" style={{ width: `${(s.eligible / total) * 100}%` }} />
                  <div className="bg-fail" style={{ width: `${(s.ineligible / total) * 100}%` }} />
                  <div className="bg-warn" style={{ width: `${(s.humanReview / total) * 100}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span><span className="mr-1 inline-block size-2 rounded-full bg-pass" />Eligible {s.eligible}</span>
                  <span><span className="mr-1 inline-block size-2 rounded-full bg-fail" />Ineligible {s.ineligible}</span>
                  <span><span className="mr-1 inline-block size-2 rounded-full bg-warn" />Requires human review {s.humanReview}</span>
                </div>

                <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent activity (audit events)</h3>
                <div className="max-h-80 overflow-y-auto scrollbar-thin">
                  <table className="table-dense w-full">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Actor</th>
                        <th>Component</th>
                        <th>Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.recentActivity.map((e) => (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap text-muted-foreground">{fmtDate(e.timestamp)}</td>
                          <td>
                            {e.screeningId ? (
                              <Link className="font-mono text-xs text-info hover:underline" href={`/audit/${e.screeningId}`}>
                                {e.eventType}
                              </Link>
                            ) : (
                              <span className="font-mono text-xs">{e.eventType}</span>
                            )}
                          </td>
                          <td><Badge variant="muted">{e.actorType}</Badge></td>
                          <td className="text-xs text-muted-foreground">{e.component}</td>
                          <td><Hash value={e.eventHash} n={8} /></td>
                        </tr>
                      ))}
                      {s.recentActivity.length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center text-muted-foreground">No activity yet — run the synthetic demo.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>System health</CardTitle>
                    <CardDescription>{agents.data?.demoLabel}</CardDescription>
                  </div>
                  <Badge variant={health.data?.status === 'ok' ? 'pass' : 'warn'}>{health.data?.status ?? '…'}</Badge>
                </CardHeader>
                <CardContent className="space-y-1.5 text-[13px]">
                  <Row k="Database" v={health.data?.checks.database} ok={health.data?.checks.database === 'up'} />
                  <Row k={`Queue (${health.data?.checks.queue.mode ?? '…'})`} v={health.data?.checks.queue.status} ok={health.data?.checks.queue.status === 'up'} />
                  <Row k="Lyzr mode" v={health.data?.lyzr.mode === 'live' ? 'live' : 'mock (not Lyzr)'} ok />
                  <Row k="Lyzr API key" v={health.data?.lyzr.apiKeyConfigured ? 'configured' : 'not configured'} ok={health.data?.lyzr.mode === 'mock' || health.data?.lyzr.apiKeyConfigured} />
                  <Row k="AIMS telemetry" v={health.data?.lyzr.aimsEnabled ? 'enabled' : 'disabled'} ok />
                  <Row k="Environment" v={agents.data?.environment.environmentId ?? '—'} ok />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Agent fleet</CardTitle>
                    <CardDescription>Four Lyzr agents · none can decide eligibility</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {agents.data?.agents.map((a) => (
                    <div key={a.key} className="rounded-md border border-border bg-panel-2/50 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium">{a.name.replace('TrialGuard ', '')}</span>
                        <Badge variant="muted">v{a.version}</Badge>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">queue: <span className="font-mono">{a.queue}</span></div>
                      <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <ShieldCheck className="mt-px size-3 shrink-0 text-pass" aria-hidden />
                        <span>
                          <span className="font-medium text-foreground/80">Guardrails · never: </span>
                          {a.prohibitedActions.join('; ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function Row({ k, v, ok }: { k: string; v?: string | null; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={ok ? 'text-foreground' : 'text-warn'}>{v ?? '…'}</span>
    </div>
  );
}
