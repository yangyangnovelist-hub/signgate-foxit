import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.SIGNGATE_BASE_URL ?? 'http://127.0.0.1:8787';
const runtimeDir = resolve(root, 'runtime');
const assetsDir = resolve(root, 'assets');

async function prepareAndApprove(page) {
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  await page.locator('#provenance-particles canvas').waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Prepare exact artifact' }).click();
  await page.locator('#paper:not([hidden])').waitFor({ timeout: 30_000 });
  await page.locator('[data-route-stage="approve"].is-active').waitFor({ timeout: 10_000 });
  const phrase = await page.locator('#required-phrase').innerText();
  assert.match(phrase, /^APPROVE /);
  await page.locator('#approval-phrase').fill(phrase);
  await page.locator('#attest-recipient').check();
  await page.locator('#attest-authority').check();
  await page.getByRole('button', { name: 'Issue one-shot approval' }).click();
  await page.locator('#send-button:enabled').waitFor({ timeout: 10_000 });
  await page.locator('[data-route-stage="send"].is-active').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('#seal-label').innerText(), 'APPROVED');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#scan-beam')).opacity === '0');
}

await mkdir(runtimeDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });
const consoleErrors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await prepareAndApprove(page);
  assert.match(await page.locator('#doc-title').innerText(), /Mutual/);
  assert.equal((await page.locator('#artifact-hash').innerText()).length, 64);
  assert.match(await page.locator('#artifact-mode').innerText(), /HTML PROOF \/ DEMO/);
  await page.getByRole('button', { name: 'Dispatch approved artifact' }).click();
  await page.waitForFunction(() => document.querySelector('#event-log')?.innerText.includes('sent no email'));
  assert.equal(await page.locator('#send-button').isDisabled(), true);
  assert.equal(await page.locator('#seal-label').innerText(), 'CONSUMED');
  assert.match(await page.locator('[data-route-stage="proof"]').getAttribute('class'), /is-active/);
  assert.ok(await page.locator('#prepare-button').evaluate((element) => element.getBoundingClientRect().height >= 44));
  await page.locator('.workspace').screenshot({ path: resolve(assetsDir, 'signgate-workspace.png') });
  await page.screenshot({ path: resolve(runtimeDir, 'e2e-desktop.png'), fullPage: true });

  await prepareAndApprove(page);
  await page.getByRole('button', { name: 'Change recipient, then try ↯' }).click();
  await page.waitForFunction(() => document.querySelector('#event-log')?.innerText.includes('EXPECTED HARD BLOCK'));
  assert.match(await page.locator('#event-log').innerText(), /APPROVAL_BINDING_BROKEN/);
  assert.match(await page.locator('#gate-result').innerText(), /ZERO PROVIDER CALLS/);
  assert.match(await page.locator('#provenance-board').getAttribute('class'), /is-alert/);
  await page.locator('.workspace').screenshot({ path: resolve(assetsDir, 'signgate-tamper-proof.png') });
  assert.equal(await page.locator('#audit-valid').innerText(), 'HASH CHAIN VALID');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1);

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const mobilePage = await mobile.newPage();
  mobilePage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  mobilePage.on('pageerror', (error) => consoleErrors.push(error.message));
  await mobilePage.goto(baseUrl);
  await mobilePage.waitForLoadState('networkidle');
  assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1);
  await mobilePage.screenshot({ path: resolve(runtimeDir, 'e2e-mobile.png'), fullPage: true });
  await mobilePage.screenshot({ path: resolve(assetsDir, 'signgate-mobile.png'), fullPage: false });

  const reduced = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const reducedPage = await reduced.newPage();
  reducedPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  reducedPage.on('pageerror', (error) => consoleErrors.push(error.message));
  await reducedPage.goto(baseUrl);
  await reducedPage.waitForLoadState('networkidle');
  assert.equal(await reducedPage.locator('#provenance-particles').evaluate((element) => getComputedStyle(element).display), 'none');
  assert.equal(await reducedPage.locator('#route-packet').evaluate((element) => getComputedStyle(element).display), 'none');
  assert.ok(await reducedPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1);

  await reduced.close();
  await mobile.close();
  await context.close();
} finally {
  await browser.close();
}

const unexpectedErrors = consoleErrors.filter((message) => !message.includes('409 (Conflict)'));
assert.deepEqual(unexpectedErrors, [], `browser console errors: ${unexpectedErrors.join(' | ')}`);
console.log('E2E PASS: prepare → approve → transparent simulation');
console.log('E2E PASS: post-approval recipient mutation → hard block');
console.log('E2E PASS: desktop/mobile layouts have no horizontal overflow');
console.log('E2E PASS: state-linked motion loads; reduced-motion disables ambient effects');
console.log(`Screenshots: ${resolve(runtimeDir, 'e2e-desktop.png')}, ${resolve(runtimeDir, 'e2e-mobile.png')}`);
