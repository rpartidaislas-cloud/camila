// Humo de navegador del vigilante de congelamientos: simula un bucle de DOM y un bloqueo largo, con un Sentry interceptado.
//   NODE_PATH=$(npm root -g) node tests/qa/freeze-watchdog-smoke.cjs [loop|busy|hidden|idle]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { r.writeHead(200, {'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'text/plain'}); r.end(fs.readFileSync(f)); }
  else { r.writeHead(404); r.end(); }
}).listen(0, async () => {
  const port = srv.address().port; const events = [];
  const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
  await ctx.route('https://o4512394436083712.ingest.us.sentry.io/**', (route) => { const body = route.request().postData() || ''; events.push(body.split('\n').slice(2).join('\n')); route.fulfill({ status: 200, body: '{}', headers: {'access-control-allow-origin': '*'} }); });
  await page.route('**/*supabase*', (route) => route.abort());
  await page.goto(`http://localhost:${port}/simulacion.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.SmylFreezeWatchdog, null, { timeout: 8000 });
  await page.waitForTimeout(4000);
  page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('NAV', f.url().slice(-40)); });
  await page.evaluate(() => { window.SmylSentry.setContext({ userId: 'u-1', tenantId: 'clinic-1', role: 'staff' }); });
  await page.waitForTimeout(1500);
  const mode = process.argv[2] || 'loop';
  if (mode === 'loop') {
    // Reproduce el bucle de microtareas del error de pacientes: no se espera al evaluate porque la página se congela.
    page.evaluate(() => { document.body.dataset.x = 1; const o = new MutationObserver(() => { const d = document.createElement('div'); d.id = 'bucle-prueba'; document.body.appendChild(d); d.remove(); }); o.observe(document.body, { childList: true }); document.body.appendChild(document.createElement('i')); }).catch(() => {});
    await new Promise(r => setTimeout(r, 11000));
  } else if (mode === 'busy') {
    // Bloqueo largo pero que termina (8 s): debe dar "ongoing" y luego "recovered".
    page.evaluate(() => { const t = Date.now(); while (Date.now() - t < 8000) {} }).catch(() => {});
    await new Promise(r => setTimeout(r, 12000));
  } else if (mode === 'hidden') {
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    page.evaluate(() => { const t = Date.now(); while (Date.now() - t < 8000) {} }).catch(() => {});
    await new Promise(r => setTimeout(r, 12000));
  } else { await new Promise(r => setTimeout(r, 9000)); }
  console.log(mode, '→ eventos:', events.length);
  events.forEach(e => { try { const j = JSON.parse(e); console.log(' ', j.tags.outcome, '|', j.message, '|', JSON.stringify(j.extra), '| user', JSON.stringify(j.user), '| clinic', j.tags.clinic, '| fp', j.fingerprint.join('/')); } catch (_) { console.log(' (no JSON)', e.slice(0, 200)); } });
  await b.close(); srv.close(); process.exit(0);
});
