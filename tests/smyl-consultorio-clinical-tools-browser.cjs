const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures/smyl-consultorio-preview.html');
const output = path.join(root, 'output/clinical-tools');
const names = ['Periodontograma', 'Entrevista con MILA', 'Fotografías guiadas', 'Simulador de carillas'];
const patient = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const twin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const visit = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const branch = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const tenant = '11111111-1111-4111-8111-111111111111';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const dialog = page => page.locator('#smyl-clinical-tool-dialog[open]');
const group = page => page.locator('[data-co-clinical-tools]');
const calls = page => page.evaluate(() => window.__toolCalls);

async function start(browser, width, staff = false) {
  const page = await browser.newPage({ viewport: { width, height: width > 600 ? 1000 : 844 }, serviceWorkers: 'block' });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'smyl.test') return route.abort();
    if (url.pathname === '/simulacion-rapida.html') return route.fulfill({ contentType: 'text/html', body: '<title>Simulador de prueba</title>' });
    const file = url.pathname === '/consultorio-qa.html' ? fixture : path.join(root, decodeURIComponent(url.pathname));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404 });
    return route.fulfill({ path: file, contentType: types[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto('http://smyl.test/consultorio-qa.html?caso=herramientas&rol=' + (staff ? 'staff' : 'dueno'));
  await page.locator('.co-person').first().waitFor();
  await page.evaluate(() => {
    window.__toolCalls = [];
    window.SmylCaseWorkspace = {
      openChairside(tool, tenant, patient, options) {
        window.__toolCalls.push({ tool, tenant, patient, active: window.pacienteActual.id, current: options.isCurrent() });
        return true;
      }
    };
    window.SmylMilaInterview = { open({ tenant, patient, patientInfo, appointmentId, view }) {
      window.__toolCalls.push({ tool: 'interview', tenant, patient, record: patientInfo.id, appointmentId, view });
      return true;
    } };
  });
  return page;
}

async function selectTwin(page) {
  const modal = dialog(page);
  await modal.getByRole('searchbox').fill('Alex');
  await modal.getByRole('button', { name: 'Alex De prueba 5550002200' }).click();
  await modal.getByRole('button', { name: 'Abrir herramienta', exact: true }).waitFor();
}

async function openFromVisit(page) {
  await page.locator('.co-person').filter({ hasText: 'Blanqueamiento' }).click();
  await page.getByRole('button', { name: 'Herramientas clínicas', exact: true }).click();
  await dialog(page).getByRole('button', { name: names[0], exact: true }).waitFor();
  assert.equal(await dialog(page).getByRole('searchbox').count(), 0);
}

async function layoutAndSelection(browser, width) {
  const page = await start(browser, width);
  try {
    const area = group(page);
    assert.deepEqual(await area.getByRole('button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label'))), names);
    for (const name of names) {
      const box = await area.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, name + ' a ' + width);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const screen = width === 1280 ? 'escritorio' : width === 390 ? 'movil' : null;
    if (screen) await page.screenshot({ path: path.join(output, 'consultorio-' + screen + '.png'), fullPage: true });
    await area.getByRole('button', { name: names[0], exact: true }).click();
    await selectTwin(page);
    if (screen) await page.screenshot({ path: path.join(output, 'seleccion-' + screen + '.png') });
    await dialog(page).getByRole('button', { name: 'Cerrar herramientas clínicas' }).click();
    assert.deepEqual(await calls(page), []);
    await area.getByRole('button', { name: names[0], exact: true }).click();
    await selectTwin(page);
    await dialog(page).getByRole('button', { name: 'Abrir herramienta' }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    assert.deepEqual(await calls(page), [{ tool: 'periodontal', tenant, patient: twin, active: twin, current: true }]);
    console.log('Consultorio, cancelación y selección de homónimo a ' + width + ' px');
  } finally { await page.close(); }
}

async function visitAndOtherTools(browser) {
  const page = await start(browser, 390);
  try {
    await page.evaluate(async () => {
      window.__citas.push({ ...window.__citas[0], id:'cita-sin-vinculo', patient_id:null });
      await window.SmylConsultorio.reload();
    });
    await page.getByRole('button', { name:'Ver cita sin paciente vinculado' }).click();
    await dialog(page).getByText(/vincula un paciente a esta cita/i).waitFor();
    assert.equal(await dialog(page).getByRole('searchbox').count(), 0);
    assert.deepEqual(await calls(page), []);
    await page.keyboard.press('Escape');
    const contexts = await page.evaluateHandle(() => {
      const contexts = [], api = window.SmylClinicalTools;
      window.SmylClinicalTools = { ...api, open(opts) { contexts.push(opts); return api.open(opts); } };
      return contexts;
    });
    await openFromVisit(page);
    const [selection] = await contexts.jsonValue();
    assert.equal(selection.patientId, patient);
    assert.equal(selection.patientName, 'Alex De prueba');
    assert.equal(selection.appointmentId, visit);
    assert.equal(selection.branchId, branch);
    await dialog(page).getByRole('button', { name: names[1], exact: true }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    assert.deepEqual(await calls(page), [{ tool: 'interview', tenant, patient, record: patient, appointmentId: visit, view: 'clinic' }]);
    await page.evaluate(() => window.ir('consultorio'));
    await group(page).getByRole('button', { name: names[2], exact: true }).click();
    await selectTwin(page);
    await dialog(page).getByRole('button', { name: 'Abrir herramienta' }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    assert.deepEqual((await calls(page)).at(-1), { tool: 'guided-photos', tenant, patient: twin, active: twin, current: true });
    await page.evaluate(() => window.ir('consultorio'));
    await group(page).getByRole('button', { name: names[3], exact: true }).click();
    await selectTwin(page);
    await dialog(page).getByRole('button', { name: 'Abrir herramienta' }).click();
    await page.waitForURL('**/simulacion-rapida.html?*');
    const url = new URL(page.url());
    assert.deepEqual(Object.fromEntries(url.searchParams), { workspace: 'professional', patient: twin, clinic: tenant, from: 'consultorio' });
    console.log('Cita exacta y entrega a MILA, fotografías y simulador');
  } finally { await page.close(); }
}

async function staleAndDenied(browser) {
  const page = await start(browser, 390);
  try {
    await page.evaluate(() => {
      const rpc = window.sb.rpc;
      window.sb.rpc = function(name, args) {
        if (name === 'smyl_search_patients' && args.p_query === 'demorada') return new Promise(resolve => {
          window.__finishSearch = () => resolve({ data: [{ id: 'obsolete', nombre: 'Resultado anterior' }], error: null });
        });
        return rpc(name, args);
      };
    });
    await group(page).getByRole('button', { name: names[2], exact: true }).click();
    await dialog(page).getByRole('searchbox').fill('demorada');
    await page.waitForFunction(() => !!window.__finishSearch);
    await dialog(page).getByRole('searchbox').fill('Alex');
    await dialog(page).getByRole('button', { name: 'Alex De prueba 5550002200' }).waitFor();
    await page.evaluate(async () => { window.__finishSearch(); await new Promise(resolve => requestAnimationFrame(resolve)); });
    assert.equal(await dialog(page).getByText('Resultado anterior').count(), 0);
    assert.equal(await dialog(page).getByRole('button', { name: /Alex De prueba/ }).count(), 2);
    await dialog(page).getByRole('button', { name: 'Cerrar herramientas clínicas' }).click();
    await openFromVisit(page);
    await page.evaluate(() => { window.__citas[1] = { ...window.__citas[1], branch_id: window.__citas[0].branch_id }; });
    await dialog(page).getByRole('button', { name: names[1], exact: true }).click();
    await dialog(page).getByText(/datos de la cita cambiaron/i).waitFor();
    assert.deepEqual(await calls(page), []);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.ir('consultorio');
      const original = window.verPaciente;
      window.verPaciente = async id => {
        await original(id);
        window.pacienteActual = window.__pac.p1;
        return true;
      };
    });
    await group(page).getByRole('button', { name: names[2], exact: true }).click();
    await selectTwin(page);
    await dialog(page).getByRole('button', { name: 'Abrir herramienta' }).click();
    await dialog(page).getByText(/paciente activo cambió/i).waitFor();
    assert.deepEqual(await calls(page), []);
    console.log('Una búsqueda anterior y una cita modificada no cambian el destino');
  } finally { await page.close(); }

  const staff = await start(browser, 390, true);
  try {
    await staff.evaluate(() => window.SmylClinicalTools.open({ tool: 'interview' }));
    await selectTwin(staff);
    await dialog(staff).getByRole('button', { name: 'Abrir herramienta' }).click();
    await dialog(staff).getByText(/permiso.*clínica/i).waitFor();
    assert.deepEqual(await calls(staff), []);
    assert.equal(await staff.evaluate(() => window.__log.some(x => x[0] === 'verPaciente')), false);
    console.log('La entrevista verifica los permisos antes de abrir el expediente');
  } finally { await staff.close(); }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.SMYL_CHROMIUM || (fs.existsSync(chrome) ? chrome : undefined);
  const browser = await chromium.launch({ executablePath });
  try {
    for (const width of [1280, 820, 390, 320]) await layoutAndSelection(browser, width);
    await visitAndOtherTools(browser);
    await staleAndDenied(browser);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
