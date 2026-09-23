import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiModule } from './api/api.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { GlobalExceptionFilter } from './common/errors';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { loadConfig } from './config/config';
import { HealthModule } from './health/health.module';
import { LyzrModule } from './lyzr/lyzr.module';
import { OntologyModule } from './ontology/ontology.module';
import { PatientsModule } from './patients/patients.module';
import { PhiModule } from './phi/phi.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProtocolsModule } from './protocols/protocols.module';
import { QueueModule } from './queue/queue.module';
import { RuleEngineModule } from './rule-engine/rule-engine.module';
import { ScreeningsModule } from './screenings/screenings.module';
import { StorageModule } from './storage/storage.module';
import { TrialsModule } from './trials/trials.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: loadConfig().rateLimitPerMinute }]),
    PrismaModule,
    StorageModule,
    QueueModule,
    PhiModule,
    OntologyModule,
    RuleEngineModule,
    AuditModule,
    LyzrModule,
    AuthModule,
    TrialsModule,
    ProtocolsModule,
    PatientsModule,
    ScreeningsModule,
    ApiModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
