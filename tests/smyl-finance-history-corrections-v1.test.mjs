import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const js = read('smyl-finance.js');
const css = read('smyl-finance.css');

test('la cuenta conserva cargos anulados y muestra un historial cronológico con fecha y hora', () => {
  assert.match(js, /charges=state\.charges\.filter\(function\(c\)\{return c\.patient_id===id;/);
  assert.match(js, /voided=charges\.filter\(function\(c\)\{return c\.status==='voided';\}\)/);
  assert.match(js, /data-account-tab="payments"[^>]*>Historial/);
  assert.match(js, /date\(c\.created_at,true\)/);
  assert.match(js, /date\(v\.voided_at\|\|v\.created_at,true\)/);
  assert.match(js, /date\(p\.paid_at,true\)/);
  assert.match(js, /date\(r\.refunded_at,true\)/);
  assert.match(js, /La fecha y hora provienen del registro seguro del sistema/);
});

test('las correcciones financieras se auditan y nunca eliminan movimientos confirmados', () => {
  assert.match(js, /function openVoidCharge\(charge\)/);
  assert.match(js, /rpc\('smyl_void_charge'/);
  assert.match(js, /rpc\('smyl_refund_payment'/);
  assert.match(js, /El cargo no se borrará: quedará en el historial con fecha, hora y motivo/);
  assert.doesNotMatch(js, /from\('smyl_finance_(?:charges|payments|refunds)'\)\.delete\(/);
  assert.match(css, /article\[data-kind=void\]/);
  assert.match(css, /button\[data-account-void\]/);
});

test('las versiones publicadas y la copia móvil quedan sincronizadas', () => {
  assert.match(read('app.html'), /smyl-finance\.js\?v=34/);
  assert.match(read('app.html'), /smyl-finance\.css\?v=27/);
  assert.match(read('sw.js'), /finance-history-corrections-v1/);
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) {
    assert.equal(read(file), read('mobile/www/' + file), file);
  }
});
