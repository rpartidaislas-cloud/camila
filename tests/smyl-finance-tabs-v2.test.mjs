// Cobros v2 (maqueta aprobada el 2026-11-08): 4 pestañas, «Por cobrar» unifica «Por cobrar hoy» y
// «Cuentas por cobrar», las cifras son accesos directos y la tarjeta de seguimiento pasa a una franja.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const js = read('smyl-finance.js');
const css = read('smyl-finance.css');
const nav = js.slice(js.indexOf('<nav class="finance-tabs"'), js.indexOf('</nav>', js.indexOf('<nav class="finance-tabs"')));

test('quedan cuatro pestañas con nombres cortos y los mismos identificadores que enlaza Configuración', () => {
  const ids = [...nav.matchAll(/data-finance-tab="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['accounts', 'payments', 'cash', 'fiscal']);
  for (const label of ['>Por cobrar<em hidden></em>', '>Pagos<', '>Caja<', '>Facturación<']) assert.ok(nav.includes(label), label);
  for (const old of ['Por cobrar hoy', 'Cuentas por cobrar', 'Pagos y recibos', 'Corte de caja', 'Preparación CFDI', 'Plantillas']) assert.ok(!nav.includes(old), old);
  const hub = read('smyl-settings-hub.js');
  for (const id of ['fiscal', 'payments', 'cash']) assert.match(hub, new RegExp('data-finance-tab="' + id + '"'));
});

test('«Por cobrar» reúne los filtros, con «Vencidas» en lugar de la pestaña «Por cobrar hoy»', () => {
  const filters = [...js.matchAll(/data-account-filter="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(filters, ['attention', 'overdue', 'open', 'credit', 'settled', 'all']);
  assert.match(js, /overdueMode=state\.accountFilter==='overdue'/);
  assert.match(js, /if\(overdueMode\)\{renderToday\(\);return;\}/);
  assert.match(js, /if\(state\.tab!=='accounts'\|\|state\.accountFilter!=='overdue'\)return;/);
  assert.match(js, /<div id="finance-today" hidden><\/div>/);
  assert.match(js, /data-today-send/);
  assert.match(js, /finance-list-summary/);
  assert.match(css, /\.finance-list-summary\{/);
});

test('cada cifra abre la pestaña o el filtro que la explica y es operable con teclado', () => {
  assert.match(js, /var METRIC_GO=\[\['accounts','open'[^\]]*\],\['payments',''[^\]]*\],\['accounts','credit'[^\]]*\],\['cash',''[^\]]*\]\]/);
  assert.match(js, /role="button" tabindex="0" data-metric-tab=/);
  assert.match(js, /e\.key==='Enter'\|\|e\.key===' '/);
  assert.match(css, /\.finance-metrics article\[role=button\]:focus-visible/);
});

test('la tarjeta «Seguimiento financiero» se sustituye por una franja de una línea que solo aparece con pendientes', () => {
  assert.doesNotMatch(js, /finance-focus-list|SEGUIMIENTO FINANCIERO|Cartera al día/);
  assert.match(js, /class="finance-alert-host"[^>]*hidden/);
  assert.match(js, /if\(!total\)\{host\.innerHTML='';host\.hidden=true;return;\}/);
  assert.match(css, /\.finance-alert\{display:flex/);
});

test('los tamaños de letra nuevos respetan el mínimo de 12 px y la web y el contenedor móvil coinciden', () => {
  const block = css.slice(css.indexOf('/* Cobros v2'));
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) < 12);
  assert.equal(tiny.length, 0);
  for (const f of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('el módulo es compacto: sin encabezado ni leyenda, acciones junto a las pestañas y sin avisos fijos de carga', () => {
  assert.doesNotMatch(js, /CONTROL FINANCIERO DENTAL|Separado de la suscripción|preparación fiscal por paciente/);
  assert.doesNotMatch(js, /markFinanceBoundary/);
  assert.doesNotMatch(js, /<header class="finance-head">/);
  assert.match(js, /<div class="finance-bar"><nav class="finance-tabs"[\s\S]*?<\/nav><div class="finance-head-actions">/);
  assert.match(js, /render\(\);notify\(''\);\}catch\(e\)/, 'al cargar bien se limpia el aviso de carga');
  assert.match(js, /notify\.timer=setTimeout\(function\(\)\{h\.replaceChildren\(\);\},6000\)/);
  assert.match(css, /\.finance-page>h1\{position:absolute/);
  assert.match(css, /\.finance-bar\{display:flex/);
  assert.match(css, /@media screen and \(max-width:420px\)\{[\s\S]*?\.finance-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('el cobro guiado es de un solo paso, con opción sugerida, datos útiles y aviso de caja', () => {
  const guide = js.slice(js.indexOf('function openGuidedCollection'), js.indexOf('function paymentSuccess'));
  assert.doesNotMatch(guide, /data-guide-progress|Paso \d de 2|<span>1<\/span>|<span>2<\/span>/);
  assert.match(guide, /pick=s\.due>0\?'balance':appointment\?'service':''/);
  assert.match(guide, /Sugerido/);
  assert.match(guide, /No disponible ahora/);
  assert.match(guide, /data-guide-open-cash/);
  assert.match(guide, /Caja cerrada · Abrir/);
  assert.match(guide, /Último pago/);
  assert.doesNotMatch(guide, /finance-guide-route-meta">Abrir|route-meta">Revisar|route-meta">A favor/);
  assert.match(css, /\.finance-collection-guide \[hidden\]\{display:none!important\}/);
  assert.match(css, /\.finance-guide-badge\{/);
});

test('la cuenta del paciente separa el texto, muestra estado y último pago, y ofrece pagos con recibo', () => {
  const start = js.indexOf('function openAccount');
  const acc = js.slice(start, js.indexOf('\n  function ', start + 20));
  assert.match(acc, /Total cargado/);
  assert.match(acc, /data-tone="credit"><span>A favor/);
  assert.match(acc, /Último pago/);
  assert.match(acc, /data-account-tab="payments"[^>]*>Historial/);
  assert.match(acc, /<summary>Liquidados \(/);
  assert.match(acc, /id="account-advance">Registrar anticipo/);
  assert.match(acc, /snapshot\.due>0\?'<button type="button" class="btn btn-primary" id="account-pay">Cobrar/);
  assert.match(acc, /data-account-receipt/);
  assert.match(acc, /shareReceipt\(/);
  assert.doesNotMatch(acc, /Sin fecha de vencimiento/);
  assert.match(js, /async function shareReceipt\(payment,receipt,button\)/);
  assert.match(js, /share\.onclick=function\(\)\{shareReceipt\(payment,receipt,share\);\}/);
  assert.match(css, /\.finance-account-ledger article>div strong,[^{]*\{display:block\}/);
  assert.match(css, /\.finance-account \[hidden\]\{display:none!important\}/);
});

test('Servicios y tarifas: encabezado mínimo, filas limpias con interruptor y ventana con lo esencial primero', () => {
  const cat = fs.readFileSync(new URL('../smyl-service-catalog.js', import.meta.url), 'utf8');
  const catCss = fs.readFileSync(new URL('../smyl-service-catalog-stage1.css', import.meta.url), 'utf8');
  assert.doesNotMatch(cat, /GESTIÓN DEL NEGOCIO|fuente única|professionalCopy|catalog-guidance|SAT \x27\+esc\(sat\)/);
  assert.match(cat, /role="switch" class="catalog-switch"|role="switch"/);
  assert.match(cat, /data-price-for/);
  assert.match(cat, /async function savePrice\(id,value,input\)/);
  assert.match(cat, /Usar otro nombre interno/);
  assert.match(cat, /class="catalog-fiscal wide"/);
  assert.match(cat, /Falta revisar/);
  assert.match(cat, /catalog-form-error/);
  assert.doesNotMatch(cat, /Validar con contador\/PAC|VERSIÓN /);
  assert.match(catCss, /\.catalog-switch\[aria-checked=true\]/);
  const block = catCss.slice(catCss.indexOf('/* Servicios y tarifas v2'));
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) < 12);
  assert.equal(tiny.length, 0);
  for (const f of ['smyl-service-catalog.js', 'smyl-service-catalog-stage1.css', 'app.html', 'sw.js']) assert.equal(fs.readFileSync(new URL('../mobile/www/' + f, import.meta.url), 'utf8'), fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), f);
});

test('Servicios y tarifas: «Cambiar precios» es una función de rol aplicada en pantalla y en la base', () => {
  const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const js = read('smyl-service-catalog.js');
  const admin = read('smyl-clinic-admin.js');
  const sql = read('supabase/migrations/20261109090000_smyl_catalog_price_permission.sql');
  const wf = read('.github/workflows/smyl-catalogo-precios-migracion.yml');
  assert.match(js, /canPrices/);
  assert.match(js, /catalog\.prices/);
  assert.match(js, /Tu rol no puede cambiarlo/);
  assert.match(admin, /'catalog\.manage': 'Gestionar servicios'/);
  assert.match(admin, /'catalog\.prices': 'Cambiar precios'/);
  assert.match(sql, /smyl_services_price_guard/);
  assert.match(sql, /'catalog\.manage', 'catalog\.prices'/);
  assert.match(sql, /where rp\.permission_key = 'settings\.manage'/);
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /20261109090000/);
  assert.doesNotMatch(wf, /pull_request|push:/);
});

test('Cobros: «Reembolsar y cancelar cargos» es una función de rol aplicada en pantalla y en la base', () => {
  const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const fin = read('smyl-finance.js');
  const admin = read('smyl-clinic-admin.js');
  const sql = read('supabase/migrations/20261109100000_smyl_finance_refund_permission.sql');
  const wf = read('.github/workflows/smyl-reembolsos-permiso-migracion.yml');
  assert.match(fin, /state\.canRefund=owner\|\|p\.has\('finance\.refund'\)/);
  assert.match(fin, /state\.canManage&&state\.canRefund/);
  assert.match(fin, /data-refund=/);
  assert.match(fin, /finance-row-menu/);
  assert.match(fin, /function openRefund\(payment\)\{if\(!state\.canRefund\)/);
  assert.match(admin, /'finance\.refund': 'Reembolsar y cancelar cargos'/);
  assert.match(admin, /'finance\.manage', 'finance\.refund'/);
  assert.match(sql, /smyl_finance_refund_guard/);
  assert.match(sql, /smyl_finance_void_guard/);
  assert.match(sql, /where rp\.permission_key = 'finance\.manage'/);
  assert.match(sql, /'catalog\.manage', 'catalog\.prices'/);
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /20261109100000/);
  assert.doesNotMatch(wf, /pull_request|push:/);
  for (const f of ['smyl-finance.js', 'smyl-clinic-admin.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('Servicios y tarifas: todo servicio activo muestra su precio editable en la fila para quien puede cambiarlo', () => {
  const js = fs.readFileSync(new URL('../smyl-service-catalog.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../smyl-service-catalog-stage1.css', import.meta.url), 'utf8');
  assert.match(js, /var priceCell=row&&active&&state\.canManage&&state\.canPrices\?/);
  assert.doesNotMatch(js, /var priceCell=row&&active&&missingPrice&&/);
  assert.match(js, /data-current=/);
  assert.match(js, /if\(input\.value===''&&current\)\{input\.value=current;return;\}/);
  assert.match(css, /\.catalog-price-input\.has-price/);
});
