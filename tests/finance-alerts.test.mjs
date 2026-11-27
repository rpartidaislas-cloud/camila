// Finanzas: avisos (caja olvidada, cobro sin confirmar, factura atorada) y contexto de sucursal (auditoría 2026-11-26, bloque 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const m = ui.match(/function buildFinanceAlerts\(input\)\{[\s\S]*?\n    return out;\n  \}/);
assert.ok(m, 'no se encontró buildFinanceAlerts');
const build = new Function(m[0] + ';return buildFinanceAlerts;')();
const money = (n) => '$' + Number(n).toFixed(2);
const NOW = new Date('2026-11-27T10:00:00').getTime();
const at = (days, h = 8) => { const d = new Date(NOW); d.setDate(d.getDate() - days); d.setHours(h, 0, 0, 0); return d.toISOString(); };

test('una caja abierta desde un día anterior avisa en rojo; la de hoy no', () => {
  const out = build({ now: NOW, actor: 'u1', supervise: false, money, who: () => 'Ana · Principal', sessions: [
    { id: 's1', status: 'open', opened_by: 'u1', opened_at: at(1) }, { id: 's2', status: 'open', opened_by: 'u1', opened_at: at(0, 7) } ] });
  assert.equal(out.length, 1); assert.equal(out[0].kind, 'cash'); assert.equal(out[0].tone, 'danger'); assert.equal(out[0].tab, 'cash');
  assert.match(out[0].text, /Hay una caja abierta desde hace 1 día \(Ana · Principal\)\. Haz el corte/);
  assert.deepEqual(build({ now: NOW, actor: 'u1', money, sessions: [{ id: 's2', status: 'open', opened_by: 'u1', opened_at: at(0, 7) }] }), []);
  assert.deepEqual(build({ now: NOW, actor: 'u1', money, sessions: [{ id: 's3', status: 'closed', opened_by: 'u1', opened_at: at(5) }] }), [], 'una caja cerrada no avisa');
});

test('cada persona ve las suyas; quien supervisa ve todas y el aviso cuenta cuántas y la más antigua', () => {
  const sessions = [{ id: 'a', status: 'open', opened_by: 'u1', opened_at: at(2) }, { id: 'b', status: 'open', opened_by: 'u2', opened_at: at(17) }];
  assert.equal(build({ now: NOW, actor: 'u1', supervise: false, money, sessions }).length, 1);
  assert.match(build({ now: NOW, actor: 'u1', supervise: false, money, who: () => 'Ana', sessions })[0].text, /desde hace 2 días/);
  const sup = build({ now: NOW, actor: 'u9', supervise: true, money, sessions });
  assert.match(sup[0].text, /Hay 2 cajas abiertas de días anteriores; la más antigua lleva 17 días\./);
  assert.deepEqual(build({ now: NOW, actor: 'u9', supervise: false, money, sessions }), [], 'quien no supervisa no ve cajas ajenas');
});

test('un cobro sin confirmar avisa después de 30 s y trae el importe; sin importe o muy reciente no', () => {
  assert.equal(build({ now: NOW, money, attempt: { at: NOW - 31000, amount: 500 } })[0].kind, 'attempt');
  assert.match(build({ now: NOW, money, attempt: { at: NOW - 31000, amount: 500 } })[0].text, /\$500\.00 quedó sin confirmar/);
  assert.equal(build({ now: NOW, money, attempt: { at: NOW - 31000, amount: 500 } })[0].verify, true);
  assert.deepEqual(build({ now: NOW, money, attempt: { at: NOW - 5000, amount: 500 } }), [], 'aún se está enviando');
  assert.deepEqual(build({ now: NOW, money, attempt: { at: NOW - 99000, amount: 0 } }), []);
  assert.deepEqual(build({ now: NOW, money, attempt: null }), []);
});

test('una factura «en proceso» por más de una hora avisa; las emitidas o recientes no', () => {
  const drafts = [{ id: 'd1', status: 'submitted', updated_at: new Date(NOW - 3 * 3600e3).toISOString() }, { id: 'd2', status: 'submitted', updated_at: new Date(NOW - 10 * 60e3).toISOString() }, { id: 'd3', status: 'issued', updated_at: new Date(NOW - 9 * 3600e3).toISOString() }];
  const out = build({ now: NOW, money, drafts });
  assert.equal(out.length, 1); assert.equal(out[0].kind, 'cfdi'); assert.match(out[0].text, /Una factura lleva más de 1 hora en proceso/);
  const two = build({ now: NOW, money, drafts: drafts.concat([{ id: 'd4', status: 'submitted', created_at: new Date(NOW - 5 * 3600e3).toISOString() }]) });
  assert.match(two[0].text, /2 facturas llevan más de 1 hora en proceso/);
});

test('el orden de los avisos es caja, cobro, factura, y sin nada que avisar no se muestra nada', () => {
  const out = build({ now: NOW, actor: 'u1', money, who: () => 'Ana', sessions: [{ id: 's', status: 'open', opened_by: 'u1', opened_at: at(1) }], attempt: { at: NOW - 60000, amount: 10 }, drafts: [{ status: 'submitted', updated_at: new Date(NOW - 7200e3).toISOString() }] });
  assert.deepEqual(out.map((a) => a.kind), ['cash', 'attempt', 'cfdi']);
  assert.deepEqual(build({ now: NOW, money }), []);
});

test('la pantalla dibuja los avisos, nunca borra un cobro sin verificar y respeta el texto como texto', () => {
  assert.match(ui, /<div class=\\?"finance-alerts\\?" id=\\?"finance-alerts\\?" role=\\?"region\\?" aria-label=\\?"Avisos de Finanzas\\?">/);
  assert.match(ui, /renderTruncationBanner\(\);renderContext\(\);renderAlerts\(\);/);
  const verify = ui.slice(ui.indexOf('if(a.verify){'), ui.indexOf('showTab(a.tab);};});'));
  assert.match(verify, /from\('smyl_finance_payments'\)\.select\('id'\)\.eq\('tenant_id',window\.tenantId\)\.eq\('id',att\.id\)/, 'verifica contra el servidor');
  assert.ok(verify.indexOf("El cobro sí se había registrado") < verify.indexOf('No encontramos ese cobro'), 'primero busca el cobro');
  assert.match(ui, /<p>'\+esc\(a\.text\)\+'<\/p>/);
});

test('contexto de sucursal: varias, una sola, con sucursal elegida y sin ella', () => {
  const m2 = ui.match(/function financeContext\(\)\{[\s\S]*?\n  \}/);
  assert.ok(m2, 'no se encontró financeContext');
  const make = (state, mine) => new Function('state', 'myBranchId', 'by', 'esc', m2[0] + ';return financeContext;')(state, () => mine, (list, id) => list.find((x) => x.id === id), (t) => String(t).replace(/</g, '&lt;'));
  const three = { branches: [{ id: 'a', name: 'Andares' }, { id: 'g', name: 'Guadalupe' }, { id: 't', name: 'Tlaquepaque' }] };
  assert.equal(make(three, '')().text, 'Vista financiera: todas tus sucursales (3) · Elige la sucursal al cobrar');
  assert.equal(make(three, 'g')().text, 'Vista financiera: todas tus sucursales (3) · Los cobros nuevos se registran en Guadalupe');
  assert.equal(make({ branches: [{ id: 'g', name: 'Guadalupe' }] }, '')().text, 'Vista financiera: Guadalupe');
  assert.equal(make({ branches: [] }, '')().text, 'Vista financiera: tu clínica');
  assert.match(make({ branches: [{ id: 'x', name: '<b>Mala</b>' }] }, '')().text, /&lt;b>Mala/, 'el nombre de la sucursal se escapa');
  assert.match(ui, /<h1>Finanzas<\/h1><p class=\\?"finance-context\\?" id=\\?"finance-context\\?" aria-live=\\?"polite\\?"><\/p>/);
});
