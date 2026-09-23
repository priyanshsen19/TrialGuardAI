import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-pipe';
import { loadConfig } from '../config/config';
import { AuthService, DEMO_USERS } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { Public, type AuthUser } from './roles';

const LoginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).strict();

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // 30/min/IP: brute-force resistant, but the demo-role switcher (one login per switch) stays usable.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  login(@Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>) {
    return this.auth.login(body.email, body.password);
  }

  /** Demo accounts (emails and roles only — the password is documented in README / .env.example). */
  @Public()
  @Get('demo-accounts')
  demoAccounts() {
    return loadConfig().demoMode ? DEMO_USERS.map(({ email, role, displayName }) => ({ email, role, displayName })) : [];
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
