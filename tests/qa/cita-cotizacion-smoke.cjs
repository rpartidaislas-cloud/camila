// Humo de navegador: la cita se liga a un concepto ya cotizado y cargado, y deja de estar «pendiente de cobro».
//   NODE_PATH=$(npm root -g) node tests/qa/cita-cotizacion-smoke.cjs
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html'; const f = path.join(root, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const handler = `rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);const S=window.__ql=window.__ql||{links:[]};
if(name==='smyl_appointment_quote_candidates'){const here=S.links.some(l=>l.a===args.p_appointment_id);const rem=2-S.links.length;if(!here&&rem<=0)return {data:[],error:null};return {data:[{proposal_id:'b0000000-0000-4000-8000-000000000001',proposal_revision:1,proposal_item_id:'quote-1',label:'Implante dental',service_id:'s1',quantity:2,linked:S.links.length,remaining:rem,linked_here:here,suggested:true}],error:null};}
if(name==='smyl_link_appointment_quote_item'){S.links.push({a:args.p_appointment_id});return {data:null,error:null};}
if(name==='smyl_unlink_appointment_quote_item'){S.links=S.links.filter(l=>l.a!==args.p_appointment_id);return {data:null,error:null};}
if(name==='smyl_appointment_quote_links_for'){return {data:S.links.map(l=>({appointment_id:l.a,proposal_id:'b0000000-0000-4000-8000-000000000001',proposal_item_id:'quote-1',label:'Implante dental'})),error:null};}
if(name==='smyl_appointment_billing'&&S.links.length){return {data:args.p_appointment_ids.map(id=>({appointment_id:id,billing_state:S.links.some(l=>l.a===id)?'covered':'pending',charged_amount:0,due_amount:0})),error:null};}
`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8').replace("rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);", handler);
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);
  await page.evaluate(() => ir('agenda')); await page.waitForTimeout(2500);
  await page.locator('[data-appointment="a2"]').first().click(); await page.waitForTimeout(900);
  check(await page.locator('.sched-quote-row:not([hidden])').count() === 1, 'la ficha de la cita ofrece la fila «Cotización»');
  check(/Sugerido/.test(await page.textContent('.sched-quote-row')) && /Implante dental/.test(await page.textContent('.sched-quote-row')), 'sugiere el concepto cotizado');
  await page.click('.sched-quote-row button'); await page.waitForTimeout(900);
  check(/✓ Implante dental/.test(await page.textContent('.sched-quote-row')), 'queda ligada al concepto');
  check(/Cubierta por cotización/.test(await page.textContent('.sched-billing-row')), 'el cobro de la cita pasa a «Cubierta por cotización»');
  await page.click('.sched-quote-row button'); await page.waitForTimeout(900);
  check(!/✓/.test(await page.textContent('.sched-quote-row')) && /Ligar a/.test(await page.textContent('.sched-quote-row')), 'se puede quitar el enlace');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
