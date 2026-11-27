-- Cumplimiento sanitario del consultorio: bitácoras y carpeta para inspección (COFEPRIS).
--
-- Lo que pide una visita de verificación es evidencia escrita, con fecha y responsable, de que se cumple lo que dicen las normas.
-- Esta migración agrega lo que SMYL todavía no registraba, y un resumen de lo que ya registra:
--   * smyl_sterilization_logs  · ciclos de autoclave y testigo biológico (NOM-013-SSA2-2015, 8.22 y 8.24: testigo cada 2 meses).
--   * smyl_rpbi_logs           · recolecciones de residuos peligrosos biológico-infecciosos con su manifiesto (NOM-087).
--   * smyl_compliance_items    · requisitos y documentos del consultorio (aviso de funcionamiento, responsable sanitario, etc.):
--                                si se tiene, folio y vigencia. No guarda el archivo; el original lo conserva la clínica.
--   * smyl_compliance_overview · resumen para la carpeta: bitácoras + actividad clínica del periodo, calculada en el servidor.
-- Las bitácoras no se editan ni se eliminan (retención, igual que consentimientos y tratamientos). Solo se usa con funciones.
-- Aditiva e idempotente. No modifica ninguna tabla existente.

create table if not exists public.smyl_sterilization_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid,
  kind text not null check (kind in ('cycle', 'biological_test')),
  occurred_at timestamptz not null default now(),
  device text check (device is null or char_length(btrim(device)) between 1 and 60),
  temperature_c smallint check (temperature_c is null or temperature_c between 100 and 200),
  minutes smallint check (minutes is null or minutes between 1 and 120),
  indicator_ok boolean,
  bio_result text check (bio_result is null or bio_result in ('negative', 'positive')),
  notes text not null default '' check (char_length(notes) <= 500),
  recorded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint smyl_steril_cycle_indicator check (kind <> 'cycle' or indicator_ok is not null),
  constraint smyl_steril_bio_result check (kind <> 'biological_test' or bio_result is not null)
);
create index if not exists smyl_sterilization_logs_idx on public.smyl_sterilization_logs (tenant_id, kind, occurred_at desc);

create table if not exists public.smyl_rpbi_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid,
  collected_at date not null default current_date,
  company text not null default '' check (char_length(company) <= 120),
  manifest text not null default '' check (char_length(manifest) <= 60),
  kg numeric(6,1) check (kg is null or kg between 0 and 9999),
  notes text not null default '' check (char_length(notes) <= 500),
  recorded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists smyl_rpbi_logs_idx on public.smyl_rpbi_logs (tenant_id, collected_at desc);

create table if not exists public.smyl_compliance_items (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  item_key text not null check (item_key ~ '^[a-z0-9_]{3,40}$'),
  status text not null check (status in ('have', 'not_applicable')),
  reference text not null default '' check (char_length(reference) <= 120),
  valid_until date,
  notes text not null default '' check (char_length(notes) <= 500),
  updated_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, item_key)
);

alter table public.smyl_sterilization_logs enable row level security;
alter table public.smyl_rpbi_logs enable row level security;
alter table public.smyl_compliance_items enable row level security;
revoke all on public.smyl_sterilization_logs from public, anon, authenticated;
revoke all on public.smyl_rpbi_logs from public, anon, authenticated;
revoke all on public.smyl_compliance_items from public, anon, authenticated;

-- Las bitácoras no se modifican ni se borran (solo la depuración de retención NOM-004 de 5 años).
create or replace function public.smyl_compliance_log_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
      raise exception using errcode = '55000', message = 'Un registro de bitácora no se puede eliminar.';
    end if;
    return old;
  end if;
  raise exception using errcode = '55000', message = 'Un registro de bitácora no se modifica. Agrega uno nuevo con la corrección.';
end;
$$;
drop trigger if exists smyl_sterilization_logs_guard on public.smyl_sterilization_logs;
create trigger smyl_sterilization_logs_guard before update or delete on public.smyl_sterilization_logs
  for each row execute function public.smyl_compliance_log_guard();
drop trigger if exists smyl_rpbi_logs_guard on public.smyl_rpbi_logs;
create trigger smyl_rpbi_logs_guard before update or delete on public.smyl_rpbi_logs
  for each row execute function public.smyl_compliance_log_guard();

drop trigger if exists smyl_sterilization_logs_audit on public.smyl_sterilization_logs;
create trigger smyl_sterilization_logs_audit after insert on public.smyl_sterilization_logs
  for each row execute function public.smyl_audit_row();
drop trigger if exists smyl_rpbi_logs_audit on public.smyl_rpbi_logs;
create trigger smyl_rpbi_logs_audit after insert on public.smyl_rpbi_logs
  for each row execute function public.smyl_audit_row();
drop trigger if exists smyl_compliance_items_audit on public.smyl_compliance_items;
create trigger smyl_compliance_items_audit after insert or update or delete on public.smyl_compliance_items
  for each row execute function public.smyl_audit_row();

-- Sucursal opcional: debe ser de la clínica.
create or replace function public.smyl_compliance_branch(p_tenant uuid, p_branch text)
returns uuid
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare v uuid;
begin
  if p_branch is null or btrim(p_branch) = '' then return null; end if;
  begin v := p_branch::uuid; exception when others then
    raise exception using errcode = '22023', message = 'La sucursal no es válida.';
  end;
  if not exists (select 1 from public.smyl_branches where tenant_id = p_tenant and id = v) then
    raise exception using errcode = '22023', message = 'La sucursal no pertenece a tu clínica.';
  end if;
  return v;
end;
$$;

-- Registrar un ciclo de autoclave (p_kind 'cycle') o un testigo biológico (p_kind 'biological_test').
-- p_values: {occurred_at?, branch_id?, device?, temperature_c?, minutes?, indicator_ok?, bio_result?, notes?}
create or replace function public.smyl_log_sterilization(p_kind text, p_values jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v jsonb := coalesce(p_values, '{}'::jsonb);
  v_at timestamptz; v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar esterilización.';
  end if;
  if coalesce(p_kind, '') not in ('cycle', 'biological_test') then
    raise exception using errcode = '22023', message = 'El tipo de registro no es válido.';
  end if;
  v_at := coalesce(nullif(v->>'occurred_at', '')::timestamptz, now());
  if v_at > now() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'La fecha del registro no puede ser futura.';
  end if;
  if p_kind = 'cycle' and (v->>'indicator_ok') is null then
    raise exception using errcode = '22023', message = 'Indica si el indicador químico del ciclo fue correcto.';
  end if;
  if p_kind = 'biological_test' and coalesce(v->>'bio_result', '') not in ('negative', 'positive') then
    raise exception using errcode = '22023', message = 'Indica el resultado del testigo biológico (negativo o positivo).';
  end if;
  if nullif(v->>'temperature_c', '') is not null and (v->>'temperature_c')::numeric not between 100 and 200 then
    raise exception using errcode = '22023', message = 'La temperatura del ciclo debe estar entre 100 y 200 °C.';
  end if;
  if nullif(v->>'minutes', '') is not null and (v->>'minutes')::numeric not between 1 and 120 then
    raise exception using errcode = '22023', message = 'La duración del ciclo debe ser de 1 a 120 minutos.';
  end if;
  insert into public.smyl_sterilization_logs (tenant_id, branch_id, kind, occurred_at, device, temperature_c, minutes, indicator_ok, bio_result, notes)
  values (v_tenant, public.smyl_compliance_branch(v_tenant, v->>'branch_id'), p_kind, v_at,
          nullif(left(btrim(coalesce(v->>'device', '')), 60), ''),
          nullif(v->>'temperature_c', '')::smallint, nullif(v->>'minutes', '')::smallint,
          case when p_kind = 'cycle' then (v->>'indicator_ok')::boolean end,
          case when p_kind = 'biological_test' then v->>'bio_result' end,
          left(btrim(coalesce(v->>'notes', '')), 500))
  returning id into v_id;
  return v_id;
end;
$$;

-- Registrar una recolección de RPBI. p_values: {collected_at?, branch_id?, company?, manifest?, kg?, notes?}
create or replace function public.smyl_log_rpbi(p_values jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v jsonb := coalesce(p_values, '{}'::jsonb);
  v_date date; v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar residuos.';
  end if;
  v_date := coalesce(nullif(v->>'collected_at', '')::date, current_date);
  if v_date > current_date then
    raise exception using errcode = '22023', message = 'La fecha de la recolección no puede ser futura.';
  end if;
  if char_length(btrim(coalesce(v->>'manifest', ''))) < 1 then
    raise exception using errcode = '22023', message = 'Escribe el número del manifiesto de recolección.';
  end if;
  if nullif(v->>'kg', '') is not null and (v->>'kg')::numeric not between 0 and 9999 then
    raise exception using errcode = '22023', message = 'Los kilos de residuos deben estar entre 0 y 9999.';
  end if;
  insert into public.smyl_rpbi_logs (tenant_id, branch_id, collected_at, company, manifest, kg, notes)
  values (v_tenant, public.smyl_compliance_branch(v_tenant, v->>'branch_id'), v_date,
          left(btrim(coalesce(v->>'company', '')), 120), left(btrim(v->>'manifest'), 60),
          nullif(v->>'kg', '')::numeric, left(btrim(coalesce(v->>'notes', '')), 500))
  returning id into v_id;
  return v_id;
end;
$$;

-- Marcar un requisito del consultorio: lo tengo (con folio y vigencia) o no aplica. p_status 'clear' lo quita.
create or replace function public.smyl_set_compliance_item(
  p_key text, p_status text, p_reference text default '', p_valid_until date default null, p_notes text default '')
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para actualizar los requisitos del consultorio.';
  end if;
  if coalesce(p_key, '') !~ '^[a-z0-9_]{3,40}$' then
    raise exception using errcode = '22023', message = 'El requisito no es válido.';
  end if;
  if p_status = 'clear' then
    delete from public.smyl_compliance_items where tenant_id = v_tenant and item_key = p_key;
    return;
  end if;
  if coalesce(p_status, '') not in ('have', 'not_applicable') then
    raise exception using errcode = '22023', message = 'El estado del requisito no es válido.';
  end if;
  insert into public.smyl_compliance_items (tenant_id, item_key, status, reference, valid_until, notes, updated_by, updated_at)
  values (v_tenant, p_key, p_status, left(btrim(coalesce(p_reference, '')), 120), p_valid_until, left(btrim(coalesce(p_notes, '')), 500), auth.uid(), now())
  on conflict (tenant_id, item_key) do update
    set status = excluded.status, reference = excluded.reference, valid_until = excluded.valid_until,
        notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- Resumen para la carpeta: bitácoras + actividad clínica del periodo (por defecto, los últimos 12 meses).
create or replace function public.smyl_compliance_overview(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_from timestamptz := coalesce(p_from, (current_date - interval '12 months')::date)::timestamptz;
  v_to timestamptz := (coalesce(p_to, current_date) + 1)::timestamptz;
  v_steril jsonb; v_rpbi jsonb; v_items jsonb; v_activity jsonb := '{}'::jsonb;
  v_signed int := 0; v_draft int := 0; v_verified int := 0; v_consents int := 0; v_revoked int := 0; v_visits int := 0;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.read') then
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar el cumplimiento del consultorio.';
  end if;

  select jsonb_build_object(
    'cycles', (select count(*) from public.smyl_sterilization_logs where tenant_id = v_tenant and kind = 'cycle' and occurred_at >= v_from and occurred_at < v_to),
    'bio_tests', (select count(*) from public.smyl_sterilization_logs where tenant_id = v_tenant and kind = 'biological_test' and occurred_at >= v_from and occurred_at < v_to),
    'last_cycle_at', (select max(occurred_at) from public.smyl_sterilization_logs where tenant_id = v_tenant and kind = 'cycle'),
    'last_bio_at', (select max(occurred_at) from public.smyl_sterilization_logs where tenant_id = v_tenant and kind = 'biological_test'),
    'last_bio_result', (select bio_result from public.smyl_sterilization_logs where tenant_id = v_tenant and kind = 'biological_test' order by occurred_at desc limit 1),
    'positives', (select count(*) from public.smyl_sterilization_logs where tenant_id = v_tenant and bio_result = 'positive' and occurred_at >= v_from and occurred_at < v_to),
    'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.occurred_at desc) from (
        select id, kind, occurred_at, device, temperature_c, minutes, indicator_ok, bio_result, notes
          from public.smyl_sterilization_logs where tenant_id = v_tenant and occurred_at >= v_from and occurred_at < v_to
         order by occurred_at desc limit 40) r), '[]'::jsonb))
  into v_steril;

  select jsonb_build_object(
    'collections', (select count(*) from public.smyl_rpbi_logs where tenant_id = v_tenant and collected_at >= v_from::date and collected_at < v_to::date),
    'kg', (select coalesce(sum(kg), 0) from public.smyl_rpbi_logs where tenant_id = v_tenant and collected_at >= v_from::date and collected_at < v_to::date),
    'last_at', (select max(collected_at) from public.smyl_rpbi_logs where tenant_id = v_tenant),
    'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.collected_at desc) from (
        select id, collected_at, company, manifest, kg, notes
          from public.smyl_rpbi_logs where tenant_id = v_tenant and collected_at >= v_from::date and collected_at < v_to::date
         order by collected_at desc limit 40) r), '[]'::jsonb))
  into v_rpbi;

  select coalesce(jsonb_agg(jsonb_build_object('key', item_key, 'status', status, 'reference', reference, 'valid_until', valid_until, 'notes', notes, 'updated_at', updated_at)), '[]'::jsonb)
    into v_items from public.smyl_compliance_items where tenant_id = v_tenant;

  select count(*) filter (where status = 'signed' and signed_at >= v_from and signed_at < v_to),
         count(*) filter (where status = 'draft' and created_at >= v_from and created_at < v_to),
         count(*) filter (where status = 'signed' and signed_at >= v_from and signed_at < v_to and document ? 'procedure')
    into v_signed, v_draft, v_verified from public.smyl_clinical_notes where tenant_id = v_tenant;
  if to_regclass('public.smyl_informed_consents') is not null then
    execute 'select count(*) filter (where signed_at >= $2 and signed_at < $3), count(*) filter (where revoked_at >= $2 and revoked_at < $3) from public.smyl_informed_consents where tenant_id = $1'
      into v_consents, v_revoked using v_tenant, v_from, v_to;
  end if;
  select count(*) into v_visits from public.smyl_appointments
   where tenant_id = v_tenant and status in ('completed', 'in_progress', 'arrived') and starts_at >= v_from and starts_at < v_to;

  v_activity := jsonb_build_object('signed_notes', v_signed, 'draft_notes', v_draft, 'verified_procedures', v_verified,
                                   'consents_signed', v_consents, 'consents_revoked', v_revoked, 'visits', v_visits);
  return jsonb_build_object('from', v_from::date, 'to', (v_to - interval '1 day')::date, 'sterilization', v_steril, 'rpbi', v_rpbi, 'items', v_items, 'activity', v_activity);
end;
$$;

revoke all on function public.smyl_compliance_log_guard() from public, anon, authenticated;
revoke all on function public.smyl_compliance_branch(uuid, text) from public, anon, authenticated;
revoke all on function public.smyl_log_sterilization(text, jsonb) from public, anon;
revoke all on function public.smyl_log_rpbi(jsonb) from public, anon;
revoke all on function public.smyl_set_compliance_item(text, text, text, date, text) from public, anon;
revoke all on function public.smyl_compliance_overview(date, date) from public, anon;
grant execute on function public.smyl_log_sterilization(text, jsonb) to authenticated;
grant execute on function public.smyl_log_rpbi(jsonb) to authenticated;
grant execute on function public.smyl_set_compliance_item(text, text, text, date, text) to authenticated;
grant execute on function public.smyl_compliance_overview(date, date) to authenticated;
