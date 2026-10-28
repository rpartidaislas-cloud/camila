// Revisión por pieza v2 (Etapa 4) en navegador real: registro + QC + localización, tarjetas por
// candidato con sus cuatro bloques, confirmar / corregir (renumerar) / descartar, contorno editable
// y reversible, teclado, objetivos táctiles, zoom centrado, cierre con borrador y pérdida de red.
// Escritorio, tableta, 390 y 320 px. Datos sintéticos; sin paciente real.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

// Auditoría de contraste AA (≥ 4.5:1 texto normal, 3:1 grande) del contenido visible del diálogo abierto.
const AUDIT = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (const c of stack.reverse()) base = over(c, base); return base; };
  const out = [];
  const root = document.querySelector('dialog[open]') || document.body;
  for (const el of root.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    if (el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const disabled = el.disabled || el.closest('button:disabled');
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); const f = over(fg, bg);
    const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need && !disabled) out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), text: el.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, color: cs.color });
  }
  return out;
};

let browser = null;
(async () => {
  browser = await chromium.launch({ headless: true });
  const base = process.env.SMYL_PREVIEW_URL || `file://${path.resolve(__dirname, 'fixtures/smyl-radiograph-review-v2-preview.html')}`;
  const output = path.resolve(__dirname, '..', 'artifacts', 'radiograph-review-v2-v47');
  fs.mkdirSync(output, { recursive: true });
  const cases = [
    { name: 'desktop', width: 1280, height: 820 },
    { name: 'tablet', width: 820, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 700 },
  ];
  const report = [];
  const fail = (m) => { throw new Error(m); };
  for (const item of cases) {
    const page = await browser.newPage({ viewport: { width: item.width, height: item.height } });
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(base);
    await page.locator('#open').click();
    await page.locator('.rv2-dialog[open] .rr-intro').waitFor();
    // 1) registro con consentimiento obligatorio
    await page.getByRole('button', { name: 'Registrar y comprobar calidad' }).click();
    if (!(await page.locator('.rr-feedback').textContent()).includes('autorización')) fail('consent not enforced');
    await page.locator('#rv2-consent').check();
    await page.getByRole('button', { name: 'Registrar y comprobar calidad' }).click();
    await page.locator('.rv2-qc .rr-quality-card').waitFor();
    const qcText = await page.locator('.rv2-qc .rr-quality-card').textContent();
    if (!qcText.includes('Imagen limitada') || !qcText.includes('Panorámica') || !qcText.includes('Desenfoque anterior')) fail('QC card incomplete: ' + qcText);
    // 2) localización + señales
    await page.getByRole('button', { name: 'Localizar piezas', exact: true }).click();
    await page.locator('.rr-item').first().waitFor();
    await page.getByRole('button', { name: 'Buscar señales', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.rr-item').length === 7);
    const lowContrast = await page.evaluate(AUDIT);
    if (lowContrast.length) fail('contraste insuficiente: ' + JSON.stringify(lowContrast.slice(0, 5)));
    const metrics = await page.evaluate(() => {
      const visible = (s) => Array.from(document.querySelectorAll(s)).filter((e) => e.getClientRects().length);
      const dialog = document.querySelector('.rv2-dialog');
      const body = document.querySelector('.rr-item-body');
      const blocks = Array.from(body.querySelectorAll('.rv2-block > span:first-child')).map((e) => e.textContent);
      const buttons = visible('.rv2-dialog button').filter((b) => !b.disabled || b.getAttribute('aria-disabled'));
      return {
        rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        dialogOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
        cards: visible('.rr-item').length,
        shapes: document.querySelectorAll('.rv2-overlay .rv2-shape').length,
        labels: Array.from(document.querySelectorAll('.rv2-shape-label')).map((e) => e.textContent),
        blocks,
        crop: !!body.querySelector('canvas.rv2-crop'),
        stateText: Array.from(document.querySelectorAll('.rv2-state')).map((e) => e.textContent.trim()),
        minButtonHeight: Math.min(...visible('.rv2-actions button, .rv2-steps button, .rr-bar button').map((b) => b.getBoundingClientRect().height)),
        compareDisabled: document.querySelector('.rv2-actions button[aria-disabled="true"]')?.textContent,
        listbox: document.querySelector('.rv2-items')?.getAttribute('role'),
        sameRow: Math.abs(document.querySelector('.rr-canvas').getBoundingClientRect().top - document.querySelector('.rr-signal-panel').getBoundingClientRect().top) < 2,
      };
    });
    if (metrics.rootOverflow || metrics.dialogOverflow) fail(`overflow at ${item.width}`);
    if (metrics.cards !== 7 || metrics.shapes !== 7) fail(`cards/shapes ${JSON.stringify(metrics)}`);
    if (JSON.stringify(metrics.blocks) !== JSON.stringify(['Base visual sugerida', 'Confianza del modelo', 'Limitaciones', 'Valoración profesional'])) fail('card blocks ' + metrics.blocks);
    if (!metrics.crop) fail('crop missing');
    if (!metrics.stateText.every((t) => /^[○✓✎✕] /.test(t))) fail('state not text+symbol: ' + metrics.stateText);
    if (!metrics.labels.every((l) => /^[○✓✎✕] \d+$/.test(l))) fail('overlay labels: ' + metrics.labels);
    if (metrics.minButtonHeight < 42) fail(`button height ${metrics.minButtonHeight} at ${item.width}`);
    if (metrics.compareDisabled !== 'Comparar con anterior') fail('compare must be disabled with reason');
    if (metrics.listbox !== 'list') fail('cards list lacks list role');
    if (metrics.sameRow !== item.width >= 960) fail(`layout ${item.width}: sameRow=${metrics.sameRow}`);
    report.push({ name: item.name, width: item.width, cards: metrics.cards, shapes: metrics.shapes, minButtonHeight: metrics.minButtonHeight, sameRow: metrics.sameRow });

    if (item.name === 'desktop') {
      // teclado: ArrowDown mueve la selección en la lista
      await page.locator('.rr-item[aria-current="true"]').focus();
      await page.keyboard.press('ArrowDown');
      const second = await page.locator('.rr-item[aria-current="true"] .rr-number').textContent();
      if (second.trim() !== '2') fail('keyboard navigation did not move selection');
      // confirmar
      await page.locator('.rr-item[aria-current="true"] textarea').fill('Pieza 15 comprobada en la imagen.');
      await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.rr-feedback')?.textContent.includes('Confirmada'));
      const confirmedCard = await page.locator('.rr-item').nth(1).getAttribute('data-state');
      if (confirmedCard !== 'confirmed') fail('confirm did not persist');
      if (!(await page.locator('.rv2-overlay .rv2-shape').nth(1).getAttribute('class')).includes('rv2-shape-confirmed')) fail('overlay stroke pattern did not change');
      // corregir: renumerar + "Guardar corrección" sólo con cambios; el original queda intacto
      await page.locator('.rr-item').nth(2).locator('.rr-item-head').click();
      if (!(await page.getByRole('button', { name: 'Guardar corrección (sin cambios)' }).isDisabled())) fail('correction enabled without changes');
      await page.locator('.rr-item[aria-current="true"] select').first().selectOption('24');
      await page.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.rr-feedback')?.textContent.includes('Corrección registrada'));
      const corrected = await page.evaluate(() => { const d = window.__db; const c = d.candidates[2]; const dec = d.decisions.find((x) => x.candidate_id === c.id); return { original: c.payload.fdiCandidate, state: dec.state, payload: dec.payload, revision: dec.revision }; });
      if (corrected.original !== '14' || corrected.state !== 'corrected' || corrected.payload.fdi !== '24' || corrected.revision !== 2) fail('correction wrong: ' + JSON.stringify(corrected));
      if (!(await page.locator('.rr-item').nth(2).textContent()).includes('Pieza FDI 24 (modelo: 14)')) fail('card does not show renumbering with model origin');
      // re-corregir una tarjeta ya corregida: el payload es absoluto (conserva la renumeración) y "Confirmar" no la pierde
      const originalVisibility = await page.evaluate(() => window.__db.candidates[2].payload.visibility);
      const visibilityTarget = originalVisibility === 'partial' ? 'not_evaluable' : 'partial';
      await page.locator('.rr-item[aria-current="true"] select').nth(1).selectOption(visibilityTarget);
      await page.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
      await page.waitForFunction(() => window.__db.decisions[2].revision === 3);
      const recorrected = await page.evaluate(() => window.__db.decisions[2].payload);
      if (recorrected.fdi !== '24' || recorrected.visibility === undefined) fail('re-correction dropped the earlier renumbering: ' + JSON.stringify(recorrected));
      await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
      await page.waitForFunction(() => window.__db.decisions[2].revision === 4);
      const reaffirmed = await page.evaluate(() => ({ state: window.__db.decisions[2].state, payload: window.__db.decisions[2].payload }));
      if (reaffirmed.state !== 'corrected' || reaffirmed.payload.fdi !== '24') fail('confirming a corrected card lost its correction: ' + JSON.stringify(reaffirmed));
      // flechas dentro de un campo (textarea / select) no cambian la tarjeta seleccionada
      const keptCard = await page.locator('.rr-item[aria-current="true"]').getAttribute('data-rv2-card');
      await page.locator('.rr-item[aria-current="true"] textarea').focus();
      await page.keyboard.press('ArrowDown');
      if ((await page.locator('.rr-item[aria-current="true"]').getAttribute('data-rv2-card')) !== keptCard) fail('arrow key inside a field moved the selection');
      // descartar + reconsiderar (versionado)
      await page.locator('.rr-item').nth(3).locator('.rr-item-head').click();
      await page.getByRole('button', { name: 'Descartar', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.rr-item')[3]?.dataset.state === 'rejected');
      await page.getByRole('button', { name: 'Descartadas', exact: true }).click();
      if (await page.locator('.rr-item').count() !== 1) fail('rejected filter');
      await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.rr-feedback')?.textContent.includes('Confirmada'));
      const revs = await page.evaluate(() => window.__db.decisions[3].revision);
      if (revs !== 3) fail('reconsideration not versioned');
      await page.getByRole('button', { name: 'Todas', exact: true }).click();
      // contorno editable y reversible
      await page.locator('.rr-item').nth(4).locator('.rr-item-head').click();
      await page.getByRole('button', { name: 'Editar contorno', exact: true }).click();
      const vertex = page.locator('.rv2-vertex').first();
      const vb = await vertex.boundingBox();
      await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2); await page.mouse.down(); await page.mouse.move(vb.x + 40, vb.y + 30, { steps: 4 }); await page.mouse.up();
      await page.getByRole('button', { name: 'Deshacer contorno', exact: true }).waitFor();
      const edited = await page.evaluate(() => { const poly = document.querySelectorAll('.rv2-overlay .rv2-shape')[4]; return poly.getAttribute('points'); });
      if (edited.startsWith('100.0,520.0')) fail('vertex drag did not move the polygon');
      await page.getByRole('button', { name: 'Deshacer contorno', exact: true }).click();
      const restored = await page.evaluate(() => document.querySelectorAll('.rv2-overlay .rv2-shape')[4].getAttribute('points'));
      if (!restored.startsWith('100.0,520.0')) fail('undo did not restore model geometry');
      // deshacer conserva el modo edición (el profesional puede seguir ajustando)
      if (!(await page.getByRole('button', { name: 'Terminar edición de contorno', exact: true }).count())) fail('undo left edit mode unexpectedly');
      const vb2 = await page.locator('.rv2-vertex').first().boundingBox();
      await page.mouse.move(vb2.x + vb2.width / 2, vb2.y + vb2.height / 2); await page.mouse.down(); await page.mouse.move(vb2.x + 40, vb2.y + 30, { steps: 4 }); await page.mouse.up();
      await page.getByRole('button', { name: 'Guardar corrección', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.rr-feedback')?.textContent.includes('Corrección registrada'));
      const geo = await page.evaluate(() => window.__db.decisions[4].payload.geometry);
      if (!geo || geo.kind !== 'polygon' || geo.points.length !== 4 || geo.coordinateSpace !== 'source-normalized') fail('geometry correction not saved: ' + JSON.stringify(geo));
      // pérdida de conexión: el borrador se conserva, nada se pierde en silencio
      await page.locator('.rr-item').nth(5).locator('.rr-item-head').click();
      await page.locator('.rr-item[aria-current="true"] textarea').fill('Borrador offline');
      await page.evaluate(() => { window.sb.rpc = async () => { throw new TypeError('Failed to fetch'); }; });
      await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.rr-feedback')?.textContent.includes('Sin conexión'));
      if ((await page.locator('.rr-item[aria-current="true"] textarea').inputValue()) !== 'Borrador offline') fail('draft lost after network failure');
      // cierre con borrador → confirmación personalizada
      await page.getByRole('button', { name: 'Volver al expediente', exact: true }).click();
      await page.locator('.rr-confirm-dialog[open]').waitFor();
      await page.getByRole('button', { name: 'Continuar revisando', exact: true }).click();
      if (!await page.locator('.rv2-dialog[open]').count()) fail('close confirmation dismissed the review');
      // zoom centrado del visor compartido
      const zoom = page.locator('.rr-tool-range input[aria-label="Ampliar radiografía"]'), viewport = page.locator('.rr-image-wrap');
      await zoom.fill('2'); await page.waitForTimeout(40);
      const centered = await viewport.evaluate((e) => ({ left: e.scrollLeft, center: (e.scrollLeft + e.clientWidth / 2) / e.scrollWidth, zoomed: e.classList.contains('is-zoomed') }));
      if (!centered.zoomed || centered.left <= 0 || Math.abs(centered.center - .5) > .04) fail('zoom not centered ' + JSON.stringify(centered));
      await page.getByRole('button', { name: 'Vista original', exact: true }).click();
    }
    if (item.name === 'mobile') {
      const last = page.locator('.rr-item').last();
      await last.scrollIntoViewIfNeeded();
      const reachable = await page.evaluate(() => { const d = document.querySelector('.rv2-dialog').getBoundingClientRect(), s = document.querySelector('.rr-item:last-child').getBoundingClientRect(); return s.top >= d.top - 1 && s.bottom <= d.bottom + 1; });
      if (!reachable) fail('last card unreachable on mobile');
    }
    await page.screenshot({ path: path.join(output, `${item.name}.png`), fullPage: false });
    if (pageErrors.length) fail(`pageerror (${item.name}): ${pageErrors.join(' | ')}`);
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
})().catch(async (error) => { console.error(error); process.exitCode = 1; try { await browser?.close(); } catch (_) {} });
