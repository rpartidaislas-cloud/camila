-- Cobros · Pacientes pendientes de cargo: citas que llegaron y se cierran «sin cargo» con motivo.
--   * La lista de pendientes NO se guarda: se calcula en Cobros (cita que llegó/está en consulta/terminó, sin cargo vigente
--     y sin esta decisión). Aquí sólo se guarda la decisión «sin cargo» (revisión, garantía, cortesía u otro) y quién la tomó.
--   * Escritura sólo por funciones que derivan clínica y usuario de la sesión (permiso finance.manage); lectura con finance.read.
--   * Reversible: smyl_reopen_appointment_charge vuelve a mostrar la cita como pendiente. Ambas acciones quedan en auditoría.
-- No toca cargos, pagos ni citas existentes. Idempotente.

create table if not exists public.smyl_appointment_no_charge (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  appointment_id uuid not null,
  reason text not null check (reason in ('review','warranty','courtesy','other')),
  note text not null default '' check (char_length(note) <= 300),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (tenant_id, appointment_id),
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id) on delete cascade
);

alter table public.smyl_appointment_no_charge enable row level security;
revoke all on public.smyl_appointment_no_charge from public, anon, authenticated;
grant select on public.smyl_appointment_no_charge to authenticated;

drop policy if exists smyl_appointment_no_charge_read on public.smyl_appointment_no_charge;
create policy smyl_appointment_no_charge_read on public.smyl_appointment_no_charge for select to authenticated
  using (tenant_id in (select public.smyl_tenants_with_permission('finance.read')));

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
  if coalesce(p_reason, '') not in ('review', 'warranty', 'courtesy', 'other') then
    raise exception using errcode = '22023', message = 'Elige el motivo.';
  end if;
  select a.status into v_status from public.smyl_appointments a where a.tenant_id = v_tenant and a.id = p_appointment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'La cita no existe en tu clínica.';
  end if;
  if v_status not in ('arrived', 'in_progress', 'completed') then
    raise exception using errcode = '23514', message = 'Sólo las citas en las que el paciente ya llegó pueden cerrarse sin cargo.';
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

create or replace function public.smyl_reopen_appointment_charge(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_before jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'finance.manage') then
    raise exception using errcode = '42501', message = 'Sin permiso para reabrir el cobro de una visita.';
  end if;
  delete from public.smyl_appointment_no_charge n
   where n.tenant_id = v_tenant and n.appointment_id = p_appointment_id
  returning jsonb_build_object('reason', n.reason) into v_before;
  if v_before is not null then
    insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, before_data)
    values (v_tenant, auth.uid(), 'delete', 'appointment_no_charge', p_appointment_id::text, v_before);
  end if;
end;
$function$;

revoke all on function public.smyl_mark_appointment_no_charge(uuid, text, text) from public, anon;
revoke all on function public.smyl_reopen_appointment_charge(uuid) from public, anon;
grant execute on function public.smyl_mark_appointment_no_charge(uuid, text, text) to authenticated;
grant execute on function public.smyl_reopen_appointment_charge(uuid) to authenticated;
