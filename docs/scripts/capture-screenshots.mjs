// Captures README screenshots from a running stack (web :3000, api :4000).
// Usage: CHROME_PATH=/path/to/chrome pnpm docs:screenshots
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'TrialGuard!Demo2026';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = join(dirname(fileURLToPath(import.meta.url)), '../screenshots');
mkdirSync(out, { recursive: true });

const token = async (role) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${role}@trialguard.demo`, password: PASSWORD }) });
  return r.json();
};

const coordinator = await token('coordinator');
const screenings = await (await fetch(`${API}/screenings`, { headers: { authorization: `Bearer ${coordinator.accessToken}` } })).json();
const byPatient = (ref) => screenings.find((s) => s.patientRef === ref && s.screeningDate === '2026-09-23');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

async function as(role) {
  const s = await token(role);
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle0' });
  await page.evaluate((t, u) => {
    sessionStorage.setItem('tg.token', t);
    sessionStorage.setItem('tg.user', JSON.stringify(u));
  }, s.accessToken, s.user);
}

async function shot(path, file, { fullPage = false, wait = 1200 } = {}) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: join(out, file), fullPage });
  console.log('captured', file);
}

await as('coordinator');
await shot('/dashboard', 'dashboard.png');
await shot(`/screenings/${byPatient('PAT-004').id}`, 'screening.png', { fullPage: true });
await shot(`/screenings/${byPatient('PAT-002').id}`, 'screening-ineligible.png');
await shot('/trials', 'trials.png');
const trials = await (await fetch(`${API}/trials`, { headers: { authorization: `Bearer ${coordinator.accessToken}` } })).json();
await shot(`/trials/${trials.find((t) => t.code === 'CT-2026-001').id}`, 'trial-criteria.png', { fullPage: true });
await shot('/patients/PAT-003', 'patient-facts.png');
await as('reviewer');
await shot('/review', 'review.png');
await as('auditor');
await shot(`/audit/${byPatient('PAT-002').id}`, 'audit.png');
await browser.close();
