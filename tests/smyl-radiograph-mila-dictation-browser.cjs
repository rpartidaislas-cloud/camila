const { chromium } = require('playwright');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.addInitScript(() => {
    window.SUPA_URL = 'https://example.supabase.co';
    window.SUPA_KEY = 'test-key';
    window.sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
    class MockMediaRecorder {
      static isTypeSupported() { return true; }
      constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) }); this.onstop?.(); }
    }
    window.MediaRecorder = MockMediaRecorder;
    window.fetch = async url => {
      if (!String(url).includes('/mila-clinical-dictation')) throw new Error('Unexpected request: ' + url);
      return new Response(JSON.stringify({ transcript: 'en la pieza 47 se ve como pérdida de hueso localizada', professional_text: 'En la pieza 47 se observa aparente pérdida ósea localizada.', polished: true, needs_review: true, review_reasons: ['Confirma que la pieza dictada corresponde a la pieza 47.'], duration_seconds: 7, token_usage: { total_tokens: 42 }, usage_recorded: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  const fixture = `file:///${path.resolve(__dirname, 'fixtures/smyl-radiograph-workbench-preview.html').replace(/\\/g, '/')}`;
  await page.goto(fixture);
  await page.locator('#open').click();
  await page.getByRole('button', { name: 'Revisar 3 señales', exact: true }).click();
  const dictate = page.locator('.rr-input-mode-mila');
  if (!await dictate.isVisible()) throw new Error('DICTAR CON MILA is not visible');
  if (!(await page.locator('.rr-mila-disclosure').textContent()).includes('tokens técnicos')) throw new Error('Usage disclosure is missing');
  await dictate.click();
  if ((await dictate.textContent()).trim() !== 'DETENER Y PREPARAR') throw new Error('Recording state was not exposed');
  await dictate.click();
  await page.waitForFunction(() => document.querySelector('.rr-mila-status')?.textContent.includes('42 tokens técnicos registrados'));
  const value = await page.locator('.rr-item-body textarea').inputValue();
  if (value !== 'En la pieza 47 se observa aparente pérdida ósea localizada.') throw new Error('Professional draft did not reach the canonical field: ' + value);
  if (!await page.locator('.rr-mila-comparison').evaluate(node => node.open)) throw new Error('Ambiguity review did not open automatically');
  if (!(await page.locator('.rr-mila-comparison').textContent()).includes('en la pieza 47')) throw new Error('Ephemeral recognized text is unavailable for comparison');
  if (await page.evaluate(() => window.__reviewSaves.length) !== 0) throw new Error('Dictation saved a clinical decision without confirmation');
  await page.setViewportSize({ width: 390, height: 780 });
  const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, dictateHeight: document.querySelector('.rr-input-mode-mila')?.getBoundingClientRect().height || 0 }));
  if (mobile.overflow) throw new Error('Professional dictation overflows the mobile viewport');
  if (mobile.dictateHeight < 44) throw new Error('DICTAR CON MILA does not meet the 44px touch target');
  await browser.close();
  console.log('MILA radiograph dictation browser flow passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
