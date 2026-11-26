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

async function openPreview(t, width) {
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
  await page.evaluate(() => {
    window.tenantId='demo-a'; window.miRolEquipo='dueño';
    window.ir = route => { document.body.dataset.route = route; };
    window.SUPA_URL='https://inicio.test'; window.SUPA_KEY='demo';
    window.fetch=async () => Response.json({channels:[]});
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
        const result = {count:['smyl_clinic_hours','camila_pacientes'].includes(table) ? 1 : 0, data:{enabled:false}};
        return {select(){return this;},eq(){return this;},maybeSingle(){return this;},then(resolve){resolve(result);}};
      }
    };
  });
  await page.addScriptTag({content:complianceModel});
  await page.addScriptTag({content:script});
  return page;
}

for (const width of [320, 820, 1440]) {
  test('Configuración secundaria con foco estable y espacio táctil a ' + width + ' px', async t => {
    if (!browser) return t.skip('Se necesita Chromium.');
    const page=await openPreview(t,width);
    const section=page.locator('#smyl-clinic-setup'), toggle=section.locator('.clinic-setup-toggle');
    await toggle.waitFor();
    const compliance=page.locator('#smyl-compliance-nudge');
    await compliance.waitFor();
    assert.match(await compliance.innerText(),/18 de 20 requisitos al día/);
    assert.match(await compliance.innerText(),/Siguiente prioridad: Aviso de funcionamiento/);
    assert.equal(await compliance.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    assert.match(await toggle.innerText(), /2 de 5 pasos listos/);
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.equal(await section.locator('li:visible').count(),0);
    assert.equal(await section.evaluate(el=>el===el.parentElement.lastElementChild),true);
    const row=await toggle.boundingBox(); assert.ok(row.height >=44 && row.height<=60);
    assert.equal(await section.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await toggle.focus(); await toggle.press('Enter');
    assert.equal(await section.locator('li:visible').count(),5);
    assert.equal(await toggle.evaluate(el=>document.activeElement===el),true);
    const next=section.getByRole('button',{name:'Conectar',exact:true});
    await next.focus();
    await page.evaluate(()=>window.SmylClinicSetup.reload());
    assert.equal(await next.evaluate(el=>document.activeElement===el),true,'La actualización conserva el foco en el paso actual');
    await next.press('Enter');
    assert.equal(await page.locator('body').getAttribute('data-route'),'conexiones');
    const dismiss=section.getByRole('button',{name:'Ocultar por hoy'});
    if(width===320) assert.ok((await dismiss.boundingBox()).height>=44 && (await next.boundingBox()).height>=44);
    await dismiss.click();
    assert.equal(await section.count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'agenda');
    await page.evaluate(()=>window.SmylClinicSetup.reload());
    assert.equal(await section.count(),0,'Respeta el rechazo para el día y la clínica');
    await page.evaluate(()=>{window.tenantId='demo-b'; return window.SmylClinicSetup.reload();});
    assert.equal(await toggle.getAttribute('aria-expanded'),'false','Los otros consultorios conservan su propia preferencia');
    assert.equal(await page.evaluate(()=>{window.miRolEquipo='recepción'; return window.SmylClinicSetup.results();}),null);
    await page.evaluate(()=>window.SmylClinicSetup.reload());
    assert.equal(await section.count(),0,'Sólo lo ve el propietario');
  });
}

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
  assert.match(await section.locator('.clinic-setup-toggle').innerText(), /2 de 5 verificados/);
  assert.deepEqual(await page.evaluate(() => window.SmylClinicSetup.results().template), {unknown:true});
  await section.locator('.clinic-setup-toggle').click();
  assert.equal(await section.locator('[data-step="template"] [role="img"]').getAttribute('aria-label'), 'Sin verificar');
});
