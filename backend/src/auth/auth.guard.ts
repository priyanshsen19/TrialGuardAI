import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { currentContext } from '../common/request-context';
import { IS_PUBLIC_KEY, ROLES_KEY, type AuthUser, type RoleName } from './roles';

/** Global JWT authentication + role-based access control guard. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('UNAUTHENTICATED', 'Missing bearer token', 401);
    let user: AuthUser;
    try {
      user = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired token', 401);
    }
    req.user = user;
    const store = currentContext();
    if (store) {
      store.userId = user.sub;
      store.role = user.role;
    }
    const required = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, targets);
    if (required?.length && user.role !== 'ADMIN' && !required.includes(user.role)) {
      throw new AppError('FORBIDDEN', `Role ${user.role} is not permitted to perform this action (requires ${required.join(' or ')})`, 403);
    }
    return true;
  }
}
