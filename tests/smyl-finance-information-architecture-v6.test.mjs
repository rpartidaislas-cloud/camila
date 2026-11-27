// Finanzas v6 · las pestañas son el resumen. Cuatro pestañas (Por cobrar, Pagos, Caja y Facturación) con su cifra y su aviso;
// la cabecera es la misma en todas y cada pestaña dibuja solo lo suyo. Sustituye a la v5, que tenía una pestaña «Resumen».
// La conducta en navegador se comprueba con tests/qa/finanzas-pestanas-smoke.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const finance = read('smyl-finance.js');
const css = read('smyl-finance.css');

test('Finanzas abre en Por cobrar: cuatro pestañas con cifra y sin pestaña Resumen', () => {
  assert.match(finance, /actor:null,tab:'accounts'/);
  assert.match(finance, /var TABS=\[\['accounts','Por cobrar'\],\['receipts','Pagos'\],\['cash','Caja'\],\['fiscal','Facturación'\]\]/);
  assert.match(finance, /<nav class="finance-tabcards" role="tablist" aria-label="Secciones de Finanzas">/);
  assert.match(finance, /<span class="finance-tab-name">'\+t\[1\]\+'<\/span><strong class="finance-tab-figure">—<\/strong><small class="finance-tab-note"><\/small>/);
  for (const gone of ["tab:'summary'", 'Panorama financiero de la clínica', 'Del saldo al cierre', 'finance-flow', 'finance-overview', 'renderFinanceOverview', 'renderMetrics', 'METRIC_GO', 'finance-titlebar']) {
    assert.ok(!finance.includes(gone), gone);
  }
  // Los ids de pestaña no cambian. Recibos y Corte de caja ya no se repiten en Configuración: son trabajo diario de Finanzas.
  const hub = read('smyl-settings-hub.js');
  for (const id of ['receipts', 'cash']) assert.doesNotMatch(hub, new RegExp('data-finance-tab="' + id + '"'));
});

test('la página se arma una sola vez, ya en su forma final', () => {
  assert.doesNotMatch(finance, /upgradeFinanceWorkspace|upgradeFinanceActions|var buildBase=build|renderVisitsBase|renderAccounts=function|renderToday=function|renderVisits=function/);
  for (const name of ['build', 'renderAccounts', 'accountLine', 'renderVisits', 'renderCash', 'renderPayments', 'renderFiscal']) {
    assert.equal(finance.split('function ' + name + '(').length - 1, 1, name + ' debe tener una sola definición');
  }
  assert.match(finance, /<header class="finance-page-head finance-actionsbar"><div class="finance-head-actions"><\/div><\/header>/);
  for (const tab of ['accounts', 'receipts', 'cash', 'fiscal']) {
    assert.match(finance, new RegExp('<section data-finance-panel="' + tab + '" id="finance-panel-' + tab + '" role="tabpanel" aria-labelledby="finance-tab-' + tab + '"'));
  }
});

test('la cabecera es la misma en las cuatro pestañas: Cobrar y el menú Más', () => {
  const actions = finance.slice(finance.indexOf('function renderFinanceActions()'), finance.indexOf('function build()'));
  assert.ok(actions.length > 0);
  assert.doesNotMatch(actions, /state\.tab/, 'la cabecera no depende de la pestaña');
  for (const action of ['id="finance-guided-collection">Cobrar</button>', '<summary>Más</summary>', '<strong>Registrar cargo</strong>', '<strong>Recibir anticipo</strong>', '<strong>Importar cotización</strong>', '<strong>Política de inasistencia</strong>']) {
    assert.ok(actions.includes(action), action);
  }
  // Abrir la caja, la entrada o salida, el corte y la configuración fiscal aparecen una sola vez, dentro de su pestaña.
  for (const duplicate of ['finance-header-adjust', 'finance-header-close', 'finance-header-open', 'finance-header-billing', 'Realizar corte', 'Configurar facturación', 'Entrada / salida']) {
    assert.ok(!finance.includes(duplicate), duplicate);
  }
  assert.match(finance, /<button type="button" class="btn btn-secondary"'\+\(first\?' id="finance-adjust"':''\)\+' data-adjust="'\+s\.id\+'">Entrada o salida<\/button><button type="button" class="btn btn-secondary"'\+\(first\?' id="finance-close-cash"':''\)\+' data-close-cash="'\+s\.id\+'">Hacer corte<\/button>/);
  assert.match(finance, /id="finance-open-billing-setup">'\+\(ready\?'Ver configuración':'Terminar configuración'\)/);
  assert.doesNotMatch(finance, /id="finance-walk-in"/);
});

test('cada pestaña lleva su cifra y su aviso: vencido, citas sin cobrar, cobrado hoy, caja y facturación', () => {
  assert.match(finance, /function tabFacts\(\)/);
  assert.match(finance, /function renderTabs\(\)/);
  assert.match(finance, /if\(f\.overdueCents>0\)due\.push\('<b>'\+money\(f\.overdueCents\/100\)\+' vencido<\/b>'\)/);
  assert.match(finance, /if\(f\.visits\)due\.push\(plural\(f\.visits,'cita sin cobrar','citas sin cobrar'\)\)/);
  assert.match(finance, /put\('accounts',money\(f\.dueCents\/100\)/);
  assert.match(finance, /var pf=periodFacts\(\);put\('receipts',money\(pf\.totalCents\/100\),pf\.label\+' · '/);
  assert.match(finance, /put\('cash',f\.session\?money\(f\.cashCents\/100\):'Cerrada'/);
  assert.match(finance, /f\.sessionOld\?'Abierta hace más de 18 h'/);
  assert.match(finance, /f\.fiscalReady\?'En pruebas':'Falta configurar'/);
  // El aviso no depende solo del color: lleva punto y texto.
  assert.match(css, /#p-caja \.finance-tabcards>button\[data-tone\] \.finance-tab-note::before\{content:""/);
});

test('solo se dibuja la pestaña visible y las listas largas van de 50 en 50', () => {
  const panel = finance.slice(finance.indexOf('function renderPanel()'), finance.indexOf('function showTab('));
  assert.match(panel, /p\.hidden=p\.dataset\.financePanel!==state\.tab/);
  assert.match(panel, /if\(state\.tab==='accounts'\)\{renderVisits\(\);renderAccounts\(\);\}/);
  assert.match(panel, /else if\(state\.tab==='receipts'\)renderPayments\(\);/);
  assert.match(panel, /else if\(state\.tab==='cash'\)renderCash\(\);/);
  assert.match(panel, /else if\(state\.tab==='fiscal'\)renderFiscal\(\);/);
  // Cambiar de pestaña no vuelve a dibujar todo: solo marca la pestaña y dibuja su panel.
  assert.match(finance, /b\.onclick=function\(\)\{showTab\(b\.dataset\.financeTab\);\}/);
  assert.match(finance, /function showTab\(tab,filter\)\{[^\n]*renderPanel\(\);\}/);
  // Al terminar de cargar la página deja de anunciarse como ocupada (antes se quedaba en aria-busy="true").
  assert.match(finance, /renderPanel\(\);renderBillingSetup\(\);var page=document\.getElementById\('p-caja'\);if\(page\)page\.setAttribute\('aria-busy','false'\);/);
  // Cada lista se salta si su pestaña no está a la vista.
  assert.match(finance, /function renderAccounts\(\)\{\r?\n    var host=document\.getElementById\('finance-accounts'\);if\(!host\|\|state\.tab!=='accounts'\)return;/);
  assert.match(finance, /var host=document\.getElementById\('finance-payments'\);if\(!host\|\|state\.tab!=='receipts'\)return;/);
  assert.match(finance, /var host=document\.getElementById\('finance-cash'\);if\(!host\|\|state\.tab!=='cash'\)return;/);
  // Pagos solo recorre el periodo elegido (abre en Hoy): no dibuja el historial completo.
  assert.match(finance, /payPeriod:'today'/);
  assert.match(finance, /if\(t>=range\.from&&t<range\.to\)add\('payment',t,p,p,cents\(p\.amount\)\)/);
  assert.match(finance, /PAGE_ROWS=50/);
  assert.match(finance, /function moreRows\(total,shown,key\)\{return total>shown\?/);
  for (const key of ['accounts', 'payments']) assert.match(finance, new RegExp("moreRows\\([a-zA-Z.]+,[a-zA-Z.]+,'" + key + "'\\)"));
  assert.match(finance, /shown:\{accounts:50,payments:50,moves:12,cuts:5,invoices:50\}/);
  assert.match(finance, /var host=document\.getElementById\('finance-fiscal'\);if\(!host\|\|state\.tab!=='fiscal'\)return;/);
  // Sin recorridos de tabla completa por fila: recibos, borradores y datos fiscales se buscan por índice.
  assert.match(finance, /function byKey\(a,key,id\)/);
  assert.doesNotMatch(finance, /state\.receipts\.find\(function/);
});

test('un nombre para cada cosa dentro de Finanzas', () => {
  for (const old of ['Registrar pago', 'Cobrar a paciente', 'Agregar cargo', 'Agregar servicio', 'Registrar anticipo', 'Realizar corte', 'Confirmar cierre', 'Entrada / salida', 'Cuentas por cobrar', 'Cuentas de pacientes', 'Pagos y recibos', 'Pendientes de registrar', 'Cuentas por crear', 'Operaciones', '>Sin cargo<', 'Cerrar sin cargo']) {
    assert.ok(!finance.includes(old), old);
  }
  for (const name of ['>Cobrar</button>', '<h2>Cobrar</h2>', '<h2>Registrar cargo</h2>', '>Registrar cargo</button>', '>Fue sin costo</button>', 'Citas atendidas sin cobrar', '>Recibir anticipo</button>', '>Hacer corte</button>', '>Entrada o salida</button>', "'Cerrar sin costo'"]) {
    assert.ok(finance.includes(name), name);
  }
});

test('el lenguaje visible adopta Finanzas en navegación y configuración', () => {
  assert.match(read('smyl-navigation.js'), /\['Finanzas', 'caja', 'cash'\]/);
  assert.match(read('smyl-professional-v3.js'), /caja:\['Finanzas','Saldos, pagos y control financiero de la clínica'\]/);
  assert.match(read('smyl-settings-hub.js'), /id: 'cobros', title: 'Finanzas'/);
  assert.match(read('smyl-consultorio.js'), /Ir a Finanzas/);
  assert.match(read('smyl-proposals.js'), /Iniciar tratamiento/);
});

test('la capa visual nueva evita microtexto, se adapta al celular y ya no deja el Resumen encima', () => {
  const block = css.slice(css.indexOf('/* Finanzas v6'));
  assert.ok(block.length > 0);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 12);
  assert.equal(tiny.length, 0);
  assert.match(block, /#p-caja \.finance-tabcards\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(block, /@media\(max-width:720px\)\{/);
  assert.match(block, /@media\(max-width:560px\)\{\s*#p-caja \.finance-tabcards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  // En pantallas táctiles, lo que se toca mide al menos 44 px.
  assert.match(block, /#p-caja :is\(\.finance-link-action,\.finance-more-rows \.btn\)\{min-height:44px\}/);
  assert.match(block, /#p-caja \.finance-operations-menu>summary\{[^}]*min-height:44px/);
  // La regla «.finance-summary-panel{display:grid}» ganaba al atributo hidden y dejaba el Resumen visible en todas las pestañas.
  assert.doesNotMatch(css, /finance-summary|finance-overview|finance-priority-list|\.finance-flow|\.finance-metrics|\.finance-tabs(?![\w-])|\.finance-bar(?![\w-])/);
  // Ningún panel de pestaña recibe un «display» que gane al atributo hidden.
  assert.doesNotMatch(css, /\[data-finance-panel[^\]]*\]\s*\{[^}]*display:/);
});

test('web y PWA comparten la misma entrega versionada', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'smyl-xlsx.js', 'smyl-navigation.js', 'smyl-professional-v3.js', 'smyl-settings-hub.js', 'smyl-consultorio.js', 'smyl-proposals.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read('mobile/www/' + file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.css\?v=61/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=84/);
  assert.match(read('sw.js'), /smyl-finance\.js\?v=84/);
  assert.match(read('sw.js'), /smyl-finance\.css\?v=61/);
  assert.match(read('sw.js'), /finanzas-pestanas-v6/);
  assert.match(read('sw.js'), /finanzas-cobrar-pagos-v7/);
});
