'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Loader2, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import * as React from 'react';
import { ErrorText, KV, LoadingBlock, PageHeader } from '@/components/page';
import { ConfidenceMeter, DecisionBadge, Hash, ProviderBadge, StatusBadge, WarningNote } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { CrossValidationSummary, VerificationBadge, type CrossValidation, type Provenance } from '@/components/verification';
import { api } from '@/lib/api';
import { can } from '@/lib/auth';
import { useSession } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';

interface CriterionRow {
  id: string;
  criterionKey: string;
  category: string;
  domain: string;
  field: string;
  operator: string;
  text: string;
  page: number;
  section: string;
  mandatory: boolean;
  requiresHumanReview: boolean;
  ambiguity: number;
  definition: {
    value?: number | string | null;
    values?: string[];
    range?: { min: number; max: number };
    unit?: string | null;
    temporal?: { operator: string; days: number; anchor: string };
    lookbackDays?: number;
    requireActive?: boolean;
    appliesTo?: { sex?: string };
    ambiguityReason?: string;
    resolution?: { conceptKeys: string[]; unresolvedTerms: string[] };
    extraction?: Provenance;
  };
}

interface ProtocolVersion {
  id: string;
  version: string;
  status: string;
  contentHash: string;
  redactedHash: string | null;
  pageCount: number;
  phiSummary: { totalRedactions: number } | null;
  extractionNotes: string[] | null;
  groundingRejections: Array<{ id: string; reason: string }> | null;
  injectionFindings: Array<{ pattern: string; location: string; excerpt?: string }> | null;
  crossValidation: CrossValidation | null;
  errorMessage: string | null;
  extractedAt: string | null;
  criteria: CriterionRow[];
  document: { filename: string; sizeBytes: number; mimeType: string } | null;
  execution: { provider: string; agentName: string; agentVersion: string; latencyMs: number; inputHash: string; outputHash: string | null } | null;
}

interface TrialDetail {
  id: string;
  code: string;
  title: string;
  phase: string;
  sponsor: string;
  indication: string;
  protocolVersions: Array<{ id: string; version: string; status: string; contentHash: string; createdAt: string }>;
  activeProtocol: ProtocolVersion | null;
  screenings: Array<{ id: string; screeningRef: string; decision: string | null; finalDecision: string | null; confidence: number | null; status: string; createdAt: string; patient: { patientRef: string } }>;
}

function threshold(c: CriterionRow): string {
  const d = c.definition;
  const unit = d.unit ? ` ${d.unit}` : '';
  if (c.requiresHumanReview) return 'not machine-evaluable';
  if (c.operator === 'BETWEEN' && d.range) return `${d.range.min} – ${d.range.max}${unit}`;
  if (c.operator === 'IN' || c.operator === 'NOT_IN') return (d.values ?? []).join(' | ');
  if (c.operator === 'EXISTS' || c.operator === 'NOT_EXISTS') return c.field;
  return `${d.value ?? '—'}${unit}`;
}

function temporal(c: CriterionRow): string {
  const d = c.definition;
  const parts: string[] = [];
  if (d.temporal) parts.push(`${d.temporal.operator} ${d.temporal.days}d (${d.temporal.anchor})`);
  if (d.lookbackDays) parts.push(`look-back ${d.lookbackDays}d`);
  if (d.requireActive) parts.push('active');
  if (d.appliesTo?.sex) parts.push(`sex=${d.appliesTo.sex}`);
  return parts.join(' · ') || '—';
}

export default function TrialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const trial = useQuery({
    queryKey: ['trial', id],
    queryFn: () => api.get<TrialDetail>(`/trials/${id}`),
    refetchInterval: (q) => (q.state.data?.activeProtocol && ['PENDING', 'PROCESSING'].includes(q.state.data.activeProtocol.status) ? 2000 : false),
  });

  if (trial.isLoading) return <LoadingBlock rows={6} />;
  if (trial.error) return <ErrorText error={trial.error} />;
  const t = trial.data!;
  const p = t.activeProtocol;
  const groups = [
    { label: 'Inclusion criteria', rows: p?.criteria.filter((c) => c.criterionKey.startsWith('INC')) ?? [] },
    { label: 'Exclusion criteria', rows: p?.criteria.filter((c) => c.criterionKey.startsWith('EXC')) ?? [] },
    { label: 'Non-binding guidance', rows: p?.criteria.filter((c) => c.criterionKey.startsWith('GDN')) ?? [] },
  ];

  return (
    <>
      <PageHeader eyebrow={<Link href="/trials" className="hover:underline">Trials</Link>} title={<span className="font-mono">{t.code}</span>} subtitle={t.title} actions={<Badge variant="muted">Phase {t.phase}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Protocol</CardTitle>
              <CardDescription>Lyzr Protocol Criteria Agent → grounding → ontology</CardDescription>
            </div>
            {p && <StatusBadge status={p.status} />}
          </CardHeader>
          <CardContent>
            {p ? (
              <dl className="divide-y divide-border/50">
                <KV k="Version">v{p.version}</KV>
                <KV k="Document">{p.document?.filename} · {p.pageCount} pages</KV>
                <KV k="Protocol SHA-256"><Hash value={p.contentHash} /></KV>
                <KV k="Redacted SHA-256"><Hash value={p.redactedHash} /></KV>
                <KV k="Criteria">{p.criteria.length} ({p.criteria.filter((c) => c.ambiguity).length} ambiguous)</KV>
                <KV k="PHI redactions">{p.phiSummary?.totalRedactions ?? 0}</KV>
                <KV k="Extracted">{fmtDate(p.extractedAt)}</KV>
                {p.execution && (
                  <>
                    <KV k="Agent"><span className="mr-1">{p.execution.agentName.replace('TrialGuard ', '')} v{p.execution.agentVersion}</span><ProviderBadge provider={p.execution.provider} /></KV>
                    <KV k="Output hash"><Hash value={p.execution.outputHash} /></KV>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No protocol uploaded.</p>
            )}
            {p?.errorMessage && <Alert tone="fail" title="Extraction failed" className="mt-3">{p.errorMessage}</Alert>}
            {!!p?.injectionFindings?.length && (
              <Alert tone="warn" title="Prompt-injection text detected in protocol" className="mt-3">
                Treated as document data only. {p.injectionFindings.length} finding(s).
              </Alert>
            )}
            {!!p?.groundingRejections?.length && (
              <Alert tone="warn" title="Ungrounded extractions rejected" className="mt-3">
                {p.groundingRejections.map((r) => `${r.id}: ${r.reason}`).join('; ')}
              </Alert>
            )}
            <CrossValidationSummary cv={p?.crossValidation} what="criteria" />
            {p?.extractionNotes?.map((n) => <WarningNote key={n}>{n}</WarningNote>)}
            {can(user, 'COORDINATOR') && <UploadProtocol trialId={t.id} />}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Screenings</CardTitle>
              <CardDescription>Deterministic decisions for this trial</CardDescription>
            </div>
            {can(user, 'COORDINATOR') && p?.status === 'READY' && <NewScreening trialId={t.id} />}
          </CardHeader>
          <div className="max-h-72 overflow-auto scrollbar-thin">
            <table className="table-dense w-full">
              <thead>
                <tr>
                  <th>Screening</th>
                  <th>Patient</th>
                  <th>Decision</th>
                  <th>Final</th>
                  <th>Confidence</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {t.screenings.map((s) => (
                  <tr key={s.id}>
                    <td><Link className="whitespace-nowrap font-mono text-info hover:underline" href={`/screenings/${s.id}`}>{s.screeningRef}</Link></td>
                    <td className="whitespace-nowrap font-mono">{s.patient.patientRef}</td>
                    <td><DecisionBadge decision={s.decision as never} /></td>
                    <td>{s.finalDecision ? <DecisionBadge decision={s.finalDecision as never} /> : <span className="text-muted-foreground">—</span>}</td>
                    <td><ConfidenceMeter value={s.confidence} /></td>
                    <td className="text-xs text-muted-foreground">{fmtDate(s.createdAt)}</td>
                  </tr>
                ))}
                {!t.screenings.length && (
                  <tr><td colSpan={6} className="text-center text-muted-foreground">No screenings yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {p && (
        <Card className="mt-4 overflow-x-auto">
          <CardHeader>
            <div>
              <CardTitle>Extracted eligibility criteria</CardTitle>
              <CardDescription>Structured by the Protocol Criteria Agent, verified verbatim against the protocol, mapped to terminology. Ambiguous language is never converted into thresholds.</CardDescription>
            </div>
          </CardHeader>
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th>ID</th>
                <th>Verification</th>
                <th>Protocol text (verbatim)</th>
                <th>Domain</th>
                <th>Field</th>
                <th>Operator</th>
                <th>Threshold</th>
                <th>Temporal</th>
                <th>Terminology</th>
                <th>Source</th>
                <th>Review</th>
              </tr>
            </thead>
            {groups.map((g) =>
              g.rows.length ? (
                <tbody key={g.label}>
                  <tr>
                    <td colSpan={11} className="bg-panel-2/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</td>
                  </tr>
                  {g.rows.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono font-semibold">{c.criterionKey}</td>
                      <td><VerificationBadge p={c.definition.extraction} /></td>
                      <td className="min-w-[280px] max-w-md text-[12.5px]">{c.text}</td>
                      <td className="text-xs">{c.domain}</td>
                      <td className="text-xs">{c.field}</td>
                      <td className="whitespace-nowrap font-mono text-xs">{c.operator}</td>
                      <td className="whitespace-nowrap font-mono text-xs">{threshold(c)}</td>
                      <td className="text-xs">{temporal(c)}</td>
                      <td className="font-mono text-[11px] text-info">{c.definition.resolution?.conceptKeys.join(', ') || <span className="text-warn">unresolved</span>}</td>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">p.{c.page}</td>
                      <td>
                        {c.requiresHumanReview ? (
                          <Badge variant="warn" title={c.definition.ambiguityReason}>ambiguous</Badge>
                        ) : (
                          <Badge variant="muted">{c.mandatory ? 'mandatory' : 'guidance'}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : null,
            )}
          </table>
        </Card>
      )}
    </>
  );
}

function UploadProtocol({ trialId }: { trialId: string }) {
  const qc = useQueryClient();
  const [file, setFile] = React.useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file!);
      return api.post(`/trials/${trialId}/protocol`, fd);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trial', trialId] }),
  });
  return (
    <form
      className="mt-4 space-y-2 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (file) upload.mutate();
      }}
    >
      <Label htmlFor="protocol-file">Upload protocol (PDF or text, ≤ 10 MB)</Label>
      <Input id="protocol-file" type="file" accept="application/pdf,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-1.5 text-xs" />
      <ErrorText error={upload.error} />
      <Button type="submit" size="sm" variant="secondary" disabled={!file || upload.isPending}>
        {upload.isPending ? <Loader2 className="animate-spin" /> : <FileUp />} Extract criteria
      </Button>
    </form>
  );
}

function NewScreening({ trialId }: { trialId: string }) {
  const router = useRouter();
  const patients = useQuery({ queryKey: ['patients'], queryFn: () => api.get<Array<{ id: string; patientRef: string; latestVersion: { status: string } | null }>>('/patients') });
  const [patientId, setPatientId] = React.useState('');
  const [date, setDate] = React.useState('2026-09-23');
  const run = useMutation({
    mutationFn: () => api.post<{ screening: { id: string } }>('/screenings', { trialId, patientId, screeningDate: date }),
    onSuccess: (r) => router.push(`/screenings/${r.screening.id}`),
  });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select aria-label="Patient" className="h-8 w-32 text-xs" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
        <option value="">Patient…</option>
        {patients.data?.filter((p) => p.latestVersion?.status === 'READY').map((p) => (
          <option key={p.id} value={p.id}>{p.patientRef}</option>
        ))}
      </Select>
      <Input aria-label="Screening date" type="date" className="h-8 w-36 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
      <Button size="sm" disabled={!patientId || run.isPending} onClick={() => run.mutate()}>
        {run.isPending ? <Loader2 className="animate-spin" /> : <PlayCircle />} Screen
      </Button>
      {run.error && <span className="text-xs text-fail">{(run.error as Error).message}</span>}
    </div>
  );
}
