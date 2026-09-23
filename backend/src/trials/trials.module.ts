import { Module } from '@nestjs/common';
import { ProtocolsModule } from '../protocols/protocols.module';
import { TrialsController } from './trials.controller';
import { TrialsService } from './trials.service';

@Module({ imports: [ProtocolsModule], controllers: [TrialsController], providers: [TrialsService], exports: [TrialsService] })
export class TrialsModule {}
