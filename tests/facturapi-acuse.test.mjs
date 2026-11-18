import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DESCARGAS, descarga } from '../supabase/functions/_shared/facturapi-core.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('descargas: comprobante y acuse de cancelación, con la ruta exacta de Facturapi', () => {
  assert.deepEqual(Object.keys(DESCARGAS), ['pdf', 'xml', 'acuse_pdf', 'acuse_xml']);
  assert.equal(descarga('pdf').path, 'pdf');
  assert.equal(descarga('xml').mime, 'application/xml');
  assert.equal(descarga('acuse_pdf').path, 'cancellation_receipt/pdf');
  assert.equal(descarga('acuse_xml').path, 'cancellation_receipt/xml');
  assert.equal(descarga('acuse_xml').acuse, true);
  assert.equal(descarga('pdf').acuse, false);
});

test('un tipo desconocido o malicioso cae en el PDF del comprobante, nunca arma una ruta libre', () => {
  for (const kind of ['../../organizations', 'constructor', '__proto__', 'toString', '', null, undefined, 'zip']) assert.equal(descarga(kind), DESCARGAS.pdf, String(kind));
});

test('la función: el acuse solo con la cancelación aceptada y nombre de archivo propio', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  assert.match(fn, /d\.acuse && draft\.status !== "cancelled"/);
  assert.match(fn, /\/invoices\/\$\{encodeURIComponent\(draft\.provider_invoice_id\)\}\/\$\{d\.path\}/);
  assert.match(fn, /Acuse-cancelacion/);
  assert.doesNotMatch(fn, /\$\{kind\}/, 'la ruta no se arma con texto del navegador');
});

test('Cobros: botones de acuse solo en comprobantes cancelados', () => {
  const js = read('smyl-finance.js');
  assert.match(js, /d\.status==='cancelled'\?'<button data-download-cfdi="'\+d\.id\+'" data-kind="acuse_pdf">Acuse PDF/);
  assert.match(js, /data-kind="acuse_xml">Acuse XML/);
  assert.equal(js, read('mobile/www/smyl-finance.js'));
});
