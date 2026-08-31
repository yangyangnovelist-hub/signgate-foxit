import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const outputDir = 'video/build/browser';
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } },
  colorScheme: 'light',
});
const page = await context.newPage();
const video = page.video();

const pause = (seconds) => page.waitForTimeout(seconds * 1000);
const moveTo = async (selector, index = 0) => {
  const box = await page.locator(selector).nth(index).boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
  }
};
const prepare = async () => {
  await page.locator('#prepare-button').click();
  await page.locator('#approval-phrase:not([disabled])').waitFor();
};
const approve = async () => {
  const phrase = (await page.locator('#required-phrase').textContent())?.trim();
  if (!phrase?.startsWith('APPROVE ')) throw new Error('Approval phrase was not rendered');
  await page.locator('#approval-phrase').fill(phrase);
  await page.locator('#attest-recipient').check();
  await page.locator('#attest-authority').check();
  await page.locator('#approve-button').click();
  await page.locator('#send-button:not([disabled])').waitFor();
};

const demoUrl = process.env.SIGNGATE_DEMO_URL || 'https://signgate-foxit-production.up.railway.app/';
const proofUrl = 'https://github.com/yangyangnovelist-hub/signgate-foxit/blob/main/docs/evidence/foxit-live-proof.md';

await page.goto(demoUrl, { waitUntil: 'networkidle' });
await page.getByText('Transparent demo · no external send').waitFor();
await moveTo('#case-title');
await pause(11);

await page.locator('#brief-form').scrollIntoViewIfNeeded();
await moveTo('#prepare-button');
await pause(8);

await prepare();
await page.locator('#paper-wrap').scrollIntoViewIfNeeded();
await moveTo('#artifact-hash');
await pause(12);

await page.locator('#risk-stack').scrollIntoViewIfNeeded();
await moveTo('.risk.critical');
await pause(10);

await approve();
await moveTo('#approval-seal');
await pause(8);

await page.locator('#tamper-button').click();
await page.getByText(/EXPECTED HARD BLOCK · APPROVAL_BINDING_BROKEN · ZERO PROVIDER CALLS/).waitFor();
await moveTo('#gate-result');
await pause(14);

await page.reload({ waitUntil: 'networkidle' });
await page.getByText('Transparent demo · no external send').waitFor();
await prepare();
await page.locator('#approval-box').scrollIntoViewIfNeeded();
await approve();
await page.locator('#send-button').click();
await page.getByText('DEMO CLOSED · APPROVAL CONSUMED · NO EMAIL SENT').waitFor();
await moveTo('#gate-result');
await pause(14);

await page.locator('.evidence-section').scrollIntoViewIfNeeded();
await moveTo('.evidence-ledger article:nth-child(1)');
await pause(12);

await page.locator('.console-section').scrollIntoViewIfNeeded();
await moveTo('#event-log li:first-child');
await pause(7);

await page.goto(proofUrl, { waitUntil: 'domcontentloaded' });
await page.locator('article.markdown-body').waitFor({ timeout: 20_000 });
await page.locator('article.markdown-body h1').scrollIntoViewIfNeeded();
await pause(8);

await page.getByRole('heading', { name: 'Provider lifecycle' }).scrollIntoViewIfNeeded();
await moveTo('article.markdown-body table');
await pause(14);

await page.getByRole('heading', { name: 'Final PDF verification' }).scrollIntoViewIfNeeded();
await moveTo('article.markdown-body table', 1);
await pause(13);

await page.getByRole('heading', { name: 'Scope boundary' }).scrollIntoViewIfNeeded();
await moveTo('article.markdown-body h2:last-of-type');
await pause(8);

await page.close();
await context.close();
console.log(await video.path());
await browser.close();
