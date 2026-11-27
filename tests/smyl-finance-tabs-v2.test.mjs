// Finanzas v6: cuatro pestañas con su cifra (Por cobrar, Pagos, Caja y Facturación); ya no hay pestaña Resumen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const js = read('smyl-finance.js');
const css = read('smyl-finance.css');
const nav = (js.match(/var TABS=\[[^\n]*?\]\]/) || [''])[0];

test('Finanzas tiene cuatro destinos claros y abre en Por cobrar', () => {
  assert.equal(nav, "var TABS=[['accounts','Por cobrar'],['cash','Caja'],['receipts','Pagos y recibos'],['fiscal','Facturación']]");
  assert.match(js, /<nav class="finance-tabcards" role="tablist" aria-label="Secciones de Cobros y caja">'\+TABS\.map\(/);
  assert.doesNotMatch(js, /data-finance-tab="(summary|payments|today)"/);
  for (const old of ['Resumen', 'Cuentas por cobrar', 'Por cobrar hoy', 'Corte de caja', 'Preparación CFDI', 'Plantillas']) assert.ok(!nav.includes(old), old);
  const hub = read('smyl-settings-hub.js');
  for (const id of ['receipts', 'cash']) assert.doesNotMatch(hub, new RegExp('data-finance-tab="' + id + '"'), 'Pagos y Caja viven en Finanzas, no en Configuración');
  // La configuración fiscal ya no es una pestaña de Cobros: Configuración incrusta #billing-setup.
  assert.match(hub, /element: '#billing-setup'/);
});

test('«Por cobrar» reúne los filtros, con «Vencidas» en lugar de la pestaña «Por cobrar hoy»', () => {
  const filters = [...js.matchAll(/data-account-filter="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(filters, ['open', 'overdue', 'credit', 'all']);
  assert.match(js, /var ACCOUNT_FILTERS=\['open','overdue','credit','all'\]/);
  // Las vencidas son filas de la misma lista (ya no hay una lista aparte): mismas columnas y, además, su menú de recordatorios.
  assert.doesNotMatch(js, /renderToday|finance-today|overdueMode|finance-list-summary/);
  assert.match(js, /function matchAccount\(s,filter\)\{return filter==='overdue'\?s\.overdue\.length>0:filter==='open'\?s\.dueCents>0:filter==='credit'\?s\.creditCents>0:/);
  assert.match(js, /data-remind="'\+id\+'"/);
  assert.match(js, /Cada recordatorio se revisa antes de enviarse\./);
  assert.match(css, /#p-caja \.finance-tag\[data-tone=danger\]\{/);
});

test('cada pestaña lleva su cifra, se abre con un clic y se recorre con las flechas del teclado', () => {
  assert.match(js, /<button type="button" role="tab" id="finance-tab-'\+t\[0\]\+'" data-finance-tab="'\+t\[0\]\+'"/);
  assert.match(js, /<strong class="finance-tab-figure">—<\/strong><small class="finance-tab-note"><\/small>/);
  assert.match(js, /b\.onkeydown=function\(e\)\{if\(e\.key!=='ArrowRight'&&e\.key!=='ArrowLeft'\)return;/);
  assert.match(css, /#p-caja \.finance-tabcards>button\[aria-selected=true\]\{/);
});

test('las franjas de resumen desaparecieron: cada aviso vive en la pestaña donde se resuelve', () => {
  assert.doesNotMatch(js, /finance-focus-list|SEGUIMIENTO FINANCIERO|Cartera al día|id="finance-focus"|renderCollectionFocus|POR REVISAR/);
  assert.doesNotMatch(js, /finance-overview|finance-flow|Panorama financiero|Del saldo al cierre|data-metric-/);
  assert.match(js, /if\(f\.overdueCents>0\)due\.push\('<b>'\+money\(f\.overdueCents\/100\)\+' vencido<\/b>'\)/);
  assert.match(js, /class="finance-session-warn" role="status">Lleva más de 18 horas abierta\. Haz el corte para cerrar el turno\./);
  assert.match(js, /Abrir mi caja/);
  assert.match(js, /Abierta hace más de 18 h/);
});

test('los tamaños de letra nuevos respetan el mínimo de 12 px y la web y el contenedor móvil coinciden', () => {
  const block = css.slice(css.indexOf('/* Cobros v2'));
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) < 12);
  assert.equal(tiny.length, 0);
  for (const f of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('el módulo tiene identidad profesional, acciones contextuales y sin avisos fijos de carga', () => {
  assert.doesNotMatch(js, /CONTROL FINANCIERO DENTAL|Separado de la suscripción|preparación fiscal por paciente/);
  assert.doesNotMatch(js, /markFinanceBoundary/);
  assert.match(js, /finance-page-head finance-actionsbar/);
  assert.doesNotMatch(js, /finance-titlebar|GESTIÓN FINANCIERA/);
  assert.match(js, /function renderFinanceActions\(\)/);
  assert.match(js, /class="btn btn-primary" id="finance-guided-collection">Cobrar<\/button>/);
  assert.match(js, /finance-operations-menu/);
  assert.match(js, /render\(\);notify\(''\);\}catch\(e\)/, 'al cargar bien se limpia el aviso de carga');
  assert.match(js, /notify\.timer=setTimeout\(function\(\)\{h\.replaceChildren\(\);\},action\?15000:6000\)/);
  assert.match(css, /\.finance-page>h1\{position:absolute/);
  assert.match(css, /\.finance-actionsbar\{/);
  assert.match(css, /@media\(max-width:560px\)\{\s*#p-caja \.finance-tabcards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
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
  assert.match(acc, /id="account-advance">Recibir anticipo/);
  assert.match(acc, /snapshot\.due>0\?\(onlinePayEnabled\(\)\?'<button type="button" id="account-link">Enlace de pago<\/button>':''\)\+'<button type="button" class="btn btn-primary" id="account-pay">Cobrar/);
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
  assert.match(fin, /function openRefund\(payment\)\{\s*if\(!state\.canRefund\)/);
  assert.match(admin, /'finance\.refund': 'Reembolsar y cancelar cargos'/);
  assert.match(admin, /'finance\.manage', 'finance\.cash', 'finance\.cash\.supervise', 'finance\.refund'/);
  assert.match(sql, /smyl_finance_refund_guard/);
  assert.match(sql, /smyl_finance_void_guard/);
  assert.match(sql, /where rp\.permission_key = 'finance\.manage'/);
  assert.match(sql, /'catalog\.manage', 'catalog\.prices'/);
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /20261109100000/);
  assert.doesNotMatch(wf, /pull_request|push:/);
  for (const f of ['smyl-finance.js', 'smyl-clinic-admin.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('Servicios y tarifas: la tarjeta no muestra ni edita el precio; se cambia en «Editar»', () => {
  const js = fs.readFileSync(new URL('../smyl-service-catalog.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /var priceCell=|catalog-service-price|catalog-price-input/);
  assert.match(js, /name="reference_price"/);
  assert.match(js, /precio varía por sede/);
  assert.match(js, /Falta precio/);
});

test('Agregar servicio o cargo: el selector no marca «sin datos fiscales»; el aviso al elegir lo explica', () => {
  const fin = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fin, /sin datos fiscales/);
  assert.match(fin, /Se puede cobrar, pero aún no facturar/);
});

test('Agregar servicio o cargo: el total queda junto a los botones y el descuento no es una caja dentro de otra', () => {
  const fin = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../smyl-finance.css', import.meta.url), 'utf8');
  assert.match(fin, /finance-actions-total/);
  assert.match(fin, /data-sum="total-foot"/);
  assert.match(fin, /\[data-sum="total-foot"\]'\)\.textContent=money2\(m\.total\)/);
  assert.match(css, /body\.smyl-ui-governed \.contenido \.finance-charge-form :is\(\.finance-discount-input,\.finance-money-input\) input\{border:0!important/);
  assert.match(css, /\.finance-actions-total\{margin-right:auto/);
});

test('Inventario v2: un solo título, alertas en chips, primer uso guiado y sin aviso fijo', () => {
  const js = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../smyl-inventory.css', import.meta.url), 'utf8');
  assert.equal((js.match(/<h1>/g) || []).length, 0, 'el título vive en el encabezado de la página; el módulo no repite un segundo título');
  assert.doesNotMatch(js, /Inventario, compras y trazabilidad/);
  assert.doesNotMatch(js, /id="inventory-metrics"|renderMetrics/);
  assert.match(js, /id="inventory-alerts"/);
  assert.match(js, /inventory-chip/);
  assert.match(js, /function renderFirstUse\(host\)/);
  assert.match(js, /Agrega tu primer producto/);
  assert.match(js, /Prepara tu inventario/);
  assert.match(js, /host\.innerHTML = actions\.join\(''\)/, 'sin alertas no se pinta ningún aviso fijo');
  assert.doesNotMatch(js, /notify\('Existencias calculadas/);
  assert.match(css, /\.inventory-first-use\{/);
  assert.match(css, /\.inventory-chip\[data-tone="danger"\]/);
  for (const f of ['smyl-inventory.js', 'smyl-inventory.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('Inventario v2 paso 2: movimiento por tipo, buscador de pacientes y confirmaciones propias', () => {
  const js = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../smyl-inventory.css', import.meta.url), 'utf8');
  assert.match(js, /var MOVEMENT_KINDS=/);
  assert.match(js, /role="radiogroup" aria-label="Qué pasó"/);
  assert.match(js, /WASTE_REASONS=\['Caducado'/);
  assert.match(js, /itemSel=d\.querySelector\('select\[name="item"\]'\)/);
  assert.doesNotMatch(js, /form\.elements\.item\b/);
  assert.match(js, /function mountPatientPicker\(form,initialId\)/);
  assert.match(js, /Elige al paciente de la lista o borra el campo/);
  assert.match(js, /function confirmAction\(o\)/);
  assert.doesNotMatch(js, /window\.confirm\(|window\.prompt\(/);
  assert.match(js, /id="inventory-confirm"/);
  assert.match(css, /\.inventory-kinds\{/);
  assert.match(css, /\.inventory-patient-results\{/);
  assert.match(css, /\.inventory-confirm \.btn\[data-danger="true"\]/);
  for (const f of ['smyl-inventory.js', 'smyl-inventory.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('Inventario v2 paso 3: orden de compra con varias líneas, total y proveedor sin salir del diálogo', () => {
  const js = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../smyl-inventory.css', import.meta.url), 'utf8');
  assert.match(js, /function openOrder\(opts\)/);
  assert.match(js, /data-add-line/);
  assert.match(js, /data-add-missing/);
  assert.match(js, /data-new-supplier/);
  assert.match(js, /from\('smyl_inventory_suppliers'\)\.insert\(\{tenant_id:state\.tenant,name:name/);
  assert.match(js, /p_lines:lines/);
  assert.match(js, /#inventory-new-order'\)\.onclick=\(\)=>openOrder\(\)/);
  assert.doesNotMatch(js, /onclick=openOrder/);
  assert.match(css, /\.inventory-order-line\{display:grid/);
  assert.match(css, /\.inventory-order-total\{/);
  for (const f of ['smyl-inventory.js', 'smyl-inventory.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('Inventario v2: consumo al cerrar la cita (aviso, estado en la ficha y lista de citas sin material)', () => {
  const inv = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
  const sch = fs.readFileSync(new URL('../smyl-schedule.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../smyl-inventory.css', import.meta.url), 'utf8');
  assert.match(sch, /status==='completed'\)window\.dispatchEvent\(new CustomEvent\('smyl:appointment-completed'/);
  assert.match(sch, /data-material-row/);
  assert.match(sch, /window\.SmylInventory\.consumptionStatus\(a\)/);
  assert.match(inv, /window\.addEventListener\('smyl:appointment-completed'/);
  assert.match(inv, /async function consumptionStatus\(app\)/);
  assert.match(inv, /async function loadPendingMaterial\(\)/);
  assert.match(inv, /function openPendingMaterial\(\)/);
  assert.match(inv, /citas con material pendiente/);
  assert.match(inv, /consumptionStatus:consumptionStatus/);
  assert.match(css, /\.inventory-toast\{/);
  assert.match(css, /\.inventory-dialog\[data-plain\]/);
  for (const f of ['smyl-inventory.js', 'smyl-inventory.css', 'smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('Inventario v2: «Reponer» por fila y «Crear pedidos sugeridos» sin duplicar lo que ya viene en camino', () => {
  const js = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../smyl-inventory.css', import.meta.url), 'utf8');
  assert.match(js, /function incomingQuantity\(x\)/);
  assert.match(js, /reorderTarget\(x\)-Number\(x\.on_hand\|\|0\)-incomingQuantity\(x\)/);
  assert.match(js, /function usualSupplier\(itemId\)/);
  assert.match(js, /function openSuggestedOrders\(\)/);
  assert.match(js, /data-reponer=/);
  assert.match(js, /data-suggest-orders/);
  assert.match(js, /Sin proveedor habitual/);
  assert.match(js, /En camino /);
  assert.match(css, /\.inventory-suggest-bar\{/);
  assert.match(css, /\.inventory-reponer\{/);
  for (const f of ['smyl-inventory.js', 'smyl-inventory.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('Inventario: «Registrar consumo», «Ajustar inventario» y «Comprar y recibir» son funciones de rol aplicadas en pantalla y en la base', () => {
  const js = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
  const admin = fs.readFileSync(new URL('../smyl-clinic-admin.js', import.meta.url), 'utf8');
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261114120000_smyl_inventory_role_permissions.sql', import.meta.url), 'utf8');
  const wf = fs.readFileSync(new URL('../.github/workflows/smyl-inventario-permisos-migracion.yml', import.meta.url), 'utf8');
  assert.match(js, /state\.canAdjust=state\.canManage&&extra\('inventory\.adjust'\)/);
  assert.match(js, /state\.canPurchase=state\.canManage&&extra\('inventory\.purchase'\)/);
  assert.match(js, /state\.canConsume=state\.canRead&&\(state\.canManage\|\|p\.has\('inventory\.consume'\)\)/);
  assert.match(js, /state\.canAdjust&&!reversed&&m\.movement_type!=='reversal'/);
  assert.match(js, /state\.canPurchase&&open\?'<button class="btn btn-primary" data-receive=/);
  assert.match(js, /if\(!state\.canConsume\)\{notify\('Tu rol puede consultar inventario/);
  assert.match(admin, /'inventory\.consume': 'Registrar consumo'/);
  assert.match(admin, /'inventory\.adjust': 'Ajustar inventario'/);
  assert.match(admin, /'inventory\.purchase': 'Comprar y recibir'/);
  assert.match(admin, /'inventory\.read', 'inventory\.manage', 'inventory\.consume', 'inventory\.adjust', 'inventory\.purchase'/);
  assert.match(sql, /smyl_inventory_movement_guard/);
  assert.match(sql, /smyl_purchase_order_guard/);
  assert.match(sql, /p_movement_type='consumption' and public\.smyl_has_permission\(v_tenant,'inventory\.consume'\)/);
  assert.match(sql, /where rp\.permission_key = 'inventory\.manage'/);
  assert.match(sql, /'finance\.cash', 'finance\.cash\.supervise', 'finance\.invoice', 'finance\.refund'/);
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /20261114120000/);
  assert.match(wf, /finance\.cash\.supervise/);
  assert.doesNotMatch(wf, /pull_request|push:/);
  for (const f of ['smyl-inventory.js', 'smyl-clinic-admin.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('Finanzas abre en Por cobrar y conserva la cuenta detallada con sus filtros', () => {
  assert.match(js, /actor:null,tab:'accounts'/);
  // El número de citas sin cobrar de la pestaña es el mismo del menú (pendingVisits).
  assert.match(js, /if\(f\.visits\)due\.push\(plural\(f\.visits,'cita sin cobrar','citas sin cobrar'\)\)/);
  assert.doesNotMatch(js, /tabCount\.textContent=String\(openCount\)/);
  assert.doesNotMatch(js, /MORE_FILTERS|finance-more-filters|Requieren acción|data-account-filter="(attention|settled)"/);
  assert.match(js, /class="finance-link-action" data-visit-nocharge=/);
  assert.match(js, /Sin abonos todavía/);
  assert.match(js, /Todo cobrado por ahora/);
  assert.match(js, /<header class="finance-page-head finance-actionsbar"><div class="finance-head-actions"><\/div><\/header>/);
  // El nombre del paciente (con su línea de estado) es el botón que abre la cuenta.
  assert.match(css, /#p-caja button\.finance-line-who:hover \.finance-line-name\{color:var\(--smyl-accent,#142bc3\);text-decoration:underline/);
  const app = read('app.html'), shell = read('smyl-professional-v3.css');
  assert.match(app, /new MutationObserver\(function\(\)\{place\(\);\}\)/, 'el pie de derechos siempre queda al final del contenido');
  assert.match(shell, /\.contenido>#app-copyright\{position:static[^}]*height:0/);
});

test('Cobros paso 2: la ayuda de caja cabe en una línea al pie y los botones usan el estilo de la app', () => {
  assert.doesNotMatch(js, /<h2>Reglas de caja<\/h2>|finance-cash-help|¿Cómo funciona la caja\?/);
  assert.match(js, /<p class="finance-list-foot">Los pagos con tarjeta o transferencia no entran a la caja: se revisan al hacer el corte\.<\/p>/);
  assert.match(js, /<button type="button" class="btn btn-secondary"'\+\(first\?' id="finance-adjust"':''\)\+' data-adjust="'\+s\.id\+'">Entrada o salida<\/button>/);
  assert.match(js, /class="btn btn-secondary" data-supervise-cash=/);
  assert.match(css, /#p-caja \.finance-segment\{display:inline-flex;padding:3px;/);
  assert.match(css, /#p-caja :is\(\.finance-chips>button,\.finance-segment>button,[^{]*\)\{min-height:44px\}/);
});

test('Cobros paso 3: precio de lista, cobro en la fila, «Todas», siguiente pendiente y corte visible', () => {
  // Precio de lista del servicio en cada pendiente (el total real, con impuestos, se confirma en el diálogo).
  assert.match(js, /function visitPrice\(a\)\{var sv=by\(state\.services,a\.service_id\),price=sv&&Number\(priceFor\(sv,a\.branch_id\)\);return price>0&&a\.status!=='no_show'\?'Precio de lista <b>'/);
  // «Cobrar» en la fila reutiliza el cobro de saldo existente; el importe ya está en la columna Saldo.
  assert.match(js, /data-account-pay="'\+id\+'" aria-label="Cobrar a '\+label\+'">Cobrar<\/button>/);
  assert.match(js, /openPayment\(button\.dataset\.accountPay,\{mode:'balance'\}\)/);
  // «Todas» lista las cuentas con movimientos; quien no tiene ninguno aparece al buscarlo por nombre.
  assert.match(js, /:s\.charges\.length>0\|\|s\.creditCents>0;\}/);
  assert.match(js, /data-account-filter="all" aria-pressed="false">Todas<\/button>/);
  assert.match(js, /Quien no tiene movimientos aparece al buscarlo\./);
  assert.doesNotMatch(js, /data-toggle-empty|showEmptyAccounts/);
  // Aviso con el siguiente pendiente después de cobrar o cerrar sin cargo.
  assert.match(js, /function notifyNextVisit\(text\)/);
  assert.match(js, /label:'Siguiente: '\+name\(a\.patient_id\)\+' →'/);
  assert.match(js, /fromVisit\)\{await reload\(\);notifyNextVisit\(chargeText\);\}/);
  // Corte visible. Finanzas abre siempre en «Con saldo»: lo primero que se ve es lo que hay que cobrar (ya no se recuerda el último filtro).
  assert.match(js, /f\.sessionOld\?'Abierta hace más de 18 h'/);
  assert.doesNotMatch(js, /smyl_finance_filter_/);
  assert.match(css, /#p-caja \.finance-session-warn\{/);
  assert.doesNotMatch(js, /\.from\('smyl_finance_[a-z_]*'\)\.insert|\.update\(/);
});
