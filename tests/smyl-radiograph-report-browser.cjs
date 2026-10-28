// Informe radiográfico asistido (Etapa 5) en navegador real: desde la mesa v2 confirma dos
// candidatos y descarta uno, abre el informe (sólo los confirmados aparecen), la redacción
// asistida que intenta añadir una pieza y una certeza se descarta, la limpia se aplica, se guarda
// el borrador, se firma (inmutable, con hash), se agrega una adenda y se exporta con aviso.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
let browser = null;
(async () => {
  browser = await chromium.launch({ headless: true });
  const base = process.env.SMYL_PREVIEW_URL || `file://${path.resolve(__dirname, 'fixtures/smyl-radiograph-review-v2-preview.html')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'radiograph-report-v48');
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
    await page.getByRole('button', { name: 'Localizar piezas', exact: true }).click();
    await page.locator('.rr-item').first().waitFor();
    // confirmar 1 y 2, descartar 3; 4-6 quedan pendientes
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.rr-item')[0]?.dataset.state === 'confirmed');
    await page.locator('.rr-item').nth(1).locator('.rr-item-head').click();
    await page.locator('.rr-item[aria-current="true"] textarea').fill('Comprobada en la imagen.');
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.rr-item')[1]?.dataset.state === 'confirmed');
    await page.locator('.rr-item').nth(2).locator('.rr-item-head').click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.rr-item')[2]?.dataset.state === 'rejected');
    // informe
    await page.locator('.rv2-report-button').click();
    await page.locator('.rp-dialog[open] .rp-finding').first().waitFor();
    const draft = await page.evaluate(() => ({ findings: Array.from(document.querySelectorAll('.rp-finding strong')).map((e) => e.textContent), limits: document.querySelector('[data-rp-section="technicalLimitations"]').value, warnings: Array.from(document.querySelectorAll('.rp-diff li')).map((e) => e.textContent), sections: document.querySelectorAll('.rp-sections textarea').length, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, minBtn: Math.min(...Array.from(document.querySelectorAll('.rp-action-buttons button')).map((b) => b.getBoundingClientRect().height)) }));
    if (JSON.stringify(draft.findings) !== JSON.stringify(['Pieza FDI 16', 'Pieza FDI 15'])) fail('findings must be only the confirmed ones: ' + draft.findings);
    if (!draft.limits.includes('limitada') || !draft.limits.includes('desenfoque anterior')) fail('technical limitations not prefilled: ' + draft.limits);
    if (draft.sections !== 5) fail('five sections expected');
    if (!draft.warnings.some((w) => w.includes('descripción radiográfica está vacía'))) fail('empty description warning missing');
    if (draft.overflow || draft.minBtn < 42) fail(`layout ${item.width}: ${JSON.stringify(draft)}`);
    report.push({ name: item.name, width: item.width, findings: draft.findings.length, minBtn: draft.minBtn });
    if (item.name === 'desktop') {
      // redacción asistida: la primera respuesta intenta añadir la pieza 25 y una certeza → se descarta
      await page.evaluate(() => { window.__assistResponses.push((ids) => JSON.stringify({ findingsOrder: ids, sections: { description: 'Caries confirmada en pieza 25 y pieza 16.' } })); });
      await page.getByRole('button', { name: 'Ordenar y redactar con apoyo de IA' }).click();
      await page.waitForFunction(() => document.querySelector('.rp-dialog .rr-feedback')?.textContent.includes('Se descartó la redacción asistida'));
      const fb = await page.locator('.rp-dialog .rr-feedback').textContent();
      if (!fb.includes('pieza 25') || !fb.includes('certeza')) fail('guard explanation incomplete: ' + fb);
      if ((await page.locator('[data-rp-section="description"]').inputValue()) !== '') fail('rejected assist must not touch the draft');
      // segunda respuesta limpia → se aplica (reordena) y no toca estudios complementarios
      await page.locator('[data-rp-section="complementaryStudies"]').fill('CBCT considerado por el profesional.');
      await page.getByRole('button', { name: 'Ordenar y redactar con apoyo de IA' }).click();
      await page.waitForFunction(() => document.querySelector('.rp-dialog .rr-feedback')?.textContent.includes('Redacción asistida aplicada'));
      const after = await page.evaluate(() => ({ desc: document.querySelector('[data-rp-section="description"]').value, comp: document.querySelector('[data-rp-section="complementaryStudies"]').value, order: Array.from(document.querySelectorAll('.rp-finding strong')).map((e) => e.textContent), ok: !!document.querySelector('.rp-diff-ok') }));
      if (!after.desc.includes('pieza 16') || after.comp !== 'CBCT considerado por el profesional.' || JSON.stringify(after.order) !== JSON.stringify(['Pieza FDI 15', 'Pieza FDI 16']) || !after.ok) fail('clean assist not applied: ' + JSON.stringify(after));
      // aviso (no bloqueo) cuando el profesional menciona una pieza sin hallazgo; luego la quita
      await page.locator('[data-rp-section="clinicalCorrelation"]').fill('Revisar también la pieza 36 en clínica.');
      await page.waitForFunction(() => document.querySelector('.rp-diff-extra_tooth'));
      await page.locator('[data-rp-section="clinicalCorrelation"]').fill('Revisar en clínica.');
      await page.waitForFunction(() => document.querySelector('.rp-diff-ok'));
      // guardar borrador → revisión 1
      await page.getByRole('button', { name: 'Guardar borrador' }).click();
      await page.waitForFunction(() => document.querySelector('.rp-dialog .rr-save-title')?.textContent.includes('revisión 1'));
      // firmar: confirmación personalizada → firmado, inmutable, hash
      await page.getByRole('button', { name: 'Firmar informe' }).click();
      await page.locator('.rr-confirm-dialog[open]').waitFor();
      await page.getByRole('button', { name: 'Firmar', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.rp-hash'));
      const signed = await page.evaluate(() => ({ hash: document.querySelector('.rp-hash').textContent, readonly: Array.from(document.querySelectorAll('.rp-sections textarea')).every((t) => t.readOnly), noSign: !document.querySelector('.rp-action-buttons button[disabled]') && !Array.from(document.querySelectorAll('.rp-action-buttons button')).some((b) => b.textContent === 'Firmar informe'), db: window.__db.reports[0].status, rev: window.__db.reports[0].revision }));
      if (!signed.hash.includes('f'.repeat(64)) || !signed.readonly || !signed.noSign || signed.db !== 'signed' || signed.rev !== 2) fail('signature state wrong: ' + JSON.stringify(signed));
      // adenda
      await page.locator('.rp-addendum-form textarea').fill('Se complementa con hallazgo clínico posterior.');
      await page.locator('.rp-addendum-form input').fill('Correlación clínica');
      await page.getByRole('button', { name: 'Agregar adenda' }).click();
      await page.waitForFunction(() => document.querySelectorAll('.rp-addenda li').length === 1);
      // exportar y vista imprimible con autoría + aviso
      await page.getByRole('button', { name: 'Vista para imprimir' }).click();
      await page.locator('.rp-print[open]').waitFor();
      const printed = await page.locator('.rp-print-doc').textContent();
      for (const s of ['Firmado por usuario', 'versión 2', 'hash f', 'Limitaciones técnicas', 'desenfoque anterior', 'smyl-sim-dental', 'Correlación clínica', 'No constituye diagnóstico automático']) if (!printed.includes(s)) fail('print view missing: ' + s);
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar (JSON)' }).click()]);
      const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      if (exported.report.signed_hash !== 'f'.repeat(64) || !exported.notice.includes('No constituye diagnóstico') || exported.addenda.length !== 1) fail('export incomplete');
      if ((await page.evaluate(() => window.__calls.filter((c) => c[0] === 'export').length)) !== 2) fail('export must be audited by the server');
    }
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: false });
    if (pageErrors.length) fail(`pageerror (${item.name}): ${pageErrors.join(' | ')}`);
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(async (error) => { console.error(error); process.exitCode = 1; try { await browser?.close(); } catch (_) {} });
