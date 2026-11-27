-- SMYL · Finanzas: conciliación del corte como DATOS (auditoría 2026-11-26, bloque 2).
--
-- Hasta hoy la conciliación por forma de pago (efectivo, tarjeta, transferencia…) solo existía como TEXTO dentro de close_notes
-- («Cierre de turno. Conciliación: Efectivo esperado $X, reportado $Y, diferencia $Z; …»), cortado a 1,000 caracteres y vuelto a interpretar
-- por la pantalla. Ahora el cierre guarda la conciliación estructurada en smyl_cash_sessions.close_reconciliation, validada en el servidor:
--   · el efectivo esperado lo calcula SIEMPRE la base (smyl_cash_expected), no el navegador;
--   · el efectivo reportado debe coincidir con el efectivo contado del corte;
--   · cada diferencia se recalcula en el servidor;
--   · una forma de pago no puede repetirse.
-- close_notes se sigue escribiendo igual (cortes anteriores y lectores antiguos no cambian). Aditiva y repetible.

begin;

alter table public.smyl_cash_sessions
  add column if not exists close_reconciliation jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_cash_sessions_close_reconciliation_check') then
    alter table public.smyl_cash_sessions
      add constraint smyl_cash_sessions_close_reconciliation_check check (close_reconciliation is null or jsonb_typeof(close_reconciliation) = 'object');
  end if;
end $$;
comment on column public.smyl_cash_sessions.close_reconciliation is
  'Conciliación del corte: {type, methods:[{method, expected, reported, variance}], variance_total, reason, notes, recorded_at}. NULL = corte anterior (solo texto en close_notes).';

-- Valida y normaliza la conciliación que manda el navegador.
create or replace function public.smyl_normalize_cash_reconciliation(p_input jsonb, p_expected_cash numeric, p_counted_cash numeric)
returns jsonb
language plpgsql stable set search_path = pg_catalog, public as $$
declare
  v_item jsonb; v_method text; v_expected numeric; v_reported numeric; v_out jsonb := '[]'::jsonb; v_seen text[] := '{}'; v_total numeric := 0; v_has_cash boolean := false;
  v_type text := coalesce(p_input->>'type', 'shift'); v_reason text := left(btrim(coalesce(p_input->>'reason', '')), 200); v_notes text := left(btrim(coalesce(p_input->>'notes', '')), 800);
begin
  if p_input is null then return null; end if;
  if jsonb_typeof(p_input) <> 'object' or jsonb_typeof(p_input->'methods') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'La conciliación no tiene el formato esperado.';
  end if;
  if v_type not in ('shift', 'day') then raise exception using errcode = '22023', message = 'Tipo de corte inválido.'; end if;
  if jsonb_array_length(p_input->'methods') not between 1 and 5 then raise exception using errcode = '22023', message = 'La conciliación debe incluir de 1 a 5 formas de pago.'; end if;
  for v_item in select value from jsonb_array_elements(p_input->'methods') loop
    v_method := v_item->>'method';
    if v_method is null or v_method not in ('cash', 'card', 'transfer', 'check', 'other') then raise exception using errcode = '22023', message = 'Forma de pago inválida en la conciliación.'; end if;
    if v_method = any(v_seen) then raise exception using errcode = '22023', message = 'Una forma de pago aparece dos veces en la conciliación.'; end if;
    v_seen := v_seen || v_method;
    begin
      v_expected := round((v_item->>'expected')::numeric, 2); v_reported := round((v_item->>'reported')::numeric, 2);
    exception when others then raise exception using errcode = '22023', message = 'Importes inválidos en la conciliación.';
    end;
    if v_reported < 0 then raise exception using errcode = '22003', message = 'El importe reportado no puede ser negativo.'; end if;
    if v_method = 'cash' then
      v_has_cash := true;
      v_expected := round(p_expected_cash, 2); -- lo calcula la base, no el navegador
      if v_reported <> round(p_counted_cash, 2) then raise exception using errcode = '23514', message = 'El efectivo reportado en la conciliación no coincide con el efectivo contado.'; end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('method', v_method, 'expected', v_expected, 'reported', v_reported, 'variance', round(v_reported - v_expected, 2)));
    v_total := v_total + round(v_reported - v_expected, 2);
  end loop;
  if not v_has_cash then raise exception using errcode = '22023', message = 'La conciliación debe incluir el efectivo.'; end if;
  return jsonb_build_object('type', v_type, 'methods', v_out, 'variance_total', round(v_total, 2), 'reason', v_reason, 'notes', v_notes, 'recorded_at', now());
end $$;
revoke all on function public.smyl_normalize_cash_reconciliation(jsonb, numeric, numeric) from public, anon, authenticated;
grant execute on function public.smyl_normalize_cash_reconciliation(jsonb, numeric, numeric) to service_role;

-- Cierre: igual que antes + conciliación estructurada opcional (los clientes anteriores siguen funcionando).
drop function if exists public.smyl_close_cash_session(uuid, integer, numeric, text);
create or replace function public.smyl_close_cash_session(
  p_session_id uuid, p_expected_revision integer, p_counted_cash numeric, p_notes text default '', p_reconciliation jsonb default null
)
returns public.smyl_cash_sessions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_cash_sessions; v_expected numeric; v_recon jsonb;
begin
  if not public.smyl_has_permission(v_tenant, 'finance.manage') then raise exception using errcode = '42501', message = 'Sin permiso.'; end if;
  select * into v_row from public.smyl_cash_sessions where tenant_id = v_tenant and id = p_session_id for update;
  if not found or v_row.status <> 'open' then raise exception using errcode = '23514', message = 'La caja ya no está abierta.'; end if;
  if v_row.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'La caja cambió en otra sesión.'; end if;
  v_expected := public.smyl_cash_expected(v_tenant, p_session_id);
  v_recon := public.smyl_normalize_cash_reconciliation(p_reconciliation, v_expected, p_counted_cash);
  update public.smyl_cash_sessions
     set status = 'closed', expected_cash = v_expected, counted_cash = p_counted_cash, variance = p_counted_cash - v_expected,
         close_notes = coalesce(p_notes, ''), close_reconciliation = v_recon, closed_by = auth.uid(), closed_at = now(), revision = revision + 1
   where tenant_id = v_tenant and id = p_session_id returning * into v_row;
  return v_row;
end $$;
revoke all on function public.smyl_close_cash_session(uuid, integer, numeric, text, jsonb) from public, anon;
grant execute on function public.smyl_close_cash_session(uuid, integer, numeric, text, jsonb) to authenticated, service_role;

commit;
