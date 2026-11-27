import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {after, before, test} from 'node:test';

const project = new URL('../', import.meta.url);
const css = readFileSync(new URL('smyl-professional-v3.css', project), 'utf8');
const script = readFileSync(new URL('smyl-professional-v3.js', project), 'utf8');
let browser;

before(async () => {
  try {
    browser = await createRequire(import.meta.url)('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM});
  } catch (error) {
    if (process.env.SMYL_CHROMIUM) throw error;
  }
});
after(async () => browser?.close());

async function preview(t, width) {
  const page = await browser.newPage({viewport:{width,height:width < 600 ? 844 : 900},hasTouch:width < 600});
  t.after(() => page.close());
  await page.setContent(`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*{box-sizing:border-box}body{margin:0;background:#eef2f6;font-family:Inter,Arial,sans-serif}.sr-only{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important}${css}</style></head><body class="smyl-management-v3"><button id="origin">Preparar cotización</button><main class="contenido"><section id="p-dashboard" class="pantalla activa"></section></main></body></html>`);
  await page.evaluate(() => {
    window.tenantId='tenant-demo'; window.ir=()=>{};
    const patients=[
      {id:'p1',nombre:'Doña',apellido:'Chole',telefono:'3311111111',email:'chole@example.test'},
      {id:'p2',nombre:'Imelda',apellido:'Castellanos',telefono:'3322222222',email:'imelda@example.test'},
      {id:'p3',nombre:'La doña',apellido:'2',telefono:'3333333333',email:'dona@example.test'}
    ];
    const plans=[
      {patient_id:'p1',status:'reviewed',revision:2,reviewed_at:'2026-11-20T12:00:00Z'},
      {patient_id:'p2',status:'draft',revision:1,reviewed_at:null},
      {patient_id:'p4',status:'reviewed',revision:1,reviewed_at:'2026-11-21T12:00:00Z'}
    ];
    const quotes=[
      {id:'q-old',patient_id:'p1',status:'draft',plan_revision:1,updated_at:'2026-11-25T12:00:00Z'},
      {id:'q-current',patient_id:'p1',status:'draft',plan_revision:2,updated_at:'2026-11-24T12:00:00Z'}
    ];
    window.sb={
      rpc:async (name,args)=>({data:name==='smyl_search_patients'&&String(args.p_query).toLowerCase().includes('zoe')?[{id:'p4',nombre:'Zoé',apellido:'Álvarez',telefono:'3344444444',email:'zoe@example.test'}]:[]}),
      from(table){
        const rows=table==='camila_pacientes'?patients:table==='smyl_clinical_plans'?plans:table==='smyl_proposals'?quotes:[];
        const query={select(){return this;},eq(){return this;},in(){return this;},order(){return this;},limit(){return this;},then(resolve){resolve({data:rows});}};
        return query;
      }
    };
    window.SmylProposals={openSaved:id=>{document.body.dataset.saved=id;},openPlan:id=>{document.body.dataset.plan=id;},forPatient:id=>{document.body.dataset.patient=id;}};
  });
  await page.addScriptTag({content:script});
  await page.locator('#origin').focus();
  await page.evaluate(() => window.SmylCareTasks.open('quote'));
  await page.locator('#pro-task-dialog [data-task-patient]').first().waitFor();
  return page;
}

test('escritorio: la ventana se centra, explica la acción y encuentra todo el directorio', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page=await preview(t,1440);
  const dialog=page.locator('#pro-task-dialog');
  const box=await dialog.boundingBox();
  assert.ok(Math.abs((box.x+box.width/2)-720)<3,'centrada horizontalmente');
  assert.ok(Math.abs((box.y+box.height/2)-450)<3,'centrada verticalmente');
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'sin desbordamiento horizontal');
  assert.match(await dialog.innerText(),/Cotización en borrador/);
  assert.match(await dialog.innerText(),/Continuar/);
  await dialog.getByRole('tab',{name:/Por completar/}).click();
  assert.match(await dialog.innerText(),/Plan por revisar/);
  if(process.env.SMYL_SHOT)await page.screenshot({path:process.env.SMYL_SHOT+'-desktop.png'});
  await dialog.locator('[data-task-search]').fill('zoe');
  await page.waitForTimeout(420);
  assert.match(await dialog.innerText(),/Zoé Álvarez/);
  assert.match(await dialog.innerText(),/1 resultado en todos los pacientes/);
  // En un input[type=search], el primer Escape limpia la búsqueda y el segundo cierra el diálogo.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'origin','devuelve el foco al botón que abrió la ventana');
});

test('PWA: se convierte en hoja inferior, conserva objetivos táctiles y no se amontona', async t => {
  if (!browser) return t.skip('Se necesita Chromium.');
  const page=await preview(t,390);
  const dialog=page.locator('#pro-task-dialog');
  const box=await dialog.boundingBox();
  assert.ok(Math.abs(box.x)<2 && Math.abs(box.width-390)<2,'ocupa el ancho útil');
  assert.ok(Math.abs((box.y+box.height)-844)<3,'se apoya en la parte inferior');
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'sin scroll horizontal');
  assert.ok((await dialog.locator('[data-task-search]').boundingBox()).height>=44,'buscador táctil');
  assert.ok((await dialog.locator('[data-task-patient]').first().boundingBox()).height>=70,'fila táctil');
  if(process.env.SMYL_SHOT)await page.screenshot({path:process.env.SMYL_SHOT+'-pwa.png'});
});
