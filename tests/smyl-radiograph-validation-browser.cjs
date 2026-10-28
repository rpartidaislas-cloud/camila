// Panel de validación (Etapa 7) en navegador real: divulgación visible en la mesa (motor simulado,
// sin validación), panel sólo con aprobación clínica: crear conjunto, añadir fuente, anotar
// referencia, métricas, incidentes, informe con criterios (previsualización local + veredicto del
// servidor), pausa por clínica. Datos sintéticos.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
let browser = null;
(async () => {
  browser = await chromium.launch({ headless: true });
  const base = process.env.SMYL_PREVIEW_URL || `file://${path.resolve(__dirname, 'fixtures/smyl-radiograph-review-v2-preview.html')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'radiograph-validation-v50');
  fs.mkdirSync(output, { recursive: true });
  const fail = (m) => { throw new Error(m); };
  const report = [];
  for (const item of [{ name: 'desktop', width: 1280, height: 820 }, { name: 'mobile', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    page.setDefaultTimeout(20000);
    const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(base);
    await page.locator('#open').click();
    await page.locator('#rv2-consent').check();
    await page.getByRole('button', { name: 'Registrar y comprobar calidad' }).click();
    await page.locator('.rv2-qc .rr-quality-card').waitFor();
    const disc = await page.locator('.rv2-disclosure').textContent();
    if (!disc.includes('Motor simulado · sin validación clínica') || !disc.includes('smyl-sim-dental 0.1.0 (simulado)') || !disc.includes('Sin informe de validación aprobado')) fail('disclosure incomplete: ' + disc);
    await page.getByRole('button', { name: 'Validación del motor' }).click();
    await page.locator('.rv-dialog[open] .rv-section').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('listo'));
    const layout = await page.evaluate(() => ({ sections: document.querySelectorAll('.rv-section').length, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, minBtn: Math.min(...Array.from(document.querySelectorAll('.rv-form button, .rv-flags button')).map((b) => b.getBoundingClientRect().height)) }));
    if (layout.sections !== 6 || layout.overflow || layout.minBtn < 42) fail('layout ' + JSON.stringify(layout));
    report.push({ name: item.name, width: item.width, ...layout });
    if (item.name === 'desktop') {
      // conjunto + fuente con exposición → el informe se rechaza; sin exposición → se registra
      await page.locator('input[aria-label="Nombre del conjunto"]').fill('Piloto');
      await page.locator('input[aria-label="Uso previsto"]').fill('Localización de piezas en panorámicas de adultos.');
      await page.getByRole('button', { name: 'Crear conjunto' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Conjunto creado'));
      await page.locator('#rv-exposure').check();
      await page.getByRole('button', { name: 'Añadir esta radiografía al conjunto' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Fuente añadida'));
      await page.locator('select[aria-label="Conjunto a evaluar"]').selectOption({ label: 'Piloto' });
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Métricas calculadas'));
      const metrics = await page.evaluate(() => Array.from(document.querySelectorAll('.rv-section')[3].querySelectorAll('tbody tr')).slice(0, 1).map((r) => Array.from(r.children).map((c) => c.textContent)));
      if (!metrics[0] || !metrics[0].includes('93.3 %') || !metrics[0].includes('professional_decisions')) fail('metrics table: ' + JSON.stringify(metrics));
      const preview = await page.locator('.rv-preview').textContent();
      if (!preview.includes('✕ no') || !preview.includes('Hay criterios sin cumplir')) fail('local criteria preview should flag unmet criteria: ' + preview);
      await page.getByRole('button', { name: 'Registrar informe de validación' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('exposición al entrenamiento'));
      await page.locator('#rv-exposure').uncheck();
      await page.getByRole('button', { name: 'Añadir esta radiografía al conjunto' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Fuente añadida'));
      // referencia anotada
      await page.locator('select[aria-label="Tipo de anotación"]').selectOption('tooth');
      await page.locator('select[aria-label="Pieza FDI"]').selectOption('16');
      await page.getByRole('button', { name: 'Registrar anotación' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Anotación registrada'));
      if ((await page.evaluate(() => window.__db.reference_annotations.length)) !== 1) fail('annotation not stored');
      // informe no aprobado (criterios por defecto no se cumplen con la especificidad simulada), inmutable y con hash
      await page.getByRole('button', { name: 'Registrar informe de validación' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Informe registrado'));
      const rep = await page.evaluate(() => ({ n: window.__db.validation_reports.length, verdict: window.__db.validation_reports[0].verdict, locked: !!window.__db.eval_sets[0].locked_at, table: document.querySelectorAll('.rv-section')[4].querySelector('tbody').textContent }));
      if (rep.n !== 1 || rep.verdict !== 'not_approved' || !rep.locked || !rep.table.includes('No aprobado')) fail('report: ' + JSON.stringify(rep));
      if (!(await page.locator('.rv-validation').textContent()).includes('no aprobada')) fail('disclosure should reflect the report');
      // incidente + cierre
      await page.locator('input[aria-label="Descripción del incidente"]').fill('Numeración incorrecta en 46.');
      await page.getByRole('button', { name: 'Reportar incidente' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Incidente reportado'));
      await page.locator('input[aria-label="Resolución"]').fill('Corregido por el profesional.');
      await page.getByRole('button', { name: 'Cerrar incidente' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Incidente cerrado'));
      // pausa por clínica
      await page.getByRole('button', { name: 'Pausar tooth_ai_v1' }).click();
      await page.waitForFunction(() => document.querySelector('.rv-dialog .rr-feedback')?.textContent.includes('Pausado'));
      const flag = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'flag').pop());
      if (!flag || flag[1] !== 'radiograph.tooth_ai_v1' || flag[2] !== false) fail('pause flag call: ' + JSON.stringify(flag));
      if (!(await page.getByRole('button', { name: 'Reanudar tooth_ai_v1' }).count())) fail('pause did not re-render');
    }
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: false });
    if (pageErrors.length) fail(`pageerror (${item.name}): ${pageErrors.join(' | ')}`);
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(async (error) => { console.error(error); process.exitCode = 1; try { await browser?.close(); } catch (_) {} });
