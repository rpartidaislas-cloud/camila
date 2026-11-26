import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {after, before, test} from 'node:test';

const project = new URL('../', import.meta.url);
const html = readFileSync(new URL('app.html', project), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const styles = Array.from(head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*rel="stylesheet"[^>]*>/gi), m => m[0]).join('\n');
const script = readFileSync(new URL('smyl-clinic-setup.js', project), 'utf8');
const complianceModel = readFileSync(new URL('smyl-compliance-model.js', project), 'utf8');
let browser;
before(async () => {
  try {
    browser = await createRequire(import.meta.url)('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM});
  } catch (error) { if (process.env.SMYL_CHROMIUM) throw error; }
});
after(async () => browser?.close());

// Conteos por tabla del Supabase simulado: lo que no aparece cuenta 0.
const COUNTS = {smyl_branches: 1, smyl_clinic_hours: 5, smyl_rooms: 1, smyl_professional_hours: 0, smyl_services: 3, camila_pacientes: 1};

async function openPreview(t, width, counts = COUNTS) {
  const page = await browser.newPage({viewport: {width, height: 840}, hasTouch:width < 500});
  t.after(() => page.close()); page.setDefaultTimeout(5000);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://inicio.test') return route.abort();
    if (url.pathname === '/') {
      return route.fulfill({contentType:'text/html', body:'<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1">' + styles + '</head><body class="smyl-professional smyl-management-v3 smyl-ui-governed"><main class="contenido"><section id="p-dashboard" class="pantalla activa"><div id="smyl-daily-home" class="daily-home"><button id="agenda">Ver agenda</button></div></section></main></body></html>'});
    }
    if (/^\/[\w.-]+\.css$/.test(url.pathname)) {
      return route.fulfill({contentType:'text/css', body:readFileSync(new URL(url.pathname.slice(1),project),'utf8')});
    }
    return route.abort();
  });
  await page.goto('https://inicio.test/', {waitUntil:'load'});
  await page.evaluate(counts => {
    window.tenantId='demo-a'; window.miRolEquipo='dueño'; window.__counts = counts;
    window.ir = route => { document.body.dataset.route = route; };
    window.SUPA_URL='https://inicio.test'; window.SUPA_KEY='demo';
    window.fetch=async () => Response.json({channels:[{channel:'whatsapp', connected:false}]});
    window.sb={
      auth:{getSession:async () => ({ data:{session:{access_token:'demo'}} })},
      functions:{invoke:async () => ({data:{templates:[]}})},
      rpc:async name => name === 'smyl_compliance_overview' ? {data:{
        sterilization:{cycles:1,last_bio_at:new Date().toISOString(),last_bio_result:'negative'},
        rpbi:{collections:1,kg:2},
        activity:{signed_notes:1,draft_notes:0,consents_signed:1,consents_revoked:0,verified_procedures:1,visits:1},
        items:[
          {key:'titulo_visible',status:'have'},{key:'rotulo_horario',status:'have'},{key:'contrato_rpbi',status:'have'},
          {key:'contenedores_rpbi',status:'have'},{key:'fauna_nociva',status:'have'},{key:'bitacora_limpieza',status:'have'},
          {key:'cisterna',status:'have'},{key:'cloro_residual',status:'have'},{key:'autoclave',status:'have'},
          {key:'botiquin',status:'have'},{key:'telefonos_emergencia',status:'have'},{key:'vacunas_personal',status:'have'},
          {key:'medicamentos',status:'have'},{key:'protocolos',status:'not_applicable'},{key:'equipo_rayos_x',status:'not_applicable'}
        ]
      }} : {data:null},
      from(table) {
        const filters = [];
        const query = {select(){return this;}, eq(){return this;}, neq(){return this;}, gt(){return this;}, maybeSingle(){return this;},
          then(resolve){ resolve({count: window.__counts[table] || 0, data: {enabled: false, no_show_enabled: false, level: 'off'}}); }};
        return query;
      }
    };
  }, counts);
  await page.addScriptTag({content:complianceModel});
  await page.addScriptTag({content:script});
  return page;
}

for (const width of [320, 820, 1440]) {
  test('Puesta en marcha: avance, siguiente paso y lista completa a ' + width + ' px', async t => {
    if (!browser) return t.skip('Se necesita Chromium.');
    const page=await openPreview(t,width);
    const section=page.locator('#smyl-clinic-setup');
    await section.locator('.setup-next').waitFor();
    const compliance=page.locator('#smyl-compliance-nudge');
    await compliance.waitFor();
    assert.match(await compliance.innerText(),/18 de 20 requisitos al día/);
    assert.match(await compliance.innerText(),/Siguiente prioridad: Aviso de funcionamiento/);
    assert.equal(await compliance.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    // 11 pasos obligatorios; con estos datos están listos: sucursal, horario, consultorio, equipo, servicios, paciente = 6.
    assert.equal(await section.locator('.setup-percent').innerText(), '55 %');
    assert.match(await section.innerText(), /6 de 11 pasos listos/);
    const bar = section.locator('[role="progressbar"]');
    assert.equal(await bar.getAttribute('aria-valuenow'), '55');
    assert.equal(await section.locator('.setup-bar-fill').evaluate(el => el.style.width), '55%');
    assert.match(await section.locator('.setup-next').innerText(), /siguiente paso\s+Pon el horario de tus dentistas/i);
    assert.equal(await section.evaluate(el=>el===el.parentElement.lastElementChild),true);
    assert.equal(await section.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true, 'sin scroll horizontal');
    if (process.env.SMYL_SHOT) await page.screenshot({path: process.env.SMYL_SHOT + '-tarjeta-' + width + '.png'});

    // Lista completa: grupos, obligatorios y recomendados.
    const all = section.getByRole('button', {name: 'Ver todos los pasos'});
    await all.focus(); await all.press('Enter');
    const dialog = page.locator('#smyl-setup-dialog');
    await dialog.waitFor();
    assert.equal(await dialog.locator('[data-step]').count(), 16);
    assert.deepEqual(await dialog.locator('.setup-group-title span').allInnerTexts(), ['Tu clínica','Tu equipo','Servicios','Mensajes a pacientes','Pacientes y agenda','Recomendados']);
    assert.match(await dialog.locator('[data-group="clinic"] .setup-group-title small').innerText(), /3 de 3/);
    assert.match(await dialog.locator('[data-group="extra"] .setup-group-title small').innerText(), /No cuentan para el 100 %/);
    assert.equal(await dialog.locator('[data-step="branch"]').getAttribute('data-done'), 'true');
    assert.equal(await dialog.locator('[data-step="professional"]').getAttribute('data-next'), 'true');
    assert.equal(await dialog.locator('[data-step="branch"] [role="img"]').getAttribute('aria-label'), 'Completado');
    assert.equal(await dialog.locator('[data-step="branch"] button').count(), 0, 'lo completado no ofrece botón');
    assert.equal(await dialog.locator('[data-step="whatsapp"] [role="img"]').getAttribute('aria-label'), 'Pendiente');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'setup-close');
    if (process.env.SMYL_SHOT) await page.screenshot({path: process.env.SMYL_SHOT + '-lista-' + width + '.png'});
    if (width === 320) assert.ok((await dialog.locator('[data-step="whatsapp"] button').boundingBox()).height >= 44);

    // Botón de un paso: cierra la ventana y lleva a su pantalla.
    await dialog.locator('[data-step="whatsapp"] button').click();
    assert.equal(await page.locator('body').getAttribute('data-route'),'conexiones');
    assert.equal(await dialog.evaluate(el => el.open), false);

    // El botón del siguiente paso de la tarjeta lleva a su pantalla.
    await section.getByRole('button', {name: 'Poner horario', exact: true}).click();
    assert.equal(await page.locator('body').getAttribute('data-route'),'agenda');

    // Ocultar por hoy: respeta el rechazo por día y clínica; otro consultorio la vuelve a ver.
    const dismiss=section.getByRole('button',{name:'Ocultar por hoy'});
    if(width===320) assert.ok((await dismiss.boundingBox()).height>=44);
    await dismiss.click();
    assert.equal(await section.count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'agenda');
    await page.evaluate(()=>window.SmylClinicSetup.reload());
    assert.equal(await section.count(),0,'Respeta el rechazo para el día y la clínica');
    await page.evaluate(()=>{window.tenantId='demo-b'; return window.SmylClinicSetup.reload();});
    assert.equal(await section.count(),1,'Los otros consultorios conservan su propia preferencia');
    assert.equal(await page.evaluate(()=>{window.miRolEquipo='recepción'; return window.SmylClinicSetup.results();}),null);
    await page.evaluate(()=>window.SmylClinicSetup.reload());
    assert.equal(await section.count(),0,'Sólo lo ve el propietario');
  });
}

test('Con todos los pasos obligatorios listos la tarjeta desaparece y la lista confirma que la clínica está lista', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const full = Object.assign({}, COUNTS, {smyl_professional_hours: 4, smyl_member_roles: 1, smyl_appointments: 2});
  const page = await openPreview(t, 820, full);
  await page.evaluate(() => {
    window.fetch = async () => Response.json({channels:[{channel:'whatsapp', connected:true, display_name:'Clínica'}]});
    window.sb.functions.invoke = async () => ({data:{templates:[{status:'APPROVED', category:'UTILITY'}]}});
    const original = window.sb.from;
    window.sb.from = table => { const q = original(table); const then = q.then; q.then = resolve => then.call(q, result => resolve(Object.assign({}, result, {data: {enabled: true, no_show_enabled: false, level: 'off'}}))); return q; };
  });
  await page.evaluate(() => window.SmylClinicSetup.reload());
  assert.equal(await page.locator('#smyl-clinic-setup').count(), 0);
  assert.equal((await page.evaluate(() => window.SmylClinicSetup.summary())).percent, 100);
  await page.evaluate(() => window.SmylClinicSetup.open());
  assert.match(await page.locator('#smyl-setup-dialog').innerText(), /Tu clínica está lista/);
});

test('Un paso cuya lectura falla queda «sin verificar» y no cuenta como listo', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await openPreview(t, 820);
  await page.evaluate(() => {
    const original = window.sb.from;
    window.sb.from = table => table === 'smyl_rooms' ? { select(){return this;}, eq(){return this;}, then(resolve){ resolve({error:{message:'sin permiso'}}); } } : original(table);
  });
  await page.evaluate(() => window.SmylClinicSetup.reload());
  const results = await page.evaluate(() => window.SmylClinicSetup.results());
  assert.deepEqual(results.rooms, {unknown:true});
  await page.locator('#smyl-clinic-setup').getByRole('button', {name: 'Ver todos los pasos'}).click();
  assert.equal(await page.locator('[data-step="rooms"] [role="img"]').getAttribute('aria-label'), 'Sin verificar');
  assert.match(await page.locator('[data-step="rooms"]').innerText(), /No pudimos verificarlo ahora/);
});

test('Una verificación tardía de otra clínica no reemplaza los datos de la clínica actual', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page = await openPreview(t, 820);
  const section = page.locator('#smyl-clinic-setup');
  await section.waitFor();
  await page.evaluate(() => {
    window.sb.functions.invoke = () => new Promise(resolve => {
      window.finishPreviousCheck = () => resolve({data:{templates:[{status:'APPROVED', category:'UTILITY'}]}});
    });
    window.previousCheck = window.SmylClinicSetup.reload();
  });
  await page.waitForFunction(() => typeof window.finishPreviousCheck === 'function');
  await page.evaluate(async () => {
    window.tenantId = 'demo-b';
    window.sb.functions.invoke = async () => ({error:{message:'No disponible'}});
    await window.SmylClinicSetup.reload();
    window.finishPreviousCheck();
    await window.previousCheck;
  });
  assert.deepEqual(await page.evaluate(() => window.SmylClinicSetup.results().template), {unknown:true});
  await section.getByRole('button', {name: 'Ver todos los pasos'}).click();
  assert.equal(await page.locator('[data-step="template"] [role="img"]').getAttribute('aria-label'), 'Sin verificar');
});
