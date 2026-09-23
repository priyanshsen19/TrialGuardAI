'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { EmptyState, ErrorText, LoadingBlock, PageHeader } from '@/components/page';
import { ConfidenceMeter, DecisionBadge, Hash, StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { can } from '@/lib/auth';
import { useSession } from '@/lib/hooks';

interface PatientRow {
  id: string;
  patientRef: string;
  sex: string | null;
  synthetic: boolean;
  latestVersion: { id: string; versionNumber: number; status: string; facts: number; snapshotHash: string; phiSummary: { totalRedactions: number; byCategory: Record<string, number> } | null } | null;
  latestScreening: { id: string; screeningRef: string; decision: string | null; finalDecision: string | null; confidence: number | null } | null;
  screeningCount: number;
}

export default function PatientsPage() {
  const { user } = useSession();
  const [open, setOpen] = React.useState(false);
  const patients = useQuery({ queryKey: ['patients'], queryFn: () => api.get<PatientRow[]>('/patients'), refetchInterval: (q) => (q.state.data?.some((p) => p.latestVersion && ['PENDING', 'PROCESSING'].includes(p.latestVersion.status)) ? 2000 : false) });
  return (
    <>
      <PageHeader
        title="Patients"
        subtitle="Synthetic patient records. Identifiers are aliased before any agent inference and stored only as ciphertext in the PHI vault."
        actions={can(user, 'COORDINATOR') && <Button onClick={() => setOpen(true)}><UserPlus /> Register synthetic patient</Button>}
      />
      <Card className="overflow-x-auto">
        {patients.isLoading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : patients.error ? (
          <div className="p-4"><ErrorText error={patients.error} /></div>
        ) : patients.data?.length ? (
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th>Patient ref</th>
                <th>Sex</th>
                <th>Record</th>
                <th>Facts</th>
                <th>PHI aliased</th>
                <th>Snapshot hash</th>
                <th>Latest screening</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {patients.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/patients/${p.patientRef}`} className="whitespace-nowrap font-mono font-semibold text-info hover:underline">{p.patientRef}</Link>
                    {p.synthetic && <Badge variant="muted" className="ml-2">synthetic</Badge>}
                  </td>
                  <td>{p.sex ?? '—'}</td>
                  <td>{p.latestVersion ? <div className="flex items-center gap-1.5">v{p.latestVersion.versionNumber} <StatusBadge status={p.latestVersion.status} /></div> : '—'}</td>
                  <td className="tabular-nums">{p.latestVersion?.facts ?? 0}</td>
                  <td className="tabular-nums text-info">{p.latestVersion?.phiSummary?.totalRedactions ?? 0}</td>
                  <td><Hash value={p.latestVersion?.snapshotHash} /></td>
                  <td>
                    {p.latestScreening ? (
                      <Link href={`/screenings/${p.latestScreening.id}`} className="flex items-center gap-2 hover:underline">
                        <span className="font-mono text-xs">{p.latestScreening.screeningRef}</span>
                        <DecisionBadge decision={(p.latestScreening.finalDecision ?? p.latestScreening.decision) as never} />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td><ConfidenceMeter value={p.latestScreening?.confidence} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4"><EmptyState title="No patients yet">Run the synthetic demo from the dashboard.</EmptyState></div>
        )}
      </Card>
      <RegisterPatient open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const SAMPLE = `DEMOGRAPHICS
Sex: Female
PROBLEM LIST
- Type 2 diabetes mellitus | ICD-10 E11.9 | onset 2020-01-15 | active
LABORATORY RESULTS
2026-09-15 | Hemoglobin A1c | 8.2 | %
2026-09-15 | eGFR (CKD-EPI) | 75 | mL/min/1.73m2
MEDICATIONS
- Metformin 1000 mg PO BID | start 2021-01-01 | end ongoing`;

function RegisterPatient({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState({ name: '', dateOfBirth: '1970-01-01', sex: 'F', mrn: '', email: '', record: SAMPLE, synthetic: false });
  const reg = useMutation({
    mutationFn: () =>
      api.post('/patients', {
        synthetic: f.synthetic ? true : undefined,
        demographics: { name: f.name, dateOfBirth: f.dateOfBirth, sex: f.sex, ...(f.mrn ? { mrn: f.mrn } : {}), ...(f.email ? { email: f.email } : {}) },
        documents: [{ name: 'ehr-record.txt', text: f.record }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Register synthetic patient" description="Identifiers are aliased locally before extraction and stored encrypted. Never enter real patient data." className="max-w-2xl">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); reg.mutate(); }}>
        <Alert tone="warn">This demonstration accepts synthetic data only.</Alert>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><Label htmlFor="pn">Synthetic name</Label><Input id="pn" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div><Label htmlFor="dob">Date of birth</Label><Input id="dob" type="date" value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} required /></div>
          <div><Label htmlFor="sex">Sex</Label><Select id="sex" value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="F">F</option><option value="M">M</option></Select></div>
          <div><Label htmlFor="mrn">MRN</Label><Input id="mrn" value={f.mrn} onChange={(e) => setF({ ...f, mrn: e.target.value })} /></div>
        </div>
        <div><Label htmlFor="rec">EHR text</Label><Textarea id="rec" rows={10} className="font-mono text-xs" value={f.record} onChange={(e) => setF({ ...f, record: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.synthetic} onChange={(e) => setF({ ...f, synthetic: e.target.checked })} /> I confirm this record is entirely synthetic
        </label>
        <ErrorText error={reg.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!f.synthetic || reg.isPending}>Register & extract</Button>
        </div>
      </form>
    </Dialog>
  );
}
