// Comparación longitudinal (Etapa 6) en navegador real: desde la mesa v2 con un estudio anterior
// comparable y otro incompatible, el selector explica el motivo y sólo abre el comparable; el
// comparador muestra ambos visores con zoom/desplazamiento sincronizados, alternancia, las tres
// categorías separadas, el aviso de "sin mediciones" y registra el par como comparable.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
let browser = null;
(async () => {
  browser = await chromium.launch({ headless: true });
  const base = process.env.SMYL_PREVIEW_URL || `file://${path.resolve(__dirname, 'fixtures/smyl-radiograph-review-v2-preview.html')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'radiograph-longitudinal-v49');
  fs.mkdirSync(output, { recursive: true });
  const fail = (m) => { throw new Error(m); };
  const report = [];
  for (const item of [{ name: 'desktop', width: 1280, height: 820 }, { name: 'mobile', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    page.setDefaultTimeout(20000);
    const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(base);
    await page.evaluate(() => window.__seedPrevious());
    await page.locator('#open').click();
    await page.locator('#rv2-consent').check();
    await page.getByRole('button', { name: 'Registrar y comprobar calidad' }).click();
    await page.locator('.rv2-qc .rr-quality-card').waitFor();
    await page.getByRole('button', { name: 'Localizar piezas', exact: true }).click();
    await page.locator('.rr-item').first().waitFor();
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.rr-item')[0]?.dataset.state === 'confirmed');
    const compare = page.getByRole('button', { name: /^Comparar con anterior/ });
    if (await compare.isDisabled()) fail('compare should be enabled with a comparable previous study');
    await compare.click();
    await page.locator('.rl-picker-dialog[open]').waitFor();
    const picker = await page.evaluate(() => Array.from(document.querySelectorAll('.rl-picker-item')).map((e) => ({ verdict: e.dataset.verdict, text: e.querySelector('small').textContent, disabled: e.querySelector('button').disabled })));
    if (picker.length !== 2 || !picker.some((p) => p.verdict === 'comparable' && !p.disabled) || !picker.some((p) => p.verdict === 'incompatible' && p.disabled && p.text.includes('Tipo de estudio distinto'))) fail('picker verdicts: ' + JSON.stringify(picker));
    await page.locator('.rl-picker-item[data-verdict="comparable"] button').click();
    await page.locator('.rl-dialog[open] .rl-workspace').waitFor();
    const metrics = await page.evaluate(() => {
      const t = (s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent);
      return { viewers: document.querySelectorAll('.rl-canvas').length, overlays: document.querySelectorAll('.rl-canvas .rv2-shape').length, lead: document.querySelector('.rl-dialog .rr-lead').textContent, confirmed: t('.rl-confirmed li'), ai: t('.rl-ai li'), stable: t('.rl-stable li'), acq: t('.rl-acq li'), measure: document.querySelector('.rl-measure').textContent, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, minBtn: Math.min(...Array.from(document.querySelectorAll('.rl-tools button, .rl-actions button')).map((b) => b.getBoundingClientRect().height)) };
    });
    if (metrics.viewers !== 2 || metrics.overlays < 3) fail('viewers/overlays ' + JSON.stringify(metrics));
    if (!metrics.lead.includes('Estudios comparables')) fail('lead ' + metrics.lead);
    if (!metrics.stable.some((s) => s.includes('Pieza 16'))) fail('16 should be stable: ' + metrics.stable);
    if (!metrics.ai.some((s) => s.includes('Pieza 15'))) fail('15 should be ai_proposed (pending now): ' + metrics.ai);
    if (metrics.confirmed.length !== 1 || !metrics.confirmed[0].includes('Ninguno')) fail('no confirmed change expected: ' + metrics.confirmed);
    if (!metrics.acq.some((s) => s.includes('usable → limited')) || !metrics.acq.some((s) => s.includes('desenfoque anterior'))) fail('acquisition differences: ' + metrics.acq);
    if (!metrics.measure.includes('Sin mediciones')) fail('measurement note missing');
    if (metrics.overflow || metrics.minBtn < 42) fail(`layout ${item.width}: ${JSON.stringify(metrics)}`);
    // zoom compartido y desplazamiento sincronizado
    await page.locator('input[aria-label="Ampliar ambos visores"]').fill('2');
    await page.waitForTimeout(60);
    const zoomed = await page.evaluate(() => Array.from(document.querySelectorAll('.rl-wrap')).map((w) => ({ zoomed: w.classList.contains('is-zoomed'), left: w.scrollLeft })));
    if (!zoomed.every((z) => z.zoomed && z.left > 0)) fail('shared zoom did not apply to both: ' + JSON.stringify(zoomed));
    await page.evaluate(() => { const w = document.querySelectorAll('.rl-wrap')[0]; w.scrollLeft = 40; w.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(60);
    const synced = await page.evaluate(() => Array.from(document.querySelectorAll('.rl-wrap')).map((w) => w.scrollLeft));
    if (Math.abs(synced[0] - synced[1]) > 2) fail('scroll not synced: ' + synced);
    await page.getByRole('button', { name: 'Alternar anterior / actual' }).click();
    if ((await page.locator('.rl-workspace').getAttribute('data-flip')) !== 'true') fail('flip toggle');
    await page.getByRole('button', { name: 'Registrar par como comparable' }).click();
    await page.waitForFunction(() => document.querySelector('.rl-dialog .rr-feedback')?.textContent.includes('comparable'));
    if ((await page.evaluate(() => window.__db.links.length)) !== 1) fail('link not registered');
    report.push({ name: item.name, width: item.width, viewers: metrics.viewers, minBtn: metrics.minBtn });
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: false });
    if (pageErrors.length) fail(`pageerror (${item.name}): ${pageErrors.join(' | ')}`);
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(async (error) => { console.error(error); process.exitCode = 1; try { await browser?.close(); } catch (_) {} });
