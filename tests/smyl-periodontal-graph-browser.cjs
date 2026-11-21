const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const value = (depth, margin) => ({ depth, margin, bleeding: null });
const surface = {
  DB: value(4, -2),
  B: value(0, 0),
  MB: value(0, 2),
  L: value(3, 0)
};
const exam = {
  id: '11111111-1111-4111-8111-111111111111',
  date: '2026-11-20',
  status: 'draft',
  summary: '',
  teeth: { 16: surface, 26: surface, 46: surface, 36: surface }
};

async function openGraph(page, examination = exam, options = {}) {
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="graph"></main>');
  await page.addStyleTag({ path: path.join(root, 'smyl-periodontal-graph.css') });
  await page.addScriptTag({ path: path.join(root, 'smyl-dental-model.js') });
  await page.addScriptTag({ path: path.join(root, 'smyl-periodontal-graph.js') });
  await page.evaluate(({ examination, options }) => {
    if (!SmylDentalModel.validPeriodontalExam(examination)) throw Error('Invalid synthetic exam');
    window.selectionLog = [];
    window.editLog = [];
    window.fixture = examination;
    window.graph = SmylPeriodontalGraph.mount(document.querySelector('#graph'), {
      exam: examination, tooth: '16', site: 'DB', missingTeeth: [], canEdit: true,
      ...options,
      onSelect: (...args) => selectionLog.push(args),
      onEdit: (...args) => editLog.push(args)
    });
  }, { examination, options });
}

function siteButton(page, tooth, site) {
  return page.locator(`[role="button"][data-tooth="${tooth}"][data-site="${site}"]`);
}

function mark(page, kind, tooth, site) {
  return page.locator(`[data-mark="${kind}"][data-tooth="${tooth}"][data-site="${site}"]`);
}

async function center(locator) {
  const rect = await locator.boundingBox();
  assert.ok(rect, `No visible geometry for ${locator}`);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.5, `${message} (${actual} vs ${expected})`);
}

// Positive marginal recession is apical to the CEJ. The pocket bottom is
// further apical by exactly the measured depth. The two arches mirror in Y.
async function verifyScale(page, tooth, apicalDirection) {
  const [coronal, reference, apical, bottom, zero] = await Promise.all([
    center(mark(page, 'margin', tooth, 'DB')), center(mark(page, 'margin', tooth, 'B')),
    center(mark(page, 'margin', tooth, 'MB')), center(mark(page, 'bottom', tooth, 'DB')),
    center(mark(page, 'bottom', tooth, 'B'))
  ]);
  assert.ok((reference.y - coronal.y) * apicalDirection > 0, 'Negative margin is coronal');
  assert.ok((apical.y - reference.y) * apicalDirection > 0, 'Positive margin is apical');
  near(reference.y - coronal.y, apical.y - reference.y, 'Signed margins share a millimetre scale');
  near(bottom.y, apical.y, 'A -2 mm margin and 4 mm depth place the base at +2 mm');
  near(zero.y, reference.y, 'A recorded zero is a value');
}

async function verifyHorizontalOrder(page, tooth, mesialToRight) {
  const mesial = await center(mark(page, 'margin', tooth, 'MB'));
  const distal = await center(mark(page, 'margin', tooth, 'DB'));
  assert.equal(mesial.x > distal.x, mesialToRight, `Mesial site must face the midline for tooth ${tooth}`);
}

async function verifyGap(locator, x) {
  const crosses = await locator.evaluateAll((segments, x) => segments.some(segment => {
    const rect = segment.getBoundingClientRect();
    return rect.left < x && x < rect.right;
  }), x);
  assert.equal(crosses, false, `A segment of ${locator} crosses an unmeasured site`);
}

async function checkIncompleteSites(page) {
  const partial = {
    ...exam,
    teeth: {
      17: surface,
      16: { DB: value(2, 0), B: value(4, null), MB: value(3, 1) },
      15: { DB: value(2, 0), B: value(null, 1), MB: value(3, 2) }
    }
  };
  await openGraph(page, partial, { tooth: '16', site: 'B' });
  assert.equal(await mark(page, 'margin', '16', 'B').count(), 0);
  assert.equal(await mark(page, 'bottom', '16', 'B').count(), 0, 'Depth alone cannot locate the base');
  assert.equal(await mark(page, 'margin', '15', 'B').count(), 1);
  assert.equal(await mark(page, 'bottom', '15', 'B').count(), 0, 'Margin alone cannot locate the base');
  assert.equal(await mark(page, 'margin', '14', 'B').count(), 0);
  for (const [kind, tooth] of [['margin', '16'], ['bottom', '16'], ['bottom', '15']]) {
    assert.ok(await page.locator(`[data-line="${kind}"]`).count(), 'Fixture has adjacent measured points');
    const { x } = await center(siteButton(page, tooth, 'B'));
    await verifyGap(page.locator(`[data-line="${kind}"]`), x);
    await verifyGap(page.locator('[data-band]'), x);
  }
  const probe = page.getByRole('button', { name: 'Sonda virtual' });
  if (await probe.isEnabled() && await probe.getAttribute('aria-pressed') !== 'true') await probe.click();
  assert.equal(await page.locator('[data-probe]').count(), 0, 'No synthetic probe for a missing margin');
  assert.deepEqual(await page.evaluate(() => fixture), partial);

  await openGraph(page, { ...exam, teeth: {} });
  assert.equal(await page.locator('[data-mark], [data-band], [data-probe]').count(), 0);
}

async function checkArchControls(page) {
  await openGraph(page);
  const arch = page.getByLabel('Arcada', { exact: true });
  const face = page.getByLabel('Cara', { exact: true });
  assert.equal(await arch.inputValue(), 'upper');
  assert.equal(await face.inputValue(), 'vestibular');
  await verifyScale(page, '16', -1);
  await verifyHorizontalOrder(page, '16', true);
  await verifyHorizontalOrder(page, '26', false);
  await arch.selectOption('lower');
  await verifyScale(page, '46', 1);
  await verifyHorizontalOrder(page, '46', true);
  await verifyHorizontalOrder(page, '36', false);
  await face.selectOption('interior');
  assert.equal(await mark(page, 'margin', '46', 'B').count(), 0);
  assert.equal(await mark(page, 'margin', '46', 'L').count(), 1);
  assert.match(await face.locator('option:checked').innerText(), /lingual/i);
  await arch.selectOption('upper');
  assert.match(await face.locator('option:checked').innerText(), /palatin/i);
}

async function checkSelection(page) {
  await openGraph(page);
  const probe = page.getByRole('button', { name: 'Sonda virtual' });
  if (await probe.getAttribute('aria-pressed') === 'true') await probe.click();
  assert.equal(await page.locator('[data-probe]').count(), 0);
  await probe.click();
  assert.equal(await probe.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-probe]').count(), 1);
  const needle = await page.locator('[data-probe] .pg-probe-shaft').evaluate(el => {
    const tip = new DOMPoint(el.x1.baseVal.value, el.y1.baseVal.value).matrixTransform(el.getScreenCTM());
    return tip.y;
  });
  near(needle, (await center(mark(page, 'bottom', '16', 'DB'))).y, 'Probe tip reaches the measured bottom');
  await siteButton(page, '16', 'DB').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await siteButton(page, '16', 'B').getAttribute('aria-pressed'), 'true');
  assert.equal(await siteButton(page, '16', 'B').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await siteButton(page, '16', 'B').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-site][role="button"][tabindex="0"]').count(), 1);
  await siteButton(page, '16', 'MB').click();
  assert.equal(await siteButton(page, '16', 'MB').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.evaluate(() => selectionLog.at(-1)), ['16', 'MB']);
  await page.getByRole('button', { name: 'Editar sitio' }).click();
  assert.deepEqual(await page.evaluate(() => editLog), [['16', 'MB']]);
  await siteButton(page, '16', 'MB').focus();
  await page.keyboard.press('End');
  assert.equal(await siteButton(page, '28', 'DB').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await siteButton(page, '18', 'DB').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.evaluate(() => fixture), exam);
}

async function checkMissingTooth(page) {
  await openGraph(page, exam, { missingTeeth: ['16'] });
  assert.equal(await mark(page, 'margin', '16', 'B').count(), 0);
  assert.equal(await siteButton(page, '16', 'B').getAttribute('aria-disabled'), 'true');
  const active = page.locator('[data-site][role="button"][tabindex="0"]');
  await active.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await active.getAttribute('aria-disabled'), 'false', 'An absent tooth cannot trap the keyboard');
  await siteButton(page, '17', 'MB').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await siteButton(page, '15', 'DB').getAttribute('aria-pressed'), 'true', 'Skip absent tooth');
}

async function checkUpdate(page) {
  await openGraph(page);
  const enlarged = {
    ...exam, teeth: { 46: { B: value(20, 20), DB: value(0, -20) } }
  };
  await page.evaluate(examination => graph.update({ exam: examination, tooth: '46', site: 'B' }), enlarged);
  const plot = await page.locator('svg[aria-label="Sitios periodontales"]').boundingBox();
  const base = await center(mark(page, 'bottom', '46', 'B'));
  const highMargin = await center(mark(page, 'margin', '46', 'DB'));
  assert.ok(base.y > highMargin.y && highMargin.y >= plot.y && base.y <= plot.y + plot.height,
    'All supported clinical measurements fit the vertical scale');
  assert.equal(await mark(page, 'margin', '46', 'MB').count(), 0, 'Cleared values do not leave stale marks');
  await page.evaluate(() => graph.destroy());
  assert.equal(await page.locator('#graph > *').count(), 0);
}

async function toothContours(page) {
  return page.locator('.pg-diagram').evaluate(async diagram => {
    // Allow a resized container and its SVG layout to settle before measuring.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const frame = diagram.getBoundingClientRect();
    const labelTop = diagram.querySelector('.pg-tooth-label').getBoundingClientRect().top;
    return [...diagram.querySelectorAll('path.pg-enamel, path.pg-root')].map(path => {
      const box = path.getBoundingClientRect();
      const drawn = path.getBBox();
      return {
        ratio: box.width / box.height,
        drawnRatio: drawn.width / drawn.height,
        width: box.width, height: box.height,
        insidePlot: box.width > 0 && box.height > 0 && box.top >= frame.top - 1 &&
          box.bottom <= labelTop + 1 && box.left >= frame.left - 1 && box.right <= frame.right + 1
      };
    });
  });
}

async function checkFixedAxis(page) {
  const result = await page.locator('.pg-viewport').evaluate(viewport => {
    const axis = viewport.querySelector('.pg-axis-zero'), reference = viewport.querySelector('.pg-grid-zero');
    const original = viewport.scrollLeft;
    const read = () => {
      const label = axis.getBoundingClientRect(), line = reference.getBoundingClientRect();
      return { labelX: label.left, labelMid: label.top + label.height / 2, labelHeight: label.height,
        lineX: line.left, lineY: line.top, scroll: viewport.scrollLeft };
    };
    viewport.scrollLeft = 0;
    const start = read();
    viewport.scrollLeft = viewport.scrollWidth;
    const end = read();
    viewport.scrollLeft = original;
    return { start, end };
  });
  const { start, end } = result;
  near(start.labelX, end.labelX, 'The zero tick stays on the fixed axis while scrolling');
  near(start.lineX - end.lineX, end.scroll - start.scroll, 'The chart scrolls beneath the fixed axis');
  for (const { labelMid, labelHeight, lineY } of [start, end]) {
    assert.ok(Math.abs(labelMid - lineY) <= labelHeight / 4, 'The reference line aligns with the zero label');
  }
}

async function checkContourProportions(desktop, mobile) {
  const baseline = {};
  const extremeSite = { B: value(20, 20), DB: value(0, -20) };
  const extreme = { ...exam, teeth: { 16: extremeSite, 46: extremeSite } };
  const apical = { ...exam, teeth: { 16: { B: value(20, 20) }, 46: { B: value(20, 20) } } };
  const coronal = { ...exam, teeth: { 16: { B: value(0, -20) }, 46: { B: value(0, -20) } } };
  for (const [page, width] of [[desktop, 1440], [desktop, 950], [mobile, 390]]) {
    const sizeAtWidth = {};
    await page.setViewportSize({ width, height: 850 });
    await openGraph(page);
    for (const [range, examination] of [['normal', exam], ['-20…+40 mm', extreme], ['+40 mm', apical], ['-20 mm', coronal]]) {
      await page.evaluate(next => graph.update({ exam: next }), examination);
      for (const arch of ['upper', 'lower']) {
        await page.getByLabel('Arcada', { exact: true }).selectOption(arch);
        const contours = await toothContours(page);
        await checkFixedAxis(page);
        assert.ok(contours.length >= 16, 'Expected anatomical outlines for the complete arch');
        baseline[arch] ??= contours;
        sizeAtWidth[arch] ??= contours;
        assert.equal(contours.length, baseline[arch].length);
        contours.forEach(({ ratio, drawnRatio, insidePlot }, i) => {
          const description = `${arch}, contour ${i + 1}, ${width} px, ${range}`;
          const reference = baseline[arch][i].ratio;
          near(contours[i].width, sizeAtWidth[arch][i].width, `Clinical range must preserve tooth width: ${description}`);
          near(contours[i].height, sizeAtWidth[arch][i].height, `Clinical range must preserve tooth height: ${description}`);
          assert.ok(insidePlot, `Tooth outline clipped or overlapping FDI numbers: ${description}`);
          assert.ok(Math.abs(ratio / drawnRatio - 1) < 0.03,
            `Rendered tooth differs from its drawn proportions: ${description}`);
          assert.ok(Math.abs(ratio / reference - 1) < 0.03,
            `Tooth proportions changed: ${description} (${ratio.toFixed(3)} vs ${reference.toFixed(3)})`);
        });
      }
    }
  }
}

async function checkMobile(page) {
  await openGraph(page, exam, { canEdit: false });
  assert.equal(await page.getByRole('button', { name: 'Editar sitio' }).count(), 0);
  await page.getByRole('button', { name: 'Ver pieza' }).tap();
  const site = siteButton(page, '16', 'MB');
  await site.tap();
  assert.equal(await site.getAttribute('aria-pressed'), 'true');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Viewport does not overflow');
  await page.getByLabel('Arcada', { exact: true }).selectOption('lower');
  await verifyScale(page, '46', 1);
}

(async () => {
  const executablePath = process.env.CHROME_PATH || process.env.SMYL_CHROMIUM ||
    (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1366, height: 850 }, locale: 'es-MX' });
    const errors = [];
    desktop.on('pageerror', error => errors.push(error.message));
    await checkArchControls(desktop);
    await checkIncompleteSites(desktop);
    await checkSelection(desktop);
    await checkUpdate(desktop);
    const mobile = await browser.newPage({
      viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'es-MX'
    });
    mobile.on('pageerror', error => errors.push(error.message));
    await checkMobile(mobile);
    await checkMissingTooth(desktop);
    await checkContourProportions(desktop, mobile);
    assert.deepEqual(errors, [], 'Browser runtime errors');
    console.log('Periodontal graph passed desktop, keyboard and mobile touch checks.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
