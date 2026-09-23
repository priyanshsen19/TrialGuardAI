import { Module } from '@nestjs/common';
import { ProtocolsService } from './protocols.service';

@Module({ providers: [ProtocolsService], exports: [ProtocolsService] })
export class ProtocolsModule {}
