const { chromium } = require('playwright');
const path = require('node:path');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = process.env.SMYL_PREVIEW_URL || `file:///${path.resolve(__dirname, 'fixtures/smyl-radiograph-workbench-preview.html').replace(/\\/g, '/')}`;

const visibleCount = locator => locator.evaluateAll(elements => elements.filter(element => element.getClientRects().length > 0).length);

async function openSignals(page) {
  await page.goto(base);
  await page.locator('#open').click();
  await page.locator('.rr-dialog[open] .rr-image-check-workspace').waitFor();
  await page.getByRole('button', { name: 'Revisar 3 señales', exact: true }).click();
  await page.locator('.rr-signal-panel').waitFor();
}

async function activeSignal(page) {
  return page.locator('.rr-item[aria-current="true"]').evaluate(item => ({
    id: item.dataset.rrItem,
    number: item.querySelector('.rr-number')?.textContent?.trim() || '',
    tooth: item.querySelector('.rr-tooth-current')?.textContent?.match(/\d{2}/)?.[0]
      || item.querySelector('.rr-item-location')?.textContent?.match(/\d{2}/)?.[0]
      || ''
  }));
}

async function assertFreshSessionsShareCursor(browser) {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await Promise.all([openSignals(desktop), openSignals(mobile)]);
    const [desktopActive, mobileActive] = await Promise.all([activeSignal(desktop), activeSignal(mobile)]);
    if (!desktopActive.id || !desktopActive.tooth) throw new Error(`Desktop did not expose an active signal identity: ${JSON.stringify(desktopActive)}`);
    if (JSON.stringify(desktopActive) !== JSON.stringify(mobileActive)) {
      throw new Error(`Fresh desktop and mobile sessions started on different signals: ${JSON.stringify({ desktopActive, mobileActive })}`);
    }
    const context = {
      marks: await visibleCount(mobile.locator('.rr-image-stage > .rr-mark.is-context')),
      boxes: await visibleCount(mobile.locator('.rr-image-stage > .rr-box.is-context'))
    };
    if (context.marks < 1) throw new Error(`Mobile must preserve a visible marker for every located non-active signal: ${JSON.stringify(context)}`);
  } finally {
    await Promise.all([desktop.close(), mobile.close()]);
  }
}

async function assertZoomControls(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openSignals(page);
    const controls = page.locator('.rr-zoom-quick');
    await controls.waitFor({ state: 'visible' });
    const zoomOut = controls.getByRole('button', { name: 'Alejar radiografía', exact: true });
    const zoomIn = controls.getByRole('button', { name: 'Ampliar radiografía', exact: true });
    const fit = controls.getByRole('button', { name: 'Ajustar', exact: true });
    const percentage = controls.getByText(/^\d+%$/).first();
    for (const [name, locator] of [['−', zoomOut], ['+', zoomIn], ['porcentaje', percentage], ['Ajustar', fit]]) {
      if (!await locator.isVisible()) throw new Error(`The visible zoom toolbar is missing ${name}`);
    }
    const initial = (await percentage.textContent()).trim();
    await zoomIn.click();
    await page.waitForFunction(value => Array.from(document.querySelectorAll('.rr-zoom-quick *')).some(element => /^\d+%$/.test(element.textContent?.trim() || '') && element.textContent.trim() !== value), initial);
    if (!await page.locator('.rr-image-wrap').evaluate(element => element.classList.contains('is-zoomed'))) throw new Error('The + control did not zoom the radiograph');
    await zoomOut.click();
    await fit.click();
    if ((await percentage.textContent()).trim() !== '100%') throw new Error('Ajustar did not restore 100%');
    if (await page.locator('.rr-image-wrap').evaluate(element => element.classList.contains('is-zoomed'))) throw new Error('Ajustar left the radiograph in a zoomed state');
  } finally {
    await page.close();
  }
}

async function setRemoteTooth(page, tooth) {
  return page.evaluate(value => {
    const document = structuredClone(window.__reviewRemoteRow.document);
    document.items[0].tooth = value;
    return window.__setReviewRemoteRow({ document });
  }, tooth);
}

async function assertPassiveRemoteRefresh(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  try {
    await openSignals(page);
    const before = await page.evaluate(() => ({ loads: window.__reviewLoads, revision: window.__reviewRemoteRow.revision }));
    await setRemoteTooth(page, '47');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('.rr-item[aria-current="true"] .rr-tooth-current')?.textContent.includes('47'));
    const focused = await page.evaluate(() => ({ loads: window.__reviewLoads, revision: window.__reviewRemoteRow.revision }));
    if (focused.loads <= before.loads || focused.revision <= before.revision) throw new Error(`Focus did not reload the newer passive revision: ${JSON.stringify({ before, focused })}`);

    await setRemoteTooth(page, '48');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => document.querySelector('.rr-item[aria-current="true"] .rr-tooth-current')?.textContent.includes('48'));
    const visible = await page.evaluate(() => ({ loads: window.__reviewLoads, revision: window.__reviewRemoteRow.revision }));
    if (visible.loads <= focused.loads || visible.revision <= focused.revision) throw new Error(`Visibility restoration did not reload the newer passive revision: ${JSON.stringify({ focused, visible })}`);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    await assertFreshSessionsShareCursor(browser);
    await assertZoomControls(browser);
    await assertPassiveRemoteRefresh(browser);
    console.log('Radiograph device consistency: OK');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
