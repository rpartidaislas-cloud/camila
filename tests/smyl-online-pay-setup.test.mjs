// task-id smyl-openpay-config: la clínica conecta su Openpay a LANA desde Configuración → Finanzas, sin entrar al panel de LANA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const fn = read('supabase/functions/smyl-pay/index.ts');
const ui = read('smyl-online-pay-setup.js');
const css = read('smyl-online-pay-setup.css');
const hub = read('smyl-settings-hub.js');

test('smyl-pay: consultar con permiso de cobro; conectar, métodos y desconectar solo el dueño', () => {
  assert.match(fn, /if \(typeof body\.action === "string" && body\.action\.startsWith\("openpay_"\)\) return await accionesOpenpay\(body, tenantId, user\.id, CORS\);/);
  const i = fn.indexOf('accionesOpenpay(body, tenantId, user.id, CORS)'), permiso = fn.indexOf('if (permitido !== true) return json(CORS, 403');
  assert.ok(permiso > 0 && i > permiso, 'las acciones de Openpay van después del permiso finance.manage');
  assert.match(fn, /const esDueno = userId === tenantId;/);
  assert.match(fn, /else if \(!esDueno\) \{\s*return json\(CORS, 403, \{ error: "Solo el dueño de la clínica puede conectar o cambiar Openpay\." \}\);/);
  for (const ruta of ['"/payments/openpay"', '"/payments/openpay/credentials"', '"/payments/openpay/methods"', '"/payments/openpay/disconnect"']) assert.ok(fn.includes(ruta), ruta);
});

test('smyl-pay: las llaves solo viajan a LANA; la respuesta devuelve el estado sin llaves y sincroniza pago_en_linea', () => {
  assert.match(fn, /init = \{ method: "PUT", body: JSON\.stringify\(\{ merchant_id: body\.merchant_id, public_key: body\.public_key, private_key: body\.private_key \}\) \};/);
  assert.match(fn, /return json\(CORS, 200, \{ openpay, owner: esDueno \}\);/);
  assert.doesNotMatch(fn, /from\("camila_tenants"\)[^;]*private_key/);
  assert.match(fn, /await marcarPagoEnLinea\(tenantId, !!openpay\.connected && !!openpay\.active\);/);
  assert.match(fn, /config: \{ \.\.\.config, pago_en_linea: activo \}/);
});

test('pantalla: estado, métodos (Paynet y MSI como próximamente), credenciales solo para el dueño', () => {
  for (const t of ['PAGOS EN LÍNEA · OPENPAY', 'Métodos disponibles', 'Tarjeta', 'Transferencia SPEI', 'Efectivo en tiendas Paynet', 'Meses sin intereses', 'Credenciales y seguridad', 'Conectar Openpay', 'Actualizar credenciales', 'Desconectar', 'Ya configurado — escribe uno nuevo para reemplazarlo']) assert.ok(ui.includes(t), t);
  assert.match(ui, /if \(state\.owner\) \{/);
  assert.match(ui, /call\('openpay_status'\)/);
  assert.match(ui, /run\('openpay_connect', body,/);
  assert.match(ui, /run\('openpay_disconnect', \{\},/);
  assert.match(ui, /input\.type = secret && !state\.showKey \? 'password' : 'text';/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/, 'las llaves no se guardan en el navegador');
  assert.doesNotMatch(ui, /cifrad/, 'no promete cifrado que no podemos garantizar');
});

test('Configuración → Finanzas abre «Pagos en línea (Openpay)» y carga el estado', () => {
  assert.match(hub, /title: 'Pagos en línea \(Openpay\)'.*element: '#online-pay-setup', ensure: 'online-pay'/);
  assert.match(hub, /item\.ensure === 'online-pay' && win\.SmylOnlinePay && typeof win\.SmylOnlinePay\.ensure === 'function'/);
  for (const f of ['app.html', 'sw.js']) { assert.match(read(f), /smyl-online-pay-setup\.js\?v=3/); assert.match(read(f), /smyl-online-pay-setup\.css\?v=2/); }
  for (const f of ['smyl-online-pay-setup.js', 'smyl-online-pay-setup.css', 'smyl-settings-hub.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), 'mobile/www/' + f);
});

test('estilos sin microtexto', () => {
  for (const m of css.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 12, m[0]);
});

test('si el servidor no devuelve un error legible, se muestra el código HTTP y la respuesta (no un mensaje genérico)', () => {
  assert.match(ui, /detail = \(status \? 'HTTP ' \+ status \+ ' · ' : ''\)/);
  assert.match(ui, /'No se pudo ' \+ \(ACTION_LABEL\[action\] \|\| 'completar'\) \+ ' Openpay'/);
  assert.match(ui, /openpay_connect: 'conectar'/);
  assert.doesNotMatch(ui, /No se pudo consultar Openpay\./);
});

// Efectivo en tiendas (Paynet vía Openpay/LANA).
test('Paynet: pantalla con interruptor real, smyl-pay mapea paynet→store y lo acepta en métodos', () => {
  assert.match(ui, /switchRow\('store', 'Efectivo en tiendas Paynet', '[^']+', d\.methods\.paynet, lock,/);
  assert.match(ui, /run\('openpay_methods', \{ paynet: v \}/);
  assert.match(fn, /const metodo = req\.method === "spei" \? "transfer" : req\.method === "paynet" \? "store" : "card";/);
  assert.match(fn, /for \(const k of \["active", "card", "spei", "paynet"\]\)/);
});

test('Paynet: la migración acepta store y lo registra como "other" para que no cuente como efectivo de la caja', () => {
  const mig = read('supabase/migrations/20261121130000_smyl_payment_links_store.sql');
  assert.match(mig, /check \(method in \('card','transfer','store'\)\)/);
  assert.match(mig, /if p_method not in \('card','transfer','store'\)/);
  assert.match(mig, /v_finance_method := case when p_method = 'store' then 'other' else p_method end;/);
  assert.match(mig, /'OpenPay Paynet '/);
});

test('Paynet: pagar.html ofrece «Efectivo en tienda» solo si la clínica lo tiene activo y muestra referencia y código de barras de Openpay', () => {
  const page = read('pagar.html');
  assert.match(page, /\['paynet', 'Efectivo en tienda', methods\.paynet === true\]/);
  assert.match(page, /post\(LANA_PAY, \{ accion: 'paynet', token: token \}\)/);
  assert.match(page, /\/\^https:\\\/\\\/\(\[a-z0-9-\]\+\\\.\)\*openpay\\\.mx\\\/\/\.test\(d\.barcode_url\)/);
  assert.doesNotMatch(page, /innerHTML/);
});

test('la pantalla explica que Openpay opera a través de LANA como aplicación externa', () => {
  assert.match(ui, /Cómo funciona/);
  assert.match(ui, /Openpay opera en SMYL a través de LANA como aplicación externa: Openpay validó a LANA como plataforma de pagos/);
});
