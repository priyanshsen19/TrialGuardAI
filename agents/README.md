# /agents — Lyzr agents, Safe AI and orchestration

This package (`@trialguard/agents`) contains **everything Lyzr-specific** in TrialGuard AI.

```
agents/
├── contracts/            strict zod schemas for every agent input/output (+ rule-engine result types)
├── lyzr/
│   ├── environment.ts    Lyzr Environment: env loading/validation, mock|live, secret-free description
│   ├── client.ts         Lyzr Agent API client: POST /v3/inference/chat/, POST /v3/agents/, GET /v3/agents/{id},
│   │                     redacted-asset upload, timeouts, retries w/ backoff+jitter, structured LyzrError, runtime events
│   ├── configuration.ts  agent definitions (role/goal/instructions/version/temperature/queue/Safe AI policy/prohibited actions)
│   │                     + mapping to the documented POST /v3/agents/ payload
│   ├── inference.ts      single inference gateway: Safe AI pre-flight → Lyzr (live) or simulator (mock) → PHI-free telemetry (AIMS)
│   ├── safe-ai.ts        Safe AI: residual-PHI/secret blocking, prompt-injection detection, strict parsing, verbatim grounding, narrative guard
│   ├── prompt-guard.ts   untrusted-data clause + <untrusted_document> envelope
│   ├── provision.ts      creates the 4 agents in your Lyzr environment and prints their IDs
│   └── print-manifest.ts prints the agent manifest (incl. recommended Lyzr RAI policy)
├── protocol-criteria/    Protocol Criteria Agent (prompt, agent, mock simulator)
├── clinical-facts/       Clinical Facts Agent (prompt, agent, mock simulator)
├── safety-validator/     Safety Validator Agent (prompt, agent, mock simulator)
├── audit-agent/          Audit Narration Agent (prompt, agent, deterministic template/fallback)
└── orchestration/
    ├── ports.ts          interfaces the backend implements (PHI, ontology, rule engine, safety, decision, audit)
    ├── orchestrator.ts   TrialGuardOrchestrator: ingestion pipelines + screening stage graph (queue-aligned, idempotent)
    └── runtime.ts        createAgentRuntime(): Environment → Client → Safe AI → Inference → Orchestrator
```

## Principles
1. **No agent decides eligibility.** Agents extract, normalise, flag and narrate; the backend rule engine decides.
2. **Every document is untrusted data** — stated verbatim in all agent instructions and enforced by envelopes + strict schemas.
3. **Nothing un-redacted leaves the process** — Safe AI pre-flight blocks residual PHI/secrets before any HTTP call.
4. **Nothing ungrounded enters the pipeline** — extracted items must quote the source verbatim with matching numbers/dates.
5. **Mock ≠ Lyzr** — simulators are labelled `provider: "mock"` everywhere (telemetry, audit, UI, dossier).

## Commands
```bash
pnpm --filter @trialguard/agents build
LYZR_API_KEY=... pnpm --filter @trialguard/agents provision   # create agents in Lyzr
pnpm --filter @trialguard/agents manifest                      # print agent manifest + Safe AI policies
```
