import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { userInfo } from 'node:os';

/**
 * Applies migrations (incl. append-only triggers) to the dedicated test database.
 * Non-destructive: test isolation is done by the integration suite through the
 * app's demo reset (DEMO_MODE only) against this test database.
 */
export default function setup() {
  if (process.env.SKIP_DB_TESTS === '1') return;
  const url = process.env.TEST_DATABASE_URL ?? `postgresql://${userInfo().username}@localhost:5432/trialguard_test`;
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '../backend'),
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
