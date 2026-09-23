import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/misc';

export interface Provenance {
  method: 'cross-validated' | 'deterministic-resolution' | 'deterministic-recovery' | 'llm-only' | 'simulator';
  disagreements?: string[];
}

export interface CrossValidation {
  llmItems: number;
  deterministicItems: number;
  agreed: string[];
  resolved: Array<{ id: string; disagreements: string[] }>;
  recovered: string[];
  llmOnly: string[];
  llmOutputRejected?: string[];
  agreementRate: number;
}

const LABELS: Record<Provenance['method'], { label: string; v: 'pass' | 'warn' | 'info' | 'fail' | 'muted'; title: string }> = {
  'cross-validated': { label: 'LLM ✓ verified', v: 'pass', title: 'Lyzr agent output matches the independent deterministic parse' },
  'deterministic-resolution': { label: 'LLM corrected', v: 'warn', title: 'Lyzr agent output disagreed with the deterministic parse; the grounded deterministic parse was used' },
  'deterministic-recovery': { label: 'LLM omission recovered', v: 'warn', title: 'The Lyzr agent missed this item; recovered from the deterministic parse' },
  'llm-only': { label: 'LLM only · review', v: 'fail', title: 'Not confirmed by the deterministic parser; routed to human review' },
  simulator: { label: 'mock simulator', v: 'muted', title: 'Mock mode: deterministic local simulator (not Lyzr)' },
};

export function VerificationBadge({ p }: { p?: Provenance | null }) {
  if (!p) return <span className="text-muted-foreground">—</span>;
  const l = LABELS[p.method];
  return (
    <Badge variant={l.v} title={[l.title, ...(p.disagreements ?? [])].join('\n')}>
      {l.label}
    </Badge>
  );
}

export function CrossValidationSummary({ cv, what }: { cv: CrossValidation | null | undefined; what: string }) {
  if (!cv) return null;
  const tone = cv.llmOutputRejected ? 'fail' : cv.resolved.length || cv.recovered.length || cv.llmOnly.length ? 'warn' : 'pass';
  return (
    <Alert tone={tone} title={`Lyzr ${what} cross-validated against deterministic parser — ${Math.round(cv.agreementRate * 100)}% agreement`} className="mt-3">
      <div className="mt-1 text-xs">
        {cv.agreed.length} agreed · {cv.resolved.length} corrected · {cv.recovered.length} omissions recovered · {cv.llmOnly.length} LLM-only (→ review)
        {cv.llmOutputRejected && <div className="mt-1 text-fail">LLM output failed strict validation and was replaced by the deterministic parse.</div>}
      </div>
      {cv.resolved.length > 0 && (
        <ul className="mt-2 space-y-1">
          {cv.resolved.slice(0, 12).map((r) => (
            <li key={r.id} className="text-[11px]">
              <span className="font-mono font-semibold">{r.id.length > 40 ? `${r.id.slice(0, 40)}…` : r.id}</span>
              {r.disagreements.map((d) => (
                <div key={d} className="ml-3 font-mono text-muted-foreground">
                  {d}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
