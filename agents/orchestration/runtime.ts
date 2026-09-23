/**
 * Factory that wires Environment → Client → Safe AI → Inference → Orchestrator.
 */
import { loadLyzrEnvironment, type LyzrEnvironmentConfig } from '../lyzr/environment';
import { LyzrInference, type InferenceCache, type TelemetryListener } from '../lyzr/inference';
import type { LyzrEventListener } from '../lyzr/client';
import { SafeAi } from '../lyzr/safe-ai';
import { TrialGuardOrchestrator } from './orchestrator';
import type { OrchestrationPorts } from './ports';

export function createAgentRuntime(
  ports: OrchestrationPorts,
  opts: { env?: NodeJS.ProcessEnv; config?: LyzrEnvironmentConfig; onTelemetry?: TelemetryListener; onClientEvent?: LyzrEventListener; cache?: InferenceCache } = {},
) {
  const config = opts.config ?? loadLyzrEnvironment(opts.env);
  const safeAi = new SafeAi(ports.phi.residualScanner);
  const inference = new LyzrInference(config, safeAi, { onClientEvent: opts.onClientEvent, cache: opts.cache });
  if (opts.onTelemetry) inference.onTelemetry(opts.onTelemetry);
  const orchestrator = new TrialGuardOrchestrator(inference, ports);
  return { config, safeAi, inference, orchestrator };
}
