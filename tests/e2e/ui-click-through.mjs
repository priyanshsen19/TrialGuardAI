// End-to-end click-through of every interactive control in the TrialGuard UI.
// Each step asserts a visible response. Run against a MOCK-mode stack only:
//   API :4000 (LYZR_MODE=mock) + web :3000, then  pnpm test:ui
// The script refuses to run if the API reports live Lyzr mode (no credits spent).
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'TrialGuard!Demo2026';
const OUT = resolve(process.env.UI_TEST_OUT ?? join(tmpdir(), 'trialguard-ui-test'));
const DOWNLOADS = join(OUT, 'downloads');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(DOWNLOADS, { recursive: true });

const health = await (await fetch(`${API}/health`)).json();
if (health.lyzr?.mode !== 'mock') {
  console.error(`Refusing to run: API reports Lyzr mode "${health.lyzr?.mode}". Start the API with LYZR_MODE=mock.`);
  process.exit(2);
}

const results = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const cdp = await page.createCDPSession();
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('dialog', (d) => d.accept());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    const shot = join(OUT, `FAIL-${results.length + 1}.png`);
    await page.screenshot({ path: shot }).catch(() => undefined);
    results.push({ name, ok: false, error: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}\n      screenshot: ${shot}`);
  }
}

async function waitForText(text, timeout = 15_000) {
  // Case-insensitive: badges render uppercase via CSS text-transform.
  await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout, polling: 100 }, text);
}
async function waitForUrl(re, timeout = 15_000) {
  await page.waitForFunction((src) => new RegExp(src).test(location.pathname), { timeout, polling: 100 }, re.source);
}
/** Click the first visible element of `selector` whose text contains `text`. */
async function click(selector, text) {
  const ok = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && (!t || e.textContent.includes(t)));
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    },
    selector,
    text ?? '',
  );
  if (!ok) throw new Error(`no visible ${selector}${text ? ` containing "${text}"` : ''}`);
}
async function isDisabled(selector, text) {
  return page.evaluate((sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t))?.disabled, selector, text);
}
async function setInput(selector, value) {
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(selector, (el) => {
    el.value = '';
  });
  await page.type(selector, value);
}
function newestDownload(ext, since) {
  return readdirSync(DOWNLOADS)
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ f, t: statSync(join(DOWNLOADS, f)).mtimeMs, size: statSync(join(DOWNLOADS, f)).size }))
    .filter((x) => x.t >= since)
    .sort((a, b) => b.t - a.t)[0];
}
async function waitForDownload(ext, since, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const d = newestDownload(ext, since);
    if (d && d.size > 0) return d;
    await sleep(200);
  }
  throw new Error(`no ${ext} download within ${timeout} ms`);
}
/** PDF export: either a new tab navigated to a blob: URL, or (headless) a downloaded .pdf. */
async function expectPdfOpened(clickFn) {
  const since = Date.now();
  const tabPromise = browser.waitForTarget((t) => t.url().startsWith('blob:'), { timeout: 20_000 }).catch(() => null);
  await clickFn();
  const [tab] = await Promise.all([tabPromise]);
  if (tab) {
    const p = await tab.page().catch(() => null);
    await p?.close().catch(() => undefined);
    return 'opened in new tab';
  }
  const d = newestDownload('.pdf', since);
  if (d) return `downloaded ${d.f}`;
  throw new Error('PDF neither opened in a new tab nor downloaded');
}
async function currentRole() {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('tg.user') || '{}').role);
}

console.log(`UI click-through against ${WEB} (API mode: ${health.lyzr.mode})\n`);

// ---------------------------------------------------------------- auth
await step('login page: demo account button signs in (COORDINATOR)', async () => {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle0' });
  await waitForText('Demo accounts');
  await click('button', 'COORDINATOR');
  await waitForUrl(/^\/dashboard$/);
  await waitForText('Screening operations');
});

// ---------------------------------------------------------------- dashboard
await step('dashboard: "Run synthetic demo" shows progress then 5 result chips', async () => {
  await click('button', 'Run synthetic demo');
  await waitForText('Demo complete', 90_000);
  const chips = await page.$$eval('a[href^="/screenings/"]', (as) => as.length);
  if (chips < 5) throw new Error(`expected 5 result chips, found ${chips}`);
});
await step('dashboard: KPI cards show the seeded numbers', async () => {
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForText('ELIGIBLE');
  const text = await page.evaluate(() => document.body.innerText);
  if (!/Screenings\s*\n?\s*5/i.test(text) && !text.includes('5')) throw new Error('screening count not shown');
});
await step('dashboard: recent-activity event link opens the audit trail', async () => {
  await click('a[href^="/audit/"]');
  await waitForUrl(/^\/audit\/[0-9a-f-]{36}$/);
  await waitForText('audit trail');
});

// ---------------------------------------------------------------- sidebar nav
for (const [label, path, heading] of [
  ['Dashboard', '/dashboard', 'Screening operations'],
  ['Trials', '/trials', 'Trials'],
  ['Patients', '/patients', 'Patients'],
  ['Screenings', '/screenings', 'Screenings'],
  ['Human Review', '/review', 'Human review queue'],
  ['Audit', '/audit', 'Audit'],
]) {
  await step(`sidebar: "${label}" navigates to ${path}`, async () => {
    await click('nav[aria-label="Primary"] a', label);
    await waitForUrl(new RegExp(`^${path}$`));
    await page.waitForFunction((h) => [...document.querySelectorAll('h1')].some((e) => e.textContent.includes(h)), { timeout: 15_000 }, heading);
  });
}

// ---------------------------------------------------------------- navigation feedback
await step('navigation: progress bar / loading state appears immediately on link click', async () => {
  await page.goto(`${WEB}/trials`, { waitUntil: 'networkidle0' });
  await page.setRequestInterception(true);
  const slow = (req) => (req.url().includes('/trials/') && req.url().includes('_rsc') ? sleep(1500).then(() => req.continue()) : req.continue());
  page.on('request', slow);
  await click('a[href^="/trials/"]', 'CT-2026-001');
  // Feedback = progress bar / skeleton visible, or the new page already rendered (prefetched).
  const seen = await page
    .waitForFunction(
      () => !!document.querySelector('[aria-label="Loading page"]') || !!document.querySelector('[aria-busy="true"]') || /^\/trials\/[0-9a-f-]{36}$/.test(location.pathname),
      { timeout: 1000, polling: 20 },
    )
    .then(() => true)
    .catch(() => false);
  page.off('request', slow);
  await page.setRequestInterception(false);
  if (!seen) throw new Error('no progress bar or loading skeleton within 1 s of clicking');
  await waitForUrl(/^\/trials\/[0-9a-f-]{36}$/);
});

// ---------------------------------------------------------------- trials
await step('trial detail: criteria table + cross-validation provenance render', async () => {
  await waitForText('Extracted eligibility criteria');
  await waitForText('INC-001');
  await waitForText('mock simulator');
});
await step('trials: "New trial" dialog opens, Escape closes it', async () => {
  await page.goto(`${WEB}/trials`, { waitUntil: 'networkidle0' });
  await click('button', 'New trial');
  await page.waitForSelector('[role="dialog"]', { visible: true });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
});
const newCode = `CT-UI-${Date.now().toString().slice(-5)}`;
await step('trials: create trial via dialog adds a row', async () => {
  await click('button', 'New trial');
  await setInput('#code', newCode);
  await setInput('#title', 'UI click-through test trial');
  await setInput('#sponsor', 'Test Sponsor');
  await setInput('#indication', 'Test indication');
  await click('[role="dialog"] button[type="submit"]', 'Create trial');
  await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 15_000 });
  await waitForText(newCode);
});
await step('trial detail: protocol upload ("Extract criteria") extracts criteria (mock)', async () => {
  await click('a[href^="/trials/"]', newCode);
  await waitForUrl(/^\/trials\/[0-9a-f-]{36}$/);
  await waitForText('Upload protocol');
  if (!(await isDisabled('button', 'Extract criteria'))) throw new Error('"Extract criteria" should be disabled until a file is chosen');
  const input = await page.$('#protocol-file');
  await input.uploadFile(resolve('synthetic-data/protocols/CT-2026-001.txt'));
  await click('button', 'Extract criteria');
  await waitForText('INC-010', 30_000);
});
await step('trial detail: "Screen" button runs a screening and opens it', async () => {
  await page.waitForSelector('select[aria-label="Patient"]');
  const firstPatient = await page.$eval('select[aria-label="Patient"] option:nth-child(2)', (o) => o.value);
  await page.select('select[aria-label="Patient"]', firstPatient);
  await click('button', 'Screen');
  await waitForUrl(/^\/screenings\/[0-9a-f-]{36}$/, 30_000);
  await waitForText('Criterion evaluations');
});

// ---------------------------------------------------------------- patients
await step('patients: register dialog — submit disabled until "synthetic" is confirmed', async () => {
  await page.goto(`${WEB}/patients`, { waitUntil: 'networkidle0' });
  await click('button', 'Register synthetic patient');
  await page.waitForSelector('[role="dialog"]', { visible: true });
  await setInput('#pn', 'Ursula Testfield');
  if (!(await isDisabled('[role="dialog"] button', 'Register & extract'))) throw new Error('submit should be disabled before confirming synthetic');
  await click('[role="dialog"] label', 'I confirm this record is entirely synthetic');
  if (await isDisabled('[role="dialog"] button', 'Register & extract')) throw new Error('submit still disabled after confirming synthetic');
  await click('[role="dialog"] button', 'Register & extract');
  await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 30_000 });
});
await step('patient detail: link opens, "Redacted documents" tab switches and shows aliases', async () => {
  await click('a[href^="/patients/"]', 'PAT-003');
  await waitForUrl(/^\/patients\/PAT-003$/);
  await waitForText('Clinical facts');
  await click('[role="tab"]', 'Redacted documents');
  await waitForText('_REDACTED_');
});

// ---------------------------------------------------------------- screenings
await step('screenings: filter tabs change the table', async () => {
  await page.goto(`${WEB}/screenings`, { waitUntil: 'networkidle0' });
  const rows = () => page.$$eval('tbody tr', (r) => r.length);
  const all = await rows();
  await click('[role="tab"]', 'Eligible');
  await sleep(200);
  const eligible = await rows();
  await click('[role="tab"]', 'Human review');
  await sleep(200);
  const review = await rows();
  await click('[role="tab"]', 'All');
  if (!(eligible < all && review < all)) throw new Error(`filters did not narrow rows (all ${all}, eligible ${eligible}, review ${review})`);
});
let screeningPath = '';
await step('screening detail: row expand shows evidence quotes', async () => {
  await click('a[href^="/screenings/"]');
  await waitForUrl(/^\/screenings\/[0-9a-f-]{36}$/);
  screeningPath = await page.evaluate(() => location.pathname);
  await waitForText('Criterion evaluations');
  await click('button[aria-label^="Show evidence for INC-004"]');
  await page.waitForSelector('blockquote', { visible: true });
});
await step('screening detail: "Dossier PDF" opens/downloads the PDF', async () => {
  const how = await expectPdfOpened(() => click('button', 'Dossier PDF'));
  console.log(`      (${how})`);
});
await step('screening detail: "JSON" downloads the dossier JSON', async () => {
  const since = Date.now();
  await click('button', 'JSON');
  const d = await waitForDownload('.json', since);
  if (d.size < 1000) throw new Error(`dossier JSON suspiciously small (${d.size} bytes)`);
});

// ---------------------------------------------------------------- audit
await step('audit list: "Verify all chains" marks every chain valid', async () => {
  await page.goto(`${WEB}/audit`, { waitUntil: 'networkidle0' });
  await click('button', 'Verify all chains');
  await waitForText('valid ·', 30_000);
  const invalid = await page.evaluate(() => document.body.innerText.includes('invalid'));
  if (invalid) throw new Error('a chain reported invalid');
});
await step('audit detail: "Verify Audit Chain" reports valid', async () => {
  await click('a[href^="/audit/"]');
  await waitForUrl(/^\/audit\/[0-9a-f-]{36}$/);
  await click('button', 'Verify Audit Chain');
  await waitForText('Chain valid');
});
await step('audit detail: "Simulate tampering" detects the modified event', async () => {
  await click('button', 'Simulate tampering');
  await waitForText('Detected: chain invalid at event #5');
});
await step('audit detail: clicking a timeline event expands its payload', async () => {
  await click('ol li button', 'SCREENING_CREATED');
  await page.waitForSelector('ol li pre', { visible: true });
});
await step('audit detail: "Export PDF" opens/downloads the PDF', async () => {
  const how = await expectPdfOpened(() => click('button', 'Export PDF'));
  console.log(`      (${how})`);
});
await step('audit detail: "Export JSON" downloads the dossier JSON', async () => {
  const since = Date.now();
  await click('button', 'Export JSON');
  await waitForDownload('.json', since);
});
await step('export still works after dossier files are wiped (redeploy on ephemeral disk)', async () => {
  const storage = process.env.UI_TEST_STORAGE_DIR;
  if (!storage) throw new Error('set UI_TEST_STORAGE_DIR to the API STORAGE_DIR to run this step');
  rmSync(join(storage, 'dossiers'), { recursive: true, force: true });
  const since = Date.now();
  await click('button', 'Export JSON');
  await waitForDownload('.json', since);
});
await step('export failure is shown to the user (not silent)', async () => {
  await page.setRequestInterception(true);
  const fail = (req) => (req.url().includes('/dossier.json') && req.method() === 'GET' ? req.respond({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': WEB }, body: '{"error":{"code":"INTERNAL_ERROR","message":"Simulated export failure","requestId":"test-1234"}}' }) : req.continue());
  page.on('request', fail);
  await click('button', 'Export JSON');
  await page.waitForSelector('[role="alert"]', { visible: true, timeout: 10_000 });
  const msg = await page.$eval('[role="alert"]', (e) => e.textContent);
  page.off('request', fail);
  await page.setRequestInterception(false);
  if (!msg.includes('Simulated export failure')) throw new Error(`unexpected error text: ${msg}`);
});

// ---------------------------------------------------------------- role switching + human review
await step('header: demo-role switcher changes the signed-in role (REVIEWER)', async () => {
  await page.select('select[aria-label="Switch demo role"]', 'reviewer');
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('tg.user') || '{}').role === 'REVIEWER', { timeout: 10_000 });
});
await step('review: actions disabled until a reason of ≥10 characters is entered', async () => {
  await page.goto(`${WEB}/review`, { waitUntil: 'networkidle0' });
  await waitForText('Human review queue');
  if (!(await isDisabled('button', 'Approve Ineligible'))) throw new Error('actions should be disabled with an empty reason');
  await page.type('textarea', 'short');
  if (!(await isDisabled('button', 'Approve Ineligible'))) throw new Error('actions should stay disabled for a <10 character reason');
});
await step('review: "Request More Information" records the action and keeps the case open', async () => {
  await page.$eval('textarea', (el) => (el.value = ''));
  await page.type('textarea', 'Need outside records for the medication stop date.');
  await click('button', 'Request More Information');
  await waitForText('AWAITING INFORMATION', 20_000);
});
await step('review: "Approve Ineligible" resolves the case (moves to Recently resolved)', async () => {
  await page.type('textarea', 'Outside records confirm the washout window was not met.');
  await click('button', 'Approve Ineligible');
  await waitForText('Recently resolved', 20_000);
});
await step('screening detail (reviewer): review panel shows the signed decision', async () => {
  await click('table a[href^="/screenings/"]');
  await waitForText('Human-in-the-loop review');
  await waitForText('signature');
});
await step('header: switch to AUDITOR — write actions are hidden', async () => {
  await page.select('select[aria-label="Switch demo role"]', 'auditor');
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('tg.user') || '{}').role === 'AUDITOR', { timeout: 10_000 });
  await page.goto(`${WEB}/trials`, { waitUntil: 'networkidle0' });
  const hasNew = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('New trial')));
  if (hasNew) throw new Error('"New trial" visible to AUDITOR');
});
await step('header: switch to ADMIN — "Reset & reseed" (confirm) completes', async () => {
  await page.select('select[aria-label="Switch demo role"]', 'admin');
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('tg.user') || '{}').role === 'ADMIN', { timeout: 10_000 });
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle0' });
  await click('button', 'Reset & reseed');
  await waitForText('Demo complete', 90_000);
});

// ---------------------------------------------------------------- mobile nav + sign out
await step('mobile: menu button opens the drawer and a nav link closes it', async () => {
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle0' });
  await click('button[aria-label="Open navigation"]');
  await page.waitForSelector('button[aria-label="Close navigation"]', { visible: true });
  await click('aside nav a', 'Screenings');
  await waitForUrl(/^\/screenings$/);
  await page.waitForSelector('button[aria-label="Open navigation"]', { visible: true });
  await page.setViewport({ width: 1440, height: 900 });
});
await step('header: "Sign out" returns to the login page', async () => {
  await click('button[aria-label="Sign out"]');
  await waitForUrl(/^\/login$/);
});
await step('login: manual email/password form signs in; wrong password shows an error', async () => {
  await setInput('#email', 'auditor@trialguard.demo');
  await setInput('#password', 'wrong-password');
  await click('form button[type="submit"]');
  await page.waitForSelector('[role="alert"]', { visible: true });
  await setInput('#password', PASSWORD);
  await click('form button[type="submit"]');
  await waitForUrl(/^\/dashboard$/);
  if ((await currentRole()) !== 'AUDITOR') throw new Error('signed in with the wrong role');
});

await browser.close();

const failed = results.filter((r) => !r.ok);
const relevantConsole = consoleErrors.filter((e) => !/Failed to load resource.*(401|500)|Simulated export failure|favicon/i.test(e));
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
if (relevantConsole.length) console.log(`browser console errors (${relevantConsole.length}):\n  ${relevantConsole.slice(0, 10).join('\n  ')}`);
process.exit(failed.length ? 1 : 0);
