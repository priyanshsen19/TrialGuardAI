import { Global, Module } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';

@Global()
@Module({ providers: [RuleEngineService], exports: [RuleEngineService] })
export class RuleEngineModule {}
