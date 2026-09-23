/**
 * Push the current agent definitions (role, goal, instructions, model settings)
 * to the EXISTING Lyzr agents configured in the environment, then read them
 * back to verify. Agent definitions are code; Lyzr is kept in sync with it.
 *
 *   pnpm --filter @trialguard/agents build && pnpm --filter @trialguard/agents sync
 */
import { createHash } from 'node:crypto';
import { LyzrClient } from './client';
import { AGENT_DEFINITIONS, toLyzrAgentDefinition, type AgentKey } from './configuration';
import { loadLyzrEnvironment } from './environment';

const h = (s: unknown) => createHash('sha256').update(String(s ?? '')).digest('hex').slice(0, 12);

async function main() {
  const cfg = loadLyzrEnvironment({ ...process.env, LYZR_MODE: 'mock' });
  if (!cfg.apiKey) throw new Error('LYZR_API_KEY is required');
  const client = new LyzrClient(cfg);
  let failures = 0;
  for (const def of Object.values(AGENT_DEFINITIONS)) {
    const id = cfg.agentIds[def.key as AgentKey];
    if (!id) {
      console.log(`skip ${def.key}: no agent id configured`);
      continue;
    }
    const body = toLyzrAgentDefinition(def);
    await client.updateAgent(id, body);
    const remote = await client.getAgent(id);
    const ok = remote.agent_instructions === body.agent_instructions;
    if (!ok) failures++;
    console.log(`${ok ? 'synced ' : 'MISMATCH'} ${def.name} v${def.version} -> ${id} (instructions ${h(body.agent_instructions)} / remote ${h(remote.agent_instructions)})`);
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('Sync failed:', err?.toJSON?.() ?? err?.message ?? err);
  process.exit(1);
});
