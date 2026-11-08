-- Cobros · Cobro por «No vino»: monto fijo de la clínica, confirmación de recepción y «Perdonar».
--   * smyl_finance_settings: ajustes de cobro de la clínica. Hoy sólo no_show_fee (0 = apagado: nada se ofrece por inasistencias).
--     Lectura con finance.read; escritura sólo por smyl_set_no_show_fee (finance.manage, con auditoría).
--   * Una cita «No vino» sólo se ofrece para cobrar si el monto está configurado (> 0); nunca se cobra sola: recepción elige
--     «Cobrar inasistencia» (formulario de cargo de siempre) o «Perdonar» (decisión «sin cargo» con motivo «waived»).
--   * smyl_mark_appointment_no_charge ahora acepta citas «No vino» y el motivo «waived»;
--     smyl_appointment_billing devuelve no_show_pending (por cobrar la inasistencia) o, si no hay monto, free (sin etiqueta).
-- Requiere 20261108120000 y 20261108130000. No toca citas, cargos ni pagos existentes. Idempotente.

create table if not exists public.smyl_finance_settings (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  no_show_fee numeric(12,2) not null default 0 check (no_show_fee >= 0 and no_show_fee <= 1000000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.smyl_finance_settings enable row level security;
revoke all on public.smyl_finance_settings from public, anon, authenticated;
grant select on public.smyl_finance_settings to authenticated;

drop policy if exists smyl_finance_settings_read on public.smyl_finance_settings;
create policy smyl_finance_settings_read on public.smyl_finance_settings for select to authenticated
  using (tenant_id in (select public.smyl_tenants_with_permission('finance.read')));

create or replace function public.smyl_set_no_show_fee(p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_before numeric;
  v_amount numeric(12,2) := round(coalesce(p_amount, 0), 2);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'finance.manage') then
    raise exception using errcode = '42501', message = 'Sin permiso para cambiar el cobro por inasistencia.';
  end if;
  if v_amount < 0 or v_amount > 1000000 then
    raise exception using errcode = '22003', message = 'El monto no es válido.';
  end if;
  select s.no_show_fee into v_before from public.smyl_finance_settings s where s.tenant_id = v_tenant;
  insert into public.smyl_finance_settings (tenant_id, no_show_fee, updated_by, updated_at)
  values (v_tenant, v_amount, auth.uid(), now())
  on conflict (tenant_id) do update set no_show_fee = excluded.no_show_fee, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values (v_tenant, auth.uid(), case when v_before is null then 'insert' else 'update' end, 'no_show_fee', v_tenant::text,
          case when v_before is null then null else jsonb_build_object('no_show_fee', v_before) end, jsonb_build_object('no_show_fee', v_amount));
  return v_amount;
end;
$function$;

-- Motivo «waived» (perdonada) además de los anteriores.
alter table public.smyl_appointment_no_charge drop constraint if exists smyl_appointment_no_charge_reason_check;
alter table public.smyl_appointment_no_charge add constraint smyl_appointment_no_charge_reason_check
  check (reason in ('review', 'warranty', 'courtesy', 'other', 'waived'));

create or replace function public.smyl_mark_appointment_no_charge(
  p_appointment_id uuid,
  p_reason text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_status text;
  v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'finance.manage') then
    raise exception using errcode = '42501', message = 'Sin permiso para cerrar una visita sin cargo.';
  end if;
  if coalesce(p_reason, '') not in ('review', 'warranty', 'courtesy', 'other', 'waived') then
    raise exception using errcode = '22023', message = 'Elige el motivo.';
  end if;
  select a.status into v_status from public.smyl_appointments a where a.tenant_id = v_tenant and a.id = p_appointment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'La cita no existe en tu clínica.';
  end if;
  if v_status not in ('arrived', 'in_progress', 'completed', 'no_show') then
    raise exception using errcode = '23514', message = 'Sólo las citas en las que el paciente ya llegó, o a las que no vino, pueden cerrarse sin cargo.';
  end if;
  if exists (select 1 from public.smyl_finance_charges c where c.tenant_id = v_tenant and c.appointment_id = p_appointment_id and c.status <> 'voided') then
    raise exception using errcode = '23514', message = 'Esta cita ya tiene un cargo registrado.';
  end if;
  insert into public.smyl_appointment_no_charge (tenant_id, appointment_id, reason, note, decided_by, decided_at)
  values (v_tenant, p_appointment_id, p_reason, v_note, auth.uid(), now())
  on conflict (tenant_id, appointment_id) do update
    set reason = excluded.reason, note = excluded.note, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_tenant, auth.uid(), 'insert', 'appointment_no_charge', p_appointment_id::text, jsonb_build_object('reason', p_reason));
end;
$function$;

create or replace function public.smyl_appointment_billing(p_appointment_ids uuid[])
returns table (appointment_id uuid, billing_state text, charged_amount numeric, due_amount numeric)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_fee numeric(12,2);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'finance.read') then
    return;
  end if;
  if coalesce(array_length(p_appointment_ids, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_appointment_ids, 1) > 300 then
    raise exception using errcode = '22023', message = 'Demasiadas citas en una sola consulta.';
  end if;
  select coalesce((select s.no_show_fee from public.smyl_finance_settings s where s.tenant_id = v_tenant), 0) into v_fee;
  return query
  with charges as (
    select c.appointment_id as aid,
           sum(c.total_amount) as total,
           sum(greatest(c.total_amount
                 - (coalesce((select sum(x.amount) from public.smyl_finance_payment_allocations x where x.tenant_id = c.tenant_id and x.charge_id = c.id), 0)
                  - coalesce((select sum(r.amount) from public.smyl_finance_refund_allocations r where r.tenant_id = c.tenant_id and r.charge_id = c.id), 0)), 0)) as due
      from public.smyl_finance_charges c
     where c.tenant_id = v_tenant and c.appointment_id = any (p_appointment_ids) and c.status <> 'voided'
     group by c.appointment_id
  )
  select a.id,
         case when ch.aid is not null then case when ch.due > 0 then 'due' else 'paid' end
              when n.appointment_id is not null then 'no_charge'
              when a.status = 'no_show' then case when v_fee > 0 then 'no_show_pending' else 'free' end
              when s.reference_price is not null and s.reference_price = 0 then 'free'
              else 'pending' end,
         coalesce(ch.total, 0)::numeric,
         coalesce(ch.due, 0)::numeric
    from public.smyl_appointments a
    left join charges ch on ch.aid = a.id
    left join public.smyl_appointment_no_charge n on n.tenant_id = a.tenant_id and n.appointment_id = a.id
    left join public.smyl_services s on s.tenant_id = a.tenant_id and s.id = a.service_id
   where a.tenant_id = v_tenant
     and a.id = any (p_appointment_ids)
     and a.status in ('arrived', 'in_progress', 'completed', 'no_show');
end;
$function$;

revoke all on function public.smyl_set_no_show_fee(numeric) from public, anon;
revoke all on function public.smyl_mark_appointment_no_charge(uuid, text, text) from public, anon;
revoke all on function public.smyl_appointment_billing(uuid[]) from public, anon;
grant execute on function public.smyl_set_no_show_fee(numeric) to authenticated;
grant execute on function public.smyl_mark_appointment_no_charge(uuid, text, text) to authenticated;
grant execute on function public.smyl_appointment_billing(uuid[]) to authenticated;
