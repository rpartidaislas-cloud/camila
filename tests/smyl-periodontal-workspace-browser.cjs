// Runs the patient workspace, dental record, map and periodontal dialog together.
// Only the authenticated data boundary is simulated. Browser requests stay offline.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'periodontal-workspace');
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const patient = '11111111-1111-4111-8111-111111111111';
const scripts = [
  'smyl-case-model.js', 'smyl-dental-model.js', 'smyl-dental-dictation.js', 'smyl-tooth-map.js', 'smyl-periodontal-context.js',
  'smyl-periodontal-mila.js', 'smyl-periodontal-graph.js', 'smyl-periodontal-guided-model.js',
  'smyl-periodontal-guided.js', 'smyl-periodontal-review.js', 'smyl-dental-record.js',
  'smyl-dental-finding-editor.js', 'smyl-case-workspace.js'
];
const styles = [
  'smyl-design-system-v2.css', 'smyl-patient-cases.css', 'smyl-dental-record.css',
  'smyl-dental-finding-editor.css', 'smyl-case-workspace.css', 'smyl-ui-template-v3.css',
  'smyl-ui-datta-v4.css', 'smyl-periodontal-graph.css', 'smyl-periodontal-review.css', 'smyl-periodontal-guided.css'
];

function installClient({ tenant, patient, actor }) {
  window.tenantId = tenant;
  window.pacienteActual = { id:patient, nombre:'Paciente de prueba' };
  window.miRolEquipo = actor===tenant?'dueño':'staff';
  window.miUsuario = {id:actor};
  let user={id:actor,is_anonymous:false};
  const listeners=[];
  window.testSession = active => {
    if (!active) user=null;
    for (const listener of listeners) listener(user?'TOKEN_REFRESHED':'SIGNED_OUT',user?{user}:null);
  };
  window.sbTimeout = request => Promise.resolve(request);
  window.SmylPatient360 = {
    context: () => ({ ready:true, state:'ready', historyRevision:1, coverage:{pending:[]} }),
    files: () => ({total:0})
  };
  window.sb = {
    auth: {
      getUser: async () => ({data:{user},error:null}),
      onAuthStateChange: listener => listeners.push(listener)
    },
    from(table) {
      const filters = {};
      const query = {
        select: () => query,
        eq(key,value) { filters[key]=value; return query; },
        in(key,values) { filters[key]=values; return query; },
        maybeSingle: () => window.testRead({table, filters}),
        then(resolve,reject) { return window.testRead({table,filters}).then(resolve,reject); }
      };
      return query;
    },
    rpc: (name,args) => window.testRpc({name,args})
  };
}

async function scenario(browser, spec) {
  const ctx = await browser.newContext({
    viewport:{width:spec.width,height:spec.height}, hasTouch:spec.width<=768,
    isMobile:spec.width<=768, locale:'es-MX', reducedMotion:'reduce',
    serviceWorkers:'block'
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6500);
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('dialog', dialog => dialog.accept());
  let row = null;
  const closed = [];
  const actor=spec.width===768?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':tenant;
  await page.exposeFunction('testRead', ({table,filters}) => {
    assert.equal(filters.tenant_id,tenant);
    if (table==='smyl_member_roles') {
      assert.equal(filters.user_id,actor);
      return {data:[{role_id:'dentist'}],error:null};
    }
    if (table==='smyl_role_permissions') {
      assert.deepEqual(filters.role_id,['dentist']);
      return {data:[{permission_key:'clinical.read'},{permission_key:'clinical.write'}],error:null};
    }
    assert.equal(filters.patient_id,patient);
    return {data:table==='smyl_dental_records'?row:[],error:null};
  });
  await page.exposeFunction('testRpc', ({name,args}) => {
    assert.equal(args.p_patient_id,patient);
    if (name==='smyl_periodontal_history') return {data:closed,error:null};
    assert.equal(name,'smyl_save_dental_record');
    assert.equal(args.p_expected_revision,row?.revision||0);
    row = {
      tenant_id:tenant,patient_id:patient,revision:(row?.revision||0)+1,
      document:args.p_document,updated_by:actor,updated_at:new Date().toISOString()
    };
    const exam = row.document.periodontogram;
    if (exam.status==='closed'&&!closed.some(h=>h.exam.id===exam.id)) {
      closed.unshift({exam,revision:row.revision,updated_by:actor,updated_at:row.updated_at,professional_name:'Dra. Prueba'});
    }
    return {data:row,error:null};
  });
  await page.addInitScript(installClient,{tenant,patient,actor});
  const allowed = new Set([...scripts,...styles]);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>*{box-sizing:border-box}body{margin:0;font:16px system-ui;background:#f4f7fa}button,input,select,textarea{font:inherit}[hidden]{display:none!important}</style>
    ${styles.map(name=>'<link rel="stylesheet" href="/'+name+'">').join('')}
    ${scripts.map(name=>'<script defer src="/'+name+'"></script>').join('')}
    </head><body><main id="p-paciente-detalle" class="activa"><div class="clinic-layout"></div></main></body></html>`;
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin!=='https://smyl.test') return route.abort();
    const name = url.pathname.slice(1);
    if (!name) return route.fulfill({contentType:'text/html',body:html});
    if (!allowed.has(name)) return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':'text/css',body:await fs.readFile(path.join(root,name))});
  });
  const dialog = page.locator('dialog.perio-dialog[open]');
  const byName = name => dialog.getByRole('button',{name,exact:true});
  const field = (site,metric) => dialog.locator(`[data-perio-site="${site}"][data-perio-field="${metric}"]`);
  const scrollSnapshot = async name => {
    await fs.mkdir(output,{recursive:true});
    await page.screenshot({path:path.join(output,`${spec.width}-${name}.png`),animations:'disabled'});
  };
  async function openTooth() {
    const tab = page.locator('#cw-evaluation-task-findings');
    await tab.waitFor({state:'attached'});
    if (await tab.isVisible()) await tab.click();
    else await page.getByRole('button',{name:'Continuar a revisión',exact:true}).click();
    await page.locator('.cw-map-filter[data-label="Periodoncia"]').click();
    await page.locator('.cw-clinical-map [data-tooth="16"]').click();
    if (!(await dialog.isVisible())) {
      await page.locator('.cw-periodontal-host .perio-launch').click();
      if (!(await dialog.isVisible())) await page.locator('.cw-periodontal-host').getByRole('button',{name:/Registrar sondaje|Ver mediciones/}).click();
    }
    await dialog.waitFor();
    assert.match(await dialog.locator('h2').innerText(),/16/);
  }
  try {
    await page.goto('https://smyl.test/');
    await openTooth();
    await page.evaluate(()=>window.testSession(true));
    await dialog.getByLabel('Fecha de exploración').fill('2026-11-18');
    await byName('Iniciar exploración').click();
    await field('MB','depth').fill('4');
    await field('MB','margin').fill('-1');
    await field('MB','bleeding').selectOption('no');
    await field('DB','depth').fill('3');
    await field('DB','depth').blur();
    await field('MB','depth').focus();
    await page.waitForFunction(() => document.activeElement?.dataset.perioField==='depth');
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'modal overflow');
    await scrollSnapshot('registro');
    await byName('Guardar mediciones').click();
    await dialog.getByText('Mediciones guardadas.',{exact:true}).waitFor();
    assert.deepEqual(row.document.periodontogram.teeth['16'].MB,{depth:4,margin:-1,bleeding:false});
    assert.equal(row.document.periodontogram.status,'draft');
    const first = row.document.periodontogram.id;
    await byName('Cerrar periodontograma').click();
    assert.ok(await page.evaluate(()=>document.activeElement?.matches('button') && document.activeElement.getClientRects().length>0),'El foco debe volver a un control visible del mapa.');
    await page.reload();
    await openTooth();
    assert.equal(await field('MB','depth').inputValue(),'4');
    assert.equal(await field('B','depth').inputValue(),'');
    await byName('Cerrar exploración').click();
    await byName('Confirmar cierre').click();
    await byName('Iniciar nuevo control').waitFor();
    assert.equal(row.document.periodontogram.status,'closed');
    assert.equal(await field('MB','depth').count(),0);
    assert.equal(await dialog.locator('.perio-read-value').first().innerText(),'4');
    await dialog.getByLabel('Fecha de exploración').fill('2026-11-20');
    await byName('Iniciar nuevo control').click();
    assert.equal(await field('MB','depth').inputValue(),'');
    await field('MB','depth').fill('5');
    await field('MB','depth').blur();
    await dialog.locator('summary').filter({hasText:'Comparar visitas'}).click();
    assert.equal(await dialog.getByLabel('Visita de comparación').inputValue(),first);
    const comparison = dialog.locator('table[aria-label^="Comparación"]');
    assert.deepEqual(await comparison.locator('tbody tr').first().locator('td').allTextContents(),['4','5']);
    await byName('Guardar mediciones').click();
    await dialog.getByText('Mediciones guardadas.',{exact:true}).waitFor();
    assert.notEqual(row.document.periodontogram.id,first);
    assert.equal(closed.length,1);
    await byName('Ver periodontograma completo').click();
    assert.match(await dialog.locator('h2').innerText(),/completo/);
    assert.equal(await byName('Gráfica').getAttribute('aria-pressed'),'true');
    await dialog.getByRole('group',{name:'Sitios periodontales'}).waitFor();
    await scrollSnapshot('arcadas');
    await byName('Tabla').click();
    assert.equal(await dialog.getByRole('table',{name:'Arcada Superior'}).count(),1);
    await byName('Gráfica').click();
    await byName('Editar sitio').click();
    await dialog.locator('[data-perio-field="depth"]:focus').waitFor();
    assert.match(await dialog.locator('h2').innerText(),/16/);
    await page.evaluate(()=>window.testSession(false));
    await dialog.waitFor({state:'detached'});
    assert.deepEqual(errors,[]);
    console.log(`${spec.width} px: captura, guardado, recarga, cierre, comparación y arcadas correctos.`);
  } catch (err) {
    console.error({width:spec.width,pageErrors:errors,visible:await page.locator('body').innerText().then(v=>v.slice(-800)).catch(()=>null)});
    throw err;
  } finally {await ctx.close();}
}

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || (process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':undefined)});
  try {
    const failures = [];
    for (const spec of [{width:1440,height:900},{width:768,height:1024},{width:390,height:844},{width:320,height:720}]) {
      try { await scenario(browser,spec); }
      catch (err) { failures.push(err); }
    }
    if (failures.length) throw new AggregateError(failures,'Falló el flujo de periodoncia en navegador.');
  } finally {await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
