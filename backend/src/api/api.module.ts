import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { ProtocolsModule } from '../protocols/protocols.module';
import { ScreeningsModule } from '../screenings/screenings.module';
import { ApiController } from './api.controller';
import { DashboardService } from './dashboard.service';
import { DemoService } from './demo.service';

@Module({ imports: [ProtocolsModule, PatientsModule, ScreeningsModule], controllers: [ApiController], providers: [DemoService, DashboardService], exports: [DemoService] })
export class ApiModule {}
