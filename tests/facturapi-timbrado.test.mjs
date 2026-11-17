import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FORMAS_PAGO, formaPagoSugerida, construirFactura, mensajeFacturapi, clasificarRespuesta, leerFactura } from '../supabase/functions/_shared/facturapi-core.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const concepto = (over = {}) => Object.assign({
  charge_id: 'c1', description: 'Limpieza dental', quantity: 1, unit_value: 1000, discount: 0, tax: 0, amount: 1000,
  product_service_code: '85121800', unit_code: 'E48', tax_object_code: '02', fiscal_status: 'reviewed',
}, over);
const borrador = (over = {}) => Object.assign({
  id: 'd0d0d0d0-0000-4000-8000-000000000001', idempotency_key: 'b1b1b1b1-0000-4000-8000-000000000002',
  fiscal_snapshot: { legal_name: 'JOSE MUÑOZ PEREZ', rfc: 'MUPJ800229AB1', fiscal_regime: '612', tax_postal_code: '72000', cfdi_use: 'D01', email: 'a@b.mx', amount: 1000, currency: 'MXN' },
  issuer_snapshot: { invoice_series: 'A' },
  concepts_snapshot: [concepto()],
}, over);

test('forma de pago: se sugiere según el cobro y «otro» no se adivina', () => {
  assert.deepEqual(['cash', 'card', 'transfer', 'check', 'other'].map(formaPagoSugerida), ['01', '04', '03', '02', '']);
  assert.ok(Object.keys(FORMAS_PAGO).every((c) => /^\d{2}$/.test(c)));
});

test('servicio dental exento: IVA Exento sin tasa, objeto de impuesto 02 y precio sin IVA incluido', () => {
  const r = construirFactura(borrador(), { c1: { tax_treatment: 'exempt' } }, '03');
  assert.equal(r.ok, true);
  const p = r.payload;
  assert.equal(p.type, 'I');
  assert.equal(p.payment_method, 'PUE');
  assert.equal(p.payment_form, '03');
  assert.equal(p.use, 'D01');
  assert.equal(p.series, 'A');
  assert.deepEqual(p.customer, { legal_name: 'JOSE MUÑOZ PEREZ', tax_id: 'MUPJ800229AB1', tax_system: '612', address: { zip: '72000' }, email: 'a@b.mx' });
  assert.equal(p.items[0].product.taxability, '02');
  assert.deepEqual(p.items[0].product.taxes, [{ type: 'IVA', rate: 0, factor: 'Exento' }]);
  assert.equal(p.items[0].product.tax_included, false);
  assert.equal(p.items[0].product.product_key, '85121800');
  assert.equal(p.items[0].product.unit_name, 'Unidad de servicio');
  assert.equal(p.external_id, 'd0d0d0d0-0000-4000-8000-000000000001');
  assert.equal(p.idempotency_key, 'b1b1b1b1-0000-4000-8000-000000000002');
  assert.equal(r.total, 1000);
});

test('producto con IVA 16 %: el IVA debe coincidir con el del cargo y con el SAT', () => {
  const d = borrador({ fiscal_snapshot: { ...borrador().fiscal_snapshot, amount: 1160 }, concepts_snapshot: [concepto({ tax: 160, amount: 1160 })] });
  const ok = construirFactura(d, { c1: { tax_treatment: 'rate', tax_rate: 0.16 } }, '04');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.payload.items[0].product.taxes, [{ type: 'IVA', rate: 0.16, factor: 'Tasa' }]);
  const mal = construirFactura(borrador({ fiscal_snapshot: { ...borrador().fiscal_snapshot, amount: 1150 }, concepts_snapshot: [concepto({ tax: 150, amount: 1150 })] }), { c1: { tax_treatment: 'rate', tax_rate: 0.16 } }, '04');
  assert.equal(mal.ok, false);
  assert.match(mal.errors[0], /IVA/);
});

test('no objeto de impuesto y descuentos', () => {
  const noObj = construirFactura(borrador(), { c1: { tax_treatment: 'non_object' } }, '01');
  assert.equal(noObj.payload.items[0].product.taxability, '01');
  assert.deepEqual(noObj.payload.items[0].product.taxes, []);
  const desc = borrador({ fiscal_snapshot: { ...borrador().fiscal_snapshot, amount: 900 }, concepts_snapshot: [concepto({ discount: 100, amount: 900 })] });
  const r = construirFactura(desc, { c1: { tax_treatment: 'exempt' } }, '01');
  assert.equal(r.payload.items[0].discount, 100);
  assert.equal(construirFactura(borrador({ concepts_snapshot: [concepto({ discount: 1000, amount: 0 })], fiscal_snapshot: { ...borrador().fiscal_snapshot, amount: 0 } }), { c1: { tax_treatment: 'exempt' } }, '01').ok, false);
});

test('se bloquea lo que el SAT rechazaría, con el motivo en español y sin lanzar', () => {
  const exento = { c1: { tax_treatment: 'exempt' } };
  assert.match(construirFactura(borrador(), exento, '').errors[0], /forma de pago/);
  assert.match(construirFactura(borrador(), exento, '99').errors[0], /forma de pago/);
  assert.match(construirFactura(borrador(), {}, '01').errors[0], /tratamiento de IVA/);
  assert.match(construirFactura(borrador(), { c1: { tax_treatment: 'pending' } }, '01').errors[0], /tratamiento de IVA/);
  assert.match(construirFactura(borrador({ concepts_snapshot: [concepto({ product_service_code: null })] }), exento, '01').errors[0], /ClaveProdServ/);
  assert.match(construirFactura(borrador({ concepts_snapshot: [] }), exento, '01').errors[0], /conceptos/);
  assert.match(construirFactura(borrador({ fiscal_snapshot: { ...borrador().fiscal_snapshot, rfc: 'XAXX010101000' } }), exento, '01').errors.join(' '), /RFC/);
  assert.match(construirFactura(borrador({ fiscal_snapshot: { ...borrador().fiscal_snapshot, amount: 999 } }), exento, '01').errors[0], /no coincide con el pago/);
  assert.match(construirFactura(borrador({ fiscal_snapshot: { ...borrador().fiscal_snapshot, currency: 'USD' } }), exento, '01').errors[0], /pesos/);
  assert.equal(construirFactura(null, null, '01').ok, false);
});

test('respuesta de Facturapi: ok, rechazada o desconocida (no se reintenta a ciegas)', () => {
  assert.equal(clasificarRespuesta(200, { id: 'inv_123', uuid: UUID }), 'ok');
  assert.equal(clasificarRespuesta(201, { id: 'inv_123' }), 'unknown', 'sin UUID aún no está timbrada');
  assert.equal(clasificarRespuesta(400, { message: 'x' }), 'rejected');
  assert.equal(clasificarRespuesta(422, null), 'rejected');
  for (const status of [0, 408, 409, 429, 500, 502, 503]) assert.equal(clasificarRespuesta(status, null), 'unknown', String(status));
  assert.match(mensajeFacturapi({ message: '  El RFC   no existe ' }, 400), /^El RFC no existe$/);
  assert.equal(mensajeFacturapi(null, 400), 'Facturapi respondió 400.');
  assert.ok(mensajeFacturapi({ message: 'x'.repeat(900) }).length <= 400);
  const f = leerFactura({ id: 'inv_123', uuid: UUID.toUpperCase(), status: 'valid', series: 'A', folio_number: 7, total: 1000 });
  assert.deepEqual(f, { id: 'inv_123', uuid: UUID, status: 'valid', series: 'A', folio: 7, total: 1000 });
  assert.equal(leerFactura({ id: 'x' }), null);
  assert.equal(leerFactura({ id: 'inv_123', uuid: 'no-es-uuid' }).uuid, '');
});

test('la función: finance.invoice para timbrar, solo sandbox, reclama antes de enviar y deja bitácora', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  assert.match(fn, /esTimbrado \? "finance\.invoice" : "finance\.manage"/);
  assert.match(fn, /\/\^sk_test_\/\.test\(key\)/);
  // el borrador se lee con la sesión de la persona (RLS por paciente/sucursal), no con la llave de servicio
  assert.match(fn, /asUser\.from\("smyl_cfdi_drafts"\)\.select\("\*"\)/);
  // el IVA sale del snapshot del servicio guardado en el cargo
  assert.match(fn, /select\("id, service_snapshot"\)/);
  assert.doesNotMatch(fn, /body\.(tax|taxes|amount|items|concepts)/);
  // se reclama el borrador (draft/rejected → submitted) antes de llamar a Facturapi
  assert.ok(fn.indexOf('status: "submitted", provider: "facturapi"') < fn.indexOf('"/invoices", { method: "POST"'));
  assert.match(fn, /\.in\("status", \["draft", "rejected"\]\)/);
  assert.match(fn, /sandbox_status !== "passed"/);
  // una respuesta dudosa NO libera el borrador: queda «submitted» hasta verificar
  assert.match(fn, /Usa «Verificar estado» antes de intentar de nuevo/);
  assert.match(fn, /external_id=\$\{encodeURIComponent\(draftId\)\}/);
  assert.match(fn, /smyl_cfdi_stamp_events/);
  // nunca devuelve la llave
  assert.doesNotMatch(fn, /json\(CORS, \d+, \{[^}]*\bkey\b/);
});

test('migración: datos de la factura, bitácora solo de servidor y candado de coherencia', () => {
  const sql = read('supabase/migrations/20261117150000_smyl_cfdi_stamping.sql');
  assert.match(sql, /add column if not exists provider_invoice_id text/);
  assert.match(sql, /smyl_cfdi_drafts_issued_check[\s\S]*external_uuid is not null and provider_invoice_id is not null and stamped_at is not null/);
  assert.match(sql, /create table if not exists public\.smyl_cfdi_stamp_events/);
  assert.match(sql, /revoke all on table public\.smyl_cfdi_stamp_events from public, anon, authenticated/);
  assert.match(sql, /grant select, insert on table public\.smyl_cfdi_stamp_events to service_role/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*to authenticated/);
  const versions = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).map((f) => f.split('_')[0]);
  assert.equal(versions.filter((v) => v === '20261117150000').length, 1);
});

test('Cobros: timbrar, verificar y descargar desde la lista de borradores', () => {
  const js = read('smyl-finance.js');
  assert.match(js, /data-stamp-cfdi/);
  assert.match(js, /d\.sandbox_status==='passed'&&\(d\.status==='draft'\|\|d\.status==='rejected'\)&&pacConnected\(\)/);
  assert.match(js, /data-reconcile-cfdi/);
  assert.match(js, /data-download-cfdi/);
  assert.match(js, /facturapiAction\(\{action:'stamp',draft_id:draft\.id,payment_form:form\}\)/);
  assert.match(js, /Es una prueba\./);
  assert.match(js, /FORMA_SUGERIDA=\{cash:'01',check:'02',transfer:'03',card:'04'\}/);
  assert.equal(read('smyl-finance.js'), read('mobile/www/smyl-finance.js'));
  assert.equal(read('smyl-finance.css'), read('mobile/www/smyl-finance.css'));
  assert.ok(fs.existsSync(new URL('../docs/bundles/facturapi.single-file.ts', import.meta.url)));
});
