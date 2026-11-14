// Humo visual de «Recibos y facturación» con Supabase simulado.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..', '..'), fixtures = __dirname, shots = os.tmpdir();
const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
  process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '',
  process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''
].filter(Boolean);
const chromeExecutable = chromeCandidates.find(candidate => fs.existsSync(candidate));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/app.html';
  const file = path.join(root, pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch(chromeExecutable ? { executablePath: chromeExecutable } : {});
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [];
  let failures = 0;
  const check = (condition, message) => { if (!condition) { console.log('FALLA · ' + message); failures += 1; } };
  page.on('pageerror', error => errors.push(error.message.slice(0, 240)));
  page.on('dialog', dialog => dialog.dismiss());
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('@supabase/supabase-js') || url.includes('/vendor/supabase-js-')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(fixtures, 'fake-supabase-cobros.js'), 'utf8') });
    }
    return url.startsWith('http://127.0.0.1') ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const db = window.__db, tenant = db.camila_tenants[0].id, now = new Date().toISOString();
    const p1 = db.camila_pacientes[0].id, p2 = db.camila_pacientes[1].id, p3 = db.camila_pacientes[2].id;
    db.smyl_finance_charges.push(
      { id: 'c2', tenant_id: tenant, patient_id: p1, status: 'open', total_amount: 300, created_at: now, concept: 'Consulta' },
      { id: 'c3', tenant_id: tenant, patient_id: p3, status: 'open', total_amount: 450, created_at: now, concept: 'Radiografía' }
    );
    db.smyl_finance_payments = [
      { id: 'pay-ready', tenant_id: tenant, patient_id: p2, amount: 800, method: 'card', reference: '4582', paid_at: now },
      { id: 'pay-draft', tenant_id: tenant, patient_id: p1, amount: 300, method: 'transfer', reference: 'SPEI 9431', paid_at: now },
      { id: 'pay-profile', tenant_id: tenant, patient_id: p3, amount: 450, method: 'cash', reference: '', paid_at: now }
    ];
    db.smyl_finance_payment_allocations = [
      { id: 'a-ready', tenant_id: tenant, payment_id: 'pay-ready', charge_id: 'c1', amount: 800 },
      { id: 'a-draft', tenant_id: tenant, payment_id: 'pay-draft', charge_id: 'c2', amount: 300 },
      { id: 'a-profile', tenant_id: tenant, payment_id: 'pay-profile', charge_id: 'c3', amount: 450 }
    ];
    db.smyl_finance_refunds = [];
    db.smyl_finance_refund_allocations = [];
    db.smyl_finance_receipts = [
      { id: 'r-ready', tenant_id: tenant, payment_id: 'pay-ready', folio: 104, issued_at: now },
      { id: 'r-draft', tenant_id: tenant, payment_id: 'pay-draft', folio: 103, issued_at: now },
      { id: 'r-profile', tenant_id: tenant, payment_id: 'pay-profile', folio: 102, issued_at: now }
    ];
    db.smyl_patient_fiscal_profiles = [
      { tenant_id: tenant, patient_id: p1, legal_name: 'PACIENTE DE LANA', rfc: 'XAXX010101000', fiscal_regime: '616', tax_postal_code: '44100', cfdi_use: 'S01' },
      { tenant_id: tenant, patient_id: p2, legal_name: 'RICH', rfc: 'XAXX010101000', fiscal_regime: '616', tax_postal_code: '44100', cfdi_use: 'S01' }
    ];
    db.smyl_cfdi_drafts = [{ id: 'd1', tenant_id: tenant, patient_id: p1, payment_id: 'pay-draft', status: 'draft', sandbox_status: 'pending', cfdi_version: '4.0', fiscal_snapshot: { amount: 300 }, created_at: now }];
    db.smyl_issuer_fiscal_profiles = [{ tenant_id: tenant, legal_name: 'SMYL CLÍNICA', rfc: 'XAXX010101000', fiscal_regime: '601', invoice_series: 'SMYL', fiscal_status: 'reviewed' }];
    db.smyl_cfdi_pac_readiness = [];
    db.smyl_cfdi_cancellation_plans = [];
  });
  await page.evaluate(() => ir('caja'));
  await page.waitForTimeout(1800);
  await page.click('[data-finance-tab="fiscal"]');
  await page.waitForTimeout(400);

  const pending = await page.$$eval('.finance-fiscal-receipt-list>article', rows => rows.map(row => ({
    folio: row.querySelector('.finance-fiscal-receipt-folio strong').textContent,
    state: row.querySelector('.finance-badge').textContent,
    actions: [...row.querySelectorAll('button')].map(button => button.textContent.trim())
  })));
  console.log('1) por facturar:', JSON.stringify(pending));
  check(pending.length === 2, 'debe mostrar dos recibos pendientes');
  check(pending.some(row => row.actions.includes('Preparar factura')), 'el recibo listo debe permitir preparar factura');
  check(pending.some(row => row.actions.includes('Completar datos')), 'el recibo sin receptor debe pedir datos fiscales');
  await page.screenshot({ path: path.join(shots, 'cobros-recibos-escritorio.png'), fullPage: true });

  await page.click('[data-receipt-filter="draft"]');
  const draft = await page.$eval('.finance-fiscal-receipt-list>article', row => ({
    state: row.querySelector('.finance-badge').textContent,
    actions: [...row.querySelectorAll('button')].map(button => button.textContent.trim())
  }));
  console.log('2) en preparación:', JSON.stringify(draft));
  check(draft.state === 'En preparación', 'el recibo vinculado debe mostrar En preparación');
  check(draft.actions.includes('Ver proceso') && !draft.actions.includes('Preparar factura'), 'no debe duplicar la preparación fiscal');

  await page.click('[data-receipt-filter="pending"]');
  for (const viewport of [{ width: 390, height: 844, label: 'movil-390' }, { width: 320, height: 760, label: 'movil-320' }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('[data-finance-panel="fiscal"]');
      const visible = element => { const style = getComputedStyle(element); return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0; };
      const under12 = [...root.querySelectorAll('p,span,small,label,button,strong,em')].filter(visible).filter(element => element.textContent.trim() && parseFloat(getComputedStyle(element).fontSize) < 11.99).map(element => element.textContent.trim().slice(0, 35));
      const shortTargets = [...root.querySelectorAll('button')].filter(visible).map(element => ({ text: element.textContent.trim(), rect: element.getBoundingClientRect() })).filter(item => item.rect.height < 43.5 || item.rect.width < 43.5).map(item => item.text);
      const filters = root.querySelector('.finance-fiscal-receipt-filters');
      return {
        overflow: root.scrollWidth > root.clientWidth + 1,
        under12,
        shortTargets,
        filterRows: Math.round(filters.scrollHeight / filters.querySelector('button').getBoundingClientRect().height)
      };
    });
    console.log(`3) ${viewport.label}:`, JSON.stringify(metrics));
    check(!metrics.overflow, `${viewport.label} no debe desbordar horizontalmente`);
    check(metrics.under12.length === 0, `${viewport.label} no debe mostrar microtexto`);
    check(metrics.shortTargets.length === 0, `${viewport.label} debe conservar objetivos táctiles`);
    check(metrics.filterRows === 1, `${viewport.label} debe mantener los filtros en una fila`);
    await page.screenshot({ path: path.join(shots, `cobros-recibos-${viewport.label}.png`), fullPage: true });
  }
  console.log('errores de página:', JSON.stringify(errors));
  check(errors.length === 0, 'no debe haber errores de página');
  await browser.close(); server.close(); process.exit(failures ? 1 : 0);
});
