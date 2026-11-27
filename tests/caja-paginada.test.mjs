import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8');

// Extrae pageAll y sus constantes reales del archivo y las ejecuta con una base simulada que respeta range().
function build(totalRows) {
  const src = js.match(/var PAGE_SIZE=1000,PAGE_CAP=10000;\n[\s\S]*?async function pageAll[\s\S]*?\n  \}\n/)[0];
  const calls = [];
  const state = { tenant: 'T1', truncated: [] };
  const all = Array.from({ length: totalRows }, (_, i) => ({ id: 'r' + i }));
  const window = {
    sb: {
      from(table) {
        const b = { table, orders: [], filters: [] };
        b.select = () => b;
        b.eq = (k, v) => { b.filters.push([k, v]); return b; };
        b.order = (col, opts) => { b.orders.push([col, opts.ascending]); return b; };
        b.range = (a, z) => { b.from = a; b.to = z; return b; };
        b.then = (resolve) => { calls.push({ from: b.from, to: b.to, orders: b.orders, filters: b.filters }); resolve({ data: all.slice(b.from, b.to + 1), error: null }); };
        return b;
      },
    },
  };
  const q = async (b) => { const r = await b; return r.data; };
  const fn = new Function('state', 'window', 'q', src + '\nreturn { pageAll, PAGE_SIZE, PAGE_CAP };')(state, window, q);
  return { ...fn, calls, state };
}

test('Caja carga todas las filas por páginas, sin repetir ni saltarse ninguna', async () => {
  const t = build(2350);
  const rows = await t.pageAll('smyl_finance_charges', '*', [['created_at', false], ['id', false]], 'cargos');
  assert.equal(rows.length, 2350);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2350);
  assert.deepEqual(t.calls.map((c) => [c.from, c.to]), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.deepEqual(t.state.truncated, []);
});

test('Caja: un total exacto de 1000 filas pide una página más para confirmar el final', async () => {
  const t = build(1000);
  assert.equal((await t.pageAll('x', '*', [['id', true]])).length, 1000);
  assert.equal(t.calls.length, 2);
  const none = build(0);
  assert.equal((await none.pageAll('x', '*', [['id', true]])).length, 0);
});

test('Caja: siempre filtra por la clínica y ordena con una columna única para paginar estable', async () => {
  const t = build(10);
  await t.pageAll('smyl_finance_payments', '*', [['paid_at', false], ['id', false]], 'pagos');
  assert.deepEqual(t.calls[0].filters, [['tenant_id', 'T1']]);
  assert.deepEqual(t.calls[0].orders, [['paid_at', false], ['id', false]]);
});

test('Caja: con más de 10,000 filas se detiene y lo avisa una sola vez', async () => {
  const t = build(12500);
  const rows = await t.pageAll('smyl_finance_charges', '*', [['id', true]], 'cargos');
  assert.equal(rows.length, 10000);
  assert.deepEqual(t.state.truncated, ['cargos']);
  await t.pageAll('smyl_finance_charges', '*', [['id', true]], 'cargos');
  assert.deepEqual(t.state.truncated, ['cargos'], 'no se duplica el aviso');
});

test('Caja: las 7 tablas grandes usan la carga completa y el aviso aparece si se llega al tope', () => {
  for (const [table, tag] of [['camila_pacientes', 'pacientes'], ['smyl_finance_charges', 'cargos'], ['smyl_finance_payments', 'pagos'], ['smyl_finance_payment_allocations', 'aplicaciones'], ['smyl_finance_refunds', 'reembolsos'], ['smyl_finance_refund_allocations', 'aplicaciones de reembolso'], ['smyl_finance_receipts', 'recibos']]) {
    assert.match(js, new RegExp(`pageAll\\('${table}','[^']*',\\[.*?\\],'${tag}'\\)`), table);
  }
  // ya no hay cortes silenciosos en esas tablas
  assert.doesNotMatch(js, /from\('smyl_finance_charges'\)\.select\('\*'\)\.eq\('tenant_id',state\.tenant\)\.order\('created_at',\{ascending:false\}\)\.limit\(500\)/);
  assert.match(js, /state\.truncated=\[\];loadingSkeleton\(true\)/);
  assert.match(js, /function renderTruncationBanner\(\)/);
  assert.match(js, /function render\(\)\{[^\n]*renderTruncationBanner\(\);/);
  assert.match(js, /setAttribute\('role','alert'\)/);
  assert.equal(js, fs.readFileSync(new URL('../mobile/www/smyl-finance.js', import.meta.url), 'utf8'));
});

test('el límite del historial no omite pagos, recibos ni devoluciones de un turno todavía abierto',async()=>{
  const src=js.slice(js.indexOf('  var PAGE_SIZE='),js.indexOf('  var inFlight='));
  const sessions=[
    {id:'open',status:'open',branch_id:'B',opened_at:'2026-11-03'},
    {id:'previous',status:'closed',branch_id:'B',closed_at:'2026-11-02'}
  ];
  const own=Array.from({length:127},(_,i)=>({id:'PAY-'+String(i).padStart(3,'0'),tenant_id:'T',branch_id:'B',cash_session_id:'open',paid_at:'2026-11-03',method:'cash',amount:1}));
  const online={id:'online',tenant_id:'T',branch_id:'B',paid_at:'2026-11-02',method:'card'};
  const db={
    smyl_finance_payments:[...own,online,{...own[0],id:'elsewhere',branch_id:'other',cash_session_id:'other'}],
    smyl_finance_refunds:[{id:'old',tenant_id:'T',payment_id:own[0].id},{id:'new',tenant_id:'T',payment_id:'outside',refund_cash_session_id:'open'}],
    smyl_finance_receipts:[{id:'r',tenant_id:'T',payment_id:'online',snapshot:{provider:'openpay'}}],
    smyl_cash_adjustments:[{id:'in',tenant_id:'T',direction:'in',cash_session_id:'open'}, {id:'foreign',tenant_id:'other',cash_session_id:'open'}]
  };
  const window={__smylFinancePageCap:50,sb:{from(table){
    let rows=db[table].slice();const chain={
      select(){return this;},eq(k,v){rows=rows.filter(r=>r[k]===v);return this;},
      gte(k,v){rows=rows.filter(r=>r[k]>=v);return this;},in(k,vs){rows=rows.filter(r=>vs.includes(r[k]));return this;},
      order(){rows.sort((a,b)=>a.id.localeCompare(b.id));return this;},range(a,z){return rows.slice(a,z+1);}
    };return chain;
  }}};
  const run=new Function('state','window','q',src+';return completeShiftHistory;')({tenant:'T',truncated:['pagos']},window,async b=>b);
  const history={payments:own.slice(80),receipts:[],refunds:[],sessions};
  await run(history);
  assert.equal(history.payments.length,128);
  assert.equal(new Set(history.payments.map(p=>p.id)).size,128);
  assert.ok(history.payments.some(p=>p.id==='online'));
  assert.deepEqual(history.refunds.map(r=>r.id).sort(),['new','old']);
  assert.equal(history.receipts[0].snapshot.provider,'openpay');
  assert.deepEqual(history.adjustments.map(a=>a.id),['in']);
});
