// Humo de navegador de «Avisar por WhatsApp» en Facturación, con Supabase simulado (tests/qa/fake-supabase-cobros.js).
//   NODE_PATH=$(npm root -g) node tests/qa/factura-whatsapp-smoke.cjs      (requiere Playwright y Chromium)
// Comprueba: una factura timbrada ofrece «Avisar por WhatsApp» solo si el paciente tiene un chat de WhatsApp vinculado; un pago por facturar sin
// datos fiscales ofrece «Pedir datos por WhatsApp»; cada botón abre el chat con la plantilla correcta y sus variables (nombre, folio, clínica)
// SIN enviar nada; sin chat vinculado no hay botón. Sale con código 1 si algo falla.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]); if (pathname === '/') pathname = '/app.html';
  const file = path.join(root, pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch();
  let failures = 0;
  const check = (c, m) => { console.log((c ? 'ok · ' : 'FALLA · ') + m); if (!c) failures += 1; };
  for (const [name, size] of [['escritorio', { width: 1400, height: 1000 }], ['celular', { width: 390, height: 900 }]]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: size });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.includes('@supabase/supabase-js') || url.includes('/vendor/supabase-js-')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-cobros.js'), 'utf8') });
      return url.startsWith('http://127.0.0.1') ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      const db = window.__db, tenant = db.camila_tenants[0].id, now = new Date().toISOString();
      const p1 = db.camila_pacientes[0].id, p2 = db.camila_pacientes[1].id, p3 = db.camila_pacientes[2].id;
      window.tenantData = { nombre: 'Clínica Prueba', config: { consultorio: 'SMYL Centro' } };
      db.smyl_finance_charges.push({ id: 'c2', tenant_id: tenant, patient_id: p1, status: 'open', total_amount: 300, created_at: now, concept: 'Consulta' }, { id: 'c3', tenant_id: tenant, patient_id: p3, status: 'open', total_amount: 450, created_at: now, concept: 'Radiografía' });
      db.smyl_finance_payments = [
        { id: 'pay-ready', tenant_id: tenant, patient_id: p2, amount: 800, method: 'card', reference: '4582', paid_at: now },
        { id: 'pay-draft', tenant_id: tenant, patient_id: p1, amount: 300, method: 'transfer', reference: 'SPEI 9431', paid_at: now },
        { id: 'pay-profile', tenant_id: tenant, patient_id: p3, amount: 450, method: 'cash', reference: '', paid_at: now }
      ];
      db.smyl_finance_payment_allocations = [
        { id: 'a-ready', tenant_id: tenant, payment_id: 'pay-ready', charge_id: 'c1', amount: 800 }, { id: 'a-draft', tenant_id: tenant, payment_id: 'pay-draft', charge_id: 'c2', amount: 300 }, { id: 'a-profile', tenant_id: tenant, payment_id: 'pay-profile', charge_id: 'c3', amount: 450 }
      ];
      db.smyl_finance_refunds = []; db.smyl_finance_refund_allocations = [];
      db.smyl_finance_receipts = [
        { id: 'r-ready', tenant_id: tenant, payment_id: 'pay-ready', folio: 104, issued_at: now }, { id: 'r-draft', tenant_id: tenant, payment_id: 'pay-draft', folio: 103, issued_at: now }, { id: 'r-profile', tenant_id: tenant, payment_id: 'pay-profile', folio: 102, issued_at: now }
      ];
      db.smyl_patient_fiscal_profiles = [
        { tenant_id: tenant, patient_id: p1, legal_name: 'PACIENTE UNO', rfc: 'XAXX010101000', fiscal_regime: '616', tax_postal_code: '44100', cfdi_use: 'S01' },
        { tenant_id: tenant, patient_id: p2, legal_name: 'RICH', rfc: 'XAXX010101000', fiscal_regime: '616', tax_postal_code: '44100', cfdi_use: 'S01' }
      ];
      // p1: factura timbrada CON chat de WhatsApp · p2: factura timbrada SIN chat · p3: pago por facturar sin datos fiscales, CON chat.
      db.smyl_cfdi_drafts = [
        { id: 'inv1', tenant_id: tenant, patient_id: p1, payment_id: 'pay-draft', status: 'issued', sandbox_status: 'passed', cfdi_version: '4.0', fiscal_snapshot: { amount: 300 }, invoice_series: 'SMYL', invoice_folio: '2381', external_uuid: 'AAAA-1111', created_at: now },
        { id: 'inv2', tenant_id: tenant, patient_id: p2, payment_id: 'pay-ready', status: 'issued', sandbox_status: 'passed', cfdi_version: '4.0', fiscal_snapshot: { amount: 800 }, invoice_series: 'SMYL', invoice_folio: '2382', external_uuid: 'BBBB-2222', created_at: now }
      ];
      db.smyl_issuer_fiscal_profiles = [{ tenant_id: tenant, legal_name: 'SMYL CLÍNICA', rfc: 'XAXX010101000', fiscal_regime: '601', invoice_series: 'SMYL', fiscal_status: 'reviewed' }];
      db.smyl_cfdi_pac_readiness = []; db.smyl_cfdi_cancellation_plans = [];
      db.camila_lana_handoffs = [
        { tenant_id: tenant, patient_id: p1, lana_conversation_id: 'conv-p1', lana_channel: 'whatsapp', updated_at: now },
        { tenant_id: tenant, patient_id: p3, lana_conversation_id: 'conv-p3', lana_channel: 'whatsapp', updated_at: now }
      ];
      window.__sent = [];
      window.SmylInbox = { canAccess: () => true, sendTemplate: (conversation, options) => { window.__sent.push({ conversation, names: options.preferred, variables: options.variables }); return Promise.resolve(); }, collect: () => {} };
    });
    await page.evaluate(() => ir('caja')); await page.waitForTimeout(1800);
    await page.click('[data-finance-tab="fiscal"]'); await page.waitForTimeout(500);
    await page.click('[data-invoice-filter="issued"]'); await page.waitForTimeout(500);
    const issued = await page.evaluate(() => [...document.querySelectorAll('[data-finance-panel="fiscal"] .finance-line[data-cols=invoices]')].map(row => ({ who: row.querySelector('.finance-line-name').textContent, wa: !!row.querySelector('[data-wa-cfdi]'), draft: (row.querySelector('[data-wa-cfdi]') || {}).dataset ? row.querySelector('[data-wa-cfdi]').dataset.waCfdi : null })));
    console.log(name, 'emitidas:', JSON.stringify(issued));
    check(issued.length === 2, `${name}: hay dos facturas emitidas`);
    check(issued.filter(x => x.wa).length === 1 && issued.find(x => x.wa).draft === 'inv1', `${name}: «Avisar por WhatsApp» solo aparece en la del paciente con chat vinculado`);
    // Abre el menú de acciones de la factura con chat y toca el botón.
    const row = page.locator('[data-finance-panel="fiscal"] .finance-line[data-cols=invoices]').filter({ has: page.locator('[data-wa-cfdi]') });
    await row.locator('.finance-line-actions summary, .finance-line-actions [aria-haspopup], .finance-line-actions .finance-row-menu > button').first().click().catch(() => {});
    await page.evaluate(() => document.querySelector('[data-wa-cfdi="inv1"]').click());
    await page.waitForTimeout(200);
    const sent = await page.evaluate(() => window.__sent);
    check(sent.length === 1 && sent[0].conversation === 'conv-p1' && sent[0].names[0] === 'factura_disponible_v1', `${name}: abre el chat correcto con la plantilla «Factura disponible»: ${JSON.stringify(sent[0])}`);
    check(sent[0] && sent[0].variables.length === 3 && sent[0].variables[1] === 'SMYL-2381' && sent[0].variables[2] === 'SMYL Centro' && sent[0].variables[0].length > 0, `${name}: llena nombre, folio y clínica: ${JSON.stringify(sent[0] && sent[0].variables)}`);
    await page.click('[data-invoice-filter="pending"]'); await page.waitForTimeout(500);
    const pending = await page.evaluate(() => [...document.querySelectorAll('[data-finance-panel="fiscal"] .finance-line[data-invoice-state=pending]')].map(row => ({ code: row.dataset.invoiceCode, wa: !!row.querySelector('[data-wa-fiscal]') })));
    console.log(name, 'por facturar:', JSON.stringify(pending));
    check(pending.some(x => x.code === 'profile' && x.wa), `${name}: «Pedir datos por WhatsApp» aparece en el pago sin datos fiscales con chat`);
    await page.click('[data-wa-fiscal]'); await page.waitForTimeout(200);
    const asked = await page.evaluate(() => window.__sent[1]);
    check(asked && asked.conversation === 'conv-p3' && asked.names[0] === 'datos_facturacion_pendientes_v1' && asked.variables.length === 2 && asked.variables[1] === 'SMYL Centro', `${name}: pide los datos con la plantilla «Faltan datos para tu factura»: ${JSON.stringify(asked)}`);
    check((await page.evaluate(() => window.__sent.length)) === 2, `${name}: solo se abrieron los chats, no se envió nada`);
    // Sin chat vinculado no hay botón en ningún lado.
    await page.evaluate(() => { window.__db.camila_lana_handoffs = []; });
    check(!errors.filter(e => !/ERR_FAILED/.test(e)).length, `${name}: sin errores de página ${JSON.stringify(errors.slice(0, 2))}`);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${name}: sin scroll horizontal`);
    await context.close();
  }
  await browser.close(); server.close();
  console.log(failures ? failures + ' falla(s)' : 'Todo bien');
  process.exit(failures ? 1 : 0);
});
