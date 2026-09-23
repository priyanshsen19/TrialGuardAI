'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, Bot, CheckCircle2, Cog, Download, FileText, Loader2, ShieldAlert, ShieldCheck, User, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { ErrorText, KV, LoadingBlock, PageHeader } from '@/components/page';
import { DecisionBadge, Hash, ResultBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { api, downloadFile } from '@/lib/api';
import type { AuditEvent, ScreeningDetail, Verification } from '@/lib/types';
import { cn, fmtDate } from '@/lib/utils';

interface AuditData {
  screeningId: string;
  screeningRef: string;
  events: AuditEvent[];
  roots: Array<{ id: string; rootHash: string; eventCount: number; reason: string; sealedAt: string }>;
  upstreamChains: Array<{ chainId: string; events: number; rootHash: string | null }>;
}

interface AgentsInfo {
  agents: Array<{ key: string; name: string; version: string }>;
}

export default function AuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const audit = useQuery({ queryKey: ['audit', id], queryFn: () => api.get<AuditData>(`/audit/${id}`) });
  const screening = useQuery({ queryKey: ['screening', id], queryFn: () => api.get<ScreeningDetail>(`/screenings/${id}`) });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentsInfo>('/system/agents') });
  const verify = useMutation({ mutationFn: () => api.get<Verification>(`/audit/${id}/verify`) });
  const [seq, setSeq] = React.useState(5);
  const tamper = useMutation({ mutationFn: () => api.post<Verification & { tamperedSequence: number }>(`/audit/${id}/simulate-tamper`, { sequence: seq }) });
  const [expanded, setExpanded] = React.useState<number | null>(null);

  React.useEffect(() => {
    verify.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (audit.isLoading || screening.isLoading) return <LoadingBlock rows={8} />;
  if (audit.error) return <ErrorText error={audit.error} />;
  const a = audit.data!;
  const s = screening.data;
  const v = verify.data;
  const components = a.events.reduce<Record<string, string>>((acc, e) => ({ ...acc, [e.component]: e.componentVersion }), {});

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/audit" className="hover:underline">Audit</Link>}
        title={<span className="font-mono">{a.screeningRef} audit trail</span>}
        subtitle="Every significant event is appended with the SHA-256 hash of its canonical content and the hash of the previous event."
        actions={
          <>
            <Button onClick={() => verify.mutate()} disabled={verify.isPending}>{verify.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify Audit Chain</Button>
            <Button variant="outline" onClick={() => downloadFile(`/screenings/${id}/dossier`, `${a.screeningRef}-dossier.pdf`, true)}><FileText /> Export PDF</Button>
            <Button variant="outline" onClick={() => downloadFile(`/screenings/${id}/dossier.json`, `${a.screeningRef}-dossier.json`)}><Download /> Export JSON</Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className={cn(v ? (v.valid ? 'border-pass/50' : 'border-fail/50') : undefined)}>
          <CardHeader><CardTitle>Verification status</CardTitle></CardHeader>
          <CardContent>
            {v ? (
              <div className="space-y-2">
                <div className={cn('flex items-center gap-2 text-lg font-semibold', v.valid ? 'text-pass' : 'text-fail')}>
                  {v.valid ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />} {v.valid ? 'Chain valid' : 'Chain INVALID'}
                </div>
                <dl className="divide-y divide-border/50">
                  <KV k="Events verified">{v.eventsVerified}</KV>
                  <KV k="Root hash"><Hash value={v.rootHash} /></KV>
                  <KV k="Sealed root"><Hash value={v.sealedRootHash} /></KV>
                  <KV k="Sealed root matches">{v.sealedRootMatches === null ? '—' : v.sealedRootMatches ? 'yes' : 'no'}</KV>
                  <KV k="Verified at">{fmtDate(v.verifiedAt)}</KV>
                </dl>
                {v.reason && <Alert tone="fail">{v.reason}</Alert>}
              </div>
            ) : (
              <LoadingBlock rows={2} />
            )}
            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <Label htmlFor="tamper-seq">Tamper-detection demo (verifies an in-memory copy; stored records are append-only and untouched)</Label>
              <div className="flex gap-2">
                <Input id="tamper-seq" type="number" min={1} max={a.events.length} value={seq} onChange={(e) => setSeq(Number(e.target.value))} className="w-20" />
                <Button variant="warning" size="default" onClick={() => tamper.mutate()} disabled={tamper.isPending}><ShieldAlert /> Simulate tampering of event #{seq}</Button>
              </div>
              {tamper.data && (
                <Alert tone={tamper.data.valid ? 'pass' : 'fail'} title={tamper.data.valid ? 'Unexpected: still valid' : `Detected: chain invalid at event #${tamper.data.firstInvalidSequence}`}>
                  {tamper.data.reason}
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Provenance</CardTitle><CardDescription>Inputs bound to this screening</CardDescription></div></CardHeader>
          <CardContent>
            <dl className="divide-y divide-border/50">
              {s && (
                <>
                  <KV k="Decision"><DecisionBadge decision={s.finalDecision ?? s.decision} /></KV>
                  <KV k="Protocol version">v{s.protocolVersion.version}</KV>
                  <KV k="Protocol hash"><Hash value={s.protocolVersion.contentHash} /></KV>
                  <KV k="Patient snapshot hash"><Hash value={s.patientVersion.snapshotHash} /></KV>
                  <KV k="Rule engine version">v{s.ruleEngineVersion}</KV>
                  <KV k="Ontology version">{s.ontologySummary?.version}</KV>
                </>
              )}
              {a.upstreamChains.map((c) => (
                <KV key={c.chainId} k={`${c.chainId.split(':')[0]} chain (${c.events} ev.)`}><Hash value={c.rootHash} /></KV>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Component & agent versions</CardTitle><CardDescription>As recorded in the chain</CardDescription></div></CardHeader>
          <CardContent>
            <dl className="divide-y divide-border/50">
              {Object.entries(components).map(([k, ver]) => <KV key={k} k={k}>{/^\d/.test(ver) ? `v${ver}` : ver}</KV>)}
              {agents.data?.agents.filter((x) => !components[x.name]).map((x) => <KV key={x.key} k={x.name}>v{x.version}</KV>)}
            </dl>
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sealed roots</div>
              {a.roots.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-0.5 text-xs">
                  <span className="text-muted-foreground">{r.reason} ({r.eventCount})</span>
                  <Hash value={r.rootHash} n={8} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {s && (
        <Card className="mt-4 overflow-x-auto">
          <CardHeader><CardTitle>Criterion evaluations (as sealed)</CardTitle></CardHeader>
          <table className="table-dense w-full">
            <thead><tr><th>Criterion</th><th>Rule expression</th><th>Evidence</th><th>Result</th></tr></thead>
            <tbody>
              {s.evaluations.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono font-semibold">{e.criterionKey}</td>
                  <td className="font-mono text-[11px] text-info">{e.ruleExpression}</td>
                  <td className="text-xs text-muted-foreground">{e.evidence.map((x) => `${x.factId} (${x.sourceDocument} p.${x.page})`).join(', ') || '—'}</td>
                  <td><ResultBadge result={e.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader><div><CardTitle>Audit timeline & hash chain</CardTitle><CardDescription>{a.events.length} append-only events · click an event to view its payload</CardDescription></div></CardHeader>
        <CardContent>
          <ol className="relative space-y-0">
            {a.events.map((e, i) => {
              const Icon = e.actorType === 'USER' ? User : e.actorType === 'AGENT' ? Bot : Cog;
              const broken = !!tamper.data && !tamper.data.valid && tamper.data.firstInvalidSequence === e.sequence;
              return (
                <li key={e.id}>
                  <button onClick={() => setExpanded(expanded === e.sequence ? null : e.sequence)} className={cn('flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-panel-2', broken && 'bg-fail/10 ring-1 ring-fail/50')} aria-expanded={expanded === e.sequence}>
                    <div className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border', e.actorType === 'USER' ? 'border-warn/50 bg-warn/10 text-warn' : e.actorType === 'AGENT' ? 'border-info/50 bg-info/10 text-info' : 'border-border bg-muted text-muted-foreground')}>
                      <Icon className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground">#{String(e.sequence).padStart(3, '0')}</span>
                        <span className="font-mono text-[13px] font-semibold">{e.eventType}</span>
                        <Badge variant="muted">{e.actorType}</Badge>
                        <span className="text-xs text-muted-foreground">{e.component} v{e.componentVersion}</span>
                        {typeof e.payload?.result === 'string' && <ResultBadge result={e.payload.result as never} />}
                        {typeof e.payload?.criterionId === 'string' && <span className="font-mono text-xs">{e.payload.criterionId as string}</span>}
                        {broken && <Badge variant="fail">tampered</Badge>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{fmtDate(e.timestamp)}</span>
                        <span>prev <Hash value={e.previousEventHash} n={8} /></span>
                        <span>hash <Hash value={e.eventHash} n={8} /></span>
                        {e.inputHash && <span>in <Hash value={e.inputHash} n={6} /></span>}
                        {e.outputHash && <span>out <Hash value={e.outputHash} n={6} /></span>}
                      </div>
                    </div>
                  </button>
                  {expanded === e.sequence && (
                    <pre className="mb-2 ml-12 max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] scrollbar-thin">{JSON.stringify(e.payload, null, 2)}</pre>
                  )}
                  {i < a.events.length - 1 && <ArrowDown className="ml-[18px] size-3 text-border" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
