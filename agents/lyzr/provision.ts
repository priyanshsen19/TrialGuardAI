/**
 * Provision the four TrialGuard agents in a Lyzr environment.
 *
 *   LYZR_API_KEY=... pnpm --filter @trialguard/agents build && pnpm --filter @trialguard/agents provision
 *
 * Prints the env lines to paste into .env. After provisioning, attach a Lyzr
 * Responsible AI policy (PII redaction, prompt-injection, toxicity) to each
 * agent in Lyzr Studio — see configuration.ts `safeAiPolicy`.
 */
import { LyzrClient } from './client';
import { AGENT_DEFINITIONS, toLyzrAgentDefinition, type AgentKey } from './configuration';
import { loadLyzrEnvironment } from './environment';

const ENV_NAMES: Record<AgentKey, string> = {
  protocol: 'LYZR_PROTOCOL_AGENT_ID',
  patient: 'LYZR_PATIENT_AGENT_ID',
  safety: 'LYZR_SAFETY_AGENT_ID',
  audit: 'LYZR_AUDIT_AGENT_ID',
};

async function main() {
  const cfg = loadLyzrEnvironment({ ...process.env, LYZR_MODE: 'mock' });
  if (!cfg.apiKey) {
    console.error('LYZR_API_KEY is required to provision agents.');
    process.exit(1);
  }
  const client = new LyzrClient(cfg);
  const lines: string[] = [];
  for (const def of Object.values(AGENT_DEFINITIONS)) {
    const { agentId } = await client.createAgent(toLyzrAgentDefinition(def));
    console.log(`created ${def.name} v${def.version} -> ${agentId}`);
    lines.push(`${ENV_NAMES[def.key]}=${agentId}`);
  }
  console.log('\nAdd to .env:\n' + lines.join('\n') + '\nLYZR_MODE=live');
}

main().catch((err) => {
  console.error('Provisioning failed:', err?.toJSON?.() ?? err?.message ?? err);
  process.exit(1);
});
