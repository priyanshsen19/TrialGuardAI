import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { loadConfig } from '../config/config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: loadConfig().jwtSecret, signOptions: { expiresIn: loadConfig().jwtTtlSeconds, issuer: 'trialguard-ai', audience: 'trialguard-ui' }, verifyOptions: { issuer: 'trialguard-ai', audience: 'trialguard-ui' } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
