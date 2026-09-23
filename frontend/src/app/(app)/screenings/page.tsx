'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from '@/components/page';
import { ConfidenceMeter, DecisionBadge, StatusBadge } from '@/components/status';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { ScreeningRow } from '@/lib/types';
import { fmtDate, fmtMs } from '@/lib/utils';

type Filter = 'ALL' | 'ELIGIBLE' | 'INELIGIBLE' | 'REQUIRES_HUMAN_OVERVIEW';

export default function ScreeningsPage() {
  const [filter, setFilter] = React.useState<Filter>('ALL');
  const q = useQuery({ queryKey: ['screenings'], queryFn: () => api.get<ScreeningRow[]>('/screenings'), refetchInterval: (x) => (x.state.data?.some((s) => ['QUEUED', 'RUNNING'].includes(s.status)) ? 2000 : 15_000) });
  const rows = (q.data ?? []).filter((s) => filter === 'ALL' || s.decision === filter);
  const count = (d: Filter) => (q.data ?? []).filter((s) => d === 'ALL' || s.decision === d).length;
  return (
    <>
      <PageHeader title="Screenings" subtitle="Each screening binds a protocol version and a patient snapshot, runs the staged pipeline, and yields a deterministic decision." />
      <Card className="overflow-x-auto">
        <div className="px-4 pt-2">
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: 'ALL', label: 'All', count: count('ALL') },
              { id: 'ELIGIBLE', label: 'Eligible', count: count('ELIGIBLE') },
              { id: 'INELIGIBLE', label: 'Ineligible', count: count('INELIGIBLE') },
              { id: 'REQUIRES_HUMAN_OVERVIEW', label: 'Human review', count: count('REQUIRES_HUMAN_OVERVIEW') },
            ]}
          />
        </div>
        {q.isLoading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : q.error ? (
          <div className="p-4"><ErrorText error={q.error} /></div>
        ) : rows.length ? (
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th>Screening</th>
                <th>Trial</th>
                <th>Patient</th>
                <th>Status</th>
                <th>System decision</th>
                <th>Final</th>
                <th>Confidence</th>
                <th>Flags</th>
                <th>Review</th>
                <th>Duration</th>
                <th>Screening date</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/screenings/${s.id}`} className="whitespace-nowrap font-mono font-semibold text-info hover:underline">{s.screeningRef}</Link></td>
                  <td className="whitespace-nowrap font-mono text-xs">{s.trialCode}</td>
                  <td className="whitespace-nowrap font-mono text-xs">{s.patientRef}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td><DecisionBadge decision={s.decision} /></td>
                  <td>{s.finalDecision ? <DecisionBadge decision={s.finalDecision} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td><ConfidenceMeter value={s.confidence} /></td>
                  <td className="tabular-nums">{s.safetyFlags}</td>
                  <td>{s.reviewStatus ? <StatusBadge status={s.reviewStatus} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-xs tabular-nums">{fmtMs(s.durationMs)}</td>
                  <td className="text-xs">{s.screeningDate}</td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4"><EmptyState title="No screenings">Run the synthetic demo from the dashboard, or start one from a trial page.</EmptyState></div>
        )}
      </Card>
    </>
  );
}
