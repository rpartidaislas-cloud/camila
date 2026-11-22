// Humo visual de Configuración → Cobros → Facturación (flujo de plataforma) con Supabase simulado.
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
  const progress = async () => (await page.textContent('.billing-setup-progress strong')).trim();
  page.on('pageerror', e => errors.push(e.message.slice(0, 240)));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('@supabase/supabase-js') || url.includes('/vendor/supabase-js-')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(fixtures, 'fake-supabase-cobros.js'), 'utf8') });
    return url.startsWith('http://127.0.0.1') ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const T = window.__db.camila_tenants[0].id;
    window.__issuer = null; window.__policy = false; window.__servicesOk = false; window.__manifestSigned = false; window.__calls = [];
    window.__fp = { status: 'disconnected', environment: 'test', mode: 'platform', has_organization: false, pending_steps: [], production_ready: false };
    const rpc = window.sb.rpc.bind(window.sb);
    window.sb.rpc = async (name, args) => {
      if (name === 'smyl_cfdi_readiness_report') return { data: { ready: false, checks: [
        { id: 'issuer', passed: !!window.__issuer }, { id: 'services', passed: !!window.__servicesOk, detail: window.__servicesOk ? 0 : 16 },
        { id: 'provider', passed: window.__fp.has_organization }, { id: 'sandbox', passed: window.__fp.has_organization }, { id: 'policy', passed: window.__policy }] }, error: null };
      if (name === 'smyl_save_issuer_fiscal_profile') { window.__issuer = { tenant_id: T, legal_name: args.p_legal_name, rfc: args.p_rfc, fiscal_regime: args.p_fiscal_regime, tax_postal_code: args.p_tax_postal_code, invoice_series: args.p_invoice_series, fiscal_status: 'reviewed' }; window.__db.smyl_issuer_fiscal_profiles = [window.__issuer]; return { data: window.__issuer, error: null }; }
      if (name === 'smyl_set_cfdi_pac_readiness') { window.__policy = args.p_policy_reviewed; window.__db.smyl_cfdi_pac_readiness = [{ tenant_id: T, provider_name: args.p_provider_name, provider_authorization_checked_at: args.p_authorization_checked ? new Date().toISOString() : null, sandbox_account_confirmed_at: args.p_sandbox_confirmed ? new Date().toISOString() : null, fiscal_policy_reviewed_at: args.p_policy_reviewed ? new Date().toISOString() : null }]; return { data: {}, error: null }; }
      return rpc(name, args);
    };
    window.sb.functions.invoke = async (name, opts) => {
      if (name !== 'facturapi') return { data: {}, error: null };
      const fd = opts.body instanceof FormData;
      const a = fd ? opts.body.get('action') : opts.body.action;
      window.__calls.push(a + (fd ? ':multipart' : ''));
      const fail = (m) => ({ data: { error: m }, error: null });
      if (a === 'provision') window.__fp = { status: 'connected', environment: 'test', mode: 'platform', has_organization: true, organization_name: 'CLINICA', key_fingerprint: 'AAAA0DC2', production_ready: false, pending_steps: [{ type: 'certificate', description: 'CSD' }, { type: 'manifiesto', description: 'Firma Carta Manifiesto' }] };
      if (a === 'upload_csd') { if (opts.body.get('password') === 'mala') return fail('El certificado o la llave privada no son válidos.'); window.__fp = { ...window.__fp, csd_valid_until: '2030-11-17T20:00:00Z', pending_steps: [{ type: 'manifiesto', description: 'Firma Carta Manifiesto' }] }; }
      if (a === 'sync' && window.__manifestSigned) window.__fp = { ...window.__fp, production_ready: true, pending_steps: [] };
      if (a === 'enable_live') { if (String(opts.body.confirm_text).trim().toUpperCase() !== 'FACTURAR EN PRODUCCION') return fail('Para confirmar escribe: FACTURAR EN PRODUCCION'); window.__fp = { ...window.__fp, environment: 'live', live_enabled_at: new Date().toISOString(), live_key_fingerprint: 'BBBB1EC3', live_stamping: !!window.__liveStamping }; }
      if (a === 'disable_live') window.__fp = { ...window.__fp, environment: 'test', live_enabled_at: null };
      return { data: { connection: window.__fp }, error: null };
    };
    window.__db.smyl_issuer_fiscal_profiles = [];
  });
  await page.evaluate(() => window.SmylFinance.reload());
  await page.waitForTimeout(800);
  // Cobros → Facturación: solo una franja de estado, sin tarjetas de configuración.
  await page.evaluate(() => window.ir('caja')); await page.waitForTimeout(800);
  await page.click('[data-finance-tab="fiscal"]'); await page.waitForTimeout(500);
  check(await page.$('#finance-fiscal .finance-setup-strip') !== null && (await page.$$('#finance-fiscal .finance-setup-strip button')).length === 1, 'Cobros → Facturación muestra la franja de estado, con un solo botón');
  check(await page.$('#finance-issuer, #finance-pac, #finance-facturapi') === null, 'Cobros → Facturación ya no tiene emisor/PAC/Facturapi');
  // Configuración → Cobros → Facturación
  await page.evaluate(() => window.SmylSettingsHub.openItem('cobros', 'Facturación')); await page.waitForTimeout(1200);
  const vis = await page.evaluate(() => { const n = document.querySelector('#billing-setup'); return !!n && n.offsetParent !== null && n.closest('.settings-hub-embed') !== null; });
  check(vis, 'los pasos se muestran dentro de Configuración');
  check((await page.$$('#billing-setup .billing-setup-steps li')).length === 5, 'hay cinco pasos, el último es producción');
  check(await progress() === '0/4', 'progreso 0/4 al inicio');
  check(await page.$('[data-step="production"][data-muted="true"]') !== null, 'producción está atenuada mientras falten pasos');
  await page.screenshot({ path: path.join(shots, 'billing-setup-1280.png') });
  // Paso 1: emisor con validación
  await page.click('[data-bs="issuer"]'); await page.waitForTimeout(300);
  await page.fill('.billing-issuer [name=legal]', 'CLINICA DENTAL SMYL'); await page.fill('.billing-issuer [name=rfc]', 'mal');
  await page.click('.billing-issuer button[type=submit]');
  check(!(await page.$eval('[data-form-error]', e => e.hidden)), 'RFC inválido muestra error en el formulario');
  await page.fill('.billing-issuer [name=rfc]', 'xaxx010101000'); await page.selectOption('.billing-issuer [name=regime]', '601'); await page.fill('.billing-issuer [name=postal]', '64000');
  await page.check('.billing-issuer [name=reviewed]'); await page.click('.billing-issuer button[type=submit]'); await page.waitForTimeout(1200);
  check(await progress() === '1/4', 'guardar emisor avanza a 1/4');
  // Paso 2: activar y subir CSD
  await page.click('[data-bs="facturapi"]'); await page.waitForTimeout(300);
  check(await page.$('.billing-csd') !== null, 'el diálogo del CSD explica qué es');
  await page.click('.billing-csd button[type=submit]');
  check(!(await page.$eval('[data-form-error]', e => e.hidden)), 'sin archivos muestra error en el formulario');
  const fakeCer = { name: 'csd.cer', mimeType: 'application/octet-stream', buffer: Buffer.alloc(400, 1) }, fakeKey = { name: 'csd.key', mimeType: 'application/octet-stream', buffer: Buffer.alloc(400, 2) };
  await page.setInputFiles('.billing-csd [name=cer]', fakeCer); await page.setInputFiles('.billing-csd [name=key]', fakeKey);
  await page.fill('.billing-csd [name=password]', 'mala'); await page.click('.billing-csd button[type=submit]'); await page.waitForTimeout(900);
  check((await page.textContent('[data-form-error]')).includes('no son válidos'), 'un CSD inválido muestra el mensaje claro');
  check((await page.inputValue('.billing-csd [name=password]')) === '', 'la contraseña se borra del formulario tras un error');
  await page.fill('.billing-csd [name=password]', 'buena-clave'); await page.click('.billing-csd button[type=submit]'); await page.waitForTimeout(1600);
  const calls = await page.evaluate(() => window.__calls);
  check(calls.includes('provision') && calls.includes('upload_csd:multipart'), 'crea la organización y sube el CSD por multipart');
  check(!(await page.isVisible('.billing-csd')), 'el diálogo se cierra al terminar');
  check(/Carta Manifiesto/.test(await page.textContent('[data-step="facturapi"]')), 'explica que falta firmar la Carta Manifiesto');
  check(!(await page.content()).includes('buena-clave'), 'la contraseña no queda en el DOM');
  // Manifiesto firmado → Revisar de nuevo
  await page.evaluate(() => { window.__manifestSigned = true; });
  await page.click('[data-bs="facturapi"]'); await page.waitForTimeout(1500);
  check(/Facturación activa/.test(await page.textContent('[data-step="facturapi"]')), 'tras firmar y revisar, la facturación queda activa');
  // Paso 4 sin servicios: aún no se puede producción
  await page.click('[data-bs="policy"]'); await page.waitForTimeout(1200);
  check(await progress() === '3/4', 'faltan los servicios con clave SAT: 3/4');
  check(await page.$('[data-bs="production"]') === null, 'sin los pasos previos no se ofrece activar producción');
  // Servicios listos → se ofrece producción
  await page.evaluate(async () => { window.__servicesOk = true; await window.SmylFinance.reload(); }); await page.waitForTimeout(1200);
  check(await progress() === '4/4', 'con servicios listos: 4/4');
  check(await page.$('[data-bs="production"]') !== null, 'se ofrece activar producción');
  await page.screenshot({ path: path.join(shots, 'billing-setup-1280-b.png') });
  // Compuerta de producción: confirmación escrita
  await page.click('[data-bs="production"]'); await page.waitForTimeout(300);
  check(await page.$eval('.billing-live button[type=submit]', b => b.disabled), 'el botón de producción está deshabilitado sin confirmar');
  check(/reales/.test(await page.textContent('.billing-live-warn')), 'advierte que las facturas serán reales');
  await page.fill('.billing-live [name=confirm]', 'si'); check(await page.$eval('.billing-live button[type=submit]', b => b.disabled), 'texto incorrecto no habilita el botón');
  await page.fill('.billing-live [name=confirm]', 'facturar en produccion'); check(!(await page.$eval('.billing-live button[type=submit]', b => b.disabled)), 'el texto correcto habilita el botón');
  await page.click('.billing-live button[type=submit]'); await page.waitForTimeout(1500);
  check((await page.$$eval('.billing-setup-head h2', n => n[0].textContent)).includes('timbrado real pendiente'), 'con el interruptor del servidor apagado, dice que el timbrado real está pendiente');
  await page.evaluate(async () => { window.__fp = { ...window.__fp, live_stamping: true }; await window.SmylFinance.ensureBilling(); }); await page.waitForTimeout(1200);
  check((await page.$$eval('.billing-setup-head h2', n => n[0].textContent)).includes('facturando en producción'), 'con el interruptor encendido, dice que se factura en producción');
  check(/BBBB1EC3|1EC3/.test(await page.textContent('[data-step="production"]')), 'muestra la huella de la llave live, nunca la llave');
  await page.screenshot({ path: path.join(shots, 'billing-setup-1280-live.png') });
  for (const [w, h] of [[834, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(!overflow, `sin desbordamiento horizontal a ${w}px`);
    await page.screenshot({ path: path.join(shots, `billing-setup-${w}.png`) });
  }
  check(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); server.close(); process.exit(failures ? 1 : 0);
});
