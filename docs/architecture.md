# TrialGuard AI — architecture notes

## Dependency direction
```
frontend ──HTTP──► backend ──imports──► @trialguard/agents (Lyzr client, agents, orchestration)
                      ▲                           │
                      └────── ports (interfaces) ◄┘   PHI · ontology · rule engine · safety · decision · audit
```
`backend/src/rule-engine` never imports runtime code from `/agents` (type-only imports of shared contracts).

## Screening state machine
`QUEUED → RUNNING → COMPLETED | FAILED`; stages `ontology-validation → screening-evaluation → safety-validation → audit-generation → dossier-generation`,
each a BullMQ queue (or inline). `Screening.pipelineState.completedStages` makes re-delivered jobs no-ops.

## Data model (Prisma)
User, Role, Trial, Protocol, ProtocolVersion, ProtocolCriterion, Patient, PatientVersion, ClinicalFact, OntologyMapping,
Screening, CriterionEvaluation, SafetyFlag, ReviewTask, ReviewDecision, AuditEvent, AuditRoot, AuditDossier, Document,
LyzrExecution, PhiVaultEntry — see `backend/prisma/schema.prisma`.

## Audit chains
- `protocol:<protocolVersionId>` — upload, PHI redaction, agent invocation, criteria extraction, sealed root
- `patient:<patientVersionId>` — registration, PHI redaction, agent invocation, fact extraction, sealed root
- `<screeningId>` — binds both upstream roots + every evaluation, flag, decision, review, dossier
