'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Download, FileText, ScrollText, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { ReviewPanel } from '@/components/review-panel';
import { ErrorText, KV, LoadingBlock, PageHeader } from '@/components/page';
import { ConfidenceMeter, DecisionBadge, Hash, ProviderBadge, ResultBadge, SeverityBadge, StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Progress } from '@/components/ui/misc';
import { api, downloadFile } from '@/lib/api';
import type { Evaluation, ScreeningDetail } from '@/lib/types';
import { cn, fmtDate, fmtMs, pct } from '@/lib/utils';

export default function ScreeningDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['screening', id],
    queryFn: () => api.get<ScreeningDetail>(`/screenings/${id}`),
    refetchInterval: (x) => (x.state.data && ['QUEUED', 'RUNNING'].includes(x.state.data.status) ? 1500 : false),
  });
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorText error={q.error} />;
  const s = q.data!;
  const finalDecision = s.finalDecision ?? s.decision;
  const blocking = s.flags.filter((f) => f.severity === 'BLOCKING').length;
  const warnings = s.flags.filter((f) => f.severity === 'WARNING').length;
  const groups: Array<{ label: string; rows: Evaluation[] }> = [
    { label: 'Inclusion criteria', rows: s.evaluations.filter((e) => e.criterionKey.startsWith('INC')) },
    { label: 'Exclusion criteria', rows: s.evaluations.filter((e) => e.criterionKey.startsWith('EXC')) },
    { label: 'Non-binding guidance (does not gate eligibility)', rows: s.evaluations.filter((e) => e.criterionKey.startsWith('GDN')) },
  ];
  const counts = (r: string) => s.evaluations.filter((e) => e.mandatory && e.result === r).length;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/screenings" className="hover:underline">Screenings</Link>}
        title={<span className="font-mono">{s.screeningRef}</span>}
        subtitle={<>Trial <Link className="font-mono text-info hover:underline" href={`/trials/${s.trial.id}`}>{s.trial.code}</Link> · patient <Link className="font-mono text-info hover:underline" href={`/patients/${s.patient.patientRef}`}>{s.patient.patientRef}</Link> · screening date {s.screeningDate}</>}
        actions={
          <>
            <Link href={`/audit/${s.id}`}><Button variant="secondary"><ScrollText /> Audit trail</Button></Link>
            <Button variant="outline" onClick={() => downloadFile(`/screenings/${s.id}/dossier`, `${s.screeningRef}-dossier.pdf`, true)}><FileText /> Dossier PDF</Button>
            <Button variant="outline" onClick={() => downloadFile(`/screenings/${s.id}/dossier.json`, `${s.screeningRef}-dossier.json`)}><Download /> JSON</Button>
          </>
        }
      />

      {s.status === 'FAILED' && <Alert tone="fail" title="Screening failed" className="mb-4">{s.errorMessage}</Alert>}

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className={cn('lg:col-span-2', finalDecision === 'ELIGIBLE' ? 'border-pass/40' : finalDecision === 'INELIGIBLE' ? 'border-fail/40' : 'border-warn/40')}>
          <CardContent>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Final status</div>
                <div className="mt-1.5"><DecisionBadge decision={finalDecision} large /></div>
                {s.finalDecision && (
                  <div className="mt-1.5 text-xs text-muted-foreground">Human reviewer decision · system decision retained: <DecisionBadge decision={s.decision} /></div>
                )}
                {!s.finalDecision && <div className="mt-1.5 text-xs text-muted-foreground">Decided by deterministic rule engine v{s.ruleEngineVersion} — not by an LLM</div>}
              </div>
              <div className="min-w-[160px]">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Confidence</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{pct(s.confidence)}</div>
                <Progress value={(s.confidence ?? 0) * 100} tone={(s.confidence ?? 0) >= 0.9 ? 'pass' : 'warn'} className="mt-1" />
                <div className="mt-1 text-[10px] text-muted-foreground">threshold 90% · mean {pct(s.confidenceBreakdown?.criterionMean)} − penalty {pct(s.confidenceBreakdown?.safetyPenalty)}</div>
              </div>
            </div>
            <ul className="mt-4 space-y-1 border-t border-border pt-3 text-[13px]">
              {(s.decisionReasons ?? []).map((r) => (
                <li key={r} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Safety status</CardTitle>{blocking ? <Badge variant="fail">{blocking} blocking</Badge> : warnings ? <Badge variant="warn">{warnings} warning</Badge> : <Badge variant="pass">clear</Badge>}</CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
              <Stat n={counts('PASS')} label="pass" cls="text-pass" />
              <Stat n={counts('FAIL')} label="fail" cls="text-fail" />
              <Stat n={counts('UNKNOWN')} label="unknown" cls="text-warn" />
              <Stat n={counts('NOT_APPLICABLE')} label="n/a" cls="text-muted-foreground" />
            </div>
            <p className="text-[11px] text-muted-foreground">Mandatory criteria only.</p>
            {s.safetySummary && <p className="border-t border-border pt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Safety agent: </span>{s.safetySummary}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Provenance</CardTitle><StatusBadge status={s.status} /></CardHeader>
          <CardContent>
            <dl className="divide-y divide-border/50">
              <KV k="Protocol">v{s.protocolVersion.version}</KV>
              <KV k="Protocol hash"><Hash value={s.protocolVersion.contentHash} n={8} /></KV>
              <KV k="Patient snapshot"><Hash value={s.patientVersion.snapshotHash} n={8} /></KV>
              <KV k="Age (derived)">{s.context?.patientAgeYears ?? '—'} y · sex {s.context?.patientSex ?? '—'}</KV>
              <KV k="PHI aliased">{s.patientVersion.phiSummary?.totalRedactions ?? 0} identifiers</KV>
              <KV k="Ontology">{s.ontologySummary?.version ?? '—'}</KV>
              <KV k="Agents"><ProviderBadge provider={s.lyzrMode === 'live' ? 'lyzr' : 'mock'} /></KV>
              <KV k="Duration">{fmtMs(s.durationMs)}</KV>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardContent className="py-3">
          <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Pipeline stages">
            {s.stages.map((st, i) => (
              <li key={st.stage} className="flex items-center gap-2">
                <span title={st.description} className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1', st.completed ? 'border-pass/40 bg-pass/10 text-pass' : 'border-border text-muted-foreground')}>
                  {st.completed ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-muted-foreground" />}
                  {st.stage}
                </span>
                {i < s.stages.length - 1 && <ChevronRight className="size-3 text-muted-foreground" aria-hidden />}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-x-auto">
        <CardHeader>
          <div>
            <CardTitle>Criterion evaluations</CardTitle>
            <CardDescription>Every result is computed by the deterministic rule engine from ontology-validated, source-grounded facts. Expand a row for evidence quotes.</CardDescription>
          </div>
        </CardHeader>
        <table className="table-dense w-full">
          <thead>
            <tr>
              <th className="w-6" />
              <th>Criterion</th>
              <th>Protocol requirement</th>
              <th>Operator</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Rule expression</th>
              <th>Evidence</th>
              <th>Result</th>
            </tr>
          </thead>
          {groups.map((g) =>
            g.rows.length ? (
              <tbody key={g.label}>
                <tr>
                  <td colSpan={9} className="bg-panel-2/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</td>
                </tr>
                {g.rows.map((e) => <EvaluationRow key={e.id} e={e} />)}
              </tbody>
            ) : null,
          )}
        </table>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>Safety flags</CardTitle><CardDescription>Deterministic checks + Lyzr Safety Validator Agent. Flags can require review but never make a patient eligible.</CardDescription></div></CardHeader>
          <CardContent className="space-y-2">
            {s.flags.length === 0 && <p className="text-sm text-muted-foreground">No safety flags.</p>}
            {s.flags.map((f) => (
              <div key={f.id} className="rounded-md border border-border bg-panel-2/40 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={f.severity} />
                  <span className="font-mono text-xs">{f.code}</span>
                  <Badge variant="muted">{f.source}</Badge>
                  {f.criterionIds.map((c) => <Badge key={c} variant="info">{c}</Badge>)}
                </div>
                <p className="mt-1.5 text-[13px]">{f.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <ReviewPanel screening={s} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>Audit narrative</CardTitle><CardDescription>AI-generated, non-authoritative. Guarded: may not add numbers, contradict the decision, or make regulatory claims.</CardDescription></div>{s.narrative && <Badge variant={s.narrative.source === 'agent' ? 'info' : 'muted'}>{s.narrative.source}</Badge>}</CardHeader>
          <CardContent>
            {s.narrative ? (
              <>
                <p className="text-[13px] italic leading-relaxed">{s.narrative.narrative.summary}</p>
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {s.narrative.narrative.keyPoints.map((k) => <li key={k}>• {k}</li>)}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Pending.</p>
            )}
          </CardContent>
        </Card>
        <Card className="overflow-x-auto">
          <CardHeader><div><CardTitle>Agent executions</CardTitle><CardDescription>PHI-free telemetry (hashes, latency) — AIMS-ready</CardDescription></div><ShieldCheck className="size-4 text-muted-foreground" /></CardHeader>
          <table className="table-dense w-full">
            <thead><tr><th>Agent</th><th>Provider</th><th>Status</th><th>Latency</th><th>Input hash</th><th>Output hash</th></tr></thead>
            <tbody>
              {s.executions.map((x) => (
                <tr key={x.id}>
                  <td className="text-xs">{x.agentName.replace('TrialGuard ', '')} <span className="text-muted-foreground">v{x.agentVersion}</span></td>
                  <td><ProviderBadge provider={x.provider} />{x.cacheHit && <Badge variant="info" className="ml-1" title="Reused a stored Lyzr response for identical agent + redacted input (temperature 0); no new Lyzr call">cached</Badge>}</td>
                  <td><StatusBadge status={x.status === 'SUCCEEDED' ? 'COMPLETED' : x.status} /></td>
                  <td className="text-xs tabular-nums">{fmtMs(x.latencyMs)}</td>
                  <td><Hash value={x.inputHash} n={8} /></td>
                  <td><Hash value={x.outputHash} n={8} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.dossiers[0] && (
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Dossier v{s.dossiers[0].version} · {fmtDate(s.dossiers[0].generatedAt)} · PDF <Hash value={s.dossiers[0].pdfHash} n={8} /> · covers root <Hash value={s.dossiers[0].auditRootHash} n={8} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div className="rounded-md bg-panel-2 py-1.5">
      <div className={cn('text-lg font-semibold tabular-nums', cls)}>{n}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function EvaluationRow({ e }: { e: Evaluation }) {
  const [open, setOpen] = React.useState(false);
  const ev = e.evidence[0];
  return (
    <>
      <tr className={cn(e.result === 'FAIL' && 'bg-fail/5', e.result === 'UNKNOWN' && e.mandatory && 'bg-warn/5')}>
        <td>
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} evidence for ${e.criterionKey}`} className="rounded p-0.5 text-muted-foreground hover:bg-panel-2 hover:text-foreground">
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        </td>
        <td className="whitespace-nowrap">
          <div className="font-mono font-semibold">{e.criterionKey}</div>
          <div className="text-[10px] text-muted-foreground">p.{e.sourcePage} · {e.category}</div>
        </td>
        <td className="min-w-[190px] max-w-[260px] text-[12.5px]">{e.requirement}</td>
        <td className="font-mono text-xs">{e.operator}</td>
        <td className="min-w-[130px] max-w-[190px] text-xs">{e.expectedValue}</td>
        <td className="min-w-[120px] max-w-[190px] text-xs">{e.actualValue ?? '—'}</td>
        <td className="min-w-[170px] max-w-[240px] font-mono text-[11px] text-info">{e.ruleExpression}</td>
        <td className="min-w-[120px] text-xs">
          {ev ? (
            <>
              <div className="font-mono text-[11px]">{ev.sourceDocument}</div>
              <div className="text-muted-foreground">p.{ev.page}{ev.observedAt ? ` · ${ev.observedAt}` : ''}</div>
              {e.evidence.length > 1 && <div className="text-muted-foreground">+{e.evidence.length - 1} more</div>}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td><ResultBadge result={e.result} /><div className="mt-1"><ConfidenceMeter value={e.result === 'UNKNOWN' ? null : e.confidence} /></div></td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={8} className="bg-panel-2/40">
            <p className="text-[13px]"><span className="text-muted-foreground">Reason: </span>{e.reason}</p>
            {e.reviewReasons.length > 0 && <div className="mt-1 flex gap-1">{e.reviewReasons.map((r) => <Badge key={r} variant="warn">{r}</Badge>)}</div>}
            <div className="mt-2 space-y-1.5">
              {e.evidence.map((x) => (
                <div key={x.factId} className="rounded border border-border bg-background/60 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{x.factId}</span>
                    <span>{x.display}</span>
                    <span className="text-muted-foreground">{x.sourceDocument} · page {x.page}{x.observedAt ? ` · ${x.observedAt}` : ''}</span>
                    {x.normalizedValue !== undefined && x.normalizedValue !== x.value && <Badge variant="info">normalized {String(x.normalizedValue)} {x.normalizedUnit}</Badge>}
                  </div>
                  <blockquote className="mt-1 border-l-2 border-primary/50 pl-2 font-mono text-[11px] text-foreground/80">{x.quote}</blockquote>
                </div>
              ))}
              {e.evidence.length === 0 && <p className="text-xs text-muted-foreground">No supporting record (negative or missing evidence).</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
