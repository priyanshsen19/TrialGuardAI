import { resolve } from 'node:path';
import { userInfo } from 'node:os';
import { tmpdir } from 'node:os';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const root = resolve(__dirname, '..');

export default defineConfig({
  root,
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } })],
  resolve: { alias: { '@trialguard/agents': resolve(root, 'agents/index.ts') } },
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgresql://${userInfo().username}@localhost:5432/trialguard_test`,
      QUEUE_MODE: 'inline',
      REDIS_URL: '',
      LYZR_MODE: 'mock',
      // Hermetic: Prisma Client auto-loads backend/.env into process.env, so pin
      // every Lyzr variable to empty — tests must never see real credentials or
      // make live (billed) calls.
      LYZR_API_KEY: '',
      LYZR_ENVIRONMENT_ID: '',
      LYZR_PROTOCOL_AGENT_ID: '',
      LYZR_PATIENT_AGENT_ID: '',
      LYZR_SAFETY_AGENT_ID: '',
      LYZR_AUDIT_AGENT_ID: '',
      LYZR_AIMS_ENABLED: 'false',
      JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789abcdef',
      ENCRYPTION_MASTER_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      STORAGE_DIR: resolve(tmpdir(), `trialguard-test-storage-${process.pid}`),
      DEMO_MODE: 'true',
      DEMO_USER_PASSWORD: 'TrialGuard!Demo2026',
      LOG_LEVEL: 'error',
      RATE_LIMIT_PER_MINUTE: '100000',
      SYNTHETIC_DATA_DIR: resolve(root, 'synthetic-data'),
    },
  },
});
