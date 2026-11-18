import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const finance = read('smyl-finance.js');
const css = read('smyl-finance.css');

test('Finanzas usa un resumen y una secuencia operativa explícita', () => {
  assert.match(finance, /tab:'summary'/);
  assert.match(finance, /finance-page-head finance-actionsbar/);
  assert.doesNotMatch(finance, /finance-titlebar/);
  assert.match(finance, /Panorama financiero de la clínica/);
  assert.match(finance, /Del saldo al cierre/);
  const flow = finance.slice(finance.indexOf('class="finance-flow"'), finance.indexOf("';bar.after(summaryPanel)"));
  for (const label of ['Cuentas por cobrar', 'Pagos y recibos', 'Facturación', 'Caja']) {
    assert.ok(flow.includes(label), label);
  }
});

test('las acciones cambian según la tarea y no mezclan Agenda con Finanzas', () => {
  assert.match(finance, /function renderFinanceActions\(\)/);
  for (const action of ['Registrar pago', 'Agregar cargo', 'Importar cotización', 'Registrar anticipo', 'Política de inasistencia', 'Entrada o salida', 'Realizar corte', 'Configurar facturación']) {
    assert.match(finance, new RegExp(action));
  }
  assert.doesNotMatch(finance, /id="finance-walk-in"/);
});

test('el resumen prioriza cartera, cuentas por crear, saldos a favor y caja', () => {
  assert.match(finance, /function renderFinanceOverview\(\)/);
  for (const label of ['CARTERA VENCIDA', 'CUENTAS POR CREAR', 'SALDOS A FAVOR', "eyebrow:'CAJA'"]) {
    assert.ok(finance.includes(label), label);
  }
  assert.match(finance, /data-overview-tab/);
  assert.match(finance, /goFinanceTab\(button\.dataset\.overviewTab,button\.dataset\.overviewFilter\)/);
});

test('el lenguaje visible adopta Finanzas en navegación y configuración', () => {
  assert.match(read('smyl-navigation.js'), /\['Finanzas', 'caja', 'cash'\]/);
  assert.match(read('smyl-professional-v3.js'), /caja:\['Finanzas','Saldos, pagos y control financiero de la clínica'\]/);
  assert.match(read('smyl-settings-hub.js'), /id: 'cobros', title: 'Finanzas'/);
  assert.match(read('smyl-consultorio.js'), /Ir a Finanzas/);
  assert.match(read('smyl-proposals.js'), /Pasar a Finanzas/);
});

test('la capa visual nueva evita microtexto y se adapta a PWA', () => {
  const block = css.slice(css.indexOf('/* Finanzas v5'));
  assert.ok(block.length > 0);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 12);
  assert.equal(tiny.length, 0);
  assert.match(block, /grid-template-columns:\.72fr 1\.18fr 1\.08fr \.68fr \.82fr/);
  assert.match(block, /@media\(max-width:720px\)/);
  assert.match(block, /overflow-x:auto/);
});

test('web y PWA comparten la misma entrega versionada', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'smyl-navigation.js', 'smyl-professional-v3.js', 'smyl-settings-hub.js', 'smyl-consultorio.js', 'smyl-proposals.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read('mobile/www/' + file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.css\?v=41/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=56/);
  assert.match(read('sw.js'), /finanzas-workspace-v5/);
});
