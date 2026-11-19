import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const fixture = new URL('./fixtures/smyl-inbox-stage7-preview.html', import.meta.url);
let browser, skipReason;
before(async () => {
  try { browser = await require('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM, args:['--allow-file-access-from-files']}); }
  catch (e) { if (process.env.SMYL_CHROMIUM) throw e; skipReason = 'Se necesita Chromium con Playwright.'; }
});
after(async () => browser?.close());
async function openPatient(page, mode) {
  await page.goto(fixture.href + '?focus=1&care-history=' + mode);
  await page.waitForSelector('html[data-preview-ready="true"]');
  const panel = page.locator('[data-inbox-context-panel]');
  if (await panel.getAttribute('aria-hidden') === 'true') await page.locator('[data-inbox-context]').click();
  const toggle = panel.locator('[data-f360-section="careHistory"]');
  await toggle.waitFor();
  assert.match(await toggle.innerText(), /Historial de visitas/);
  return {panel, toggle, history:panel.locator('[data-section="f360-careHistory"]')};
}
for (const [width,height] of [[1512,982],[1024,860],[390,844]]) {
  test('Ficha 360: sedes, profesionales y fechas sin nueva acción de agenda a ' + width, async (t) => {
    if (!browser) return t.skip(skipReason);
    const page = await browser.newPage({viewport:{width,height},hasTouch:width < 500});
    t.after(()=>page.close()); page.setDefaultTimeout(8000);
    const {panel,toggle,history} = await openPatient(page,'several');
    await toggle.filter({hasText:'Dra. Valeria Montoya'}).waitFor();
    assert.match(await toggle.textContent(), /Plaza Sol.*Dra. Valeria Montoya.*\+1 sede/);
    assert.equal(await panel.getByRole('button',{name:'Agendar cita',exact:true}).count(),0);
    assert.doesNotMatch(await panel.innerText(), /Este paciente todavía no tiene citas registradas/);
    assert.equal(await history.locator('time').count(),0);
    const appointments = panel.locator('[data-f360-section="citas"]');
    if (await appointments.getAttribute('aria-expanded') === 'true') await appointments.click();
    await toggle.click();
    const groups = history.locator('.smyl-f360-care-group'); assert.equal(await groups.count(),2);
    await groups.first().locator('summary').first().click();
    await history.getByText('Dra. Isabel Vega',{exact:true}).waitFor();
    assert.equal(await history.locator('.smyl-f360-care-days').count(),0);
    await history.locator('.smyl-f360-care-dates summary').first().click();
    await history.locator('.smyl-f360-care-days time').first().waitFor();
    assert.equal(await history.locator('.smyl-f360-care-days time').count(),2);
    assert.doesNotMatch(await history.innerText(), /Dra\. Mariana|Sin asignar/);
    const cut = await history.evaluate(el=>{const b=el.getBoundingClientRect();return el.scrollWidth>el.clientWidth+1 || b.left < -1 || b.right > innerWidth+1;});
    assert.equal(cut,false);
    if (process.env.SMYL_QA_SHOTS) {
      await history.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(process.env.SMYL_QA_SHOTS,'ficha-atenciones-'+width+'.png')});
    }
  });
}
test('Ficha 360: diferencia sin registros, datos parciales y error', async(t)=>{
  if (!browser) return t.skip(skipReason);
  const page = await browser.newPage({viewport:{width:1512,height:982}}); t.after(()=>page.close());
  for (const [mode,expected] of [['empty','No hay visitas completadas visibles.'],['error','No se pudo consultar el historial'],['missing','Sucursal no disponible']]) {
    const {toggle,history}=await openPatient(page,mode); await toggle.click();
    await history.locator('.smyl-f360-section-body').getByText(expected,{exact:false}).first().waitFor();
    if(mode==='missing') assert.match(await history.innerText(), /Profesional no registrado[\s\S]*Fecha no registrada/);
    if(mode==='error') assert.equal(await history.getByRole('button',{name:'Reintentar'}).count(),1);
  }
});

test('Una cita compartida por chat y Agenda aparece una sola vez en la Ficha 360', async (t) => {
  if (!browser) return t.skip(skipReason);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  t.after(() => page.close());
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      window.SmylSchedule.patientVisits = async () => [
        { id:'appointment-preview', status:'confirmed', starts_at:'2026-10-15T16:00:00Z', service:'Servicio repetido' },
        { id:'other-visit', status:'completed', starts_at:'2026-10-10T16:00:00Z', service:'Consulta anterior' },
      ];
    });
  });
  const { panel } = await openPatient(page, 'several');
  const toggle = panel.locator('[data-f360-section="citas"]');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const section = panel.locator('[data-section="f360-citas"]');
  await section.getByText('Consulta anterior', { exact:true }).waitFor();
  await section.locator('[data-appointment-id="appointment-preview"]').waitFor();
  assert.equal(await section.locator('.smyl-f360-visit').count(), 1);
  assert.equal(await section.getByText('Servicio repetido').count(), 0);
  assert.match(await section.innerText(), /Dra\. Mariana Ruiz · Clinica Centro/);
});
