import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

test('Facturación: «Avisar por WhatsApp» (factura timbrada) y «Pedir datos por WhatsApp» (pago sin datos fiscales) abren el chat con su plantilla', () => {
  const js = read('smyl-finance.js');
  assert.match(js, /function waLink\(patientId\)\{var l=chatLinks\[patientId\];return l&&l\.channel==='whatsapp'&&window\.SmylInbox&&typeof window\.SmylInbox\.sendTemplate==='function'\?l:null;\}/);
  assert.match(js, /preferred:\['factura_disponible_v1'\],variables:\[patientFirstName\(d\.patient_id\),invoiceFolio\(d\),clinicLabel\(\)\]/);
  assert.match(js, /preferred:\['datos_facturacion_pendientes_v1'\],variables:\[patientFirstName\(patientId\),clinicLabel\(\)\]/);
  assert.match(js, /if\(waLink\(d\.patient_id\)\)menu\.push\(item\('data-wa-cfdi','Avisar por WhatsApp'\)\)/);
  assert.match(js, /x\.code==='profile'&&waLink\(p\.patient_id\)\?'<button type="button" class="finance-link-action" data-wa-fiscal=/);
  assert.match(js, /chatLinks=map;renderAccounts\(\);renderFiscal\(\);/, 'al llegar los chats vinculados se repinta Facturación');
  // Nunca envía solo: solo abre el chat con la plantilla llenada.
  const helpers = js.slice(js.indexOf('function waLink'), js.indexOf('function resetChatLinks'));
  assert.doesNotMatch(helpers, /\.insert\(|\.update\(|\.rpc\(|functions\.invoke|fetch\(/);
  assert.match(helpers, /missingText:'Para avisarle por WhatsApp que su factura está lista necesitas la plantilla «Factura disponible»/);
});

test('las dos plantillas existen y el folio y la clínica encajan con sus variables', () => {
  const catalog = require('../smyl-template-catalog.js');
  const a = catalog.TEMPLATES.find(t => t.id === 'factura_disponible_v1'), b = catalog.TEMPLATES.find(t => t.id === 'datos_facturacion_pendientes_v1');
  assert.equal(a.variables.length, 3); assert.match(a.variables[1].label, /Folio/);
  assert.equal(b.variables.length, 2);
  assert.equal(a.category, 'UTILITY'); assert.equal(b.category, 'UTILITY');
});

test('web, móvil y PWA publican Finanzas con la versión nueva', () => {
  assert.match(read('app.html'), /smyl-finance\.js\?v=78/);
  assert.match(read('sw.js'), /'\/camila\/smyl-finance\.js\?v=78'/);
  for (const f of ['smyl-finance.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});
