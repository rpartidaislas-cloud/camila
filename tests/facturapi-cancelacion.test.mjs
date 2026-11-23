import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MOTIVOS_CANCELACION, parametrosCancelacion, estadoCancelacion, clasificarCancelacion } from '../supabase/functions/_shared/facturapi-core.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const U = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

test('motivos SAT: 01 exige el UUID sustituto y los demás no lo llevan', () => {
  assert.deepEqual(Object.keys(MOTIVOS_CANCELACION), ['01', '02', '03', '04']);
  assert.equal(parametrosCancelacion({ reason_code: '02' }).query, 'motive=02');
  assert.equal(parametrosCancelacion({ reason_code: '03' }).query, 'motive=03');
  assert.equal(parametrosCancelacion({ reason_code: '01', replacement_uuid: U.toUpperCase() }).query, `motive=01&substitution=${U}`);
  assert.match(parametrosCancelacion({ reason_code: '01' }).error, /UUID/);
  assert.match(parametrosCancelacion({ reason_code: '01', replacement_uuid: 'no-uuid' }).error, /UUID/);
  assert.match(parametrosCancelacion({ reason_code: '02', replacement_uuid: U }).error, /motivo 01/);
  assert.equal(parametrosCancelacion({ reason_code: '09' }).ok, false);
  assert.equal(parametrosCancelacion(null).ok, false);
});

test('estado de la cancelación: cancelada, pendiente de aceptación, rechazada o sin solicitud', () => {
  assert.equal(estadoCancelacion({ status: 'canceled', cancellation_status: 'accepted' }), 'accepted');
  assert.equal(estadoCancelacion({ status: 'canceled' }), 'accepted');
  assert.equal(estadoCancelacion({ status: 'valid', cancellation_status: 'pending' }), 'pending');
  assert.equal(estadoCancelacion({ status: 'valid', cancellation_status: 'rejected' }), 'rejected');
  assert.equal(estadoCancelacion({ status: 'valid', cancellation_status: 'expired' }), 'rejected');
  assert.equal(estadoCancelacion({ status: 'valid', cancellation_status: 'none' }), 'none');
  assert.equal(estadoCancelacion({ status: 'valid' }), 'none');
  assert.equal(estadoCancelacion({ status: 'draft' }), null);
  assert.equal(estadoCancelacion(null), null);
});

test('respuesta al cancelar: lo dudoso no se reintenta a ciegas', () => {
  assert.equal(clasificarCancelacion(200, { status: 'canceled' }), 'accepted');
  assert.equal(clasificarCancelacion(200, { status: 'valid', cancellation_status: 'pending' }), 'pending');
  assert.equal(clasificarCancelacion(200, { status: 'valid', cancellation_status: 'none' }), 'unknown', '200 sin solicitud registrada: verificar');
  assert.equal(clasificarCancelacion(400, { message: 'x' }), 'rejected');
  assert.equal(clasificarCancelacion(404, null), 'rejected');
  for (const status of [0, 408, 409, 429, 500, 503]) assert.equal(clasificarCancelacion(status, null), 'unknown', String(status));
});

test('la función: cancelar exige plan, reclama antes de enviar, solo sandbox y deja bitácora', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  assert.match(fn, /action === "cancel" \|\| action === "cancel_check"/);
  assert.match(fn, /esTimbrado \? "finance\.invoice" : "finance\.manage"/);
  assert.match(fn, /Primero planea la cancelación/);
  // el plan (planned → submitted) se reclama ANTES de llamar a Facturapi
  assert.ok(fn.indexOf('status: "submitted", submitted_at: now()') < fn.indexOf('{ method: "DELETE" }'));
  assert.match(fn, /\.eq\("status", "planned"\)\.select\("id"\)\.maybeSingle\(\)/);
  // el motivo y el UUID salen del plan guardado, nunca del navegador
  assert.doesNotMatch(fn, /body\.(motive|reason|substitution|replacement)/);
  assert.match(fn, /parametrosCancelacion\(plan\)/);
  // dudoso: el plan queda enviado hasta verificar; solo se libera si Facturapi no registró la solicitud
  assert.match(fn, /Usa «Verificar cancelación» antes de intentar de nuevo/);
  assert.match(fn, /Facturapi no registró la solicitud de cancelación/);
  assert.match(fn, /status: "cancelled", cancellation_status: "accepted"/);
  assert.match(fn, /"cancel_check"/);
});

test('migración: estado de la solicitud en plan y comprobante, y bitácora ampliada', () => {
  const sql = read('supabase/migrations/20261117170000_smyl_cfdi_cancellation.sql');
  assert.match(sql, /smyl_cfdi_cancellation_plans[\s\S]*add column if not exists provider_message text not null default ''/);
  assert.match(sql, /add column if not exists cancellation_status text/);
  assert.match(sql, /check \(action in \('stamp', 'reconcile', 'download', 'cancel', 'cancel_check'\)\)/);
  const versions = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).map((f) => f.split('_')[0]);
  assert.equal(versions.filter((v) => v === '20261117170000').length, 1);
});

test('Cobros: planear, cancelar en sandbox y verificar desde el comprobante', () => {
  const js = read('smyl-finance.js');
  assert.match(js, /data-cancel-cfdi/);
  // Con el plan guardado y Facturapi conectado, la fila ofrece «Enviar cancelación» en su menú.
  assert.match(js, /connected=pacConnected\(\)/);
  assert.match(js, /else if\(plan\.status==='planned'&&connected\)menu\.push\(item\('data-cancel-cfdi','Enviar cancelación',true\)\);/);
  assert.match(js, /if\(plan&&plan\.status==='submitted'\)\{main=button\('data-cancelcheck-cfdi','Verificar'\);/);
  assert.match(js, /data-cancelcheck-cfdi/);
  assert.match(js, /facturapiAction\(\{action:'cancel',draft_id:draft\.id\}\)/);
  assert.match(js, /facturapiAction\(\{action:'cancel_check',draft_id:draft\.id\}\)/);
  // Una cancelada dice «Cancelada»; mientras la clínica no timbre en producción, «Cancelada de prueba».
  assert.match(js, /if\(d\.status==='cancelled'\)tag='Cancelada';/);
  assert.match(js, /if\(bucket!=='drafts'&&!invoiceIsReal\(d\)\)tag\+=' de prueba';/);
  assert.match(js, /Es una prueba\./);
  assert.equal(read('smyl-finance.js'), read('mobile/www/smyl-finance.js'));
  assert.equal(read('smyl-finance.css'), read('mobile/www/smyl-finance.css'));
});
