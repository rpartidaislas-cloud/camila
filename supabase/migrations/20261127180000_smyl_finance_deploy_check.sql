-- SMYL · Verificador de despliegue de Finanzas (auditoría 2026-11-26, bloque 2).
--
-- Las migraciones se aplican a mano en el SQL Editor, así que nada impedía publicar la pantalla sin la migración (o al revés) y enterarse hasta
-- que un cobro fallaba. Esta función revisa que los objetos de base de datos que el código de Finanzas necesita ESTÉN en la base y que las
-- versiones reemplazadas ya no existan. Solo lee el catálogo: no toca datos de pacientes.
--
--   select * from public.smyl_finance_deploy_check() where not ok;      -- vacío = todo aplicado
--   select * from public.smyl_finance_deploy_check();                    -- el detalle de cada comprobación
--
-- Cada fila trae la migración que lo crea (migration) para saber qué falta aplicar. Aditiva y repetible.

begin;

create or replace function public.smyl_finance_deploy_check()
returns table (check_name text, ok boolean, migration text, detail text)
language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  c record;
begin
  -- Funciones que DEBEN existir (firma exacta) y versiones anteriores que ya NO deben existir.
  for c in select * from (values
    ('20261127120000_smyl_finance_cash_integrity', 'public.smyl_refund_payment(uuid,uuid,uuid,numeric,text,text,uuid,text)', true),
    ('20261127120000_smyl_finance_cash_integrity', 'public.smyl_refund_payment(uuid,uuid,uuid,numeric,text)', false),
    ('20261127120000_smyl_finance_cash_integrity', 'public.smyl_cash_expected(uuid,uuid)', true),
    ('20261127120000_smyl_finance_cash_integrity', 'public.smyl_cash_session_expected(uuid)', true),
    ('20261127120000_smyl_finance_cash_integrity', 'public.smyl_lock_open_cash_session()', true),
    ('20261127150000_smyl_cash_close_reconciliation', 'public.smyl_close_cash_session(uuid,integer,numeric,text,jsonb)', true),
    ('20261127150000_smyl_cash_close_reconciliation', 'public.smyl_close_cash_session(uuid,integer,numeric,text)', false),
    ('20261127150000_smyl_cash_close_reconciliation', 'public.smyl_normalize_cash_reconciliation(jsonb,numeric,numeric)', true),
    ('20261127170000_smyl_finance_account_summaries', 'public.smyl_finance_accounts_base(date)', true),
    ('20261127170000_smyl_finance_account_summaries', 'public.smyl_finance_account_summaries(text,text,integer,integer,date)', true),
    ('20261127170000_smyl_finance_account_summaries', 'public.smyl_finance_account_counts(date)', true),
    ('20261015050000_smyl_chat_finance_scopes', 'public.smyl_can_access_finance_patient(uuid,uuid,uuid)', true),
    ('20261015050000_smyl_chat_finance_scopes', 'public.smyl_can_access_finance_branch(uuid,uuid)', true),
    ('20261116130000_smyl_payment_links', 'public.smyl_open_charges_for_link(uuid,uuid,uuid[])', true),
    ('20261012340000_smyl_finance_actions', 'public.smyl_post_payment(uuid,uuid,uuid,uuid,uuid,numeric,text,text,timestamp with time zone,jsonb)', true),
    ('20261012340000_smyl_finance_actions', 'public.smyl_post_cash_adjustment(uuid,uuid,uuid,text,numeric,text)', true)
  ) as t(migration, signature, must_exist) loop
    check_name := (case when c.must_exist then 'función ' else 'ya no existe ' end) || c.signature;
    ok := (to_regprocedure(c.signature) is not null) = c.must_exist;
    migration := c.migration;
    detail := case when ok then 'ok' when c.must_exist then 'falta: aplica la migración' else 'sigue existiendo la versión anterior: aplica la migración' end;
    return next;
  end loop;

  -- Columnas nuevas.
  for c in select * from (values
    ('20261127120000_smyl_finance_cash_integrity', 'smyl_finance_refunds', 'refund_method'),
    ('20261127120000_smyl_finance_cash_integrity', 'smyl_finance_refunds', 'refund_cash_session_id'),
    ('20261127120000_smyl_finance_cash_integrity', 'smyl_finance_refunds', 'refund_branch_id'),
    ('20261127120000_smyl_finance_cash_integrity', 'smyl_finance_refunds', 'reference'),
    ('20261127150000_smyl_cash_close_reconciliation', 'smyl_cash_sessions', 'close_reconciliation')
  ) as t(migration, tbl, col) loop
    check_name := 'columna ' || c.tbl || '.' || c.col;
    ok := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = c.tbl and column_name = c.col);
    migration := c.migration; detail := case when ok then 'ok' else 'falta: aplica la migración' end;
    return next;
  end loop;

  -- Disparadores que congelan una caja cerrada.
  for c in select * from (values
    ('smyl_payments_lock_cash_session', 'smyl_finance_payments'),
    ('smyl_adjustments_lock_cash_session', 'smyl_cash_adjustments'),
    ('smyl_refunds_lock_cash_session', 'smyl_finance_refunds')
  ) as t(trg, tbl) loop
    check_name := 'disparador ' || c.trg;
    ok := exists (select 1 from pg_trigger g join pg_class k on k.oid = g.tgrelid join pg_namespace n on n.oid = k.relnamespace
                   where n.nspname = 'public' and k.relname = c.tbl and g.tgname = c.trg and not g.tgisinternal);
    migration := '20261127120000_smyl_finance_cash_integrity'; detail := case when ok then 'ok' else 'falta: aplica la migración' end;
    return next;
  end loop;

  -- Tablas de suscripción (Openpay) y de costos internos.
  for c in select * from (values
    ('20261123140000_smyl_openpay_billing', 'smyl_billing_plans'), ('20261123140000_smyl_openpay_billing', 'smyl_billing_customers'),
    ('20261123140000_smyl_openpay_billing', 'smyl_billing_subscriptions'), ('20261123140000_smyl_openpay_billing', 'smyl_billing_events'),
    ('20261124120000_smyl_provider_pricing', 'smyl_provider_prices'), ('20261124120000_smyl_provider_pricing', 'smyl_ai_operations')
  ) as t(migration, tbl) loop
    check_name := 'tabla ' || c.tbl;
    ok := to_regclass('public.' || c.tbl) is not null;
    migration := c.migration; detail := case when ok then 'ok' else 'falta: aplica la migración' end;
    return next;
  end loop;

  -- Los planes de suscripción deben estar registrados para el ambiente en uso (al menos uno de los dos).
  check_name := 'planes de Openpay registrados (6 por ambiente)'; migration := '20261123140000_smyl_openpay_billing';
  if to_regclass('public.smyl_billing_plans') is null then
    ok := false; detail := 'falta la tabla: aplica la migración';
  else
    execute 'select coalesce(max(n), 0) >= 6, coalesce(string_agg(environment || ''='' || n, '', ''), ''sin planes registrados'')
               from (select environment, count(*) as n from public.smyl_billing_plans group by environment) x' into ok, detail;
  end if;
  return next;
end $$;
revoke all on function public.smyl_finance_deploy_check() from public, anon, authenticated;
grant execute on function public.smyl_finance_deploy_check() to service_role;

commit;
