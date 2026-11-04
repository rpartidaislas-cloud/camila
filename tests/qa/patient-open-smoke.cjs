// Humo de navegador: abre la app real con un Supabase simulado y entra a varios pacientes.
// Falla si la página se congela o si los observadores del DOM entran en bucle (como cuando
// smyl-patient-cases y smyl-case-workspace se disputaban la galería de simulaciones).
//
//   node tests/qa/patient-open-smoke.cjs        (requiere Playwright y Chromium instalados)
//
// No forma parte de `node --test tests/*.test.mjs`: necesita navegador. Úsalo antes de publicar
// cambios que toquen la ficha del paciente (patient-360, patient-cases, case-workspace, dental-record).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const MAX_CALLBACKS_PER_OPEN = 400;

// Cuenta los callbacks de MutationObserver y los corta si se desbocan, para poder diagnosticar en vez de congelarse.
const probe = `(function(){const O=window.MutationObserver;const c={};window.__mo={counts:c,total:0,stopped:false};
window.MutationObserver=function(cb){const id=(cb.name||'anon')+' | '+String(cb).replace(/\\s+/g,' ').slice(0,60);
return new O(function(r,o){if(window.__mo.stopped)return;c[id]=(c[id]||0)+1;if(++window.__mo.total>3000){window.__mo.stopped=true;return;}return cb.call(this,r,o);});};
window.MutationObserver.prototype=O.prototype;})();`;

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
}).listen(0, async () => {
  const failures = [];
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => failures.push('Error de JavaScript: ' + e.message.slice(0, 200)));
    page.on('dialog', async (d) => { failures.push('Diálogo inesperado: ' + d.message().slice(0, 160)); await d.dismiss(); });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('@supabase/supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8') });
      return url.startsWith('http://127.0.0.1') ? route.continue() : route.abort();
    });
    await page.addInitScript(probe);
    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => ir('pacientes'));
    await page.waitForTimeout(1200);
    const rows = await page.locator('.clinic-patient-row').count();
    if (rows < 2) failures.push('El listado de pacientes no cargó filas de prueba.');

    let previous = 0;
    for (let i = 0; i < Math.min(rows, 3) && !failures.length; i += 1) {
      await page.evaluate(() => ir('pacientes')); await page.waitForTimeout(700);
      await page.evaluate((n) => document.querySelectorAll('.clinic-patient-row')[n].click(), i);
      await page.waitForTimeout(1800);
      const state = await Promise.race([
        page.evaluate(() => ({ screen: [...document.querySelectorAll('.pantalla.activa')].map((e) => e.id).join(','), galleries: document.querySelectorAll('#p-paciente-detalle .pc-gallery').length, total: window.__mo.total, stopped: window.__mo.stopped, counts: window.__mo.counts })),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!state) { failures.push(`Paciente #${i}: la página no responde (congelada).`); break; }
      const spent = state.total - previous; previous = state.total;
      if (state.stopped || spent > MAX_CALLBACKS_PER_OPEN) failures.push(`Paciente #${i}: bucle de MutationObserver (${spent} callbacks): ${JSON.stringify(state.counts)}`);
      if (state.screen !== 'p-paciente-detalle') failures.push(`Paciente #${i}: no abrió la ficha (pantalla activa: ${state.screen || 'ninguna'}).`);
      if (state.galleries !== 1) failures.push(`Paciente #${i}: se esperaba 1 galería de simulaciones y hay ${state.galleries}.`);
      console.log(`paciente #${i}: pantalla=${state.screen} galerías=${state.galleries} callbacks=${spent}`);
    }
  } finally {
    await browser.close().catch(() => {}); server.close();
  }
  if (failures.length) { console.error('\nFALLÓ:\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('OK: la ficha del paciente abre sin congelarse ni entrar en bucle.');
  process.exit(0);
});
