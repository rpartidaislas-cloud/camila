const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const fake = fs.readFileSync(path.join(__dirname, 'qa/fake-supabase-agenda.js'), 'utf8');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function check(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('supabase-js')) return route.fulfill({ contentType: 'text/javascript', body: fake });
      if (url.hostname !== 'smyl.test') return route.abort();
      const file = path.join(root, decodeURIComponent(url.pathname));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404 });
      return route.fulfill({ path: file, contentType: types[path.extname(file)] || 'application/octet-stream' });
    });
    await page.goto('http://smyl.test/app.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.SmylSchedule && window.__db && window.tenantId);
    const expected = await page.evaluate(() => {
      const db = window.__db, tenant = window.tenantId;
      const [first, selected] = db.camila_pacientes;
      for (const p of [first, selected]) { p.nombre = 'Paciente'; p.apellido = 'De prueba'; }
      const start = new Date(); start.setHours(11, 0, 0, 0);
      const make = (id, patient, branch, offset) => ({
        ...db.smyl_appointments[0], id, patient_id: patient, branch_id: branch,
        starts_at: new Date(+start + offset * 3600000).toISOString(),
        ends_at: new Date(+start + (offset + 1) * 3600000).toISOString()
      });
      db.smyl_branches.push({ id: 'other-branch', name: 'Sucursal de prueba', tenant_id: tenant, active: true });
      db.smyl_appointments = [
        make('same-name', first.id, 'b1', 0), make('earlier', selected.id, 'b1', 1),
        make('selected', selected.id, 'other-branch', 2), make('unlinked', null, 'other-branch', 3)
      ];
      window.miRolEquipo = 'equipo';
      db.smyl_member_roles = [{ tenant_id: tenant, user_id: tenant, role_id: 'test-reader' }];
      db.smyl_role_permissions = [{ tenant_id: tenant, role_id: 'test-reader', permission_key: 'clinical.read' }];
      window.openedTools = [];
      window.SmylClinicalTools = { open: context => window.openedTools.push(context) };
      window.ir('agenda');
      return { patientId: selected.id, patientName: 'Paciente De prueba', appointmentId: 'selected', branchId: 'other-branch' };
    });
    await page.locator('#schedule-calendar [data-appointment="selected"]').first().click();
    const detail = page.locator('#schedule-dialog[open]');
    const button = detail.getByRole('button', { name: 'Herramientas clínicas', exact: true });
    assert.equal(await button.count(), 1);
    const box = await button.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
    await button.click();
    assert.deepEqual(await page.evaluate(() => window.openedTools), [expected]);
    assert.equal(await detail.count(), 0);

    await page.locator('#schedule-calendar [data-appointment="unlinked"]').first().click();
    assert.equal(await detail.getByText('Esta cita no tiene un paciente vinculado.').count(), 1);
    assert.equal(await detail.locator('[data-open-patient], [data-open-care], [data-open-clinical-tools]').count(), 0);
    await detail.getByRole('button', { name: 'Cerrar', exact: true }).click();

    await page.evaluate(async () => {
      window.miRolEquipo = 'equipo';
      window.__db.smyl_role_permissions = [];
      await window.SmylSchedule.reload();
    });
    await page.locator('#schedule-calendar [data-appointment="selected"]').first().click();
    assert.equal(await button.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.openedTools), [expected]);
    console.log('Agenda y herramientas clínicas verificadas a ' + width + ' px');
  } finally {
    await page.close();
  }
}

(async () => {
  const executablePath = process.env.SMYL_CHROMIUM || (fs.existsSync(chrome) ? chrome : undefined);
  const browser = await chromium.launch({ executablePath });
  try {
    for (const width of [1280, 820, 390]) await check(browser, width);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
