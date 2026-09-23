/**
 * MOCK MODE ONLY — deterministic narrative template standing in for the Lyzr
 * Audit Narration Agent. Also used as the guaranteed-safe fallback whenever a
 * live narrative fails the narrative guard.
 */
import type { AuditNarrative, VerifiedScreeningSummary } from '../contracts';

export function templateNarrative(s: VerifiedScreeningSummary): AuditNarrative {
  const keyPoints: string[] = [
    `Decision: ${s.decision} (deterministic rule engine), confidence ${s.confidencePct}%.`,
    `Criteria evaluated: ${s.counts.total} — PASS ${s.counts.pass}, FAIL ${s.counts.fail}, UNKNOWN ${s.counts.unknown}, NOT_APPLICABLE ${s.counts.notApplicable}.`,
  ];
  for (const f of s.failed) keyPoints.push(`${f.criterionId} failed: ${f.ruleExpression}.`);
  for (const u of s.unknown) keyPoints.push(`${u.criterionId} could not be determined: ${u.reason}`);
  if (s.safetyFlags.length) keyPoints.push(`Safety flags: ${s.safetyFlags.map((f) => `${f.code} (${f.severity})`).join(', ')}.`);
  if (s.review) keyPoints.push(`Human review recorded by ${s.review.reviewerRole}: ${s.review.outcome}.`);

  const why =
    s.decision === 'ELIGIBLE'
      ? 'All mandatory criteria passed with sufficient evidence and no blocking safety issues.'
      : s.decision === 'INELIGIBLE'
        ? 'At least one mandatory criterion failed deterministic evaluation.'
        : 'One or more criteria could not be determined automatically, so the case was routed to a qualified human reviewer.';
  return {
    summary: `Screening ${s.screeningId} of ${s.patientRef} against ${s.trialCode} (protocol ${s.protocolVersion}) resulted in ${s.decision}. ${why} This narrative is non-authoritative; the criterion table and audit chain are the record of truth.`,
    keyPoints: keyPoints.slice(0, 12),
  };
}
