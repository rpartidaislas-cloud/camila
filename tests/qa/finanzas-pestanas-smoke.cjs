// Humo de navegador de Finanzas v6 (pestañas con cifra), con Supabase simulado (tests/qa/fake-supabase-cobros.js) y datos ficticios.
// Comprueba: cuatro pestañas y ninguna «Resumen»; cada pestaña muestra solo lo suyo; cifras y avisos de cada pestaña; cabecera igual en todas
// (Cobrar y Más); un solo nombre por cosa; sumas en centavos ($100.20 en tres pagos de $33.40 queda en cero); caja con cobros y salidas
// separados; listas de 50 en 50; flechas del teclado; acceso desde Configuración; y que nada se desborda en computadora, tableta y celular.
// Paso 2: «Por cobrar» (cuatro vistas, un botón por fila, saldo alineado, búsqueda sin acentos, recordatorios) y «Pagos» (periodo, forma de pago,
// abono/anticipo/reembolso con su nombre, recibo desde su pago y exportación a Excel registrada en Seguridad).
//   NODE_PATH=$(npm root -g) node tests/qa/finanzas-pestanas-smoke.cjs      (requiere Playwright y Chromium)
// Sale con código 1 si algo falla. Con SMYL_SHOTS=/carpeta guarda capturas.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const root = path.resolve(__dirname, '..', '..'), shots = process.env.SMYL_SHOTS || '';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

// Clínica ficticia: 4 cuentas con saldo ($5,700.00, de los cuales $800.00 vencidos), 2 citas atendidas sin cobrar, un anticipo,
// caja abierta con $500.00 de fondo, $1,300.00 cobrados en efectivo y una salida de $120.00, y un borrador de factura.
function seed(extra) {
  const db = window.__db, T = db.camila_tenants[0].id, H = 3600e3, D = 24 * H, now = Date.now();
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0); const today = part => new Date(midnight.getTime() + (now - midnight.getTime()) * part).toISOString();   // «hoy», sin importar a qué hora corre la prueba
  const iso = ms => new Date(now - ms).toISOString(), day = ms => new Date(now - ms).toISOString().slice(0, 10);
  const names = [['Mariana', 'López Vega'], ['Jorge', 'Ramírez Solís'], ['Elena', 'Castro Núñez'], ['Luis', 'Hernández Ortiz'], ['Sofía', 'Mendoza Ruiz'], ['Carlos', 'Aguilar Peña'], ['Paola', 'Ríos Fuentes'], ['Andrés', 'Delgado Mora'], ['Ximena', 'Centavos Exactos']];
  db.camila_pacientes = names.map((n, i) => ({ id: 'p' + (i + 1), tenant_id: T, nombre: n[0], apellido: n[1], email: '', telefono: '', created_at: iso(30 * D), notas: '', alertas_medicas: [] }));
  const P = db.camila_pacientes.map(p => p.id);
  db.smyl_services = [
    { id: 's1', tenant_id: T, name: 'Limpieza dental', reference_price: 800, active: true, fiscal_status: 'reviewed', tax_treatment: 'exempt', tax_rate: 0 },
    { id: 's3', tenant_id: T, name: 'Resina', reference_price: 1200, active: true, fiscal_status: 'reviewed', tax_treatment: 'exempt', tax_rate: 0 }];
  db.smyl_appointments = [
    { id: 'a1', tenant_id: T, patient_id: P[0], service_id: 's1', branch_id: 'b1', starts_at: iso(2 * H), status: 'arrived' },
    { id: 'a2', tenant_id: T, patient_id: P[1], service_id: 's3', branch_id: 'b1', starts_at: iso(3 * H), status: 'completed' }];
  db.smyl_finance_charges = [
    { id: 'c1', tenant_id: T, patient_id: P[2], status: 'open', total_amount: 800, created_at: iso(26 * H), concept: 'Limpieza dental', due_on: null, branch_id: 'b1' },
    { id: 'c2', tenant_id: T, patient_id: P[3], status: 'open', total_amount: 1500, created_at: iso(20 * D), concept: 'Ortodoncia · mensualidad', due_on: day(6 * D), branch_id: 'b1' },
    { id: 'c3', tenant_id: T, patient_id: P[3], status: 'open', total_amount: 1500, created_at: iso(2 * D), concept: 'Ortodoncia · mensualidad', due_on: day(-24 * D), branch_id: 'b1' },
    { id: 'c4', tenant_id: T, patient_id: P[4], status: 'open', total_amount: 3600, created_at: iso(9 * D), concept: 'Resina (3 piezas)', due_on: day(-5 * D), branch_id: 'b1' },
    { id: 'c5', tenant_id: T, patient_id: P[5], status: 'open', total_amount: 800, created_at: iso(4 * D), concept: 'Limpieza dental', due_on: null, branch_id: 'b1' },
    { id: 'c6', tenant_id: T, patient_id: P[6], status: 'open', total_amount: 1200, created_at: iso(3 * D), concept: 'Resina', due_on: null, branch_id: 'b1' },
    // $100.20 pagado en tres partes de $33.40: con decimales quedaba «pendiente» con saldo $0.00.
    { id: 'c7', tenant_id: T, patient_id: P[8], status: 'open', total_amount: 100.2, created_at: iso(12 * D), concept: 'Radiografía', due_on: day(8 * D), branch_id: 'b1' }];
  db.smyl_cash_sessions = [{ id: 'cs1', tenant_id: T, branch_id: 'b1', opened_by: T, opened_at: today(0.5), status: 'open', opening_cash: 500 }];
  db.smyl_cash_adjustments = [{ id: 'adj1', tenant_id: T, cash_session_id: 'cs1', direction: 'out', amount: 120, reason: 'Compra de guantes', created_at: today(0.8), created_by: T }];
  db.smyl_finance_payments = [
    { id: 'pay1', tenant_id: T, patient_id: P[4], amount: 1600, method: 'card', reference: '4582', paid_at: iso(8 * D), received_by: T },
    { id: 'pay2', tenant_id: T, patient_id: P[5], amount: 800, method: 'cash', reference: '', paid_at: today(0.7), cash_session_id: 'cs1', received_by: T },
    { id: 'pay3', tenant_id: T, patient_id: P[6], amount: 600, method: 'transfer', reference: 'SPEI 9431', paid_at: iso(2 * D), received_by: T },
    { id: 'pay4', tenant_id: T, patient_id: P[7], amount: 500, method: 'cash', reference: '', paid_at: today(0.6), cash_session_id: 'cs1', received_by: T },
    { id: 'pay5', tenant_id: T, patient_id: P[3], amount: 700, method: 'card', reference: '1177', paid_at: iso(12 * D), received_by: T },
    { id: 'pay6', tenant_id: T, patient_id: P[8], amount: 33.4, method: 'card', reference: '', paid_at: iso(11 * D), received_by: T },
    { id: 'pay7', tenant_id: T, patient_id: P[8], amount: 33.4, method: 'card', reference: '', paid_at: iso(10 * D), received_by: T },
    { id: 'pay8', tenant_id: T, patient_id: P[8], amount: 33.4, method: 'card', reference: '', paid_at: iso(9 * D), received_by: T }];
  db.smyl_finance_payment_allocations = [
    { id: 'al1', tenant_id: T, payment_id: 'pay1', charge_id: 'c4', amount: 1600 }, { id: 'al2', tenant_id: T, payment_id: 'pay2', charge_id: 'c5', amount: 800 },
    { id: 'al3', tenant_id: T, payment_id: 'pay3', charge_id: 'c6', amount: 600 }, { id: 'al5', tenant_id: T, payment_id: 'pay5', charge_id: 'c2', amount: 700 },
    { id: 'al6', tenant_id: T, payment_id: 'pay6', charge_id: 'c7', amount: 33.4 }, { id: 'al7', tenant_id: T, payment_id: 'pay7', charge_id: 'c7', amount: 33.4 }, { id: 'al8', tenant_id: T, payment_id: 'pay8', charge_id: 'c7', amount: 33.4 }];
  db.smyl_finance_refunds = []; db.smyl_finance_refund_allocations = [];
  db.smyl_finance_receipts = db.smyl_finance_payments.map((p, i) => ({ id: 'r' + i, tenant_id: T, payment_id: p.id, folio: 101 + i, issued_at: p.paid_at }));
  db.smyl_patient_fiscal_profiles = [{ tenant_id: T, patient_id: P[4], legal_name: 'SOFIA MENDOZA RUIZ', rfc: 'XAXX010101000', fiscal_regime: '616', tax_postal_code: '44100', cfdi_use: 'S01' }];
  db.smyl_cfdi_drafts = [{ id: 'd1', tenant_id: T, patient_id: P[4], payment_id: 'pay1', status: 'draft', sandbox_status: 'pending', cfdi_version: '4.0', fiscal_snapshot: { amount: 1600 }, created_at: iso(8 * D) }];
  db.smyl_issuer_fiscal_profiles = [{ tenant_id: T, legal_name: 'CLINICA DEMO', rfc: 'XAXX010101000', fiscal_regime: '601', invoice_series: 'SMYL', fiscal_status: 'reviewed' }];
  db.smyl_cfdi_pac_readiness = []; db.smyl_cfdi_cancellation_plans = []; db.smyl_proposals = []; db.smyl_proposal_charge_batches = [];
  // Clínica grande: muchos pacientes con saldo y un pago cada uno, para comprobar las listas de 50 en 50.
  for (let i = 0; i < (extra || 0); i++) {
    const id = 'x' + i; db.camila_pacientes.push({ id, tenant_id: T, nombre: 'Paciente', apellido: 'Extra ' + String(i).padStart(3, '0'), email: '', telefono: '', created_at: iso(40 * D), notas: '', alertas_medicas: [] });
    db.smyl_finance_charges.push({ id: 'xc' + i, tenant_id: T, patient_id: id, status: 'open', total_amount: 1000, created_at: iso(30 * D), concept: 'Tratamiento', due_on: null, branch_id: 'b1' });
    db.smyl_finance_payments.push({ id: 'xp' + i, tenant_id: T, patient_id: id, amount: 250, method: 'card', reference: '', paid_at: iso((20 + i % 9) * D), received_by: T });
    db.smyl_finance_payment_allocations.push({ id: 'xa' + i, tenant_id: T, payment_id: 'xp' + i, charge_id: 'xc' + i, amount: 250 });
    db.smyl_finance_receipts.push({ id: 'xr' + i, tenant_id: T, payment_id: 'xp' + i, folio: 500 + i, issued_at: iso((20 + i % 9) * D) });
  }
}

// Lee un .xlsx (ZIP) sin librerías: devuelve el texto de cada archivo interno.
function unzip(buf) {
  const out = {}, end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), total = buf.readUInt16LE(end + 10); let at = buf.readUInt32LE(end + 16);
  for (let i = 0; i < total; i++) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen), start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'); at += 46 + nameLen + extra + comment;
  }
  return out;
}

server.listen(0, '127.0.0.1', async () => {
  const browser = await chromium.launch(); let failures = 0;
  const check = (ok, msg) => { if (!ok) { failures += 1; console.log('FALLA · ' + msg); } else console.log('ok · ' + msg); };
  const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase-cobros.js'), 'utf8');
  async function open(size, extra, prepare) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: size, deviceScaleFactor: 1 }); const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
    await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: fake }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2400);
    await page.evaluate(seed, extra || 0); if (prepare) await page.evaluate(prepare); await page.evaluate(() => ir('caja'));
    await page.waitForFunction(() => { const f = document.querySelector('#finance-tab-accounts .finance-tab-figure'); return f && /\$/.test(f.textContent); }, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    return { ctx, page, errs };
  }
  const tabs = page => page.$$eval('#p-caja [data-finance-tab]', els => els.map(e => ({ id: e.dataset.financeTab, name: e.querySelector('.finance-tab-name').textContent, figure: e.querySelector('.finance-tab-figure').textContent.trim(), note: e.querySelector('.finance-tab-note').textContent.trim(), selected: e.getAttribute('aria-selected'), tone: e.dataset.tone || '' })));
  const visiblePanels = page => page.$$eval('#p-caja [data-finance-panel]', els => els.filter(e => e.offsetParent !== null).map(e => e.dataset.financePanel));
  const go = async (page, tab) => { await page.click(`#p-caja [data-finance-tab="${tab}"]`); await page.waitForTimeout(250); };

  // ── 1. Computadora: estructura, cifras, cabecera y nombres ───────────────────────────────────
  let s = await open({ width: 1440, height: 900 }), page = s.page;
  const t = await tabs(page); console.log('pestañas:', JSON.stringify(t));
  check(t.map(x => x.name).join('|') === 'Por cobrar|Pagos|Caja|Facturación', 'hay cuatro pestañas: Por cobrar, Pagos, Caja y Facturación (sin Resumen)');
  check(t[0].selected === 'true' && (await visiblePanels(page)).join() === 'accounts', 'Finanzas abre en Por cobrar');
  check((await page.getAttribute('#p-caja', 'aria-busy')) === 'false', 'al terminar de cargar, la página ya no se anuncia como ocupada');
  check(t[0].figure === '$5,700.00' && /\$800\.00 vencido/.test(t[0].note) && /2 citas sin cobrar/.test(t[0].note) && t[0].tone === 'danger', 'Por cobrar: $5,700.00, con $800.00 vencido y 2 citas sin cobrar');
  check(t[1].figure === '$1,300.00' && /Hoy · 2 pagos/.test(t[1].note), 'Pagos: $1,300.00 cobrados hoy en 2 pagos');
  check(t[2].figure === '$1,680.00' && /^Abierta desde las /.test(t[2].note) && t[2].tone === 'ok', 'Caja: $1,680.00 y abierta desde hoy');
  check(/^1\s*borrador$/.test(t[3].figure) && t[3].note === 'Falta configurar' && t[3].tone === 'warning', 'Facturación: 1 borrador y falta configurar');
  const header = {}; const seen = {};
  for (const tab of ['accounts', 'receipts', 'cash', 'fiscal']) {
    await go(page, tab);
    seen[tab] = (await visiblePanels(page)).join();
    header[tab] = await page.$eval('#p-caja .finance-head-actions', e => [...e.querySelectorAll(':scope>button,:scope>details>summary')].map(b => b.textContent.trim()).join('|'));
    if (shots) await page.screenshot({ path: path.join(shots, `finanzas-${tab}-escritorio.png`), fullPage: true });
  }
  check(Object.keys(seen).every(k => seen[k] === k), 'cada pestaña muestra solo su propio contenido: ' + JSON.stringify(seen));
  check(Object.values(header).every(h => h === 'Más|Cobrar'), 'la cabecera es la misma en las cuatro pestañas (Más y Cobrar)');
  const text = await page.$eval('#p-caja', e => e.textContent);
  check(!/Panorama financiero|asuntos? por atender|Del saldo al cierre|ORDEN DE TRABAJO|ESTADO FINANCIERO/.test(text), 'el Resumen repetido ya no existe');

  await go(page, 'cash');
  const cash = await page.$eval('#finance-cash', e => ({ dl: [...e.querySelectorAll('dl dt')].map((dt, i) => dt.textContent + '=' + e.querySelectorAll('dl dd')[i].textContent), buttons: [...e.querySelectorAll('button')].map(b => b.textContent.trim()) }));
  console.log('caja:', JSON.stringify(cash));
  check(cash.dl.join('|') === 'Fondo inicial=$500.00|Cobros en efectivo=$1,300.00|Salidas=−$120.00|Efectivo esperado=$1,680.00', 'Caja separa lo cobrado ($1,300.00) de las salidas (−$120.00) y cuadra en $1,680.00');
  const cashButtons = await page.$$eval('#p-caja button', els => els.filter(e => e.offsetParent !== null).map(e => e.textContent.trim()).filter(x => /corte|Entrada|salida/i.test(x)));
  check(cashButtons.join('|') === 'Entrada o salida|Hacer corte', 'en Caja los botones aparecen una sola vez: ' + cashButtons.join(', '));
  await go(page, 'fiscal');
  const fiscalButtons = await page.$$eval('#p-caja button', els => els.filter(e => e.offsetParent !== null).map(e => e.textContent.trim()).filter(x => /configuraci/i.test(x)));
  check(fiscalButtons.length === 1 && fiscalButtons[0] === 'Terminar configuración', 'en Facturación hay un solo botón de configuración: ' + fiscalButtons.join(', '));

  // Nombres: la cabecera y las ventanas que abre.
  await go(page, 'accounts');
  const visits = await page.$eval('#finance-visits', e => ({ title: e.querySelector('h2').textContent.trim(), buttons: [...new Set([...e.querySelectorAll('.finance-line button')].map(b => b.textContent.trim()))] }));
  check(/^Citas atendidas sin cobrar\s*2$/.test(visits.title) && visits.buttons.join('|') === 'Fue sin costo|Registrar cargo', 'las citas sin cobrar usan «Registrar cargo» y «Fue sin costo»');
  await page.click('#p-caja .finance-operations-menu>summary'); await page.waitForTimeout(150);
  const menu = await page.$$eval('#p-caja .finance-operations-menu button strong', els => els.map(e => e.textContent.trim()));
  check(menu.join('|') === 'Registrar cargo|Recibir anticipo|Importar cotización|Política de inasistencia', 'el menú Más ofrece: ' + menu.join(', '));
  const titles = {};
  await page.click('#finance-new-charge'); await page.waitForTimeout(400);
  titles.cargo = await page.$eval('#finance-dialog h2', e => e.textContent.trim()); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  check(!(await page.$eval('#p-caja .finance-operations-menu', e => e.open)), 'el menú Más se cierra al elegir una opción');
  await page.click('#p-caja .finance-operations-menu>summary'); await page.click('#finance-new-advance'); await page.waitForTimeout(400);
  titles.anticipo = await page.$eval('#finance-dialog h2', e => e.textContent.trim()); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await page.click('#finance-guided-collection'); await page.waitForTimeout(400);
  titles.cobrar = await page.$eval('#finance-dialog h2', e => e.textContent.trim()); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  check(titles.cargo === 'Registrar cargo' && titles.anticipo === 'Recibir anticipo' && titles.cobrar === 'Cobrar', 'las ventanas se llaman igual que su botón: ' + JSON.stringify(titles));

  // Centavos: la cuenta de $100.20 pagada en tres partes no está pendiente ni vencida, y aparece liquidada.
  const pending = await page.$$eval('#finance-accounts .finance-line .finance-line-name', els => els.map(e => e.textContent));
  check(pending.length === 4 && !pending.includes('Ximena Centavos Exactos'), 'la cuenta pagada al centavo no aparece en «Con saldo»: ' + pending.join(', '));
  check((await page.$eval('#finance-account-summary', e => e.textContent)) === '4 cuentas · $5,700.00' && (await page.$eval('#finance-accounts-title', e => e.textContent)) === 'Cuentas con saldo', 'el encabezado dice «Cuentas con saldo · 4 cuentas · $5,700.00»');
  await page.click('#p-caja [data-account-filter="all"]'); await page.waitForTimeout(200);
  const exact = await page.$$eval('#finance-accounts .finance-line', rows => { const r = rows.find(x => /Centavos Exactos/.test(x.textContent)); return r ? { state: r.dataset.accountState, amount: r.querySelector('.finance-line-amount').textContent.trim(), pay: !!r.querySelector('[data-account-pay]'), action: r.querySelector('.finance-line-actions .btn').textContent } : null; });
  check(exact && exact.state === 'settled' && /\$0\.00\s*liquidada/.test(exact.amount) && !exact.pay && exact.action === 'Ver cuenta', 'esa cuenta sale liquidada, con «Ver cuenta» y sin botón de cobro: ' + JSON.stringify(exact));
  await page.click('#p-caja [data-account-filter="overdue"]'); await page.waitForTimeout(200);
  const overdue = await page.$$eval('#finance-accounts .finance-line .finance-line-name', els => els.map(e => e.textContent));
  check(overdue.join() === 'Luis Hernández Ortiz' && (await page.$eval('#finance-accounts-title', e => e.textContent)) === 'Cuentas vencidas', 'Vencidas muestra solo a quien debe fuera de fecha: ' + overdue.join(', '));
  await page.click('#p-caja [data-account-filter="open"]'); await page.waitForTimeout(150);

  // Teclado: las flechas recorren las pestañas.
  await page.focus('#finance-tab-accounts'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
  const afterRight = (await visiblePanels(page)).join(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200);
  check(afterRight === 'receipts' && (await visiblePanels(page)).join() === 'accounts', 'las flechas del teclado cambian de pestaña');

  // Desde Configuración se llega a la pestaña pedida.
  await page.evaluate(() => window.SmylSettingsHub.openItem('cobros', 'Corte de caja')); await page.waitForTimeout(900);
  check((await page.$eval('#finance-tab-cash', e => e.getAttribute('aria-selected'))) === 'true' && (await visiblePanels(page)).join() === 'cash', 'Configuración → Finanzas → Corte de caja abre la pestaña Caja');
  check(s.errs.length === 0, 'sin errores de página en computadora: ' + JSON.stringify(s.errs));
  await s.ctx.close();

  // ── 2. Clínica grande: listas de 50 en 50 ────────────────────────────────────────────────────
  s = await open({ width: 1440, height: 900 }, 130); page = s.page;
  const rowCount = () => page.$$eval('#finance-accounts .finance-line', els => els.length);
  const more = () => page.$eval('#finance-accounts .finance-more-rows', e => e.textContent.trim()).catch(() => '');
  const first = [await rowCount(), await more()];
  await page.click('#finance-accounts [data-more-rows="accounts"]'); await page.waitForTimeout(200); const second = [await rowCount(), await more()];
  await page.click('#finance-accounts [data-more-rows="accounts"]'); await page.waitForTimeout(200); const third = [await rowCount(), await more()];
  console.log('cuentas por páginas:', JSON.stringify([first, second, third]));
  check(first[0] === 50 && /Mostrando 50 de 134/.test(first[1]) && second[0] === 100 && third[0] === 134 && third[1] === '', 'las cuentas se muestran de 50 en 50 hasta completar 134');
  await go(page, 'receipts');
  const payRows = () => page.$$eval('#finance-payments .finance-line', els => els.length);
  const todayOnly = await payRows();
  check(todayOnly === 2, 'Pagos abre en Hoy: 2 filas aunque el historial tenga 138 pagos (' + todayOnly + ')');
  // Con un periodo amplio, la lista también va de 50 en 50.
  await page.click('#p-caja [data-pay-period="custom"]'); await page.waitForTimeout(150);
  await page.fill('#finance-pay-from', new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)); await page.fill('#finance-pay-to', new Date(Date.now() + 86400000).toISOString().slice(0, 10)); await page.waitForTimeout(250);
  const r1 = await payRows(), wide = await page.$eval('#finance-payments .finance-total-strip span', e => e.textContent);
  await page.click('#finance-payments [data-more-rows="payments"]'); await page.waitForTimeout(200); const r2 = await payRows();
  check(r1 === 50 && r2 === 100 && /^138 pagos del /.test(wide), 'en un periodo amplio los pagos van de 50 en 50 (' + r1 + ' → ' + r2 + ') y el total cuenta los 138: ' + wide);
  const timing = await page.evaluate(async () => { const out = {}; for (const tab of ['cash', 'fiscal', 'accounts', 'receipts', 'accounts']) { const b = document.querySelector('#p-caja [data-finance-tab="' + tab + '"]'), t0 = performance.now(); b.click(); out[tab] = Math.max(out[tab] || 0, Math.round(performance.now() - t0)); await new Promise(r => setTimeout(r, 40)); } out.nodos = document.getElementById('p-caja').querySelectorAll('*').length; return out; });
  console.log('cambio de pestaña (ms) y elementos:', JSON.stringify(timing));
  check(Math.max(timing.cash, timing.fiscal, timing.accounts, timing.receipts) < 300 && timing.nodos < 6000, 'cambiar de pestaña es inmediato y la página no se llena de elementos');
  check(s.errs.length === 0, 'sin errores de página con la clínica grande: ' + JSON.stringify(s.errs));
  await s.ctx.close();

  // ── 3. Tableta y celular: sin desbordes, pestañas completas y objetivos táctiles ─────────────
  // En tableta vertical (820 px) el menú lateral deja unos 460 px a Finanzas: debe usar el diseño angosto aunque la pantalla sea ancha.
  for (const [label, size, cols] of [['tableta-horizontal', { width: 1024, height: 768 }, 4], ['tableta', { width: 820, height: 1100 }, 2], ['celular', { width: 390, height: 844 }, 2], ['celular-320', { width: 320, height: 760 }, 2]]) {
    s = await open(size); page = s.page;
    for (const tab of ['accounts', 'receipts', 'cash', 'fiscal']) {
      await go(page, tab);
      const m = await page.evaluate(() => {
        const rootEl = document.querySelector('#p-caja'), visible = el => { const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0; };
        const cards = [...rootEl.querySelectorAll('.finance-tabcards>button')];
        return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, cols: new Set(cards.map(b => Math.round(b.getBoundingClientRect().left))).size,
          clipped: cards.filter(b => { const n = b.querySelector('.finance-tab-figure'); return n.scrollWidth > n.clientWidth + 1 || b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > innerWidth + 1; }).length,
          overlap: [...rootEl.querySelectorAll('.finance-line,.finance-row')].filter(visible).filter(row => { const kids = [...row.children].filter(visible).map(k => k.getBoundingClientRect()); return kids.some((a, i) => kids.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)); }).length,
          tiny: [...rootEl.querySelectorAll('p,span,small,label,button,strong,em,b')].filter(visible).filter(el => el.textContent.trim() && parseFloat(getComputedStyle(el).fontSize) < 11.99).map(el => el.textContent.trim().slice(0, 30)),
          space: Math.round(rootEl.clientWidth - parseFloat(getComputedStyle(rootEl).paddingLeft) - parseFloat(getComputedStyle(rootEl).paddingRight)),
          // Objetivos táctiles: 44 px en celular; en tableta, los 40 px que usa toda la app. Nada más chico que eso.
          short: rootEl.clientWidth > 780 ? [] : [...rootEl.querySelectorAll('button,summary,select,input')].filter(visible).map(el => ({ t: (el.textContent || el.placeholder || '').trim().slice(0, 26), h: el.getBoundingClientRect().height })).filter(x => x.h < (innerWidth <= 720 ? 43.5 : 39.5)).map(x => x.t + ' (' + Math.round(x.h) + ')'),
          panels: [...rootEl.querySelectorAll('[data-finance-panel]')].filter(e => e.offsetParent !== null).map(e => e.dataset.financePanel).join() };
      });
      if (shots) await page.screenshot({ path: path.join(shots, `finanzas-${tab}-${label}.png`), fullPage: true });
      check(!m.overflow && m.cols === cols && m.clipped === 0 && m.overlap === 0 && m.tiny.length === 0 && m.short.length === 0 && m.panels === tab, `${label} · ${tab} (${m.space} px útiles): sin desborde ni filas encimadas, ${cols} columnas de pestañas, sin texto diminuto ni botones chicos ` + (m.overflow || m.clipped || m.overlap || m.tiny.length || m.short.length || m.cols !== cols ? JSON.stringify(m) : ''));
    }
    const order = await page.$eval('#p-caja .finance-head-actions', e => [...e.children].map(c => ({ t: (c.querySelector('summary') || c).textContent.trim(), x: Math.round(c.getBoundingClientRect().left), w: Math.round(c.getBoundingClientRect().width) })).sort((a, b) => a.x - b.x));
    // El menú Más se despliega bajo su botón y sus cuatro opciones quedan a la vista (en celular no las tapa la barra de navegación).
    await go(page, 'accounts'); await page.evaluate(() => window.scrollTo(0, 0)); await page.click('#p-caja .finance-operations-menu>summary'); await page.waitForTimeout(250);
    const reach = await page.$$eval('#p-caja .finance-operations-menu button', els => els.map(el => { const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { t: el.querySelector('strong').textContent, ok: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && !!top && el.contains(top) }; }));
    check(reach.length === 4 && reach.every(x => x.ok), `${label}: las cuatro opciones del menú Más se pueden tocar ` + (reach.every(x => x.ok) ? '' : JSON.stringify(reach)));
    await page.click('#p-caja .finance-operations-menu>summary'); await page.waitForTimeout(120);
    if (size.width <= 820) check(order[0].t === 'Cobrar' && order[0].w > order[1].w * 1.8, `${label}: Cobrar ocupa el ancho y Más queda a su derecha ` + JSON.stringify(order));
    check(s.errs.length === 0, `sin errores de página en ${label}: ` + JSON.stringify(s.errs));
    await s.ctx.close();
  }

  // ── 4. Paso 2: «Por cobrar» con filas limpias y «Pagos» por periodo ───────────────────────────
  // Casos propios: un reembolso de hoy, un recordatorio enviado hace 3 días y un chat de WhatsApp vinculado a la cuenta vencida.
  const stepTwo = () => {
    const db = window.__db, T = db.camila_tenants[0].id, now = Date.now(), midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const today = part => new Date(midnight.getTime() + (now - midnight.getTime()) * part).toISOString();
    db.smyl_finance_refunds = [{ id: 'rf1', tenant_id: T, payment_id: 'pay3', amount: 200, reason: 'Se cobró de más en la resina', refunded_at: today(0.9), created_by: T }];
    db.smyl_finance_refund_allocations = [{ id: 'ra1', tenant_id: T, refund_id: 'rf1', charge_id: 'c6', amount: 200 }];
    db.smyl_collection_reminders = [{ id: 'cr1', tenant_id: T, patient_id: 'p4', sent_at: new Date(now - 3 * 86400000 - 60000).toISOString() }];
    db.camila_lana_handoffs = [{ id: 'h1', tenant_id: T, patient_id: 'p4', lana_conversation_id: 'conv-1', lana_channel: 'whatsapp', updated_at: new Date(now - 86400000).toISOString() }];
    window.__collected = []; window.__exports = [];
    const inbox = Object.create(window.SmylInbox || {});
    Object.defineProperties(inbox, { canAccess: { value: () => true }, collect: { value: c => window.__collected.push(c) }, open: { value: () => {} } });
    window.SmylInbox = inbox;
    window.SmylSecurity = { recordExport: async d => { window.__exports.push(d); return { ok: true }; } };
  };
  s = await open({ width: 1440, height: 900 }, 0, stepTwo); page = s.page;
  const chips = () => page.$$eval('#p-caja .finance-chips>button', els => els.map(e => e.textContent.trim().replace(/\s+/g, ' ') + (e.getAttribute('aria-pressed') === 'true' ? '*' : '')));
  const lines = () => page.$$eval('#finance-accounts .finance-line', els => els.map(e => ({ name: e.querySelector('.finance-line-name').textContent, sub: e.querySelector('.finance-line-who small').textContent.trim(), paid: e.querySelector('.finance-line-paid').textContent.trim(), amount: e.querySelector('.finance-line-amount strong').textContent, buttons: [...e.querySelectorAll('.finance-line-actions>.btn')].map(b => b.textContent), danger: e.querySelectorAll('.finance-tag[data-tone=danger]').length, right: Math.round(e.querySelector('.finance-line-amount').getBoundingClientRect().right), button: Math.round(e.querySelector('.finance-line-actions>.btn').getBoundingClientRect().right) })));
  check((await chips()).join('|') === 'Con saldo 4*|Vencidas 1|A favor 1|Todas', 'Por cobrar tiene cuatro vistas con su conteo: ' + (await chips()).join(' · '));
  let rows = await lines(); console.log('cuentas con saldo:', JSON.stringify(rows.map(r => [r.name, r.sub, r.paid, r.amount])));
  check(rows.length === 4 && rows[0].name === 'Luis Hernández Ortiz' && rows.every(r => r.buttons.join() === 'Cobrar'), 'cada fila tiene un solo botón (Cobrar) y la cuenta vencida va primero');
  check(new Set(rows.map(r => r.right)).size === 1 && new Set(rows.map(r => r.button)).size === 1, 'el saldo y el botón quedan alineados en todas las filas');
  check(rows.filter(r => r.danger).map(r => r.name).join() === 'Luis Hernández Ortiz', 'solo lo vencido lleva color');
  check(/^Vencida \$800\.00 desde hace [5-7] días · Avisado hace 3 días$/.test(rows[0].sub) && rows[0].paid === '$700.00 de $3,000.00' && rows[0].amount === '$2,300.00', 'la fila vencida dice cuánto, desde cuándo y cuándo se avisó: ' + rows[0].sub);
  check(rows.find(r => r.name === 'Elena Castro Núñez').paid === 'Sin abonos todavía' && rows.find(r => r.name === 'Paola Ríos Fuentes').paid === '$400.00 de $1,200.00', 'la columna Pagado muestra el avance real (el reembolso descuenta lo pagado)');
  await page.click('#finance-accounts .finance-line[data-account-state=overdue] .finance-row-menu>summary'); await page.waitForTimeout(150);
  const reminder = await page.$$eval('#finance-accounts .finance-row-menu[open] button', els => els.map(e => e.textContent));
  await page.click('#finance-accounts [data-remind]'); await page.waitForTimeout(150);
  check(reminder.join('|') === 'Enviar otro recordatorio|Abrir chat|No contactar' && (await page.evaluate(() => window.__collected)).join() === 'conv-1', 'el menú de la cuenta vencida abre el recordatorio en el chat para revisarlo (no se envía solo): ' + reminder.join(', '));
  await page.click('#finance-accounts .finance-line[data-account-state=overdue] .finance-row-menu>summary');
  await page.click('#finance-accounts .finance-line[data-account-state=overdue] button.finance-line-who'); await page.waitForTimeout(400);
  check(await page.$eval('#finance-dialog', e => e.open && e.textContent.includes('Luis Hernández Ortiz')), 'tocar el nombre abre la cuenta completa del paciente');
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await page.fill('#finance-search', 'lopez'); await page.waitForTimeout(200); rows = await lines();
  const found = { title: await page.$eval('#finance-accounts-title', e => e.textContent), chips: await chips(), visits: await page.$$eval('#finance-visits .finance-line strong', els => els.map(e => e.textContent)) };
  check(rows.length === 1 && rows[0].name === 'Mariana López Vega' && rows[0].buttons.join() === 'Ver cuenta' && found.title === 'Resultados de «lopez»' && !found.chips.some(c => c.endsWith('*')) && found.visits.join() === 'Mariana López Vega', 'buscar «lopez» encuentra a López (sin acento) en cualquier vista, con su cita por cobrar: ' + JSON.stringify(found));
  await page.fill('#finance-search', ''); await page.waitForTimeout(150);
  await page.click('#p-caja [data-account-filter="all"]'); await page.waitForTimeout(200); rows = await lines();
  check(rows.map(r => r.buttons[0]).join() === 'Cobrar,Cobrar,Cobrar,Cobrar,Ver cuenta,Ver cuenta,Ver cuenta' && rows[4].amount === '$500.00' && rows[4].name === 'Andrés Delgado Mora', 'en Todas, quien no debe ofrece «Ver cuenta» y el saldo a favor se lee como tal');
  const peek = await page.$eval('#finance-visits', e => e.textContent.trim());
  await page.click('#finance-visits [data-visits-show]'); await page.waitForTimeout(200);
  check(/^2 citas atendidas sin cobrar · Ver$/.test(peek) && (await chips())[0].endsWith('*') && (await page.$$eval('#finance-visits .finance-line', els => els.length)) === 2, 'fuera de «Con saldo» las citas no desaparecen: un aviso regresa a ellas (' + peek + ')');

  await go(page, 'receipts');
  const strip = () => page.$eval('#finance-payments .finance-total-strip', e => [...e.children].map(c => c.textContent.trim())).catch(() => []);
  const pays = () => page.$$eval('#finance-payments .finance-line', els => els.map(e => ({ kind: e.dataset.kind, name: e.querySelector('.finance-line-name').textContent, sub: e.querySelector('.finance-line-who small').textContent.trim(), how: e.querySelector('.finance-line-how span').textContent, amount: e.querySelector('.finance-line-amount strong').textContent, actions: [...e.querySelectorAll('.finance-line-actions>button')].map(b => b.textContent) })));
  let st = await strip(), list = await pays(); console.log('pagos de hoy:', JSON.stringify(st), JSON.stringify(list.map(x => [x.kind, x.name, x.sub, x.amount])));
  check(st[0] === '$1,100.00' && st[1] === '2 pagos y 1 reembolso hoy' && st[2] === 'Efectivo $1,300.00 · Tarjeta $0.00 · Transferencia −$200.00', 'Pagos abre en Hoy con el total neto y su desglose: ' + st.join(' | '));
  check((await tabs(page))[1].figure === st[0], 'la cifra de la pestaña Pagos es la misma que el total de la lista');
  check(list.map(x => x.kind).join() === 'refund,full,advance' && list[0].amount === '−$200.00' && /^Reembolso Se cobró de más en la resina · pago del /.test(list[0].sub) && list[1].sub === 'Limpieza dental' && list[2].sub === 'Anticipo Queda como saldo a favor', 'cada movimiento dice lo que es: reembolso con su motivo, pago completo sin etiqueta y anticipo');
  check(list.every(x => x.actions.join() === 'Recibo'), 'cada fila tiene una sola acción a la vista: Recibo');
  await page.click('#p-caja [data-pay-period="week"]'); await page.waitForTimeout(200); list = await pays(); st = await strip();
  const partial = list.find(x => x.kind === 'partial');
  check(list.length === 4 && partial && partial.sub === 'Abono Resina · Reembolsado $200.00' && st[1] === '3 pagos y 1 reembolso en los últimos 7 días', '«7 días» suma el abono de hace dos días, que avisa de su reembolso: ' + (partial && partial.sub));
  await page.selectOption('#finance-pay-method', 'cash'); await page.waitForTimeout(200); list = await pays(); st = await strip();
  check(list.length === 2 && list.every(x => x.how === 'Efectivo') && st.join('|') === '$1,300.00|2 pagos en efectivo en los últimos 7 días', 'el filtro de forma de pago deja solo el efectivo: ' + st.join(' | '));
  await page.selectOption('#finance-pay-method', ''); await page.waitForTimeout(150);
  await page.click('#finance-payments .finance-line[data-kind=full] [data-open-receipt]'); await page.waitForTimeout(350);
  check(await page.$eval('#finance-dialog', e => e.open && !!e.querySelector('.finance-receipt-detail') && /Recibo #\d{6}/.test(e.textContent)), '«Recibo» abre el recibo de ese pago');
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await page.click('#finance-payments .finance-line[data-kind=full] .finance-row-menu>summary'); await page.click('#finance-payments .finance-row-menu[open] [data-refund]'); await page.waitForTimeout(350);
  check((await page.$eval('#finance-dialog h2', e => e.textContent.trim())) === 'Registrar reembolso', 'el menú del pago ofrece «Reembolsar pago»');
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);

  // Exportar: el Excel trae lo mismo que la pantalla y la descarga queda registrada antes de generarse.
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#finance-pay-export')]);
  const file = path.join(os.tmpdir(), 'smyl-humo-' + download.suggestedFilename()); await download.saveAs(file); await page.waitForTimeout(300);
  const book = unzip(fs.readFileSync(file)), sheet = book['xl/worksheets/sheet1.xml'] || '', recorded = await page.evaluate(() => window.__exports);
  check(/^pagos-\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.xlsx$/.test(download.suggestedFilename()) && /<sheet name="Pagos"/.test(book['xl/workbook.xml']) && /<sheet name="Totales"/.test(book['xl/workbook.xml']), 'Exportar descarga un Excel con las hojas Pagos y Totales: ' + download.suggestedFilename());
  check((sheet.match(/<row /g) || []).length === 5 && ['Paola Ríos Fuentes', 'Reembolso', 'Anticipo', 'Abono', 'Se cobró de más en la resina'].every(x => sheet.includes(x)) && /<v>-200<\/v>/.test(sheet) && /<v>800<\/v>/.test(sheet), 'el Excel lleva los 4 movimientos del periodo con su tipo e importe (el reembolso, en negativo)');
  check(recorded.length === 1 && recorded[0].record_count === 4 && recorded[0].purpose === 'administration' && /^pagos:/.test(recorded[0].entity_id) && /Se descargó pagos-/.test(await page.$eval('#finance-feedback', e => e.textContent)), 'la exportación queda registrada en Seguridad y se confirma en pantalla: ' + JSON.stringify(recorded));
  let leaked = false; const onDownload = () => { leaked = true; }; page.on('download', onDownload);
  await page.evaluate(() => { window.SmylSecurity = { recordExport: async () => { throw new Error('La exportación no quedó registrada.'); } }; });
  await page.click('#finance-pay-export'); await page.waitForTimeout(1200); page.off('download', onDownload);
  check(!leaked && /no quedó registrada/.test(await page.$eval('#finance-feedback', e => e.textContent)), 'si la exportación no se puede registrar, no se descarga nada');
  await page.click('#p-caja [data-pay-period="custom"]'); await page.waitForTimeout(150);
  await page.fill('#finance-pay-to', '2020-01-31'); await page.fill('#finance-pay-from', '2020-01-01'); await page.waitForTimeout(250);
  const empty = { text: await page.$eval('#finance-payments .finance-empty', e => e.textContent.trim()), disabled: await page.$eval('#finance-pay-export', e => e.disabled), range: await page.$$eval('#finance-pay-range input', els => els.map(e => e.value).join(' a ')) };
  check(/^Sin pagos del 1 ene 2020 al 31 ene 2020/.test(empty.text) && empty.disabled && empty.range === '2020-01-01 a 2020-01-31', 'un periodo sin pagos lo dice claro y no deja exportar: ' + JSON.stringify(empty));
  check(s.errs.length === 0, 'sin errores de página en el recorrido del paso 2: ' + JSON.stringify(s.errs));
  await s.ctx.close();

  // Las mismas pantallas, con sus casos, en tableta y celular: nada encimado, nada cortado y todo se puede tocar.
  for (const [label, size] of [['tableta-horizontal', { width: 1024, height: 768 }], ['tableta', { width: 820, height: 1100 }], ['celular', { width: 390, height: 844 }], ['celular-360', { width: 360, height: 780 }], ['celular-320', { width: 320, height: 760 }]]) {
    s = await open(size, 0, stepTwo); page = s.page; const bad = [];
    const audit = async view => {
      const m = await page.evaluate(() => {
        const rootEl = document.querySelector('#p-caja'), visible = el => { const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden' && el.getClientRects().length > 0; };
        const cut = el => { const r = el.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; };
        return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          overlap: [...rootEl.querySelectorAll('.finance-line')].filter(visible).filter(row => { const kids = [...row.children].filter(visible).map(k => k.getBoundingClientRect()); return kids.some((a, i) => kids.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)); }).length,
          cut: [...rootEl.querySelectorAll('.finance-chips>button,.finance-segment>button,.finance-line-amount,.finance-line-actions>*,.finance-tools-end>*')].filter(visible).filter(cut).length,
          tiny: [...rootEl.querySelectorAll('p,span,small,label,button,strong,em,b')].filter(visible).filter(el => el.textContent.trim() && parseFloat(getComputedStyle(el).fontSize) < 11.99).length,
          // Un filtro desplegable debe mostrar completa la opción elegida: se compara con un gemelo sin límite de ancho que solo lleva esa opción.
          clipped: [...rootEl.querySelectorAll('.finance-list-tools select')].filter(visible).filter(el => { const twin = el.cloneNode(false); twin.removeAttribute('id'); twin.appendChild(el.options[el.selectedIndex].cloneNode(true)); twin.style.cssText = 'position:absolute;visibility:hidden;width:auto;min-width:0;max-width:none'; el.parentNode.appendChild(twin); const need = twin.getBoundingClientRect().width; twin.remove(); return el.getBoundingClientRect().width < need - 0.5; }).length,
          short: rootEl.clientWidth > 780 ? [] : [...rootEl.querySelectorAll('button,summary,select,input')].filter(visible).map(el => ({ t: (el.textContent || el.placeholder || el.id || '').trim().slice(0, 24), h: el.getBoundingClientRect().height })).filter(x => x.h < (innerWidth <= 720 ? 43.5 : 39.5)).map(x => x.t + ' (' + Math.round(x.h) + ')'),
          rows: rootEl.querySelectorAll('.finance-line').length };
      });
      if (m.overflow || m.overlap || m.cut || m.tiny || m.clipped || m.short.length || !m.rows) bad.push(view + ' ' + JSON.stringify(m));
      if (shots) await page.screenshot({ path: path.join(shots, `finanzas-paso2-${view}-${label}.png`), fullPage: true });
    };
    await audit('con-saldo');
    await page.click('#p-caja [data-account-filter="overdue"]'); await page.waitForTimeout(200); await audit('vencidas');
    await page.click('#p-caja [data-account-filter="all"]'); await page.waitForTimeout(200); await audit('todas');
    await go(page, 'receipts'); await audit('pagos-hoy');
    await page.click('#p-caja [data-pay-period="month"]'); await page.waitForTimeout(200); await audit('pagos-mes');
    await page.click('#p-caja [data-pay-period="custom"]'); await page.waitForTimeout(200); await page.fill('#finance-pay-from', new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10)); await page.fill('#finance-pay-to', new Date(Date.now() + 86400000).toISOString().slice(0, 10)); await page.waitForTimeout(200); await audit('pagos-fechas');
    // El menú de una fila se despliega completo dentro de la pantalla.
    const kebab = page.locator('#finance-payments .finance-row-menu>summary').last(); await kebab.scrollIntoViewIfNeeded(); await kebab.click(); await page.waitForTimeout(450);
    const reachable = await page.$eval('#finance-payments .finance-row-menu[open] [data-refund]', el => { const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && !!top && el.contains(top); });
    check(!bad.length && reachable && s.errs.length === 0, `${label}: Por cobrar y Pagos sin desbordes, filas encimadas, texto diminuto, filtros recortados ni botones chicos; el menú de la fila se alcanza ` + (bad.length ? bad.join(' · ') : '') + (s.errs.length ? JSON.stringify(s.errs) : ''));
    await s.ctx.close();
  }

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron.` : '\nTodo bien: Finanzas v6 pasa el recorrido completo.');
  process.exit(failures ? 1 : 0);
});
