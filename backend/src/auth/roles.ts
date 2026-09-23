import { SetMetadata } from '@nestjs/common';

export const ROLES = ['ADMIN', 'COORDINATOR', 'REVIEWER', 'AUDITOR'] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_DEFINITIONS: Record<RoleName, { description: string; permissions: string[] }> = {
  ADMIN: { description: 'Platform administrator', permissions: ['*'] },
  COORDINATOR: { description: 'Clinical research coordinator — manages trials, patients and screenings', permissions: ['trials:write', 'patients:write', 'screenings:write', 'read'] },
  REVIEWER: { description: 'Qualified investigator — adjudicates human-review tasks', permissions: ['review:write', 'read'] },
  AUDITOR: { description: 'Quality assurance / auditor — read-only with audit verification and exports', permissions: ['audit:read', 'read'] },
};

export const ROLES_KEY = 'roles';
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthUser {
  sub: string;
  email: string;
  role: RoleName;
  name: string;
}
