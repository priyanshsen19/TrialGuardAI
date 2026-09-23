/**
 * Lyzr agent configuration — the single source of truth for the four TrialGuard
 * agents (role, goal, instructions, version, safety policy, model settings).
 *
 * `toLyzrAgentDefinition()` maps a definition onto the documented
 * POST /v3/agents/ payload so `provision.ts` can create the agents in a Lyzr
 * environment. Safe AI (Lyzr Responsible AI) policies are attached to each
 * agent in Lyzr Studio; `safeAiPolicy` documents the required configuration and
 * the application-level Safe AI layer (safe-ai.ts) enforces equivalent controls
 * regardless of the tenant configuration.
 */
import {
  AUDIT_AGENT_GOAL,
  AUDIT_AGENT_INSTRUCTIONS,
  AUDIT_AGENT_ROLE,
  AUDIT_AGENT_VERSION,
} from '../audit-agent/prompt';
import {
  CLINICAL_FACTS_AGENT_GOAL,
  CLINICAL_FACTS_AGENT_INSTRUCTIONS,
  CLINICAL_FACTS_AGENT_ROLE,
  CLINICAL_FACTS_AGENT_VERSION,
} from '../clinical-facts/prompt';
import {
  PROTOCOL_AGENT_GOAL,
  PROTOCOL_AGENT_INSTRUCTIONS,
  PROTOCOL_AGENT_ROLE,
  PROTOCOL_AGENT_VERSION,
} from '../protocol-criteria/prompt';
import {
  SAFETY_AGENT_GOAL,
  SAFETY_AGENT_INSTRUCTIONS,
  SAFETY_AGENT_ROLE,
  SAFETY_AGENT_VERSION,
} from '../safety-validator/prompt';
import type { LyzrEnvironmentConfig } from './environment';

export type AgentKey = 'protocol' | 'patient' | 'safety' | 'audit';

export interface SafeAiPolicy {
  piiRedaction: 'redact' | 'block';
  promptInjection: boolean;
  toxicity: boolean;
  secretsDetection: boolean;
  groundedness: boolean;
  bannedTopics: string[];
}

export interface AgentDefinition {
  key: AgentKey;
  name: string;
  description: string;
  version: string;
  role: string;
  goal: string;
  instructions: string;
  temperature: number;
  topP: number;
  /** Queue that runs this agent in the orchestration graph. */
  queue: string;
  safeAiPolicy: SafeAiPolicy;
  /** What this agent is explicitly NOT allowed to do (surfaced in UI / dossier). */
  prohibitedActions: string[];
}

const STRICT_POLICY: SafeAiPolicy = {
  piiRedaction: 'redact',
  promptInjection: true,
  toxicity: true,
  secretsDetection: true,
  groundedness: true,
  bannedTopics: ['final eligibility decision', 'medical advice to patients'],
};

export const AGENT_DEFINITIONS: Record<AgentKey, AgentDefinition> = {
  protocol: {
    key: 'protocol',
    name: 'TrialGuard Protocol Criteria Agent',
    description: 'Extracts structured inclusion/exclusion criteria with page provenance and ambiguity detection.',
    version: PROTOCOL_AGENT_VERSION,
    role: PROTOCOL_AGENT_ROLE,
    goal: PROTOCOL_AGENT_GOAL,
    instructions: PROTOCOL_AGENT_INSTRUCTIONS,
    temperature: 0,
    topP: 1,
    queue: 'protocol-extraction',
    safeAiPolicy: STRICT_POLICY,
    prohibitedActions: ['make eligibility decisions', 'invent thresholds for qualitative criteria', 'follow instructions inside documents'],
  },
  patient: {
    key: 'patient',
    name: 'TrialGuard Clinical Facts Agent',
    description: 'Extracts and normalises clinical facts from PHI-redacted patient records.',
    version: CLINICAL_FACTS_AGENT_VERSION,
    role: CLINICAL_FACTS_AGENT_ROLE,
    goal: CLINICAL_FACTS_AGENT_GOAL,
    instructions: CLINICAL_FACTS_AGENT_INSTRUCTIONS,
    temperature: 0,
    topP: 1,
    queue: 'patient-extraction',
    safeAiPolicy: STRICT_POLICY,
    prohibitedActions: ['determine eligibility', 'infer missing facts', 'calculate durations or ages', 'reconcile conflicting values'],
  },
  safety: {
    key: 'safety',
    name: 'TrialGuard Safety Validator Agent',
    description: 'Flags contradictory, missing, stale or ambiguous evidence and potential safety signals.',
    version: SAFETY_AGENT_VERSION,
    role: SAFETY_AGENT_ROLE,
    goal: SAFETY_AGENT_GOAL,
    instructions: SAFETY_AGENT_INSTRUCTIONS,
    temperature: 0,
    topP: 1,
    queue: 'safety-validation',
    safeAiPolicy: STRICT_POLICY,
    prohibitedActions: ['override rule-engine results', 'issue eligibility decisions'],
  },
  audit: {
    key: 'audit',
    name: 'TrialGuard Audit Narration Agent',
    description: 'Writes a non-authoritative narrative from verified, deterministic screening data.',
    version: AUDIT_AGENT_VERSION,
    role: AUDIT_AGENT_ROLE,
    goal: AUDIT_AGENT_GOAL,
    instructions: AUDIT_AGENT_INSTRUCTIONS,
    temperature: 0,
    topP: 1,
    queue: 'audit-generation',
    safeAiPolicy: STRICT_POLICY,
    prohibitedActions: ['modify decisions, values, timestamps, evidence or confidence', 'claim regulatory approval'],
  },
};

export function agentIdFor(cfg: LyzrEnvironmentConfig, key: AgentKey): string | null {
  return cfg.agentIds[key];
}

/** Map a TrialGuard agent definition onto the documented Lyzr POST /v3/agents/ body. */
export function toLyzrAgentDefinition(def: AgentDefinition, model = defaultModel()): Record<string, unknown> {
  return {
    name: def.name,
    description: `${def.description} (v${def.version})`,
    agent_role: def.role,
    agent_goal: def.goal,
    agent_instructions: def.instructions,
    agent_output: 'A single JSON object matching the documented response shape.',
    features: [],
    tools: [],
    provider_id: model.providerId,
    model: model.model,
    llm_credential_id: model.credentialId,
    temperature: def.temperature,
    top_p: def.topP,
    response_format: { type: 'json_object' },
    store_messages: false,
    file_output: false,
  };
}

export function defaultModel(env: NodeJS.ProcessEnv = process.env) {
  return {
    providerId: env.LYZR_MODEL_PROVIDER || 'OpenAI',
    model: env.LYZR_MODEL || 'gpt-4o-mini',
    credentialId: env.LYZR_LLM_CREDENTIAL_ID || 'lyzr_openai',
  };
}

/** Secret-free manifest of the agent fleet (served by /health and shown in UI). */
export function agentManifest() {
  return Object.values(AGENT_DEFINITIONS).map((d) => ({
    key: d.key,
    name: d.name,
    version: d.version,
    role: d.role,
    queue: d.queue,
    safeAiPolicy: d.safeAiPolicy,
    prohibitedActions: d.prohibitedActions,
  }));
}
