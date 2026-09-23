import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { DossierService } from './dossier.service';

@Global()
@Module({ controllers: [AuditController], providers: [AuditService, DossierService], exports: [AuditService, DossierService] })
export class AuditModule {}
