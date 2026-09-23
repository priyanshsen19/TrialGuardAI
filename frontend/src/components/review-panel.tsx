'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, HelpCircle, Loader2, UsersRound, XCircle } from 'lucide-react';
import * as React from 'react';
import { DecisionBadge, Hash, StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { can } from '@/lib/auth';
import { useSession } from '@/lib/hooks';
import type { ReviewTask } from '@/lib/types';
import { fmtDate } from '@/lib/utils';

const ACTIONS = [
  { id: 'APPROVE_ELIGIBLE', label: 'Approve Eligible', icon: CheckCircle2, variant: 'success' as const },
  { id: 'APPROVE_INELIGIBLE', label: 'Approve Ineligible', icon: XCircle, variant: 'destructive' as const },
  { id: 'REQUEST_MORE_INFORMATION', label: 'Request More Information', icon: HelpCircle, variant: 'secondary' as const },
  { id: 'REQUIRE_ADDITIONAL_REVIEW', label: 'Require Additional Review', icon: UsersRound, variant: 'secondary' as const },
];

export function ReviewForm({ screeningId, onDone }: { screeningId: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState<string | null>(null);
  const idem = React.useRef(`review-${screeningId.slice(0, 8)}-${Date.now().toString(36)}`);
  const submit = useMutation({
    mutationFn: (action: string) => api.post(`/screenings/${screeningId}/review`, { action, reason }, { 'idempotency-key': `${idem.current}-${action}` }),
    onSuccess: () => {
      setReason('');
      qc.invalidateQueries();
      onDone?.();
    },
    onSettled: () => setPending(null),
  });
  const tooShort = reason.trim().length < 10;
  return (
    <div className="space-y-2">
      <Label htmlFor={`reason-${screeningId}`}>Reviewer reason (required, recorded in the audit trail and dossier)</Label>
      <Textarea id={`reason-${screeningId}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Outside records confirm prednisone stopped on 2026-09-05 — within the 30-day washout." />
      {submit.error && <p className="text-xs text-fail">{(submit.error as Error).message}</p>}
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={a.variant}
            disabled={tooShort || submit.isPending}
            onClick={() => {
              setPending(a.id);
              submit.mutate(a.id);
            }}
          >
            {pending === a.id ? <Loader2 className="animate-spin" /> : <a.icon />} {a.label}
          </Button>
        ))}
      </div>
      {tooShort && <p className="text-[11px] text-muted-foreground">Enter at least 10 characters to enable actions.</p>}
    </div>
  );
}

export function ReviewPanel({ screening }: { screening: { id: string; decision: string | null; status: string; reviewTasks: ReviewTask[] } }) {
  const { user } = useSession();
  const task = screening.reviewTasks[0];
  const canReview = can(user, 'REVIEWER');
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Human-in-the-loop review</CardTitle>
          <CardDescription>A qualified reviewer adjudicates cases the rule engine cannot decide. Deterministic results are never overwritten.</CardDescription>
        </div>
        {task && <StatusBadge status={task.status} />}
      </CardHeader>
      <CardContent className="space-y-3">
        {!task ? (
          <p className="text-sm text-muted-foreground">{screening.decision === 'REQUIRES_HUMAN_OVERVIEW' ? 'Review task pending.' : 'No human review required — the deterministic decision is final.'}</p>
        ) : (
          <>
            <ul className="space-y-1 text-[13px]">
              {task.reasons.map((r) => <li key={r} className="text-warn">• <span className="text-foreground">{r}</span></li>)}
            </ul>
            {task.decisions.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                {task.decisions.map((d) => (
                  <div key={d.id} className="rounded-md border border-border bg-panel-2/40 p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{d.reviewer.displayName}</span>
                      <span className="text-muted-foreground">{d.reviewerRole} · {fmtDate(d.createdAt)}</span>
                      <span className="font-mono">{d.action}</span>
                      {d.resultingDecision && <DecisionBadge decision={d.resultingDecision} />}
                    </div>
                    <p className="mt-1 text-[13px]">“{d.reason}”</p>
                    <div className="mt-1 text-muted-foreground">signature <Hash value={d.signatureHash} n={12} /></div>
                  </div>
                ))}
              </div>
            )}
            {task.status !== 'RESOLVED' && screening.status === 'COMPLETED' && (canReview ? <ReviewForm screeningId={screening.id} /> : <Alert tone="info">Sign in as a REVIEWER to adjudicate this case.</Alert>)}
          </>
        )}
      </CardContent>
    </Card>
  );
}
