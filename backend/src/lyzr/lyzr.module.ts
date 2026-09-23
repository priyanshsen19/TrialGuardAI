import { Global, Module } from '@nestjs/common';
import { LyzrRuntimeService } from './lyzr-runtime.service';

@Global()
@Module({ providers: [LyzrRuntimeService], exports: [LyzrRuntimeService] })
export class LyzrModule {}
