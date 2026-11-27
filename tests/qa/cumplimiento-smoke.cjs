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
const handler = `rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);const S=window.__cp=window.__cp||{ster:[],rpbi:[],items:[],sanAssets:[],sanLogs:[]};
if(name==='smyl_daily_sanitation_overview'){
if(!S.sanAssets.length)S.sanAssets=[{id:'11111111-1111-4111-8111-111111111111',name:'Consultorio 1',category:'clinical_space',default_task:'Limpieza y desinfección del espacio clínico',default_product:'',source_key:'room:1',editable:false},{id:'22222222-2222-4222-8222-222222222222',name:'Área de esterilización',category:'sterilization',default_task:'Limpieza y desinfección del área',default_product:'Alcohol al 70%',source_key:'system:sterilization',editable:false}];
const day=(args&&args.p_date)||new Date().toISOString().slice(0,10);return {data:{context:{branch_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',branch_name:'Mi Consultorio',timezone:'America/Mexico_City',date:day,time:'13:05',shift:'Matutino',responsible_name:'Dd',can_write:true,can_manage:true},items:S.sanAssets.map(a=>Object.assign({},a,{last_log:[...S.sanLogs].reverse().find(l=>l.asset_id===a.id&&l.activity_date===day)||null})),history:S.sanLogs},error:null};}
if(name==='smyl_save_daily_sanitation'){(args.p_checks||[]).forEach(c=>S.sanLogs.push({id:Math.random().toString(),asset_id:c.asset_id,asset_name:(S.sanAssets.find(a=>a.id===c.asset_id)||{}).name,status:c.status,product_method:c.product_method,notes:c.notes,responsible_name:'Dd',shift:args.p_shift,shift_name:args.p_shift,activity_date:args.p_local_date,occurred_at:args.p_local_date+'T'+args.p_local_time+':00'}));return {data:{count:(args.p_checks||[]).length},error:null};}
if(name==='smyl_configure_sanitation_asset'){if(args.p_action==='create'){const v=args.p_values,id='33333333-3333-4333-8333-'+String(S.sanAssets.length+1).padStart(12,'0');S.sanAssets.push({id,name:v.name,category:v.category,default_task:v.default_task,default_product:v.default_product||'',source_key:'custom:'+id,editable:true});}else S.sanAssets=S.sanAssets.filter(a=>a.id!==args.p_values.id);return {data:{},error:null};}
if(name.startsWith('smyl_compliance')||name==='smyl_log_sterilization'||name==='smyl_log_rpbi'||name==='smyl_set_compliance_item'){
if(name==='smyl_log_sterilization'){S.ster.push(Object.assign({kind:args.p_kind,occurred_at:new Date().toISOString()},args.p_values));return {data:{},error:null};}
if(name==='smyl_log_rpbi'){S.rpbi.push(args.p_values);return {data:{},error:null};}
if(name==='smyl_set_compliance_item'){S.items=S.items.filter(i=>i.key!==args.p_key);if(args.p_status!=='clear')S.items.push({key:args.p_key,status:args.p_status,reference:args.p_reference,valid_until:args.p_valid_until,notes:args.p_notes});return {data:{},error:null};}
const bios=S.ster.filter(r=>r.kind==='biological_test');const last=bios[bios.length-1];
return {data:{from:'2025-11-23',to:'2026-11-23',sterilization:{cycles:S.ster.filter(r=>r.kind==='cycle').length,bio_tests:bios.length,last_bio_at:last&&last.occurred_at,last_bio_result:last&&last.bio_result,positives:0,recent:S.ster},rpbi:{collections:S.rpbi.length,kg:0,recent:S.rpbi},items:S.items,activity:{signed_notes:2,draft_notes:0,verified_procedures:1,consents_signed:1,consents_revoked:0,visits:3}},error:null};}`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.SMYL_CHROMIUM || undefined }); let fails = 0; const errs = [];
  const check = (c, m) => { if (!c) { console.log('FALLA ·', m); fails++; } else console.log('ok ·', m); };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200)));
  const source = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8').replace("rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);", handler);
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source }); return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.evaluate(() => ir('cumplimiento')); await page.waitForTimeout(800);
  check(await page.evaluate(() => document.getElementById('p-cumplimiento').classList.contains('activa')), 'la pantalla abre');
  check((await page.textContent('#cp-content')).includes('controles con evidencia en SMYL'), 'muestra la preparación de la guía sin llamarla certificación');
  await page.locator('.cp-row-item').filter({ hasText: 'Testigo biológico' }).locator('button').click(); await page.waitForTimeout(200);
  await page.click('dialog.cp-dialog button[type=submit]'); await page.waitForTimeout(600);
  check(await page.evaluate(() => (window.__cp.ster || []).some(r => r.kind === 'biological_test' && r.bio_result === 'negative')), 'registra el testigo biológico');
  await page.locator('.cp-row-item').filter({ hasText: 'Recolecciones de RPBI' }).locator('button').click(); await page.waitForTimeout(200);
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
  await page.click('[data-cp-view="daily"]'); await page.waitForTimeout(300);
  check((await page.textContent('#cp-content')).includes('BITÁCORA OPCIONAL EN SMYL'), 'la bitácora diaria se presenta como opcional');
  check(await page.inputValue('[name=sanitation_time]') === '13:05' && await page.inputValue('[name=sanitation_date]') !== '', 'fecha y hora aparecen prellenadas y editables');
  check((await page.textContent('#cp-content')).includes('Mi Consultorio') && (await page.textContent('#cp-content')).includes('Dd'), 'muestra sucursal y responsable resueltos por la sesión');
  await page.locator('.cp-sanitation-row').first().locator('.cp-detail-toggle').click();
  await page.locator('.cp-sanitation-row').first().locator('[name=sanitation_status]').selectOption('incident');
  await page.check('[name=sanitation_select_all]'); await page.click('button:has-text("Guardar registros")'); await page.waitForTimeout(600);
  check((await page.textContent('.cp-daily-saved')).includes('Describe la incidencia'), 'una incidencia exige observación antes de guardar');
  await page.locator('.cp-sanitation-row').first().locator('[name=sanitation_notes]').fill('Faltó producto; se repuso antes del siguiente paciente.');
  await page.click('button:has-text("Guardar registros")'); await page.waitForTimeout(600);
  check(await page.evaluate(() => window.__cp.sanLogs.length === 2 && new Set(window.__cp.sanLogs.map(r => r.asset_id)).size === 2 && window.__cp.sanLogs.some(r => r.status === 'incident')), 'seleccionar pendientes guarda un registro auditable por equipo o área');
  check(await page.evaluate(() => window.__cp.sanLogs.some(r => r.product_method === 'Alcohol al 70%')), 'reutiliza el método habitual sin bloquear su edición');
  check(await page.evaluate(() => !document.querySelector('.cp-auto-card input[type=checkbox]')), 'las comprobaciones automáticas no se confunden con tareas manuales');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
  check(await page.evaluate(() => { const p = document.querySelector('.cp-page'); if (!p) return false; const right = Math.max(...Array.from(p.querySelectorAll('*')).filter(e => getComputedStyle(e).position !== 'fixed').map(e => e.getBoundingClientRect().right)); return p.scrollWidth <= p.clientWidth + 2 && right <= innerWidth + 2; }), 'la bitácora cabe en una PWA de 390 px sin desbordamiento horizontal');
  check(errs.length === 0, 'sin errores de página ' + errs.join(' | '));
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();
