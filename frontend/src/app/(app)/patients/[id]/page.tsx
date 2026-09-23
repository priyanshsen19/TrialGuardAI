'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { ErrorText, KV, LoadingBlock, PageHeader } from '@/components/page';
import { Hash, StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Tabs } from '@/components/ui/misc';
import { CrossValidationSummary, VerificationBadge, type CrossValidation, type Provenance } from '@/components/verification';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/utils';

interface Fact {
  factId: string;
  category: string;
  concept: { system: string; code: string | null; display: string };
  value: unknown;
  unit: string | null;
  observedAt: string | null;
  onsetDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
  datePrecision: string;
  dateText?: string;
  source: { document: string; page: number };
  sourceQuote: string;
  uncertainty: { isUncertain: boolean; reason?: string };
  extractionConfidence: number;
  resolution: { status: string; concept: { system: string; code: string; display: string } | null; classes: string[]; mappingConfidence: number; method: string; note?: string };
  extraction?: Provenance;
}

interface PatientDetail {
  id: string;
  patientRef: string;
  sex: string | null;
  phiNotice: string;
  versions: Array<{ id: string; versionNumber: number; status: string; snapshotHash: string; phiSummary: { totalRedactions: number; byCategory: Record<string, number> } | null; injectionFindings: Array<{ pattern: string; location: string; excerpt?: string }> | null; extractionNotes: string[] | null; crossValidation: CrossValidation | null; errorMessage: string | null; extractedAt: string | null }>;
  facts: Fact[];
  redactedDocuments: Array<{ id: string; filename: string; sha256: string; pages: Array<{ page: number; text: string }> }>;
}

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = React.useState<'facts' | 'docs'>('facts');
  const q = useQuery({ queryKey: ['patient', id], queryFn: () => api.get<PatientDetail>(`/patients/${id}`) });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.error) return <ErrorText error={q.error} />;
  const p = q.data!;
  const v = p.versions[0];
  const dateOf = (f: Fact) => f.observedAt ?? (f.endDate ? `end ${f.endDate}` : f.startDate ? `start ${f.startDate}` : f.onsetDate ? `onset ${f.onsetDate}` : f.dateText ? `"${f.dateText}"` : '—');

  return (
    <>
      <PageHeader eyebrow={<Link href="/patients" className="hover:underline">Patients</Link>} title={<span className="font-mono">{p.patientRef}</span>} subtitle={p.phiNotice} actions={<Badge variant="muted">synthetic · sex {p.sex ?? '—'}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Record snapshot</CardTitle>{v && <StatusBadge status={v.status} />}</CardHeader>
          <CardContent>
            {v && (
              <dl className="divide-y divide-border/50">
                <KV k="Version">v{v.versionNumber}</KV>
                <KV k="Snapshot SHA-256"><Hash value={v.snapshotHash} /></KV>
                <KV k="Extracted">{fmtDate(v.extractedAt)}</KV>
                <KV k="Facts">{p.facts.length}</KV>
                <KV k="PHI aliased">{v.phiSummary?.totalRedactions ?? 0}</KV>
              </dl>
            )}
            <div className="mt-3 flex flex-wrap gap-1">
              {Object.entries(v?.phiSummary?.byCategory ?? {}).map(([k, n]) => (
                <Badge key={k} variant="info">{k.replace(/_/g, ' ')} ×{n}</Badge>
              ))}
            </div>
            <CrossValidationSummary cv={v?.crossValidation} what="facts" />
            {!!v?.injectionFindings?.length && (
              <Alert tone="warn" title="Prompt injection detected in record" className="mt-3">
                {v.injectionFindings.map((f) => <div key={f.location + f.pattern} className="mt-1 font-mono text-[11px]">{f.pattern} @ {f.location}: “{f.excerpt}”</div>)}
                <div className="mt-1 text-xs">Treated as document data; never executed.</div>
              </Alert>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-3 overflow-hidden">
          <div className="px-4 pt-2">
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'facts', label: 'Clinical facts', count: p.facts.length }, { id: 'docs', label: 'Redacted documents', count: p.redactedDocuments.length }]} />
          </div>
          {tab === 'facts' ? (
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead>
                  <tr>
                    <th>Fact</th>
                    <th>Concept (as extracted)</th>
                    <th>Terminology (validated)</th>
                    <th>Value</th>
                    <th>Date</th>
                    <th>Source</th>
                    <th>Conf.</th>
                    <th>Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {p.facts.map((f) => (
                    <tr key={f.factId}>
                      <td className="font-mono text-xs">{f.factId}<div className="text-[10px] text-muted-foreground">{f.category}</div></td>
                      <td className="max-w-[220px]">{f.concept.display}{f.uncertainty.isUncertain && <Badge variant="warn" className="ml-1">uncertain</Badge>}</td>
                      <td>
                        {f.resolution.concept ? (
                          <span className="font-mono text-[11px] text-info">{f.resolution.concept.system} {f.resolution.concept.code}</span>
                        ) : (
                          <Badge variant="warn">{f.resolution.status}</Badge>
                        )}
                        {f.resolution.classes.length > 0 && <div className="font-mono text-[10px] text-muted-foreground">∈ {f.resolution.classes.join(', ')}</div>}
                      </td>
                      <td className="font-mono text-xs">{String(f.value ?? '—')} {f.unit ?? ''}</td>
                      <td className="text-xs">{dateOf(f)}{f.datePrecision === 'unknown' && f.category === 'medication' && <Badge variant="warn" className="ml-1">imprecise</Badge>}</td>
                      <td className="whitespace-nowrap text-xs text-muted-foreground" title={f.sourceQuote}>{f.source.document} p.{f.source.page}</td>
                      <td className="font-mono text-xs">{(f.extractionConfidence * (f.resolution.mappingConfidence || 0)).toFixed(2)}</td>
                      <td><VerificationBadge p={f.extraction} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CardContent className="space-y-3">
              <CardDescription>Exactly what the agents received — every identifier replaced by a deterministic alias.</CardDescription>
              {p.redactedDocuments.map((d) => (
                <div key={d.id} className="rounded-md border border-border">
                  <div className="flex items-center justify-between border-b border-border bg-panel-2 px-3 py-1.5 text-xs">
                    <span className="font-mono">{d.filename}</span>
                    <Hash value={d.sha256} n={8} />
                  </div>
                  {d.pages.map((pg) => (
                    <pre key={pg.page} className="whitespace-pre-wrap border-b border-border/50 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground/90 last:border-0">
                      <span className="text-muted-foreground">— page {pg.page} —{'\n'}</span>
                      {pg.text.split(/([A-Z_]+_REDACTED_[0-9A-F]{6})/).map((part, i) => (/_REDACTED_/.test(part) ? <mark key={i} className="rounded bg-info/20 px-0.5 text-info">{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>))}
                    </pre>
                  ))}
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      </div>
    </>
  );
}
