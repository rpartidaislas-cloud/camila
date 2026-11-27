import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Los cobros en línea recibidos con la caja cerrada deben entrar al siguiente corte (migración 20261202100000), probado en PostgreSQL real.
const root = fileURLToPath(new URL('..', import.meta.url));
const sql = (f) => fs.readFileSync(root + f, 'utf8');
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
function psql(db, input) {
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'];
  const r = asRoot ? spawnSync('su', ['postgres', '-c', 'psql ' + args.join(' ')], { input, encoding: 'utf8' }) : spawnSync('psql', args, { input, encoding: 'utf8' });
  return { ok: r.status === 0, out: String(r.stdout || '') + String(r.stderr || '') };
}
function pg(command) { const r = asRoot ? spawnSync('su', ['postgres', '-c', command], { encoding: 'utf8' }) : spawnSync('sh', ['-c', command], { encoding: 'utf8' }); return r.status === 0; }
const available = pg('pg_isready -q') && pg('psql -X -tAc "select 1" postgres');

const STUB = `
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
create table public.smyl_cash_sessions (tenant_id uuid, id uuid primary key, branch_id uuid, status text, opened_at timestamptz, closed_at timestamptz, close_reconciliation jsonb);
create table public.smyl_finance_payments (tenant_id uuid, id uuid primary key, branch_id uuid, method text, amount numeric, paid_at timestamptz, reference text);
create table public.smyl_finance_receipts (tenant_id uuid, payment_id uuid, folio bigint, snapshot jsonb);
create table public.smyl_finance_refunds (tenant_id uuid, payment_id uuid, amount numeric);
`;
const SCENARIO = `
do $$
declare T constant uuid := 'a0000000-0000-4000-8000-000000000001'; B constant uuid := 'b0000000-0000-4000-8000-0000000000b1';
  S1 constant uuid := '51000000-0000-4000-8000-000000000001'; S2 constant uuid := '52000000-0000-4000-8000-000000000002'; r jsonb;
begin
  -- Caja 1: abre hace 3 días y cierra hace 2. Caja 2: abre hace 12 horas (sigue abierta). Entre las dos, la caja estuvo CERRADA.
  insert into public.smyl_cash_sessions values
    (T, S1, B, 'closed', now() - interval '3 days', now() - interval '2 days', null),
    (T, S2, B, 'open', now() - interval '12 hours', null, null);
  insert into public.smyl_finance_payments values
    (T, 'c1000000-0000-4000-8000-000000000001', B, 'card', 100, now() - interval '2 days 12 hours', 'dentro de la caja 1'),
    (T, 'c2000000-0000-4000-8000-000000000002', B, 'card', 12, now() - interval '1 day', 'con la caja cerrada'),
    (T, 'c3000000-0000-4000-8000-000000000003', B, 'transfer', 50, now() - interval '6 hours', 'dentro de la caja 2'),
    (T, 'c4000000-0000-4000-8000-000000000004', B, 'card', 7, now() - interval '5 days', 'antes de todo');
  insert into public.smyl_finance_receipts values
    (T, 'c1000000-0000-4000-8000-000000000001', 1, '{"provider":"openpay"}'), (T, 'c2000000-0000-4000-8000-000000000002', 10, '{"provider":"openpay"}'),
    (T, 'c3000000-0000-4000-8000-000000000003', 11, '{"provider":"openpay"}'), (T, 'c4000000-0000-4000-8000-000000000004', 5, '{"provider":"openpay"}');
  -- Caja 2: el cobro hecho con la caja cerrada (#10) SÍ entra, junto con el suyo (#11). Lo de la caja 1 y lo anterior no.
  r := public.smyl_cash_online_report(T, S2);
  assert (r->>'count')::int = 2 and (r->>'total')::numeric = 62, 'cerrada (12) + caja 2 (50) = 62: ' || r::text;
  assert exists (select 1 from jsonb_array_elements(r->'items') i where i->>'folio' = '10'), 'el recibo #10 (caja cerrada) aparece';
  assert not exists (select 1 from jsonb_array_elements(r->'items') i where i->>'folio' in ('1', '5')), 'lo de la caja 1 y lo anterior no se mezclan';
  -- Si otro corte ya reportó el cobro de la caja cerrada, no se cuenta dos veces.
  update public.smyl_cash_sessions set close_reconciliation = '{"online":{"items":[{"payment_id":"c2000000-0000-4000-8000-000000000002"}]}}' where id = S1;
  r := public.smyl_cash_online_report(T, S2);
  assert (r->>'count')::int = 1 and (r->>'total')::numeric = 50, 'sin doble conteo: solo 50: ' || r::text;
  raise notice 'GAP OK';
end $$;
`;

test('cobros en línea con la caja cerrada entran al siguiente corte, sin contarse dos veces (PostgreSQL real)', { skip: !available && 'no hay un PostgreSQL local disponible' }, () => {
  const db = 'smyl_g_' + process.pid;
  assert.ok(pg(`createdb ${db}`));
  try {
    for (const input of [STUB, sql('supabase/migrations/20261202100000_smyl_cash_online_report_closed_gap.sql'), sql('supabase/migrations/20261202100000_smyl_cash_online_report_closed_gap.sql'), SCENARIO]) {
      const r = psql(db, input); assert.ok(r.ok, r.out);
      if (input === SCENARIO) assert.match(r.out, /GAP OK/);
    }
  } finally { pg(`dropdb --if-exists ${db}`); }
});

test('la migración solo reemplaza la función del reporte y no toca datos', () => {
  const text = sql('supabase/migrations/20261202100000_smyl_cash_online_report_closed_gap.sql').replace(/--.*$/gm, '');
  assert.doesNotMatch(text, /\b(drop|delete|update|insert|alter)\b/i);
  assert.match(text, /grant execute on function public\.smyl_cash_online_report\(uuid, uuid\) to service_role/);
});
