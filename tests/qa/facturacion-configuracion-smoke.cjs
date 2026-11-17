// Humo visual de Configuración → Cobros → Facturación (cuatro pasos) con Supabase simulado.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..', '..'), fixtures = __dirname, shots = os.tmpdir();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]); if (pathname === '/') pathname = '/app.html';
  const file = path.join(root, pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = []; let failures = 0;
  const check = (ok, msg) => { if (!ok) { console.log('FALLA · ' + msg); failures++; } else console.log('ok · ' + msg); };
  page.on('pageerror', e => errors.push(e.message.slice(0, 240)));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('@supabase/supabase-js') || url.includes('/vendor/supabase-js-')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(fixtures, 'fake-supabase-cobros.js'), 'utf8') });
    return url.startsWith('http://127.0.0.1') ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const T = window.__db.camila_tenants[0].id; window.__fp = { status: 'disconnected', environment: 'test' };
    window.__issuer = null; window.__policy = false;
    const rpc = window.sb.rpc.bind(window.sb);
    window.sb.rpc = async (name, args) => {
      if (name === 'smyl_cfdi_readiness_report') return { data: { ready: false, checks: [
        { id: 'issuer', passed: !!window.__issuer }, { id: 'services', passed: false, detail: 16 },
        { id: 'provider', passed: window.__fp.status === 'connected' }, { id: 'sandbox', passed: window.__fp.status === 'connected' }, { id: 'policy', passed: window.__policy }] }, error: null };
      if (name === 'smyl_save_issuer_fiscal_profile') { window.__issuer = { tenant_id: T, legal_name: args.p_legal_name, rfc: args.p_rfc, fiscal_regime: args.p_fiscal_regime, tax_postal_code: args.p_tax_postal_code, invoice_series: args.p_invoice_series, fiscal_status: 'reviewed' }; window.__db.smyl_issuer_fiscal_profiles = [window.__issuer]; return { data: window.__issuer, error: null }; }
      if (name === 'smyl_set_cfdi_pac_readiness') { window.__policy = args.p_policy_reviewed; return { data: {}, error: null }; }
      return rpc(name, args);
    };
    window.sb.functions.invoke = async (name, opts) => {
      if (name !== 'facturapi') return { data: {}, error: null };
      const a = opts.body.action;
      if (a === 'connect') window.__fp = { status: 'connected', environment: 'test', organization_name: 'SMYL', key_fingerprint: 'AAAA0DC2', last_verified_at: new Date().toISOString() };
      if (a === 'disconnect') window.__fp = { status: 'disconnected', environment: 'test' };
      return { data: { connection: window.__fp }, error: null };
    };
    window.__db.smyl_issuer_fiscal_profiles = [];
  });
  await page.evaluate(() => window.SmylFinance.reload());
  await page.waitForTimeout(800);
  // Cobros → Facturación: solo una franja de estado, sin tarjetas de configuración.
  await page.evaluate(() => window.ir('caja')); await page.waitForTimeout(800);
  await page.click('[data-finance-tab="fiscal"]'); await page.waitForTimeout(500);
  check(await page.$('.finance-fiscal-status') !== null, 'Cobros → Facturación muestra la franja de estado');
  check(await page.$('#finance-issuer, #finance-pac, #finance-facturapi') === null, 'Cobros → Facturación ya no tiene emisor/PAC/Facturapi');
  // Configuración → Cobros → Facturación
  await page.evaluate(() => window.SmylSettingsHub.openItem('cobros', 'Facturación')); await page.waitForTimeout(1200);
  const vis = await page.evaluate(() => { const n = document.querySelector('#billing-setup'); return !!n && n.offsetParent !== null && n.closest('.settings-hub-embed') !== null; });
  check(vis, 'los pasos se muestran dentro de Configuración');
  check((await page.$$('#billing-setup .billing-setup-steps li')).length === 4, 'hay cuatro pasos');
  check((await page.textContent('.billing-setup-progress strong')).trim() === '0/4', 'progreso 0/4 al inicio');
  await page.screenshot({ path: path.join(shots, 'billing-setup-1280.png') });
  // Emisor con validación
  await page.click('[data-bs="issuer"]'); await page.waitForTimeout(300);
  await page.fill('.billing-issuer [name=legal]', 'CLINICA DENTAL SMYL'); await page.fill('.billing-issuer [name=rfc]', 'mal');
  await page.click('.billing-issuer button[type=submit]');
  check(!(await page.$eval('[data-form-error]', e => e.hidden)), 'RFC inválido muestra error en el formulario');
  await page.fill('.billing-issuer [name=rfc]', 'xaxx010101000'); await page.selectOption('.billing-issuer [name=regime]', '601'); await page.fill('.billing-issuer [name=postal]', '64000');
  await page.check('.billing-issuer [name=reviewed]'); await page.click('.billing-issuer button[type=submit]'); await page.waitForTimeout(1200);
  check((await page.textContent('.billing-setup-progress strong')).trim() === '1/4', 'guardar emisor avanza a 1/4');
  // Facturapi
  await page.click('[data-bs="facturapi"]'); await page.waitForTimeout(300);
  check(await page.$('.billing-connect-help') !== null, 'el diálogo explica cómo obtener la llave');
  const fakeKey = ['sk', 'test', 'X'.repeat(24)].join('_'); // llave falsa armada en ejecución (no es un secreto)
  await page.fill('.billing-connect [name=key]', fakeKey); await page.click('.billing-connect button[type=submit]'); await page.waitForTimeout(1500);
  check((await page.textContent('.billing-setup-progress strong')).trim() === '2/4', 'conectar Facturapi avanza a 2/4');
  check(!(await page.content()).includes(fakeKey), 'la llave no queda en el DOM');
  await page.screenshot({ path: path.join(shots, 'billing-setup-1280-b.png') });
  for (const [w, h] of [[834, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(!overflow, `sin desbordamiento horizontal a ${w}px`);
    await page.screenshot({ path: path.join(shots, `billing-setup-${w}.png`) });
  }
  check(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close(); process.exit(failures ? 1 : 0);
});
