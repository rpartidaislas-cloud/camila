import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Cobros: sin la forma de pago «Otro», nada se cobra con la caja cerrada (ni en pantalla ni en el servidor), el aviso permite abrir la caja ahí
// mismo y la ventana «Pago registrado» muestra el recibo con claridad.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const ui = read('smyl-finance.js');
const mig = read('supabase/migrations/20261202110000_smyl_payment_require_open_cash.sql');

test('el cobro ya no ofrece «Otro» y pide caja abierta para TODA forma de pago, incluido el enlace', () => {
  assert.doesNotMatch(ui, /data-method="other"/);
  assert.doesNotMatch(ui, /data-method-fields="other"/);
  assert.match(ui, /if\(!session\)issues\.push\('Abre una caja para esta sucursal antes de cobrar\.'\);/);
  assert.doesNotMatch(ui, /if\(cash&&!session\)/);
  assert.match(ui, /Abre una caja para esta sucursal antes de cobrar en línea\./);
  assert.match(ui, /var methodOptions=\['cash','card','transfer','check'\]\.map\(/, 'tampoco en reembolsos');
  assert.match(ui, /PAYMENT_METHODS=\{cash:'Efectivo',card:'Tarjeta',transfer:'Transferencia',check:'Cheque',other:'Otro'\}/, 'los pagos históricos con «Otro» se siguen rotulando');
});

test('el servidor rechaza «Otro» y cualquier cobro sin caja abierta de quien cobra; los reintentos siguen devolviendo el pago', () => {
  assert.match(mig, /p_method not in \('cash','card','transfer','check'\)/);
  assert.match(mig, /status='open' and opened_by=auth\.uid\(\)\) then raise exception using errcode='23514',message='Abre una caja para esta sucursal antes de cobrar\.'/);
  const iReplay = mig.indexOf('if found then return v_row; end if;'), iBox = mig.indexOf('Abre una caja para esta sucursal antes de cobrar.');
  assert.ok(iReplay > 0 && iBox > iReplay, 'el reintento idempotente se resuelve antes de pedir caja');
  assert.doesNotMatch(mig.replace(/--.*$/gm, ''), /\b(drop|delete from|alter table)\b/i);
  assert.match(read('scripts/migration-sentinels.mjs'), /20261202110000/);
});

test('la ventana de pago registrado tiene la nueva estructura y conserva sus acciones', () => {
  for (const hook of ['data-success-print', 'data-success-share', 'data-success-invoice', 'data-success-schedule']) assert.ok(ui.includes(hook), hook);
  for (const cls of ['finance-success-hero', 'finance-success-ticket', 'finance-success-kicker']) assert.ok(ui.includes(cls) && read('smyl-finance.css').includes(cls), cls);
  assert.match(ui, /rows=\[\['Forma de pago'/);
  for (const f of ['smyl-finance.js', 'smyl-finance.css']) assert.equal(read(f), read('mobile/www/' + f), f);
});

const chromium = (() => { try { return createRequire(import.meta.url)('playwright').chromium; } catch { return null; } })();
test('navegador: el aviso de caja cerrada se muestra, abre la caja ahí mismo y se quita', { skip: !chromium && 'sin Playwright' }, async () => {
  const src = (name) => { const a = ui.indexOf(`  function ${name}(`); let depth = 0, i = ui.indexOf('{', a); const start = a; for (; i < ui.length; i++) { if (ui[i] === '{') depth++; else if (ui[i] === '}') { depth--; if (!depth) break; } } return ui.slice(start, i + 1); };
  const code = [src('cashSessionFor'), src('cashBanner')].join('\n');
  const b = await chromium.launch(); const page = await b.newPage();
  try {
    const out = await page.evaluate(async (code) => {
      document.body.innerHTML = '<form id="f"><div class="finance-payment-main"></div><select name="branch"><option value="b1">Centro</option></select></form>';
      const f = document.getElementById('f'); f.elements.branch.value = 'b1';
      const calls = []; let rechecks = 0;
      const env = { state: { sessions: [], actor: 'u1', tenant: 't', canCash: true }, rpc: async (n, a) => { calls.push([n, a]); return { id: 's1', branch_id: a.p_branch_id, status: 'open', opened_by: 'u1' }; }, message: (e) => String(e && e.message || e), renderPaymentCheck: () => { rechecks++; }, crypto: { randomUUID: () => 'sesion-1' } };
      const run = new Function('env', `with(env){ ${code}; return { cashBanner, cashSessionFor }; }`)(env);
      run.cashBanner(f);
      const banner = f.querySelector('[data-cash-banner]');
      const visible = !banner.hidden && /cerrada/.test(banner.textContent) && !!banner.querySelector('button');
      banner.querySelector('input').value = '500';
      banner.querySelector('button').click(); await new Promise((r) => setTimeout(r, 50));
      return { visible, calls, hiddenAfter: banner.hidden, rechecks, opened: env.state.sessions.length };
    }, code);
    assert.equal(out.visible, true, 'aparece el aviso con su botón');
    assert.equal(out.calls.length, 1);
    assert.equal(out.calls[0][0], 'smyl_open_cash_session');
    assert.equal(out.calls[0][1].p_branch_id, 'b1');
    assert.equal(out.calls[0][1].p_opening_cash, 500);
    assert.equal(out.hiddenAfter, true, 'al abrir la caja el aviso desaparece');
    assert.equal(out.rechecks, 1, 'se vuelve a revisar el cobro');
    assert.equal(out.opened, 1);
  } finally { await b.close(); }
});

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const psql = (db, input) => { const a = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-']; const r = asRoot ? spawnSync('su', ['postgres', '-c', 'psql ' + a.join(' ')], { input, encoding: 'utf8' }) : spawnSync('psql', a, { input, encoding: 'utf8' }); return { ok: r.status === 0, out: String(r.stdout || '') + String(r.stderr || '') }; };
const pg = (c) => { const r = asRoot ? spawnSync('su', ['postgres', '-c', c], { encoding: 'utf8' }) : spawnSync('sh', ['-c', c], { encoding: 'utf8' }); return r.status === 0; };
const available = pg('pg_isready -q') && pg('psql -X -tAc "select 1" postgres');
const STUB = `
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
create schema if not exists auth; create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('test.uid', true), '')::uuid $f$;
create function public.smyl_current_tenant() returns uuid language sql stable as $f$ select 'a0000000-0000-4000-8000-000000000001'::uuid $f$;
create function public.smyl_has_permission(t uuid, p text) returns boolean language sql stable as $f$ select true $f$;
create table public.smyl_cash_sessions (tenant_id uuid, id uuid primary key, branch_id uuid, status text, opened_by uuid);
create table public.smyl_finance_payments (id uuid primary key, tenant_id uuid, patient_id uuid, branch_id uuid, cash_session_id uuid, idempotency_key uuid unique, amount numeric, method text, reference text, paid_at timestamptz, created_by uuid);
create table public.smyl_finance_charges (id uuid primary key, tenant_id uuid, patient_id uuid, status text, total_amount numeric);
create table public.smyl_finance_payment_allocations (tenant_id uuid, payment_id uuid, charge_id uuid, amount numeric);
create table public.smyl_finance_refund_allocations (tenant_id uuid, charge_id uuid, amount numeric);
create table public.smyl_finance_sequences (tenant_id uuid primary key, next_receipt bigint);
create table public.smyl_finance_receipts (tenant_id uuid, payment_id uuid, folio bigint, snapshot jsonb, issued_by uuid);
`;
const SCENARIO = `
do $$
declare U constant text := '11111111-1111-4111-8111-111111111111'; B constant uuid := 'b0000000-0000-4000-8000-0000000000b1'; PAT constant uuid := 'aa000000-0000-4000-8000-000000000001';
  S constant uuid := '51000000-0000-4000-8000-000000000001'; code text; n int := 0;
begin
  perform set_config('test.uid', U, false);
  -- Caja CERRADA: ninguna forma de pago se acepta.
  foreach code in array array['cash','card','transfer','check'] loop
    begin perform public.smyl_post_payment(gen_random_uuid(), gen_random_uuid(), PAT, B, S, 100, code, 'ref', now(), '[]'::jsonb); raise exception 'NO DEBIÓ COBRAR %', code;
    exception when sqlstate '23514' then n := n + 1; end;
  end loop;
  assert n = 4, 'las 4 formas de pago se rechazan sin caja: ' || n;
  -- «Otro» ya no existe para cobros nuevos (aunque haya caja).
  insert into public.smyl_cash_sessions values ('a0000000-0000-4000-8000-000000000001', S, B, 'open', U::uuid);
  begin perform public.smyl_post_payment(gen_random_uuid(), gen_random_uuid(), PAT, B, S, 100, 'other', 'x', now(), '[]'::jsonb); raise exception 'NO DEBIÓ ACEPTAR OTRO';
  exception when sqlstate '22023' then null; end;
  -- Con caja abierta de quien cobra: efectivo, tarjeta, transferencia y cheque entran.
  foreach code in array array['cash','card','transfer','check'] loop
    perform public.smyl_post_payment(gen_random_uuid(), gen_random_uuid(), PAT, B, S, 100, code, 'ref', now(), '[]'::jsonb);
  end loop;
  assert (select count(*) from public.smyl_finance_payments) = 4, 'quedaron 4 pagos';
  -- La caja abierta por OTRA persona no sirve.
  perform set_config('test.uid', '22222222-2222-4222-8222-222222222222', false);
  begin perform public.smyl_post_payment(gen_random_uuid(), gen_random_uuid(), PAT, B, S, 100, 'card', 'ref', now(), '[]'::jsonb); raise exception 'NO DEBIÓ COBRAR CON CAJA AJENA';
  exception when sqlstate '23514' then null; end;
  -- Reintento idempotente aunque la caja ya se cerró: devuelve el pago ya registrado, no falla.
  perform set_config('test.uid', U, false);
  declare k uuid := gen_random_uuid(); r1 public.smyl_finance_payments; r2 public.smyl_finance_payments;
  begin
    r1 := public.smyl_post_payment(gen_random_uuid(), k, PAT, B, S, 100, 'card', 'ref', now(), '[]'::jsonb);
    update public.smyl_cash_sessions set status = 'closed';
    r2 := public.smyl_post_payment(gen_random_uuid(), k, PAT, B, S, 100, 'card', 'ref', now(), '[]'::jsonb);
    assert r1.id = r2.id, 'el reintento devuelve el mismo pago';
  end;
  raise notice 'COBROS OK';
end $$;
`;
test('base de datos real: sin caja abierta no se cobra nada y «Otro» ya no existe para cobros nuevos', { skip: !available && 'no hay un PostgreSQL local disponible' }, () => {
  const db = 'smyl_p_' + process.pid;
  assert.ok(pg(`createdb ${db}`));
  try {
    const original = read('supabase/migrations/20261012340000_smyl_finance_actions.sql').split('\n').slice(43, 69).join('\n');
    for (const input of [STUB, original, mig, mig, SCENARIO]) { const r = psql(db, input); assert.ok(r.ok, r.out); if (input === SCENARIO) assert.match(r.out, /COBROS OK/); }
  } finally { pg(`dropdb --if-exists ${db}`); }
});
