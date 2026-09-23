import { Global, Module } from '@nestjs/common';
import { PhiService } from './phi.service';

@Global()
@Module({ providers: [PhiService], exports: [PhiService] })
export class PhiModule {}
