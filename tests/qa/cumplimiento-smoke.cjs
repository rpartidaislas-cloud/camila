// Humo de navegador de «Cumplimiento sanitario» con tests/qa/fake-supabase-agenda.js.
//   NODE_PATH=$(npm root -g) node tests/qa/cumplimiento-smoke.cjs
// Abre la pantalla, registra un testigo biológico y una recolección RPBI, marca un requisito y genera el reporte.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const handler = `rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);if(name.startsWith('smyl_compliance')||name==='smyl_log_sterilization'||name==='smyl_log_rpbi'||name==='smyl_set_compliance_item'){const S=window.__cp=window.__cp||{ster:[],rpbi:[],items:[]};
if(name==='smyl_log_sterilization'){S.ster.push(Object.assign({kind:args.p_kind,occurred_at:new Date().toISOString()},args.p_values));return {data:{},error:null};}
if(name==='smyl_log_rpbi'){S.rpbi.push(args.p_values);return {data:{},error:null};}
if(name==='smyl_set_compliance_item'){S.items=S.items.filter(i=>i.key!==args.p_key);if(args.p_status!=='clear')S.items.push({key:args.p_key,status:args.p_status,reference:args.p_reference,valid_until:args.p_valid_until});return {data:{},error:null};}
const bios=S.ster.filter(r=>r.kind==='biological_test');const last=bios[bios.length-1];
return {data:{from:'2025-11-23',to:'2026-11-23',sterilization:{cycles:S.ster.filter(r=>r.kind==='cycle').length,bio_tests:bios.length,last_bio_at:last&&last.occurred_at,last_bio_result:last&&last.bio_result,positives:0,recent:S.ster},rpbi:{collections:S.rpbi.length,kg:0,recent:S.rpbi},items:S.items,activity:{signed_notes:2,draft_notes:0,verified_procedures:1,consents_signed:1,consents_revoked:0,visits:3}},error:null};}`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200)));
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8').replace("rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);", handler);
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.evaluate(() => ir('cumplimiento')); await page.waitForTimeout(800);
  check(await page.evaluate(() => document.getElementById('p-cumplimiento').classList.contains('activa')), 'la pantalla abre');
  check((await page.textContent('#cp-content')).includes('requisitos al día'), 'muestra el resumen');
  await page.click('button:has-text("Testigo biológico")'); await page.waitForTimeout(200);
  await page.click('dialog.cp-dialog button[type=submit]'); await page.waitForTimeout(600);
  check(await page.evaluate(() => (window.__cp.ster || []).some(r => r.kind === 'biological_test' && r.bio_result === 'negative')), 'registra el testigo biológico');
  await page.click('button:has-text("Registrar recolección")'); await page.waitForTimeout(200);
  await page.click('dialog.cp-dialog button[type=submit]'); await page.waitForTimeout(200);
  check((await page.textContent('dialog.cp-dialog .cp-error')).length > 0, 'el manifiesto es obligatorio');
  await page.fill('dialog.cp-dialog [name=manifest]', 'M-100'); await page.click('dialog.cp-dialog button[type=submit]'); await page.waitForTimeout(600);
  check(await page.evaluate(() => window.__cp.rpbi.length === 1), 'registra la recolección');
  await page.click('.cp-row-item button:has-text("Marcar")'); await page.waitForTimeout(200);
  await page.fill('dialog.cp-dialog [name=reference]', 'F-77'); await page.click('dialog.cp-dialog button[type=submit]'); await page.waitForTimeout(600);
  check(await page.evaluate(() => window.__cp.items.length === 1), 'marca un requisito');
  await page.evaluate(() => { window.print = () => { window.__printed = document.getElementById('cp-print-root').innerText; }; });
  await page.click('#cp-report'); await page.waitForTimeout(400);
  const printed = await page.evaluate(() => window.__printed || '');
  check(/Carpeta de cumplimiento sanitario/.test(printed) && /M-100/.test(printed), 'el reporte incluye título y manifiesto');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
