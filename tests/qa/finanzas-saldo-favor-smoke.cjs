// Humo de navegador de «Aplicar saldo a favor» (Finanzas · paso 4), con tests/qa/fake-supabase-cobros.js.
//   NODE_PATH=$(npm root -g) node tests/qa/finanzas-saldo-favor-smoke.cjs      (requiere Playwright y Chromium)
// Comprueba: el botón solo aparece en cargos con saldo y cuando el paciente tiene saldo a favor y el rol puede cobrar;
// la ventana propone el máximo posible, no deja pasarse, y al confirmar llama a smyl_apply_credit_to_charge con una llave de idempotencia.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const smoke = fs.readFileSync(path.join(__dirname, 'finanzas-pestanas-smoke.cjs'), 'utf8');
const seedStart = smoke.indexOf('function seed(extra) {'), seedSrc = smoke.slice(seedStart, smoke.indexOf('\n}\n', seedStart) + 2);
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(0, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } }), page = await ctx.newPage(); const errs = []; let fails = 0;
  const check = (cond, msg) => { if (!cond) { console.log('FALLA · ' + msg); fails++; } else console.log('ok · ' + msg); };
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase-cobros.js'), 'utf8') }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.evaluate('(' + seedSrc + ')(0)');
  // Una paciente con $1,000 pagados y solo un cargo de $600 sin aplicar: debe $600 y tiene $1,000 a favor (se puede aplicar hasta $600).
  await page.evaluate(() => {
    const db = window.__db, T = db.camila_tenants[0].id, now = Date.now();
    db.camila_pacientes.push({ id: 'pc1', tenant_id: T, nombre: 'Marisol Saldo', apellido: 'Favor', email: '', telefono: '', created_at: new Date(now).toISOString(), notas: '', alertas_medicas: [] });
    db.smyl_finance_charges.push({ id: 'cc1', tenant_id: T, patient_id: 'pc1', status: 'open', total_amount: 600, created_at: new Date(now - 864e5).toISOString(), concept: 'Limpieza profunda', due_on: null, branch_id: 'b1' });
    db.smyl_finance_payments.push({ id: 'pc-pay', tenant_id: T, patient_id: 'pc1', amount: 1000, method: 'card', reference: '', paid_at: new Date(now - 3600e3).toISOString(), received_by: T, created_by: T, branch_id: 'b1' });
    db.smyl_finance_receipts.push({ id: 'pc-r', tenant_id: T, payment_id: 'pc-pay', folio: 900, issued_at: new Date(now - 3600e3).toISOString() });
  });
  await page.evaluate(() => ir('caja')); await page.waitForTimeout(3000);
  await page.click('#finance-accounts [data-account="pc1"]'); await page.waitForTimeout(600);
  const buttons = () => page.$$eval('#finance-dialog [data-account-credit]', e => e.map(x => x.textContent.trim()));
  check((await buttons()).join('|') === 'Aplicar saldo a favor', 'el cargo con saldo ofrece «Aplicar saldo a favor» (' + (await buttons()).join('|') + ')');
  await page.click('#finance-dialog [data-account-credit="cc1"]'); await page.waitForTimeout(500);
  const form = await page.$eval('#finance-dialog', d => ({ title: d.querySelector('h2').textContent.trim(), text: d.querySelector('p').textContent.replace(/\s+/g, ' '), amount: d.querySelector('[name=amount]').value, max: d.querySelector('[name=amount]').max, actions: [...d.querySelectorAll('.finance-actions button')].map(x => x.textContent.trim()) }));
  check(form.title === 'Aplicar saldo a favor' && /debe \$600\.00/.test(form.text) && /tiene \$1,000\.00 a favor/.test(form.text), 'la ventana dice cuánto debe y cuánto tiene a favor: ' + form.text.slice(0, 120));
  check(form.amount === '600.00' && form.max === '600.00' && form.actions.join('|') === 'Cancelar|Aplicar saldo', 'propone el máximo ($600.00) y no deja pasarse');
  await page.fill('#finance-dialog [name=amount]', '250.50'); await page.click('#finance-dialog .finance-actions .btn-primary'); await page.waitForTimeout(1200);
  const call = await page.evaluate(() => (window.__calls || []).filter(c => c[0] === 'rpc' && c[1] === 'smyl_apply_credit_to_charge').map(c => c[2])[0]);
  check(call && call.p_patient_id === 'pc1' && call.p_charge_id === 'cc1' && call.p_amount === 250.5 && /^[0-9a-f-]{36}$/.test(call.p_idempotency_key) && /^[0-9a-f-]{36}$/.test(call.p_id), 'envía paciente, cargo, importe y llaves: ' + JSON.stringify(call));
  check(/Saldo a favor aplicado: \$250\.50/.test(await page.$eval('#finance-feedback', e => e.textContent)), 'avisa «Saldo a favor aplicado: $250.50.»');
  console.log('errores de página:', JSON.stringify(errs)); if (errs.length) fails++;
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
});
