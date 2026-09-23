'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from '@/components/page';
import { Hash, StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { api } from '@/lib/api';
import { can } from '@/lib/auth';
import { useSession } from '@/lib/hooks';

interface TrialRow {
  id: string;
  code: string;
  title: string;
  phase: string;
  sponsor: string;
  indication: string;
  synthetic: boolean;
  protocol: { versionId: string; version: string; status: string; contentHash: string; criteria: number; pages: number } | null;
  screenings: { total: number; ELIGIBLE?: number; INELIGIBLE?: number; REQUIRES_HUMAN_OVERVIEW?: number };
}

export default function TrialsPage() {
  const { user } = useSession();
  const [open, setOpen] = React.useState(false);
  const trials = useQuery({ queryKey: ['trials'], queryFn: () => api.get<TrialRow[]>('/trials') });

  return (
    <>
      <PageHeader
        title="Trials"
        subtitle="Clinical trial protocols and their extracted, machine-evaluable eligibility criteria."
        actions={
          can(user, 'COORDINATOR') && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New trial
            </Button>
          )
        }
      />
      <Card className="overflow-x-auto">
        {trials.isLoading ? (
          <div className="p-4">
            <LoadingBlock />
          </div>
        ) : trials.error ? (
          <div className="p-4">
            <ErrorText error={trials.error} />
          </div>
        ) : trials.data?.length ? (
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Phase</th>
                <th>Protocol</th>
                <th>Criteria</th>
                <th>Protocol hash</th>
                <th>Screenings</th>
              </tr>
            </thead>
            <tbody>
              {trials.data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/trials/${t.id}`} className="whitespace-nowrap font-mono font-semibold text-info hover:underline">
                      {t.code}
                    </Link>
                    {t.synthetic && <Badge variant="muted" className="ml-2">synthetic</Badge>}
                  </td>
                  <td className="max-w-md">
                    <div className="line-clamp-2">{t.title}</div>
                    <div className="text-[11px] text-muted-foreground">{t.sponsor} · {t.indication}</div>
                  </td>
                  <td>{t.phase}</td>
                  <td>{t.protocol ? <div className="flex items-center gap-1.5">v{t.protocol.version} <StatusBadge status={t.protocol.status} /></div> : <span className="text-muted-foreground">none</span>}</td>
                  <td className="tabular-nums">{t.protocol?.criteria ?? '—'}</td>
                  <td><Hash value={t.protocol?.contentHash} /></td>
                  <td className="whitespace-nowrap text-xs">
                    <span className="text-pass">{t.screenings.ELIGIBLE ?? 0}</span> / <span className="text-fail">{t.screenings.INELIGIBLE ?? 0}</span> / <span className="text-warn">{t.screenings.REQUIRES_HUMAN_OVERVIEW ?? 0}</span>
                    <span className="ml-1 text-muted-foreground">({t.screenings.total})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4">
            <EmptyState title="No trials yet">Run the synthetic demo from the dashboard or create a trial.</EmptyState>
          </div>
        )}
      </Card>
      <CreateTrialDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CreateTrialDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ code: '', title: '', phase: 'II', sponsor: '', indication: '' });
  const create = useMutation({
    mutationFn: () => api.post('/trials', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trials'] });
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} title="New trial" description="Synthetic trials only. Upload the protocol on the trial page.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div>
          <Label htmlFor="code">Code</Label>
          <Input id="code" placeholder="CT-2026-002" value={form.code} onChange={set('code')} required />
        </div>
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={form.title} onChange={set('title')} required minLength={5} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label htmlFor="phase">Phase</Label>
            <Input id="phase" value={form.phase} onChange={set('phase')} required />
          </div>
          <div>
            <Label htmlFor="sponsor">Sponsor</Label>
            <Input id="sponsor" value={form.sponsor} onChange={set('sponsor')} required />
          </div>
          <div>
            <Label htmlFor="indication">Indication</Label>
            <Input id="indication" value={form.indication} onChange={set('indication')} required />
          </div>
        </div>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={create.isPending}>Create trial</Button>
        </div>
      </form>
    </Dialog>
  );
}
