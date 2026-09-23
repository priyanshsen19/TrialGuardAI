import { Injectable } from '@nestjs/common';
import type { CriterionEvaluation, DecisionOutcome, ResolvedCriterion, ResolvedFact, SafetyFlagRecord } from '@trialguard/agents';
import { decide } from './decision';
import { evaluateAll, RULE_ENGINE_VERSION, type EvalContext } from './evaluator';
import { deterministicSafetyChecks } from './safety-checks';

/** Nest wrapper around the pure rule engine (no Lyzr / no I/O dependencies). */
@Injectable()
export class RuleEngineService {
  readonly version = RULE_ENGINE_VERSION;

  evaluate(criteria: ResolvedCriterion[], facts: ResolvedFact[], ctx: EvalContext): CriterionEvaluation[] {
    return evaluateAll(criteria, facts, ctx);
  }

  decide(evaluations: CriterionEvaluation[], flags: SafetyFlagRecord[]): DecisionOutcome {
    return decide(evaluations, flags);
  }

  safetyChecks(input: Parameters<typeof deterministicSafetyChecks>[0]): SafetyFlagRecord[] {
    return deterministicSafetyChecks(input);
  }
}
