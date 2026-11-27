// Humo de navegador: en Tratamiento el diagnóstico guía y no bloquea.
//   NODE_PATH=$(npm root -g) node tests/qa/tratamiento-guia-smoke.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8');
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
  const P = 'p2000000-0000-4000-8000-000000000002';
  await page.evaluate((P) => { window.miRolEquipo = 'dueño'; const T = window.__db.camila_pacientes[0].tenant_id;
    window.__db.smyl_clinical_plans = [{ tenant_id: T, patient_id: P, revision: 2, status: 'reviewed', treatment_id: null, updated_by: T, reviewed_by: T, updated_at: new Date().toISOString(), reviewed_at: new Date().toISOString(), document: { schema: 2, reason: 'Dolor', background: '', assessment: 'Caries profunda en 36', treatments: [{ id: 't1', name: 'Resina', area: '', notes: '', phase: 'treat', service_id: null, service_revision: null, service_snapshot: null, teeth: [], surfaces: [] }] } }]; }, P);
  await page.evaluate((P) => window.verPaciente(P), P); await page.waitForTimeout(2500);
  const tab = page.getByRole('tab', { name: 'Tratamiento' }).first(); if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500); }
  else { await page.evaluate(() => { const b = [...document.querySelectorAll('button,[role=tab]')].find(x => /^Tratamiento$/.test(x.textContent.trim())); if (b) b.click(); }); await page.waitForTimeout(1500); }
  const steps = await page.evaluate(() => [...document.querySelectorAll('.cw-step')].map(s => ({ label: s.dataset.label, route: s.dataset.route, text: s.querySelector('.cw-step-status')?.textContent || '' })));
  console.log(JSON.stringify(steps));
  check(steps.length === 4, 'la ruta tiene 4 etapas');
  const byLabel = Object.fromEntries(steps.map(s => [s.label, s]));
  check(byLabel['Diagnóstico'] && byLabel['Diagnóstico'].route === 'skipped', 'con el plan aprobado y el diagnóstico sin cerrar, Diagnóstico queda «omitido» (amarillo), no bloquea');
  check(byLabel['Plan de tratamiento'] && byLabel['Plan de tratamiento'].route === 'done', 'el plan aprobado cuenta como listo');
  check(byLabel['Presupuesto y aceptación'] && byLabel['Presupuesto y aceptación'].route === 'current', 'la etapa en curso es Presupuesto');
  check(await page.locator('.cw-diag-note:not([hidden])').count() >= 1, 'se muestra el aviso «Diagnóstico pendiente»');
  await page.evaluate(() => document.querySelector('.cw-step[data-label="Plan de tratamiento"]').click()); await page.waitForTimeout(500);
  const dock = await page.evaluate(() => document.querySelector('.cw-route-dock')?.innerText.replace(/\s+/g, ' ') || '');
  console.log('dock (plan):', dock);
  check(!/no está disponible/.test(dock), 'ver el plan ya no dice «Esta etapa todavía no está disponible»');
  check(/Ir a Presupuesto y aceptación/.test(dock) && /Diagnóstico pendiente/.test(dock), 'el pie lleva al presupuesto y recuerda que el diagnóstico sigue pendiente');
  await page.evaluate(() => document.querySelector('.cw-step[data-label="En tratamiento"]').click()); await page.waitForTimeout(500);
  const dock2 = await page.evaluate(() => document.querySelector('.cw-route-dock')?.innerText.replace(/\s+/g, ' ') || '');
  console.log('dock (en tratamiento):', dock2);
  check(/aceptar el presupuesto/.test(dock2), '«En tratamiento» sigue bloqueado hasta aceptar el presupuesto, con el motivo correcto');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await page.screenshot({ path: process.env.TMPDIR ? process.env.TMPDIR + '/trat-guia.png' : '/tmp/trat-guia.png' });
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
