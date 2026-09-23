'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from '@/components/page';
import { DecisionBadge, Hash } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import type { Verification } from '@/lib/types';
import { fmtDate } from '@/lib/utils';

interface Row {
  id: string;
  screeningRef: string;
  decision: string | null;
  finalDecision: string | null;
  status: string;
  createdAt: string;
  events: number;
  patient: { patientRef: string };
  trial: { code: string };
  latestRoot: { rootHash: string; eventCount: number; reason: string; sealedAt: string } | null;
}

export default function AuditPage() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.get<Row[]>('/audit') });
  const [results, setResults] = React.useState<Record<string, Verification>>({});
  const verifyAll = useMutation({
    mutationFn: async () => {
      const out: Record<string, Verification> = {};
      for (const r of q.data ?? []) out[r.id] = await api.get<Verification>(`/audit/${r.id}/verify`);
      return out;
    },
    onSuccess: setResults,
  });
  return (
    <>
      <PageHeader
        title="Audit"
        subtitle="Append-only, SHA-256 hash-chained audit trails (Part-11-oriented audit controls). Each screening has its own chain; each extraction has an upstream chain."
        actions={
          <Button onClick={() => verifyAll.mutate()} disabled={verifyAll.isPending || !q.data?.length}>
            {verifyAll.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify all chains
          </Button>
        }
      />
      <Card className="overflow-x-auto">
        {q.isLoading ? (
          <CardContent><LoadingBlock /></CardContent>
        ) : q.error ? (
          <CardContent><ErrorText error={q.error} /></CardContent>
        ) : q.data?.length ? (
          <table className="table-dense w-full">
            <thead>
              <tr><th>Screening</th><th>Patient</th><th>Trial</th><th>Decision</th><th>Events</th><th>Sealed root</th><th>Sealed</th><th>Verification</th></tr>
            </thead>
            <tbody>
              {q.data.map((r) => {
                const v = results[r.id];
                return (
                  <tr key={r.id}>
                    <td><Link href={`/audit/${r.id}`} className="whitespace-nowrap font-mono font-semibold text-info hover:underline">{r.screeningRef}</Link></td>
                    <td className="whitespace-nowrap font-mono">{r.patient.patientRef}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{r.trial.code}</td>
                    <td><DecisionBadge decision={(r.finalDecision ?? r.decision) as never} /></td>
                    <td className="tabular-nums">{r.events}</td>
                    <td><Hash value={r.latestRoot?.rootHash} /></td>
                    <td className="text-xs text-muted-foreground">{r.latestRoot ? `${r.latestRoot.reason} · ${fmtDate(r.latestRoot.sealedAt)}` : '—'}</td>
                    <td>
                      {v ? (
                        v.valid ? <span className="flex items-center gap-1 text-xs text-pass"><CheckCircle2 className="size-3.5" /> valid · {v.eventsVerified} events</span> : <span className="flex items-center gap-1 text-xs text-fail"><XCircle className="size-3.5" /> invalid</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">not checked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <CardContent><EmptyState title="No audit trails yet">Run the synthetic demo from the dashboard.</EmptyState></CardContent>
        )}
      </Card>
    </>
  );
}
