-- SMYL · Avisos de cita: historial de lo que se envió (o falló) al paciente y al dentista por cada cita.
-- Lo escribe la app tras cada envío (RPC con permiso) y lo lee quien puede ver esa cita. Sirve para mostrar
-- «ya se avisó» entre sesiones y dispositivos y el estado de entrega en la ficha. No contiene el texto del mensaje.
-- Aditiva e idempotente.

begin;

create table if not exists public.smyl_appointment_notice_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  appointment_id uuid not null,
  event text not null check (event in ('confirmed', 'rescheduled', 'cancelled')),
  audience text not null check (audience in ('patient', 'professional')),
  template_name text not null check (template_name ~ '^[a-z0-9_]{3,200}$'),
  status text not null check (status in ('sent', 'failed')),
  error text not null default '' check (char_length(error) <= 300),
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id) on delete cascade
);

create index if not exists smyl_appointment_notice_log_appointment_idx
  on public.smyl_appointment_notice_log(tenant_id, appointment_id, created_at desc);

alter table public.smyl_appointment_notice_log enable row level security;
-- Solo se ven los avisos de citas que el rol ya puede ver (la política de smyl_appointments se aplica en el exists).
drop policy if exists smyl_appointment_notice_log_read on public.smyl_appointment_notice_log;
create policy smyl_appointment_notice_log_read on public.smyl_appointment_notice_log
  for select to authenticated using (
    public.smyl_has_permission(tenant_id, 'schedule.read')
    and exists (select 1 from public.smyl_appointments a where a.tenant_id = smyl_appointment_notice_log.tenant_id and a.id = smyl_appointment_notice_log.appointment_id)
  );
revoke all on table public.smyl_appointment_notice_log from anon;
revoke insert, update, delete on table public.smyl_appointment_notice_log from authenticated;
grant select on public.smyl_appointment_notice_log to authenticated;

-- Registra un envío. Tenant y permiso salen de auth.uid(); la cita debe ser de la clínica.
create or replace function public.smyl_log_appointment_notice(
  p_appointment_id uuid, p_event text, p_audience text, p_template_name text, p_status text, p_error text default ''
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_id uuid;
begin
  if v_tenant is null or not (public.smyl_has_permission(v_tenant, 'messages.respond') or public.smyl_has_permission(v_tenant, 'schedule.manage')) then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar avisos de cita.';
  end if;
  if p_event not in ('confirmed', 'rescheduled', 'cancelled') or p_audience not in ('patient', 'professional')
     or p_status not in ('sent', 'failed') or coalesce(p_template_name, '') !~ '^[a-z0-9_]{3,200}$' then
    raise exception using errcode = '22023', message = 'Aviso no válido.';
  end if;
  if not exists (select 1 from public.smyl_appointments a where a.tenant_id = v_tenant and a.id = p_appointment_id) then
    raise exception using errcode = '22023', message = 'La cita no existe en esta clínica.';
  end if;
  insert into public.smyl_appointment_notice_log(tenant_id, appointment_id, event, audience, template_name, status, error, sent_by)
  values (v_tenant, p_appointment_id, p_event, p_audience, p_template_name, p_status, left(coalesce(p_error, ''), 300), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.smyl_log_appointment_notice(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.smyl_log_appointment_notice(uuid, text, text, text, text, text) to authenticated;

commit;
