// Humo de navegador: el procedimiento (Consulta) deja ligar la cita a su concepto cotizado.
//   NODE_PATH=$(npm root -g) node tests/qa/procedimiento-cotizacion-smoke.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const handler = `rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);const S=window.__ql=window.__ql||{links:[]};
if(name==='smyl_appointment_quote_candidates'){const here=S.links.some(l=>l.a===args.p_appointment_id);const rem=2-S.links.length;if(!here&&rem<=0)return {data:[],error:null};return {data:[{proposal_id:'b0000000-0000-4000-8000-000000000001',proposal_revision:1,proposal_item_id:'quote-1',label:'Implante dental',service_id:'s1',quantity:2,linked:S.links.length,remaining:rem,linked_here:here,suggested:true}],error:null};}
if(name==='smyl_link_appointment_quote_item'){S.links.push({a:args.p_appointment_id});return {data:null,error:null};}
if(name==='smyl_unlink_appointment_quote_item'){S.links=S.links.filter(l=>l.a!==args.p_appointment_id);return {data:null,error:null};}
`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 1100 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8').replace("rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);", handler);
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
  const P = 'p2000000-0000-4000-8000-000000000002';
  const opened = await page.evaluate((P) => { window.miRolEquipo = 'dueño'; return window.SmylProcedureSafety.open({ tenant: window.tenantId, patient: P, patientName: 'Rich', appointmentId: 'a2' }); }, P);
  await page.waitForTimeout(1200);
  check(opened !== false && await page.locator('.ps-dialog').count() === 1, 'se abre el procedimiento');
  check(await page.locator('[data-ps-quote]:not([hidden])').count() === 1, 'aparece «Concepto de la cotización»');
  check(/Sugerido/.test(await page.textContent('[data-ps-quote]')) && /Implante dental/.test(await page.textContent('[data-ps-quote]')), 'sugiere el concepto cotizado');
  await page.click('[data-ps-quote] .ps-quote-btn'); await page.waitForTimeout(800);
  check(/✓ Implante dental/.test(await page.textContent('[data-ps-quote]')), 'liga la cita al concepto');
  const calls = await page.evaluate(() => window.__calls.filter(c => c[0] === 'rpc' && /quote_item/.test(c[1])).map(c => c[1] + ':' + (c[2].p_appointment_id || '')));
  check(calls.some(c => c === 'smyl_link_appointment_quote_item:a2'), 'usa la misma función que la ficha de la cita');
  await page.click('[data-ps-quote] .ps-quote-btn'); await page.waitForTimeout(800);
  check(!/✓/.test(await page.textContent('[data-ps-quote]')) && /Ligar a/.test(await page.textContent('[data-ps-quote]')), 'se puede quitar el enlace');
  await page.evaluate((P) => window.SmylProcedureSafety.open({ tenant: window.tenantId, patient: P, patientName: 'Rich' }), P); await page.waitForTimeout(800);
  check(await page.locator('[data-ps-quote]:not([hidden])').count() === 0, 'sin cita (procedimiento suelto) no aparece el bloque');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await page.screenshot({ path: '/tmp/proc-cot.png' });
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
