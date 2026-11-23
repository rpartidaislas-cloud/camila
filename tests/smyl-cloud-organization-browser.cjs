const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const baseCSS = require('node:fs').readFileSync(path.join(root,'app.html'),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];

// Only the storage and database transports are substituted. Both screens and
// their event handlers run as shipped. Identifiers and files are synthetic.
function installFixture() {
  const tenant = window.tenantId = 'test-clinic';
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const patients = [{ id: 'person', nombre: 'Prueba', apellido: 'Nube', record_number: 17, tenant_id: tenant }];
  const appts = [{ id: 'visit', patient_id: 'person', tenant_id: tenant, status: 'confirmed', starts_at: start.toISOString(), ends_at: new Date(+start + 1800000).toISOString() }];
  const files = [];
  window.cloudWrites = [];
  window.miRolEquipo = 'dueño';
  window.TITULOS = {};
  window.ir = route => document.querySelectorAll('.pantalla').forEach(p => { p.hidden = p.id !== 'p-' + route; p.classList.toggle('activa', !p.hidden); });
  window.SmylSecureFiles = { sha256: async () => 'a'.repeat(64), verify: async () => true };
  function rows(data) {
    let list = data.slice(), head = false;
    const b = {
      select(names, opts) { head = opts?.head; return b; },
      eq(k, v) { list = list.filter(r => r[k] === v); return b; },
      in(k, values) { list = list.filter(r => values.includes(r[k])); return b; },
      order() { return b; }, limit(n) { list = list.slice(0,n); return b; },
      gte() { return b; }, lt() { return b; }, lte() { return b; }, is() { return b; },
      maybeSingle() { return Promise.resolve({data:list[0] || null}); },
      then(ok) { return Promise.resolve({ data:head ? null : list, count:list.length }).then(ok); }
    };
    return b;
  }
  window.sb = {
    auth: { getUser: async () => ({data:{user:{id:'tester'}}}) },
    from: t => rows(({camila_pacientes:patients, smyl_appointments:appts, smyl_cloud_files:files})[t] || []),
    storage: { from: () => ({upload:async () => ({}), remove:async () => ({}), createSignedUrls:async () => ({data:[]})}) },
    rpc(name,args={}) {
      if (name === 'smyl_cloud_summary') return Promise.resolve({data:{permissions:{read:true,upload:true,manage:true,clinical:true},counts:{total:files.length}}});
      if (name === 'smyl_cloud_register_file') {
        window.cloudWrites.push(args);
        files.push({id:args.p_id, tenant_id:tenant, patient_id:args.p_patient_id, appointment_id:args.p_appointment_id,
          clinic_use:args.p_clinic_use, category:args.p_category, display_name:args.p_display_name, mime_type:args.p_mime_type,
          needs_organization: !args.p_category || (!args.p_patient_id && !args.p_clinic_use), status:'active',created_at:start.toISOString(),size_bytes:args.p_size_bytes});
        if (window.simulateLostReply && args.p_display_name === 'dos.pdf') return Promise.resolve({error:{message:'Respuesta interrumpida'}});
      }
      if (name === 'smyl_cloud_search_files') {
        window.cloudSearch = args.p_search;
        return rows(files.filter(f => f.patient_id && args.p_search === 'EXP-17'));
      }
      return Promise.resolve({data:[]});
    }
  };
}

async function run() {
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH, headless:true});
  try {
    for (const width of [1440,820,390]) {
      const page = await browser.newPage({viewport:{width,height:850}});
      page.setDefaultTimeout(6500);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setContent('<body class="smyl-ui-governed smyl-management-v3"><main class="contenido"></main><style>html{font-family:system-ui}*{box-sizing:border-box}[hidden]{display:none!important}</style>');
      await page.evaluate(installFixture);
      await page.addStyleTag({content:baseCSS});
      for (const file of ['smyl-panel.css','smyl-schedule.css','smyl-ui-template-v3.css','smyl-cloud.css']) await page.addStyleTag({path:path.join(root,file)});
      for (const file of ['smyl-schedule.js','smyl-cloud.js']) await page.addScriptTag({path:path.join(root,file)});
      await page.evaluate(() => window.ir('agenda'));
      await page.locator('[data-schedule-view="agenda"]').click();
      await page.locator('[data-appointment="visit"]').last().click();
      await page.getByRole('button',{name:'Subir archivos',exact:true}).click();
      const dialog = page.locator('.cloud-dialog[open]');
      assert.match(await dialog.locator('.cloud-upload-context').innerText(), /Prueba Nube[\s\S]*Cita/);
      assert.equal(await dialog.getByRole('searchbox').count(), 0);
      const upload = filename => ({name:filename,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 synthetic fixture file')});
      await page.evaluate(() => {window.simulateLostReply = true;});
      await dialog.locator('input[type=file]').setInputFiles([upload('uno.pdf'),upload('dos.pdf')]);
      await dialog.getByRole('button',{name:'Guardar',exact:true}).click();
      await dialog.getByRole('button',{name:'Reintentar'}).click();
      await dialog.getByRole('button',{name:'Guardar',exact:true}).click();
      await dialog.waitFor({state:'detached'});
      assert.deepEqual(await page.evaluate(() => window.cloudWrites.map(x=>[x.p_patient_id,x.p_appointment_id])),[['person','visit'],['person','visit']]);
      await page.locator('#schedule-dialog [data-close]').click();
      await page.evaluate(() => window.ir('nube'));
      const cloud = page.locator('#p-nube');
      for (const [filename,destination] of [['general.pdf','clinic'],['pendiente.pdf','later']]) {
        await cloud.getByRole('button',{name:'Subir archivos',exact:true}).click();
        await dialog.getByLabel('Destino').selectOption(destination);
        await dialog.locator('input[type=file]').setInputFiles(upload(filename));
        await dialog.getByRole('button',{name:'Guardar',exact:true}).click();
        await dialog.waitFor({state:'detached'});
      }
      assert.deepEqual(await page.evaluate(()=>window.cloudWrites.slice(2).map(x=>[x.p_patient_id,x.p_appointment_id,x.p_clinic_use])),[[null,null,true],[null,null,false]]);
      await cloud.getByRole('button',{name:/Por organizar/}).click();
      await cloud.getByRole('heading',{name:'Por organizar'}).waitFor();
      assert.equal(await cloud.locator('.cloud-file').count(), 1);
      assert.match(await cloud.locator('.cloud-file').innerText(),/pendiente.pdf/);
      await cloud.getByRole('button',{name:/^Archivos/}).click();
      await cloud.getByRole('searchbox').fill('EXP-17');
      await page.waitForFunction(()=>window.cloudSearch==='EXP-17' && document.querySelectorAll('.cloud-file').length===2);
      await cloud.locator('.cloud-file').first().click();
      await cloud.getByText('Expediente EXP-17',{exact:true}).waitFor();
      await cloud.getByRole('button',{name:'Cerrar',exact:true}).click();
      assert.equal(await cloud.locator('[data-cloud-detail]').isVisible(),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
      if(process.env.SMYL_QA_OUTPUT) await page.screenshot({path:path.join(process.env.SMYL_QA_OUTPUT,'nube-'+width+'.png')});
      assert.deepEqual(errors,[]);
      console.log('OK', width, 'px');
      await page.close();
    }
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
