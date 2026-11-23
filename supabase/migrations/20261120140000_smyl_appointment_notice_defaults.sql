-- SMYL · Avisos de cita: qué plantilla de WhatsApp se ofrece por defecto para cada evento de una cita
-- (confirmada, reprogramada, cancelada, recordatorio) y para cada destinatario (paciente o profesional).
-- Solo guarda el NOMBRE de la plantilla; que esté aprobada por Meta lo valida la pantalla y lana-inbox al enviar.
-- Aditiva e idempotente. No envía nada: el envío sigue siendo una acción humana desde la Agenda o el chat.

begin;

create table if not exists public.smyl_appointment_notice_defaults (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  event text not null check (event in ('confirmed', 'rescheduled', 'cancelled', 'reminder')),
  audience text not null check (audience in ('patient', 'professional')),
  template_name text not null check (template_name ~ '^[a-z0-9_]{3,200}$'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, event, audience),
  -- El recordatorio previo solo existe para el paciente.
  check (event <> 'reminder' or audience = 'patient')
);

drop trigger if exists smyl_appointment_notice_defaults_touch on public.smyl_appointment_notice_defaults;
create trigger smyl_appointment_notice_defaults_touch before update on public.smyl_appointment_notice_defaults
  for each row execute function public.smyl_touch_updated_at();
drop trigger if exists smyl_appointment_notice_defaults_audit on public.smyl_appointment_notice_defaults;
create trigger smyl_appointment_notice_defaults_audit after insert or update or delete on public.smyl_appointment_notice_defaults
  for each row execute function public.smyl_audit_row();

alter table public.smyl_appointment_notice_defaults enable row level security;
-- Quien trabaja la agenda necesita leerlos para ofrecer el aviso al confirmar, reprogramar o cancelar.
drop policy if exists smyl_appointment_notice_defaults_read on public.smyl_appointment_notice_defaults;
create policy smyl_appointment_notice_defaults_read on public.smyl_appointment_notice_defaults
  for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
revoke all on table public.smyl_appointment_notice_defaults from anon;
revoke insert, update, delete on table public.smyl_appointment_notice_defaults from authenticated;
grant select on public.smyl_appointment_notice_defaults to authenticated;

-- Guarda (o quita, con nombre vacío) la plantilla por defecto. Tenant y permiso salen de auth.uid(), no del navegador.
create or replace function public.smyl_set_appointment_notice_default(p_event text, p_audience text, p_template_name text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_name text := lower(btrim(coalesce(p_template_name, '')));
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para cambiar los avisos de cita.';
  end if;
  if p_event not in ('confirmed', 'rescheduled', 'cancelled', 'reminder') or p_audience not in ('patient', 'professional')
     or (p_event = 'reminder' and p_audience <> 'patient') then
    raise exception using errcode = '22023', message = 'Aviso no válido.';
  end if;
  if v_name = '' then
    delete from public.smyl_appointment_notice_defaults
     where tenant_id = v_tenant and event = p_event and audience = p_audience;
    return jsonb_build_object('event', p_event, 'audience', p_audience, 'template_name', null);
  end if;
  if v_name !~ '^[a-z0-9_]{3,200}$' then
    raise exception using errcode = '22023', message = 'Nombre de plantilla no válido.';
  end if;
  insert into public.smyl_appointment_notice_defaults(tenant_id, event, audience, template_name, updated_by)
  values (v_tenant, p_event, p_audience, v_name, auth.uid())
  on conflict (tenant_id, event, audience)
  do update set template_name = excluded.template_name, updated_by = auth.uid();
  return jsonb_build_object('event', p_event, 'audience', p_audience, 'template_name', v_name);
end;
$$;
revoke all on function public.smyl_set_appointment_notice_default(text, text, text) from public, anon;
grant execute on function public.smyl_set_appointment_notice_default(text, text, text) to authenticated;

commit;
