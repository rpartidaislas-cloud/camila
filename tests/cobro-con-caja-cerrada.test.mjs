import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Cobro en línea con la caja cerrada: no se genera el enlace, la página no deja pagar, y lo que entre de todos modos
// (SPEI o pago en tienda hechos más tarde) cae en el siguiente corte.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const fn = read('supabase/functions/smyl-pay/index.ts');

test('no se genera un enlace de cobro en línea si la caja de la sucursal está cerrada', () => {
  assert.match(fn, /\.eq\("branch_id", branchId\)\.eq\("status", "open"\)/);
  const iCaja = fn.indexOf('if (!(await cajaAbierta(tenantId, branchId))) return json(CORS, 409');
  const iAlcance = fn.indexOf('if (!(await permisos.sucursal(branchId)))');
  const iInsert = fn.indexOf('.from("smyl_payment_links").insert({');
  assert.ok(iAlcance > 0 && iCaja > iAlcance && iInsert > iCaja, 'se comprueba la caja antes de cancelar enlaces previos y de crear el nuevo');
  assert.match(fn, /error_code: "cash_closed"/);
  assert.match(fn, /La caja de esta sucursal está cerrada\. Ábrela para poder cobrar en línea\./);
  assert.match(fn, /if \(error\) return false;\s*\/\/ si no se puede comprobar, no se cobra/);
});

test('un enlace vigente no deja pagar si la caja se cerró; un enlace ya pagado se sigue mostrando', () => {
  assert.match(fn, /actual\.status === "pending" && !\(await cajaAbierta\(String\(actual\.tenant_id\), actual\.branch_id\)\)\) return json\(CORS, 200, \{ \.\.\.vista, cash_closed: true \}\)/);
  const html = read('pagar.html');
  assert.match(html, /if \(v\.cash_closed && !returned\) return showMessage\('Pagos en pausa'/, 'el regreso de 3D Secure no se bloquea');
  assert.ok(html.indexOf("if (v.status === 'paid') return showPaid(v);") < html.indexOf('v.cash_closed'), 'lo ya pagado se muestra primero');
});

test('el corte (servidor y pantalla) incluye lo cobrado con la caja cerrada', () => {
  const sql = read('supabase/migrations/20261202100000_smyl_cash_online_report_closed_gap.sql');
  assert.match(sql, /select coalesce\(max\(o\.closed_at\), v_s\.opened_at\) into v_from/);
  assert.match(sql, /p\.paid_at >= v_from/);
  const ui = read('smyl-finance.js');
  assert.match(ui, /Igual que el servidor: el reporte arranca en el cierre de la caja anterior/);
  assert.equal(ui, read('mobile/www/smyl-finance.js'));
  assert.match(read('scripts/migration-sentinels.mjs'), /20261202100000/);
});
