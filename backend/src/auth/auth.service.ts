import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../common/errors';
import { loadConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password';
import { ROLE_DEFINITIONS, ROLES, type AuthUser, type RoleName } from './roles';

export const DEMO_USERS: Array<{ email: string; displayName: string; role: RoleName }> = [
  { email: 'admin@trialguard.demo', displayName: 'Avery Admin (demo)', role: 'ADMIN' },
  { email: 'coordinator@trialguard.demo', displayName: 'Casey Coordinator (demo)', role: 'COORDINATOR' },
  { email: 'reviewer@trialguard.demo', displayName: 'Dr. Riley Reviewer (demo)', role: 'REVIEWER' },
  { email: 'auditor@trialguard.demo', displayName: 'Jordan Auditor (demo)', role: 'AUDITOR' },
];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async ensureRolesAndDemoUsers() {
    for (const name of ROLES) {
      await this.prisma.role.upsert({
        where: { name },
        create: { name, description: ROLE_DEFINITIONS[name].description, permissions: ROLE_DEFINITIONS[name].permissions },
        update: { description: ROLE_DEFINITIONS[name].description, permissions: ROLE_DEFINITIONS[name].permissions },
      });
    }
    if (!loadConfig().demoMode) return;
    for (const u of DEMO_USERS) {
      const existing = await this.prisma.user.findUnique({ where: { email: u.email } });
      if (existing) continue;
      const role = await this.prisma.role.findUniqueOrThrow({ where: { name: u.role } });
      await this.prisma.user.create({ data: { email: u.email, displayName: u.displayName, roleId: role.id, passwordHash: await hashPassword(loadConfig().demoUserPassword) } });
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { role: true } });
    const ok = user?.active && (await verifyPassword(password, user.passwordHash));
    if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    const payload: AuthUser = { sub: user.id, email: user.email, role: user.role.name as RoleName, name: user.displayName };
    return {
      accessToken: await this.jwt.signAsync(payload),
      expiresIn: loadConfig().jwtTtlSeconds,
      user: { id: user.id, email: user.email, name: user.displayName, role: user.role.name, permissions: user.role.permissions },
    };
  }
}
